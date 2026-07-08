# Cognito User Pool — authentication for the Next.js frontend.
#
# Flow: the frontend uses the Cognito Hosted UI (OAuth 2.0 authorization
# code flow). Cognito hosts the login form; on success the frontend
# exchanges the code for tokens server-side (confidential client with a
# secret) and stores them in httpOnly cookies. Both the frontend
# middleware AND the backend independently verify the Cognito ID token
# (signature via JWKS, issuer, audience, expiry) and require membership
# in the app group before granting access.
#
# Users are admin-created only (no self sign-up). Create one with:
#
#   aws cognito-idp admin-create-user \
#     --region us-east-1 \
#     --user-pool-id <pool-id> \
#     --username someone@alpharoc.ai \
#     --user-attributes Name=email,Value=someone@alpharoc.ai Name=email_verified,Value=true \
#     --desired-delivery-mediums EMAIL
#
#   aws cognito-idp admin-add-user-to-group \
#     --region us-east-1 \
#     --user-pool-id <pool-id> \
#     --username someone@alpharoc.ai \
#     --group-name <group>   # see var.cognito_group_name

resource "aws_cognito_user_pool" "main" {
  name = "${var.name_prefix}-users"
  tags = { Name = "${var.name_prefix}-users" }

  lifecycle {
    prevent_destroy = true
  }

  # Sign in with email; admins provision accounts (no public sign-up).
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  admin_create_user_config {
    allow_admin_create_user_only = true
  }

  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = true
    temporary_password_validity_days = 7
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  mfa_configuration = "OPTIONAL"

  software_token_mfa_configuration {
    enabled = true
  }

  schema {
    name                = "email"
    attribute_data_type = "String"
    required            = true
    mutable             = true

    string_attribute_constraints {
      min_length = 1
      max_length = 256
    }
  }
}

# Hosted UI domain: https://<prefix>.auth.<region>.amazoncognito.com
resource "aws_cognito_user_pool_domain" "main" {
  domain       = var.cognito_domain_prefix
  user_pool_id = aws_cognito_user_pool.main.id
}

# Group whose members are allowed to use the app. Both the frontend and
# the backend check the ID token's `cognito:groups` for this name.
resource "aws_cognito_user_group" "app" {
  name         = var.cognito_group_name
  user_pool_id = aws_cognito_user_pool.main.id
  description  = "Users permitted to access the client management app."
  precedence   = 1
}

# Group whose members may also reach the admin audit-log page. A nested
# privilege inside the same pool: admins must be in BOTH this group and
# the app group above. Add a user with:
#
#   aws cognito-idp admin-add-user-to-group \
#     --region us-east-1 \
#     --user-pool-id <pool-id> \
#     --username someone@alpharoc.ai \
#     --group-name ccm-admins
resource "aws_cognito_user_group" "admin" {
  name         = var.cognito_admin_group_name
  user_pool_id = aws_cognito_user_pool.main.id
  description  = "Users permitted to view the audit-log admin page."
  precedence   = 0
}

# Confidential app client for the frontend. The token exchange happens
# server-side (Next.js route handler), so a client secret is used.
resource "aws_cognito_user_pool_client" "frontend" {
  name         = "${var.name_prefix}-frontend"
  user_pool_id = aws_cognito_user_pool.main.id

  generate_secret = true

  allowed_oauth_flows                  = ["code"]
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  supported_identity_providers         = ["COGNITO"]

  callback_urls = ["${var.frontend_base_url}/api/auth/callback"]
  logout_urls   = ["${var.frontend_base_url}/login"]

  # Code flow handles authentication; only refresh is exercised directly.
  explicit_auth_flows = ["ALLOW_REFRESH_TOKEN_AUTH"]

  # Token lifetimes. ID/access valid 1h; refresh 30d so the Hosted UI
  # session lets users return without re-entering credentials.
  id_token_validity      = 60
  access_token_validity  = 60
  refresh_token_validity = 30
  token_validity_units {
    id_token      = "minutes"
    access_token  = "minutes"
    refresh_token = "days"
  }

  prevent_user_existence_errors = "ENABLED"
}
