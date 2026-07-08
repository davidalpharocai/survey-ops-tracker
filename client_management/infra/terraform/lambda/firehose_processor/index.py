"""Firehose transformation: unwrap CloudWatch Logs records for Athena.

A CloudWatch Logs subscription filter delivers records to Kinesis
Firehose as base64-encoded, gzip-compressed envelopes of the form
``{"messageType": ..., "logEvents": [{"message": ...}, ...]}``. Athena
cannot query those envelopes directly, so this function decodes each
record, drops control messages, and re-emits the individual audit-log
messages as newline-delimited JSON — one clean object per line — which
Firehose then gzips and writes to S3 for Athena.
"""

import base64
import gzip
import json


def handler(event, context):
    """Transform a batch of Firehose records.

    Parameters
    ----------
    event : dict
        Firehose invocation event with a ``records`` list; each record's
        ``data`` is a base64-encoded, gzipped CloudWatch Logs envelope.
    context : object
        Lambda context (unused).

    Returns
    -------
    dict
        ``{"records": [...]}`` where each entry carries the original
        ``recordId`` and a result of ``Ok`` (with transformed ``data``),
        ``Dropped`` (control/empty messages), or ``ProcessingFailed``.
    """
    output = []
    for record in event["records"]:
        try:
            payload = json.loads(gzip.decompress(base64.b64decode(record["data"])))
        except (ValueError, OSError):
            output.append({"recordId": record["recordId"], "result": "ProcessingFailed"})
            continue

        message_type = payload.get("messageType")
        if message_type == "CONTROL_MESSAGE":
            output.append({"recordId": record["recordId"], "result": "Dropped"})
            continue
        if message_type != "DATA_MESSAGE":
            output.append({"recordId": record["recordId"], "result": "ProcessingFailed"})
            continue

        events = payload.get("logEvents", [])
        if not events:
            output.append({"recordId": record["recordId"], "result": "Dropped"})
            continue

        body = "".join(log_event["message"].rstrip("\n") + "\n" for log_event in events)
        output.append(
            {
                "recordId": record["recordId"],
                "result": "Ok",
                "data": base64.b64encode(body.encode("utf-8")).decode("utf-8"),
            }
        )
    return {"records": output}
