/**
 * Deliverables forwarder — Apps Script (runs in Google, not in the Next app).
 *
 * Bound to the backing inbox that the deliverables@alpharoc.ai Google Group delivers into.
 * On a ~5-minute trigger it finds unprocessed inbox messages, POSTs each to the app's
 * /api/deliverables/ingest endpoint, then labels the thread so it is never re-sent.
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

  for (var t = 0; t < threads.length; t++) {
    var thread = threads[t];
    var messages = thread.getMessages();
    var allOk = true;

    for (var m = 0; m < messages.length; m++) {
      var msg = messages[m];
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
        Logger.log('Ingest failed (' + code + ') for message ' + msg.getId() + ': ' + res.getContentText());
      }
    }

    // Only label the thread done if every message posted OK; otherwise retry next run (server is idempotent).
    if (allOk) thread.addLabel(label);
  }
}

function installTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'processInbox') ScriptApp.deleteTrigger(triggers[i]);
  }
  ScriptApp.newTrigger('processInbox').timeBased().everyMinutes(5).create();
  Logger.log('Trigger installed: processInbox every 5 minutes.');
}
