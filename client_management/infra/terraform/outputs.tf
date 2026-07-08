output "backend_url" {
  description = "Public HTTPS base URL of the backend (API Gateway → Lambda)."
  value       = aws_apigatewayv2_stage.backend.invoke_url
}

output "backend_ecr_repository_url" {
  description = "Push the backend image here, then deploy that tag."
  value       = aws_ecr_repository.backend.repository_url
}

output "rds_endpoint" {
  description = "RDS endpoint (host:port). Private — backend access only."
  value       = aws_db_instance.main.endpoint
}

output "database_url_secret_arn" {
  description = "Secrets Manager ARN holding the backend DATABASE_URL."
  value       = aws_secretsmanager_secret.database_url.arn
}

# --- Cognito ---

output "cognito_user_pool_id" {
  description = "Cognito User Pool ID (use with admin-create-user)."
  value       = aws_cognito_user_pool.main.id
}

output "cognito_hosted_ui_domain" {
  description = "Hosted UI base domain."
  value       = "https://${aws_cognito_user_pool_domain.main.domain}.auth.${var.aws_region}.amazoncognito.com"
}

output "cognito_issuer" {
  description = "OIDC issuer URL (token iss claim / JWKS base)."
  value       = "https://cognito-idp.${var.aws_region}.amazonaws.com/${aws_cognito_user_pool.main.id}"
}

output "cognito_admin_group" {
  description = "Cognito group gating the admin audit-log page (admin-add-user-to-group)."
  value       = aws_cognito_user_group.admin.name
}

# --- Audit logs ---

output "audit_logs_bucket" {
  description = "S3 bucket holding the audit-log backups (Athena data source)."
  value       = aws_s3_bucket.audit.bucket
}

output "audit_firehose_stream" {
  description = "Kinesis Firehose stream delivering CloudWatch audit lines to S3."
  value       = aws_kinesis_firehose_delivery_stream.audit.name
}

output "audit_athena_workgroup" {
  description = "Athena workgroup used to query the audit logs."
  value       = aws_athena_workgroup.audit.name
}

# Env vars to set on the hand-managed Amplify frontend. Pull the secret
# with: terraform output -raw amplify_env_cognito_client_secret
output "amplify_env_cognito_client_id" {
  description = "Frontend env: COGNITO_CLIENT_ID."
  value       = aws_cognito_user_pool_client.frontend.id
}

output "amplify_env_cognito_client_secret" {
  description = "Frontend env: COGNITO_CLIENT_SECRET (sensitive)."
  value       = aws_cognito_user_pool_client.frontend.client_secret
  sensitive   = true
}
