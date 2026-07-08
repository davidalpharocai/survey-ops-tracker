# FastAPI backend: built into an ECR container image and run on AWS
# Lambda (container image package type) behind an API Gateway HTTP API.
# The image carries the AWS Lambda Web Adapter, so the unchanged uvicorn
# app runs as-is — the adapter implements the Lambda Runtime API and
# proxies invocations to the local HTTP server. The function runs in the
# existing prod VPC to reach private RDS; Secrets Manager / Logs / ECR
# are served by that VPC's interface endpoints (no NAT).

resource "aws_ecr_repository" "backend" {
  name                 = "${var.name_prefix}-backend"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = { Name = "${var.name_prefix}-backend" }
}

resource "aws_ecr_lifecycle_policy" "backend" {
  repository = aws_ecr_repository.backend.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 10 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}

# --- IAM: Lambda execution role ---

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda_exec" {
  name               = "${var.name_prefix}-backend-lambda"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
  tags               = { Name = "${var.name_prefix}-backend-lambda" }
}

# CloudWatch Logs + VPC ENI management (the function runs in-VPC).
resource "aws_iam_role_policy_attachment" "lambda_vpc" {
  role       = aws_iam_role.lambda_exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

# Allow the backend to fetch DATABASE_URL from Secrets Manager at cold start.
data "aws_iam_policy_document" "lambda_exec_sm" {
  statement {
    sid       = "ReadDatabaseUrlSecret"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.database_url.arn]
  }
}

resource "aws_iam_role_policy" "lambda_exec_sm" {
  name   = "${var.name_prefix}-backend-sm"
  role   = aws_iam_role.lambda_exec.id
  policy = data.aws_iam_policy_document.lambda_exec_sm.json
}

# --- Lambda function (container image) ---

resource "aws_lambda_function" "backend" {
  function_name = "${var.name_prefix}-backend"
  role          = aws_iam_role.lambda_exec.arn
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.backend.repository_url}:${var.backend_image_tag}"

  memory_size = var.lambda_memory
  timeout     = var.lambda_timeout

  vpc_config {
    subnet_ids         = local.subnet_ids
    security_group_ids = [aws_security_group.backend.id]
  }

  environment {
    variables = {
      ENV            = "production"
      ALLOWED_DOMAIN = var.allowed_domain
      FRONTEND_URL   = var.frontend_base_url
      DATABASE_URL   = local.database_url
      # Cognito: the backend independently verifies the ID token the
      # frontend forwards (signature/issuer/audience/expiry + group).
      COGNITO_REGION        = var.aws_region
      COGNITO_USER_POOL_ID  = aws_cognito_user_pool.main.id
      COGNITO_APP_CLIENT_ID = aws_cognito_user_pool_client.frontend.id
      COGNITO_ALLOWED_GROUP = var.cognito_group_name
      COGNITO_ADMIN_GROUP   = var.cognito_admin_group_name
      # AWS Lambda Web Adapter: match the uvicorn port baked into the image.
      AWS_LWA_PORT                 = "8000"
      AWS_LWA_READINESS_CHECK_PATH = "/healthz"
      # Static JWKS (public keys only — safe to commit). Avoids an outbound
      # network call from the in-VPC Lambda, which has no internet access.
      # Update this value if Cognito rotates its signing keys.
      COGNITO_JWKS_JSON = "{\"keys\":[{\"alg\":\"RS256\",\"e\":\"AQAB\",\"kid\":\"nkJv9zRHT3z/fGWvIeQdQdXKrr2Q3LuDTd9B+4UMlxU=\",\"kty\":\"RSA\",\"n\":\"rq4BGlcQn3uh6Dy93bCsg1mF_UV3-andv-JuPFTBLFsPBdBxeJs_vjHRbee12v1dmnDa5uL3dI7b-EqrYZdkeHnaG295yFfERLa89tih21-pH3WWR1Q3tdE4zggP1uhTAlSNToc1gzyT5fjjj87JnbLBVGe9BsEEGOsjZ2opPYQjUXWez2xz78dnhSchTS_Z_ZFF1wtqiJpmeCPbx-eojrShl8smmndRVuLWDU_ljtuHrAQn6jCoXjs4w9-zkEDSKsNMT-KbN6AS5ZxXwbcvqXnRvXpLfDjlxHt1Q4009JP81EoktqlwRMsgKP_Yh5wVtRxyF61LmnRv3QpkS2gnOw\",\"use\":\"sig\"},{\"alg\":\"RS256\",\"e\":\"AQAB\",\"kid\":\"LKzG3tf61DYG3vVs612g2dZFA9trwQBqRCyk7DtI0Rk=\",\"kty\":\"RSA\",\"n\":\"1NJh6RyeAdEgi2zXELKpbz14XWG6BMkU2Xc7QiWigVN3Q6B_euTwn5sOAzSAX_vc3SDOUJnIiPlukpjGtHetbOCnLavlVBFO2qaNMLnM2Nt5nmsLBnvEplGIhUEPAKavd844c8PInAaS-C5gyJis74qYEpWiHzp5bbXJn6mgJkCMGsC4xEPqcTzDWjsV-AXZL8ANJSL_f4w6XiFfs6RPDxoqi-UO9ISRyPsfUnirs2eeqtF0b7KIzwGDAbs1IOIEnDD638Lsdva4gnknFiQhZugPRfs13rcm0e-QpU8IbUVQn7v2u0ARY8XPKPgWvP7UEG_Mv57-GQuhje15ohhz6w\",\"use\":\"sig\"}]}"
    }
  }

  tags = { Name = "${var.name_prefix}-backend" }

  depends_on = [
    aws_db_instance.main,
    aws_iam_role_policy_attachment.lambda_vpc,
  ]
}

resource "aws_cloudwatch_log_group" "backend" {
  name              = "/aws/lambda/${var.name_prefix}-backend"
  retention_in_days = 400
  # Holds the structured audit lines (shipped to S3 via the subscription
  # filter in audit.tf); retain >1 year so CloudWatch is a second copy.
  tags = { Name = "/aws/lambda/${var.name_prefix}-backend" }
}

# --- API Gateway HTTP API (public HTTPS entrypoint) ---

resource "aws_apigatewayv2_api" "backend" {
  name          = "${var.name_prefix}-backend"
  protocol_type = "HTTP"
  tags          = { Name = "${var.name_prefix}-backend" }
}

resource "aws_apigatewayv2_integration" "backend" {
  api_id                 = aws_apigatewayv2_api.backend.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.backend.invoke_arn
  integration_method     = "POST"
  payload_format_version = "2.0"
}

# JWT authorizer: API Gateway verifies the Cognito ID token before the
# request reaches Lambda. Defense-in-depth — the backend also verifies
# independently in require_user, but this layer blocks unauthenticated
# calls before they consume any Lambda capacity.
resource "aws_apigatewayv2_authorizer" "cognito" {
  api_id           = aws_apigatewayv2_api.backend.id
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  name             = "${var.name_prefix}-cognito-jwt"

  jwt_configuration {
    audience = [aws_cognito_user_pool_client.frontend.id]
    issuer   = "https://cognito-idp.${var.aws_region}.amazonaws.com/${aws_cognito_user_pool.main.id}"
  }
}

# Public health-check route — no JWT required so external monitors can
# probe liveness without a Cognito token.
resource "aws_apigatewayv2_route" "healthz" {
  api_id             = aws_apigatewayv2_api.backend.id
  route_key          = "GET /healthz"
  target             = "integrations/${aws_apigatewayv2_integration.backend.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_route" "backend" {
  api_id             = aws_apigatewayv2_api.backend.id
  route_key          = "$default"
  target             = "integrations/${aws_apigatewayv2_integration.backend.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_stage" "backend" {
  api_id      = aws_apigatewayv2_api.backend.id
  name        = "$default"
  auto_deploy = true
  tags        = { Name = "${var.name_prefix}-backend" }
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.backend.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.backend.execution_arn}/*/*"
}
