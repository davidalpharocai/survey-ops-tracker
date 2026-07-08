terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.40"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
  }

  # Remote state — shared by all team members; DynamoDB prevents concurrent
  # applies. Bootstrap with scripts/bootstrap-tfstate.sh, then:
  #   terraform init -migrate-state   (first person)
  #   terraform init                  (everyone else)
  backend "s3" {
    bucket         = "alpharoc-tfstate"
    key            = "client-management/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "alpharoc-tfstate-locks"
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "client-management"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
