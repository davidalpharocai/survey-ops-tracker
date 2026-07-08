# Audit-log pipeline.
#
#   backend Lambda (stdout JSON, {"audit":true,...})
#     -> CloudWatch log group  /aws/lambda/ccm-backend
#     -> subscription filter  { $.audit = true }
#     -> Kinesis Firehose  -- (processor Lambda unwraps CW Logs envelope) -->
#     -> S3  s3://<bucket>/logs/dt=YYYY-MM-DD/...gz   (1-year lifecycle)
#     -> Athena (Glue table, partition projection on dt)  <- admin page queries
#
# The admin query path (GET /api/admin/*) runs on a dedicated non-VPC
# Lambda (ccm-admin-query) using the same container image as the backend.
# Running outside the prod VPC gives it direct internet access to Athena,
# Glue, and the Cognito JWKS endpoint — no interface VPC endpoints are
# added to the shared VPC, so nothing outside this app is affected.
# API Gateway routes ANY /api/admin/* to the admin Lambda; the $default
# route continues to the in-VPC backend Lambda for all other paths.

data "aws_caller_identity" "current" {}

locals {
  audit_bucket_name = "${var.name_prefix}-audit-logs-${data.aws_caller_identity.current.account_id}"
  audit_logs_prefix = "logs"
  athena_results    = "athena-results"
}

# --- S3 bucket (audit data + Athena query results) ---

resource "aws_s3_bucket" "audit" {
  bucket = local.audit_bucket_name
  tags   = { Name = local.audit_bucket_name }
}

resource "aws_s3_bucket_versioning" "audit" {
  bucket = aws_s3_bucket.audit.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "audit" {
  bucket = aws_s3_bucket.audit.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "audit" {
  bucket                  = aws_s3_bucket.audit.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "audit" {
  bucket = aws_s3_bucket.audit.id

  # Audit data: cheap-archive after 90 days, expire at the retention limit.
  rule {
    id     = "audit-logs-retention"
    status = "Enabled"
    filter {
      prefix = "${local.audit_logs_prefix}/"
    }
    transition {
      days          = 90
      storage_class = "GLACIER"
    }
    expiration {
      days = var.audit_log_retention_days
    }
  }

  # Athena spill/result files are disposable — keep them briefly.
  rule {
    id     = "athena-results-cleanup"
    status = "Enabled"
    filter {
      prefix = "${local.athena_results}/"
    }
    expiration {
      days = 14
    }
  }

  rule {
    id     = "abort-incomplete-mpu"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

# --- Firehose transformation Lambda (unwrap CloudWatch Logs envelope) ---

data "archive_file" "firehose_processor" {
  type        = "zip"
  source_file = "${path.module}/lambda/firehose_processor/index.py"
  output_path = "${path.module}/build/firehose_processor.zip"
}

data "aws_iam_policy_document" "lambda_assume_audit" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "firehose_processor" {
  name               = "${var.name_prefix}-audit-processor"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_audit.json
  tags               = { Name = "${var.name_prefix}-audit-processor" }
}

resource "aws_iam_role_policy_attachment" "firehose_processor_logs" {
  role       = aws_iam_role.firehose_processor.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_lambda_function" "firehose_processor" {
  function_name    = "${var.name_prefix}-audit-firehose-processor"
  role             = aws_iam_role.firehose_processor.arn
  runtime          = "python3.12"
  handler          = "index.handler"
  filename         = data.archive_file.firehose_processor.output_path
  source_code_hash = data.archive_file.firehose_processor.output_base64sha256
  timeout          = 60
  memory_size      = 128
  tags             = { Name = "${var.name_prefix}-audit-firehose-processor" }
}

# --- Firehose delivery stream -> S3 ---

resource "aws_cloudwatch_log_group" "firehose" {
  name              = "/aws/kinesisfirehose/${var.name_prefix}-audit"
  retention_in_days = 30
  tags              = { Name = "/aws/kinesisfirehose/${var.name_prefix}-audit" }
}

data "aws_iam_policy_document" "firehose_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["firehose.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "firehose" {
  name               = "${var.name_prefix}-audit-firehose"
  assume_role_policy = data.aws_iam_policy_document.firehose_assume.json
  tags               = { Name = "${var.name_prefix}-audit-firehose" }
}

data "aws_iam_policy_document" "firehose" {
  statement {
    sid = "S3Delivery"
    actions = [
      "s3:AbortMultipartUpload",
      "s3:GetBucketLocation",
      "s3:GetObject",
      "s3:ListBucket",
      "s3:ListBucketMultipartUploads",
      "s3:PutObject",
    ]
    resources = [
      aws_s3_bucket.audit.arn,
      "${aws_s3_bucket.audit.arn}/*",
    ]
  }
  statement {
    sid       = "InvokeProcessor"
    actions   = ["lambda:InvokeFunction", "lambda:GetFunctionConfiguration"]
    resources = ["${aws_lambda_function.firehose_processor.arn}:*", aws_lambda_function.firehose_processor.arn]
  }
  statement {
    sid       = "FirehoseLogging"
    actions   = ["logs:PutLogEvents", "logs:CreateLogStream"]
    resources = ["${aws_cloudwatch_log_group.firehose.arn}:*"]
  }
}

resource "aws_iam_role_policy" "firehose" {
  name   = "${var.name_prefix}-audit-firehose"
  role   = aws_iam_role.firehose.id
  policy = data.aws_iam_policy_document.firehose.json
}

resource "aws_kinesis_firehose_delivery_stream" "audit" {
  name        = "${var.name_prefix}-audit"
  destination = "extended_s3"
  tags        = { Name = "${var.name_prefix}-audit" }

  extended_s3_configuration {
    role_arn   = aws_iam_role.firehose.arn
    bucket_arn = aws_s3_bucket.audit.arn

    # Hive-style partition so Athena projection maps dt -> S3 path.
    prefix              = "${local.audit_logs_prefix}/dt=!{timestamp:yyyy-MM-dd}/"
    error_output_prefix = "errors/!{firehose:error-output-type}/dt=!{timestamp:yyyy-MM-dd}/"

    buffering_size     = 5
    buffering_interval = 300
    compression_format = "GZIP"

    processing_configuration {
      enabled = true
      processors {
        type = "Lambda"
        parameters {
          parameter_name  = "LambdaArn"
          parameter_value = "${aws_lambda_function.firehose_processor.arn}:$LATEST"
        }
      }
    }

    cloudwatch_logging_options {
      enabled         = true
      log_group_name  = aws_cloudwatch_log_group.firehose.name
      log_stream_name = "S3Delivery"
    }
  }
}

# --- CloudWatch Logs subscription: ship audit lines to Firehose ---

data "aws_iam_policy_document" "cwl_to_firehose_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["logs.${var.aws_region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "cwl_to_firehose" {
  name               = "${var.name_prefix}-audit-cwl"
  assume_role_policy = data.aws_iam_policy_document.cwl_to_firehose_assume.json
  tags               = { Name = "${var.name_prefix}-audit-cwl" }
}

data "aws_iam_policy_document" "cwl_to_firehose" {
  statement {
    actions   = ["firehose:PutRecord", "firehose:PutRecordBatch"]
    resources = [aws_kinesis_firehose_delivery_stream.audit.arn]
  }
}

resource "aws_iam_role_policy" "cwl_to_firehose" {
  name   = "${var.name_prefix}-audit-cwl"
  role   = aws_iam_role.cwl_to_firehose.id
  policy = data.aws_iam_policy_document.cwl_to_firehose.json
}

resource "aws_cloudwatch_log_subscription_filter" "audit" {
  name            = "${var.name_prefix}-audit"
  log_group_name  = aws_cloudwatch_log_group.backend.name
  filter_pattern  = "{ $.audit IS TRUE }"
  destination_arn = aws_kinesis_firehose_delivery_stream.audit.arn
  role_arn        = aws_iam_role.cwl_to_firehose.arn
}

# --- Glue catalog + Athena (query layer) ---

resource "aws_glue_catalog_database" "audit" {
  name = "${var.name_prefix}_audit"
  tags = { Name = "${var.name_prefix}-audit" }
}

resource "aws_glue_catalog_table" "audit" {
  name          = "audit_logs"
  database_name = aws_glue_catalog_database.audit.name
  table_type    = "EXTERNAL_TABLE"
  parameters = {
    EXTERNAL                      = "TRUE"
    classification                = "json"
    "projection.enabled"          = "true"
    "projection.dt.type"          = "date"
    "projection.dt.format"        = "yyyy-MM-dd"
    "projection.dt.range"         = "${var.audit_projection_start_date},NOW"
    "projection.dt.interval"      = "1"
    "projection.dt.interval.unit" = "DAYS"
    "storage.location.template"   = "s3://${aws_s3_bucket.audit.bucket}/${local.audit_logs_prefix}/dt=$${dt}/"
  }

  partition_keys {
    name = "dt"
    type = "string"
  }

  storage_descriptor {
    location      = "s3://${aws_s3_bucket.audit.bucket}/${local.audit_logs_prefix}/"
    input_format  = "org.apache.hadoop.mapred.TextInputFormat"
    output_format = "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat"

    ser_de_info {
      serialization_library = "org.openx.data.jsonserde.JsonSerDe"
      parameters = {
        "ignore.malformed.json" = "true"
      }
    }

    columns {
      name = "occurred_at"
      type = "string"
    }
    columns {
      name = "actor_email"
      type = "string"
    }
    columns {
      name = "method"
      type = "string"
    }
    columns {
      name = "path"
      type = "string"
    }
    columns {
      name = "route"
      type = "string"
    }
    columns {
      name = "resource_type"
      type = "string"
    }
    columns {
      name = "resource_id"
      type = "string"
    }
    columns {
      name = "action"
      type = "string"
    }
    columns {
      name = "status_code"
      type = "int"
    }
    columns {
      name = "outcome"
      type = "string"
    }
    columns {
      name = "duration_ms"
      type = "int"
    }
    columns {
      name = "ip_address"
      type = "string"
    }
    columns {
      name = "user_agent"
      type = "string"
    }
    columns {
      name = "request_body"
      type = "string"
    }
  }
}

resource "aws_athena_workgroup" "audit" {
  name = "${var.name_prefix}-audit"
  tags = { Name = "${var.name_prefix}-audit" }

  configuration {
    enforce_workgroup_configuration    = true
    publish_cloudwatch_metrics_enabled = true

    result_configuration {
      output_location = "s3://${aws_s3_bucket.audit.bucket}/${local.athena_results}/"
      encryption_configuration {
        encryption_option = "SSE_S3"
      }
    }
  }

  force_destroy = true
}

# --- Admin query Lambda (non-VPC) ---
# Runs outside the shared prod VPC so it can reach Athena, Glue, and the
# Cognito JWKS endpoint over the public internet. Uses the same container
# image as the backend Lambda but without vpc_config and without
# DATABASE_URL, so no database connection is ever attempted.

resource "aws_cloudwatch_log_group" "admin_query" {
  name              = "/aws/lambda/${var.name_prefix}-admin-query"
  retention_in_days = 30
  tags              = { Name = "/aws/lambda/${var.name_prefix}-admin-query" }
}

data "aws_iam_policy_document" "admin_query_athena" {
  statement {
    sid = "Athena"
    actions = [
      "athena:StartQueryExecution",
      "athena:StopQueryExecution",
      "athena:GetQueryExecution",
      "athena:GetQueryResults",
      "athena:GetWorkGroup",
    ]
    resources = [aws_athena_workgroup.audit.arn]
  }
  statement {
    sid = "Glue"
    actions = [
      "glue:GetDatabase",
      "glue:GetTable",
      "glue:GetPartition",
      "glue:GetPartitions",
      "glue:BatchGetPartition",
    ]
    resources = [
      "arn:aws:glue:${var.aws_region}:${data.aws_caller_identity.current.account_id}:catalog",
      "arn:aws:glue:${var.aws_region}:${data.aws_caller_identity.current.account_id}:database/${aws_glue_catalog_database.audit.name}",
      "arn:aws:glue:${var.aws_region}:${data.aws_caller_identity.current.account_id}:table/${aws_glue_catalog_database.audit.name}/*",
    ]
  }
  statement {
    sid       = "S3Read"
    actions   = ["s3:GetObject", "s3:ListBucket", "s3:GetBucketLocation"]
    resources = [aws_s3_bucket.audit.arn, "${aws_s3_bucket.audit.arn}/*"]
  }
  statement {
    sid = "S3Results"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:AbortMultipartUpload",
      "s3:ListMultipartUploadParts",
    ]
    resources = ["${aws_s3_bucket.audit.arn}/${local.athena_results}/*"]
  }
}

resource "aws_iam_role" "admin_query" {
  name               = "${var.name_prefix}-admin-query"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_audit.json
  tags               = { Name = "${var.name_prefix}-admin-query" }
}

resource "aws_iam_role_policy_attachment" "admin_query_basic" {
  role       = aws_iam_role.admin_query.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "admin_query_athena" {
  name   = "${var.name_prefix}-admin-query-athena"
  role   = aws_iam_role.admin_query.id
  policy = data.aws_iam_policy_document.admin_query_athena.json
}

resource "aws_lambda_function" "admin_query" {
  function_name = "${var.name_prefix}-admin-query"
  role          = aws_iam_role.admin_query.arn
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.backend.repository_url}:${var.backend_image_tag}"

  memory_size = 512
  timeout     = 30

  environment {
    variables = {
      ENV                   = "production"
      ALLOWED_DOMAIN        = var.allowed_domain
      COGNITO_REGION        = var.aws_region
      COGNITO_USER_POOL_ID  = aws_cognito_user_pool.main.id
      COGNITO_APP_CLIENT_ID = aws_cognito_user_pool_client.frontend.id
      COGNITO_ALLOWED_GROUP = var.cognito_group_name
      COGNITO_ADMIN_GROUP   = var.cognito_admin_group_name
      FRONTEND_URL          = var.frontend_base_url
      ATHENA_DATABASE       = aws_glue_catalog_database.audit.name
      ATHENA_TABLE          = aws_glue_catalog_table.audit.name
      ATHENA_WORKGROUP      = aws_athena_workgroup.audit.name
      AUDIT_S3_OUTPUT       = "s3://${aws_s3_bucket.audit.bucket}/${local.athena_results}/"
      AWS_LWA_PORT                 = "8000"
      AWS_LWA_READINESS_CHECK_PATH = "/healthz"
    }
  }

  tags = { Name = "${var.name_prefix}-admin-query" }

  depends_on = [aws_iam_role_policy_attachment.admin_query_basic]
}

# --- API Gateway: route /api/admin/* to the admin query Lambda ---

resource "aws_apigatewayv2_integration" "admin_query" {
  api_id                 = aws_apigatewayv2_api.backend.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.admin_query.invoke_arn
  integration_method     = "POST"
  payload_format_version = "2.0"
}

# More specific than $default so API Gateway always prefers this route
# for /api/admin/* before falling through to the in-VPC backend Lambda.
resource "aws_apigatewayv2_route" "admin_query" {
  api_id             = aws_apigatewayv2_api.backend.id
  route_key          = "ANY /api/admin/{proxy+}"
  target             = "integrations/${aws_apigatewayv2_integration.admin_query.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_lambda_permission" "apigw_admin" {
  statement_id  = "AllowAPIGatewayInvokeAdmin"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.admin_query.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.backend.execution_arn}/*/*"
}
