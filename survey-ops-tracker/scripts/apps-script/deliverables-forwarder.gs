/**
 * Deliverables forwarder — Apps Script (runs in Google, not in the Next app).
 *
 * Bound to the backing inbox that the deliverables@alpharoc.ai Google Group delivers into.
 * On a ~5-minute trigger it finds unprocessed Deliverables-labeled threads and POSTs ONLY the
 * messages actually sent to deliverables@ (a forwarded email is threaded with its original
 * conversation, so a thread also contains teammates' — and possibly the client's — messages, which
 * must NOT be ingested) to the app's /api/deliverables/ingest endpoint, then labels the thread done.
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
  // Unprocessed Deliverables-labeled threads from the last week (the trigger runs often; the window is a safety bound).
  var threads = GmailApp.search('label:' + SOURCE_LABEL + ' -label:' + PROCESSED_LABEL + ' newer_than:7d', 0, 50);
  var failures = []; // non-2xx ingest responses this run — surfaced via a throttled alert email below

  for (var t = 0; t < threads.length; t++) {
    var thread = threads[t];
    var messages = thread.getMessages();
    var allOk = true;

    for (var m = 0; m < messages.length; m++) {
      var msg = messages[m];
      // A Gmail thread also holds the ORIGINAL conversation — teammates' messages, and possibly the
      // client's. Only messages actually sent to deliverables@ are real submissions; ingesting the rest
      // would file teammates' mail and reply to whoever sent each thread message. Skip non-submissions.
      if (!cameViaDeliverables(msg)) continue;

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

  // Silent-outage guard: if any forward got a non-2xx (e.g. a 401 from a stale WEBHOOK_SECRET), email the
  // owner. This runs in Gmail — independent of the app / Vercel / Slack — so it still fires during an env
  // outage, which is exactly when the in-app monitors go dark. Throttled to at most one alert every 2h.
  if (failures.length) {
    var lastAlert = Number(props.getProperty('LAST_ALERT_MS') || 0);
    if (Date.now() - lastAlert > 2 * 60 * 60 * 1000) {
      MailApp.sendEmail(
        Session.getEffectiveUser().getEmail(),
        '⚠️ Deliverables forwarder: ' + failures.length + ' forward(s) NOT filed',
        'The deliverables forwarder got non-2xx responses from the ingest endpoint, so these forwards were ' +
          'NOT filed and no reply was sent:\n\n' + failures.join('\n') + '\n\n' +
          'A 401 almost always means this script\'s WEBHOOK_SECRET no longer matches Vercel. Fix it in ' +
          'Project Settings -> Script properties (WEBHOOK_SECRET); the failed forwards retry automatically ' +
          'on the next run.'
      );
      props.setProperty('LAST_ALERT_MS', String(Date.now()));
    }
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

function installTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'processInbox') ScriptApp.deleteTrigger(triggers[i]);
  }
  ScriptApp.newTrigger('processInbox').timeBased().everyMinutes(5).create();
  Logger.log('Trigger installed: processInbox every 5 minutes.');
}
