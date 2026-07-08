variable "aws_region" {
  description = "AWS region for all resources."
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name (used in tags and resource names)."
  type        = string
  default     = "prod"
}

variable "name_prefix" {
  description = "Prefix applied to resource names."
  type        = string
  default     = "ccm"
}

variable "backend_vpc_id" {
  description = "Existing VPC to deploy RDS + the backend Lambda into (prod-vpc-us-east-1)."
  type        = string
  default     = "vpc-03bf58ff6b2b66d5d"
}

variable "allowed_domain" {
  description = "Google Workspace domain permitted to use the app."
  type        = string
  default     = "alpharoc.ai"
}

# --- Database ---

variable "db_name" {
  description = "Initial Postgres database name."
  type        = string
  default     = "clientcredits"
}

variable "db_username" {
  description = "Master username for the RDS instance."
  type        = string
  default     = "ccm_admin"
}

variable "db_instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_allocated_storage" {
  description = "Allocated storage in GiB."
  type        = number
  default     = 20
}

variable "db_engine_version" {
  description = "Postgres engine version."
  type        = string
  default     = "16.14"
}

variable "db_multi_az" {
  description = "Whether to run RDS as Multi-AZ."
  type        = bool
  default     = false
}

# --- Backend (Lambda) ---

variable "backend_image_tag" {
  description = "ECR image tag the backend Lambda deploys."
  type        = string
  default     = "latest"
}

variable "lambda_memory" {
  description = "Backend Lambda memory (MB); also scales CPU proportionally."
  type        = number
  default     = 1024
}

variable "lambda_timeout" {
  description = "Backend Lambda timeout (seconds)."
  type        = number
  default     = 30
}

# --- Auth (Cognito) ---

variable "cognito_domain_prefix" {
  description = "Hosted UI domain prefix; full domain is https://<prefix>.auth.<region>.amazoncognito.com. Must be globally unique within the region."
  type        = string
  default     = "ccm-auth"
}

variable "cognito_group_name" {
  description = "Cognito group whose members may use the app. Both frontend and backend require this group in the ID token."
  type        = string
  default     = "ccm-users"
}

variable "cognito_admin_group_name" {
  description = "Cognito group (nested in the same pool) whose members may view the admin audit-log page."
  type        = string
  default     = "ccm-admins"
}

# --- Audit logs ---

variable "audit_log_retention_days" {
  description = "Days to retain audit logs in S3 before expiry (transition to Glacier at 90 days). Must exceed 90."
  type        = number
  default     = 365
}

variable "audit_projection_start_date" {
  description = "Earliest date the Athena partition projection scans (YYYY-MM-DD). Set to roughly when auditing went live."
  type        = string
  default     = "2026-06-01"
}

variable "frontend_base_url" {
  description = "Public base URL of the frontend, used for Cognito OAuth callback/logout URLs (no trailing slash). Update to a custom domain if one is added."
  type        = string
  default     = "https://tools.alpharoc.ai/ccm"
}
