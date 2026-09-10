/**
 * Deliverables forwarder — Apps Script (runs in Google, not in the Next app).
 *
 * Bound to the backing inbox that the deliverables@alpharoc.ai Google Group delivers into.
 * On a ~5-minute trigger it POSTs deliverable submissions to the app's /api/deliverables/ingest
 * endpoint, then labels the thread done. Two sources are scanned:
 *
 *   1. INBOX — mail delivered via the Group (forwards, and BCC/CC from other people). A Gmail filter on
 *      `list:deliverables@alpharoc.ai` labels these "Deliverables". Per message we require
 *      cameViaDeliverables() so a forwarded thread's original siblings (teammates', the client's) are
 *      never ingested.
 *   2. SENT — YOUR OWN outbound that BCC'd (or CC'd) deliverables@. Gmail does not deliver the Group's
 *      echo of a message you sent back to your own inbox, so a self-BCC is never labeled in the inbox —
 *      its only copy is in Sent. Without this scan, BCC'ing deliverables@ on an email you send to a
 *      client silently does nothing.
 *
 * Script Properties required (Project Settings -> Script properties):
 *   INGEST_URL      e.g. https://survey-ops-tracker.vercel.app/api/deliverables/ingest
 *   WEBHOOK_SECRET  the same value set in Vercel
 *
 * One-time: run installTrigger() once, then authorize when prompted.
 */

var PROCESSED_LABEL = 'deliverables-filed';
// Only process mail routed via the deliverables@ Group. A Gmail filter on `list:deliverables@alpharoc.ai`
// applies this label (+ skips the inbox), so the script never scans unrelated inbox mail. This matters
// when the backing inbox also receives normal email — otherwise every internal email with an attachment
// or a Google/Occam/Edwin link would get ingested.
var SOURCE_LABEL = 'Deliverables';
// VERCEL REJECTS A SERVERLESS REQUEST BODY OVER 4.5 MB, and that is a platform
// limit no route config can raise. This was 26214400 (~25 MB) with a comment
// claiming it kept the POST "well under limits" — off by roughly six times, and
// worse than it looks: base64 inflates bytes by a third, so the cap really
// allowed a ~33 MB body.
//
// The visible cost was a 9.2 MB Bain Occam forward returning HTTP 413 every two
// hours from 2026-09-09 — 01:05, 03:03, 05:08, 07:13, 09:13, 11:18 — never
// filed, never replied to, retrying forever because a thread is only labelled
// done when every message posts OK.
//
// 3 MB of attachment is ~4 MB encoded, which leaves room for the body text and
// the JSON envelope inside 4.5 MB. The TOTAL is what matters, not any single
// file, so the budget below is spent across all of a message's attachments.
var MAX_TOTAL_ATTACHMENT_BYTES = 3145728;  // 3 MB of raw bytes per message
var MAX_ATTACHMENT_BYTES = 3145728;        // and no single file larger than that

function processInbox() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('INGEST_URL');
  var secret = props.getProperty('WEBHOOK_SECRET');
  if (!url || !secret) throw new Error('Set INGEST_URL and WEBHOOK_SECRET in Script Properties.');

  var label = GmailApp.getUserLabelByName(PROCESSED_LABEL) || GmailApp.createLabel(PROCESSED_LABEL);
  var failures = []; // non-2xx ingest responses this run — surfaced via a throttled alert email below

  // 1. Group-delivered mail (forwards, and BCC/CC from other people), labeled by the Gmail `list:` filter.
  processThreads(
    GmailApp.search('label:' + SOURCE_LABEL + ' -label:' + PROCESSED_LABEL + ' newer_than:7d', 0, 50),
    cameViaDeliverables, url, secret, label, failures
  );

  // 2. Your own outbound that BCC'd/CC'd deliverables@ — Gmail suppresses the Group's echo of your own
  //    posts, so these never reach the inbox (step 1 can't see them); their only copy is in Sent. Match
  //    on Bcc/Cc only — a forward addresses deliverables@ in To and is already handled by step 1, so
  //    excluding To here keeps forwards from being processed (and replied to) twice.
  processThreads(
    GmailApp.search(
      'in:sent -label:' + PROCESSED_LABEL + ' newer_than:7d ' +
        '(bcc:deliverables@alpharoc.ai OR cc:deliverables@alpharoc.ai)', 0, 50),
    sentToDeliverables, url, secret, label, failures
  );

  maybeAlert(props, failures);
}

/**
 * How many times a given message has failed to post.
 *
 * Kept in Script Properties beside the processed-id map, and pruned the same
 * way, so a long-lived failure cannot grow the property without bound. Exists so
 * a forward that can never succeed is reported ONCE and then left alone, instead
 * of emailing every two hours forever.
 */
var MAX_ATTEMPTS = 3;
var ATTEMPTS_KEY = 'INGEST_ATTEMPTS';

function readAttempts() {
  var raw = PropertiesService.getScriptProperties().getProperty(ATTEMPTS_KEY);
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (e) { return {}; }
}
function writeAttempts(map) {
  var keys = Object.keys(map);
  // Only failing messages are in here, so this stays tiny; the cap is a
  // belt-and-braces guard against a pathological run.
  if (keys.length > 200) {
    var trimmed = {};
    for (var i = keys.length - 200; i < keys.length; i++) trimmed[keys[i]] = map[keys[i]];
    map = trimmed;
  }
  PropertiesService.getScriptProperties().setProperty(ATTEMPTS_KEY, JSON.stringify(map));
}
function bumpAttempts(id) {
  var map = readAttempts();
  map[id] = (map[id] || 0) + 1;
  writeAttempts(map);
  return map[id];
}
function clearAttempts(id) {
  var map = readAttempts();
  if (map[id] === undefined) return;
  delete map[id];
  writeAttempts(map);
}

/**
 * POST every submission message in each thread to the ingest endpoint, then label the thread done.
 * isSubmission(msg) decides which messages in a thread are real submissions; the rest (original thread
 * siblings — teammates' or the client's mail, or the client's later replies) must never be ingested or
 * replied to. A thread is labeled done only when every submission in it posted OK, so a transient
 * failure retries next run (the server is idempotent on message id + file hash).
 */
function processThreads(threads, isSubmission, url, secret, label, failures) {
  for (var t = 0; t < threads.length; t++) {
    var thread = threads[t];
    var messages = thread.getMessages();
    var allOk = true;

    for (var m = 0; m < messages.length; m++) {
      var msg = messages[m];
      if (!isSubmission(msg)) continue;

      var attachments = [];
      var skipped = [];
      var budget = MAX_TOTAL_ATTACHMENT_BYTES;
      // includeInlineImages:false drops signature logos / tracking pixels at the source.
      var atts = msg.getAttachments({ includeInlineImages: false, includeAttachments: true });
      // Smallest first, so one oversized file cannot crowd out the small ones
      // that would have fitted. Filing three of four deliverables beats filing
      // none, which is what happened before.
      atts.sort(function (x, y) { return x.getSize() - y.getSize(); });
      for (var a = 0; a < atts.length; a++) {
        var blob = atts[a];
        var size = blob.getSize();
        if (size > MAX_ATTACHMENT_BYTES || size > budget) {
          // RECORDED, not silently dropped. The server files the email with a
          // note naming what did not come through, so a missing deliverable is
          // visible in the review queue instead of being a gap nobody sees.
          skipped.push({ filename: blob.getName(), mimeType: blob.getContentType(), bytes: size });
          continue;
        }
        budget -= size;
        attachments.push({
          filename: blob.getName(),
          mimeType: blob.getContentType(),
          base64: Utilities.base64Encode(blob.getBytes())
        });
      }

      var payload = {
        from: msg.getFrom(),
        to: msg.getTo(),
        cc: msg.getCc(),
        subject: msg.getSubject(),
        date: msg.getDate().toUTCString(),
        messageId: msg.getId(),
        body: msg.getPlainBody(),
        attachments: attachments,
        // Present only when something was left behind, so the ingest route can
        // flag the email rather than file it as if it were complete.
        skippedAttachments: skipped
      };

      var res = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        headers: { 'x-webhook-secret': secret },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      });
      var code = res.getResponseCode();
      if (code < 200 || code >= 300) {
        // A 413 CANNOT SUCCEED ON RETRY — the body is the size it is. Retrying
        // it every two hours forever is how one Bain forward produced six
        // identical failure emails in a morning and would have produced them
        // indefinitely. Count the attempts and give up loudly.
        var permanent = (code === 413 || code === 400);
        var tries = bumpAttempts(msg.getId());
        if (permanent || tries >= MAX_ATTEMPTS) {
          failures.push('GIVING UP after ' + tries + ' attempt(s) — HTTP ' + code + ' — ' + msg.getSubject() +
                        (code === 413 ? ' (payload too large even after trimming attachments)' : ''));
          Logger.log('Dead-lettered ' + msg.getId() + ' (HTTP ' + code + '): ' + res.getContentText());
          // Deliberately does NOT set allOk = false: the thread gets labelled so
          // it stops being picked up. It has been reported once, which is the
          // point — a permanent failure should surface, not repeat.
        } else {
          allOk = false;
          failures.push('HTTP ' + code + ' — ' + msg.getSubject() + ' (attempt ' + tries + ' of ' + MAX_ATTEMPTS + ')');
          Logger.log('Ingest failed (' + code + ') for message ' + msg.getId() + ': ' + res.getContentText());
        }
      } else {
        clearAttempts(msg.getId());
      }
    }

    // Only label the thread done if every message posted OK; otherwise retry next run (server is idempotent).
    if (allOk) thread.addLabel(label);
  }
}

/**
 * True only for messages that actually arrived via deliverables@alpharoc.ai -- either addressed to it
 * (To or Cc), or delivered through the Google Group (bcc / group posts). Thread siblings from the
 * original conversation (teammates, and possibly the client) are never ingested or replied to. Google
 * Groups stamps List-ID, List-Post, Mailing-list and X-Original-To headers that ordinary person-to-
 * person messages in the thread do not carry -- the same signal the Gmail "list:" filter matches on.
 */
function cameViaDeliverables(msg) {
  if ((msg.getTo() + ' ' + msg.getCc()).toLowerCase().indexOf('deliverables@alpharoc.ai') >= 0) return true;
  var raw = msg.getRawContent();
  var sep = raw.indexOf('\r\n\r\n');
  var head = (sep > 0 ? raw.substring(0, sep) : raw.substring(0, 16000)).toLowerCase();
  return /(list-id|list-post|list-unsubscribe|mailing-list|x-original-to):[^\r\n]*deliverables[@.]alpharoc\.ai/.test(head);
}

/**
 * True when deliverables@ is an actual recipient (To/Cc/Bcc) of one of YOUR OWN sent messages. On a
 * message you sent, Bcc is visible to you (Apps Script can read getBcc()), so a self-BCC is detectable
 * here even though the recipient is hidden from everyone else. Used only for the Sent scan; the client's
 * later replies in the same thread don't list deliverables@ as a recipient, so they're skipped.
 */
function sentToDeliverables(msg) {
  return (msg.getTo() + ' ' + msg.getCc() + ' ' + msg.getBcc()).toLowerCase()
    .indexOf('deliverables@alpharoc.ai') >= 0;
}

/**
 * Silent-outage guard: if any submission got a non-2xx (e.g. a 401 from a stale WEBHOOK_SECRET), email
 * the owner. This runs in Gmail — independent of the app / Vercel / Slack — so it still fires during an
 * env outage, which is exactly when the in-app monitors go dark. Throttled to at most one alert every 2h.
 */
/**
 * Turn the failure list into advice about the errors that ACTUALLY occurred.
 *
 * The alert used to end with a fixed paragraph saying "a 401 almost always means your WEBHOOK_SECRET
 * is stale" — on every alert, including the 413s in September 2026. So the one line telling the
 * reader what to do was about a different error than the one they had, and it sent David looking at
 * a secret that was fine. An alert that misdirects is worse than one with no advice at all.
 */
function adviceFor(failures) {
  var text = failures.join(' ');
  var tips = [];
  if (text.indexOf('401') >= 0 || text.indexOf('403') >= 0) {
    tips.push('401/403 - the WEBHOOK_SECRET in this script no longer matches Vercel. Fix it in Project ' +
      'Settings -> Script properties (WEBHOOK_SECRET). These retry automatically.');
  }
  if (text.indexOf('413') >= 0) {
    tips.push('413 - the forward was too big. Vercel caps a serverless request body at 4.5 MB and ' +
      'base64 inflates attachments by about a third. These are DEAD-LETTERED, not retried, because a ' +
      'body is the size it is and trying again cannot help. Share the file from Drive and forward the ' +
      'link, or file it by hand in the app. The per-message budget is MAX_ATTACHMENT_BYTES at the top ' +
      'of this script.');
  }
  if (text.indexOf('404') >= 0) {
    tips.push('404 - the ingest route is missing. Check the deploy went out, and that INGEST_URL in ' +
      'Script properties still points at the live domain.');
  }
  if (text.indexOf('500') >= 0 || text.indexOf('502') >= 0 || text.indexOf('504') >= 0) {
    tips.push('5xx - the app errored or timed out. These retry automatically; if they keep failing, ' +
      'check the Vercel logs for /api/deliverables/ingest.');
  }
  if (!tips.length) {
    tips.push('No specific guidance for these codes. Check the Vercel logs for ' +
      '/api/deliverables/ingest. Everything except 400 and 413 retries automatically.');
  }
  return tips.join('\n\n');
}

function maybeAlert(props, failures) {
  if (!failures.length) return;
  var lastAlert = Number(props.getProperty('LAST_ALERT_MS') || 0);
  if (Date.now() - lastAlert <= 2 * 60 * 60 * 1000) return;
  MailApp.sendEmail(
    Session.getEffectiveUser().getEmail(),
    '⚠️ Deliverables forwarder: ' + failures.length + ' submission(s) NOT filed',
    'The deliverables forwarder got non-2xx responses from the ingest endpoint, so these were NOT ' +
      'filed and no reply was sent:\n\n' + failures.join('\n') + '\n\n' + adviceFor(failures)
  );
  props.setProperty('LAST_ALERT_MS', String(Date.now()));
}

function installTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'processInbox') ScriptApp.deleteTrigger(triggers[i]);
  }
  ScriptApp.newTrigger('processInbox').timeBased().everyMinutes(5).create();
  Logger.log('Trigger installed: processInbox every 5 minutes.');
}
