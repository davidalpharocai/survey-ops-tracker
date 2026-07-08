# Backend secrets. DATABASE_URL carries the RDS password and is
# fetched by the backend Lambda at cold start via Secrets Manager.
# The frontend is managed outside Terraform (Amplify Console).

resource "aws_secretsmanager_secret" "database_url" {
  name        = "${var.name_prefix}/database-url"
  description = "Backend DATABASE_URL (asyncpg, TLS-enforced)"
  tags        = { Name = "${var.name_prefix}/database-url" }
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id     = aws_secretsmanager_secret.database_url.id
  secret_string = local.database_url
}

