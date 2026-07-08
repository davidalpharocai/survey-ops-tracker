/**
 * Activity forwarder — Apps Script (runs in Google, not in the Next app).
 *
 * Bound to the backing inbox that the activity@alpharoc.ai Google Group delivers into.
 * On a ~5-minute trigger it finds client-tied messages (routed there by each captain's
 * Gmail filters), POSTs each to the app's /api/webhooks/email-activity endpoint, and
 * records the Gmail message id so it is never re-sent.
 *
 * Why per-MESSAGE tracking (not per-thread labels like the deliverables forwarder):
 * client email threads get replies over many days, so labeling a whole thread "done"
 * would skip every later reply. We instead remember processed Gmail message ids in a
 * Script Property, pruned to a rolling window. The server also dedups on the RFC-822
 * Message-ID (external_id), so a re-send is always a harmless no-op — this just avoids
 * the wasted POSTs.
 *
 * Script Properties required (Project Settings -> Script properties):
 *   INGEST_URL      e.g. https://survey-ops-tracker.vercel.app/api/webhooks/email-activity
 *   WEBHOOK_SECRET  the same value set in Vercel
 * (PROCESSED_IDS is managed by the script — do not set it by hand.)
 *
 * One-time: run installTrigger() once, then authorize when prompted.
 */

// Only process mail routed via the activity@ Group. A Gmail filter on
// `list:activity@alpharoc.ai` applies this label (+ skips the inbox), so the script
// never scans unrelated inbox mail. NOTE: this is DISTINCT from the deliverables
// forwarder's 'Deliverables' label / backing inbox — the two pipelines stay separate.
var SOURCE_LABEL = 'Activity';
var SEARCH_WINDOW = 'newer_than:3d';   // bound the work; server dedup covers overlap
var PROCESSED_TTL_MS = 10 * 24 * 60 * 60 * 1000; // forget ids older than 10 days
var PROCESSED_MAX = 1500;              // hard cap so the Script Property stays small

function loadProcessed_(props) {
  var raw = props.getProperty('PROCESSED_IDS');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (e) { return {}; }
}

function saveProcessed_(props, map) {
  var now = Date.now();
  var ids = Object.keys(map);
  // Drop expired ids.
  for (var i = 0; i < ids.length; i++) {
    if (now - map[ids[i]] > PROCESSED_TTL_MS) delete map[ids[i]];
  }
  // If still over the cap, keep only the most recent PROCESSED_MAX.
  ids = Object.keys(map);
  if (ids.length > PROCESSED_MAX) {
    ids.sort(function (a, b) { return map[b] - map[a]; });
    var trimmed = {};
    for (var j = 0; j < PROCESSED_MAX; j++) trimmed[ids[j]] = map[ids[j]];
    map = trimmed;
  }
  props.setProperty('PROCESSED_IDS', JSON.stringify(map));
}

/** The RFC-822 header block (everything before the first blank line) from raw content. */
function headerBlock_(raw) {
  var idx = raw.indexOf('\r\n\r\n');
  if (idx < 0) idx = raw.indexOf('\n\n');
  return idx >= 0 ? raw.substring(0, idx) : raw;
}

function processInbox() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('INGEST_URL');
  var secret = props.getProperty('WEBHOOK_SECRET');
  if (!url || !secret) throw new Error('Set INGEST_URL and WEBHOOK_SECRET in Script Properties.');

  var processed = loadProcessed_(props);
  var threads = GmailApp.search('label:' + SOURCE_LABEL + ' ' + SEARCH_WINDOW, 0, 50);

  for (var t = 0; t < threads.length; t++) {
    var messages = threads[t].getMessages();
    for (var m = 0; m < messages.length; m++) {
      var msg = messages[m];
      var id = msg.getId();
      if (processed[id]) continue; // already sent (per-message)

      var toCc = [msg.getTo(), msg.getCc()].filter(function (x) { return !!x; }).join(', ');
      var payload = {
        raw_headers: headerBlock_(msg.getRawContent()), // carries the RFC-822 Message-ID
        from: msg.getFrom(),
        to: toCc,
        subject: msg.getSubject(),
        body: msg.getPlainBody(),
        occurred_at: msg.getDate().toISOString(),
        gmail_message_id: id
      };

      var res = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        headers: { 'x-webhook-secret': secret },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      });
      var code = res.getResponseCode();
      if (code >= 200 && code < 300) {
        processed[id] = Date.now(); // record only on success; failures retry next run
      } else {
        Logger.log('email-activity ingest failed (' + code + ') for ' + id + ': ' + res.getContentText());
      }
    }
  }

  saveProcessed_(props, processed);
}

function installTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'processInbox') ScriptApp.deleteTrigger(triggers[i]);
  }
  ScriptApp.newTrigger('processInbox').timeBased().everyMinutes(5).create();
  Logger.log('Trigger installed: processInbox every 5 minutes.');
}
