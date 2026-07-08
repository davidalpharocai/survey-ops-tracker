# We deploy into an EXISTING shared VPC (prod-vpc-us-east-1) rather than
# creating one. The backend Lambda runs in this VPC's subnets to reach
# RDS privately; Secrets Manager / Lambda / Logs / ECR are reachable via
# the interface VPC endpoints already present in this VPC (no NAT).

data "aws_vpc" "main" {
  id = var.backend_vpc_id
}

# Both prod subnets (us-east-1a/1b) — enough for an RDS subnet group
# (>=2 AZs) and the Lambda VPC config.
data "aws_subnets" "main" {
  filter {
    name   = "vpc-id"
    values = [var.backend_vpc_id]
  }
}

locals {
  vpc_id     = data.aws_vpc.main.id
  subnet_ids = data.aws_subnets.main.ids
}
