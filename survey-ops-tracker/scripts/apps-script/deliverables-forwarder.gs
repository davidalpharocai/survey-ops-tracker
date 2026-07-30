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
var MAX_ATTACHMENT_BYTES = 26214400; // ~25 MB; skip larger so the POST stays well under limits

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
      // includeInlineImages:false drops signature logos / tracking pixels at the source.
      var atts = msg.getAttachments({ includeInlineImages: false, includeAttachments: true });
      for (var a = 0; a < atts.length; a++) {
        var blob = atts[a];
        var bytes = blob.getBytes();
        if (bytes.length > MAX_ATTACHMENT_BYTES) continue;
        attachments.push({
          filename: blob.getName(),
          mimeType: blob.getContentType(),
          base64: Utilities.base64Encode(bytes)
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
        attachments: attachments
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
        allOk = false;
        failures.push('HTTP ' + code + ' — ' + msg.getSubject());
        Logger.log('Ingest failed (' + code + ') for message ' + msg.getId() + ': ' + res.getContentText());
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
function maybeAlert(props, failures) {
  if (!failures.length) return;
  var lastAlert = Number(props.getProperty('LAST_ALERT_MS') || 0);
  if (Date.now() - lastAlert <= 2 * 60 * 60 * 1000) return;
  MailApp.sendEmail(
    Session.getEffectiveUser().getEmail(),
    '⚠️ Deliverables forwarder: ' + failures.length + ' submission(s) NOT filed',
    'The deliverables forwarder got non-2xx responses from the ingest endpoint, so these were NOT filed ' +
      'and no reply was sent:\n\n' + failures.join('\n') + '\n\n' +
      'A 401 almost always means this script\'s WEBHOOK_SECRET no longer matches Vercel. Fix it in ' +
      'Project Settings -> Script properties (WEBHOOK_SECRET); the failed items retry automatically on ' +
      'the next run.'
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
