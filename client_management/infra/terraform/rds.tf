# RDS PostgreSQL in the existing prod VPC's subnets. Reachable only from
# the backend Lambda's security group. TLS is enforced at the
# parameter-group level (rds.force_ssl).

resource "aws_security_group" "backend" {
  name        = "${var.name_prefix}-backend-sg"
  description = "Backend Lambda ENIs (in-VPC egress to RDS + endpoints)"
  vpc_id      = local.vpc_id

  # Postgres to RDS (private subnet, VPC CIDR only).
  egress {
    description = "Postgres to RDS"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = [data.aws_vpc.main.cidr_block]
  }

  # HTTPS to VPC interface endpoints (Secrets Manager, ECR, CloudWatch Logs).
  egress {
    description = "HTTPS to VPC interface endpoints"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = [data.aws_vpc.main.cidr_block]
  }

  tags = { Name = "${var.name_prefix}-backend-sg" }
}

resource "aws_security_group" "rds" {
  name        = "${var.name_prefix}-rds-sg"
  description = "Postgres access from the backend Lambda only"
  vpc_id      = local.vpc_id

  ingress {
    description     = "Postgres from backend"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.backend.id]
  }

  tags = { Name = "${var.name_prefix}-rds-sg" }
}

resource "aws_db_subnet_group" "main" {
  name       = "${var.name_prefix}-db-subnets"
  subnet_ids = local.subnet_ids
  tags       = { Name = "${var.name_prefix}-db-subnets" }
}

resource "aws_db_parameter_group" "main" {
  name   = "${var.name_prefix}-pg16"
  family = "postgres16"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  tags = { Name = "${var.name_prefix}-pg16" }

  lifecycle {
    create_before_destroy = true
  }
}

resource "random_password" "db" {
  length  = 32
  special = false
}

resource "aws_db_instance" "main" {
  identifier     = "${var.name_prefix}-postgres"
  engine         = "postgres"
  engine_version = var.db_engine_version
  instance_class = var.db_instance_class

  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = var.db_allocated_storage * 5
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = var.db_name
  username = var.db_username
  password = random_password.db.result
  port     = 5432

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  parameter_group_name   = aws_db_parameter_group.main.name
  multi_az               = var.db_multi_az
  publicly_accessible    = false

  backup_retention_period   = 7
  deletion_protection       = true
  skip_final_snapshot       = false
  final_snapshot_identifier = "${var.name_prefix}-postgres-final"
  apply_immediately         = true

  tags = { Name = "${var.name_prefix}-postgres" }

  lifecycle {
    prevent_destroy = true
  }
}

# DATABASE_URL the backend consumes. asyncpg + SQLAlchemy: ?ssl=require
# (not libpq's sslmode) enforces TLS to RDS.
locals {
  database_url = format(
    "postgresql+asyncpg://%s:%s@%s:%s/%s?ssl=require",
    var.db_username,
    random_password.db.result,
    aws_db_instance.main.address,
    aws_db_instance.main.port,
    var.db_name,
  )
}
