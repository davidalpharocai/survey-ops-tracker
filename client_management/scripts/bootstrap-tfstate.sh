#!/usr/bin/env bash
# One-time setup: create the S3 bucket and DynamoDB table that back
# Terraform remote state. Run this ONCE before the first `terraform init`.
#
# After this script succeeds:
#   cd infra/terraform
#   terraform init -migrate-state   # moves local state -> S3
#
# Any team member with AWS credentials can then run terraform commands
# and state locking prevents concurrent applies from corrupting state.
set -euo pipefail

REGION="us-east-1"
BUCKET="alpharoc-tfstate"
TABLE="alpharoc-tfstate-locks"

echo ">> Creating S3 state bucket: ${BUCKET}"
if aws s3api head-bucket --bucket "$BUCKET" --region "$REGION" 2>/dev/null; then
  echo "   Already exists, skipping create"
else
  aws s3api create-bucket --bucket "$BUCKET" --region "$REGION"
  echo "   Created"
fi

echo ">> Enabling versioning (allows state rollback)"
aws s3api put-bucket-versioning \
  --bucket "$BUCKET" \
  --versioning-configuration Status=Enabled

echo ">> Enabling server-side encryption (state contains DB credentials)"
aws s3api put-bucket-encryption \
  --bucket "$BUCKET" \
  --server-side-encryption-configuration '{
    "Rules": [{
      "ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"},
      "BucketKeyEnabled": true
    }]
  }'

echo ">> Blocking public access"
aws s3api put-public-access-block \
  --bucket "$BUCKET" \
  --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

echo ">> Creating DynamoDB lock table: ${TABLE}"
if aws dynamodb describe-table --table-name "$TABLE" --region "$REGION" &>/dev/null; then
  echo "   Already exists, skipping create"
else
  aws dynamodb create-table \
    --table-name "$TABLE" \
    --attribute-definitions AttributeName=LockID,AttributeType=S \
    --key-schema AttributeName=LockID,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST \
    --region "$REGION"
  echo "   Waiting for table to become active..."
  aws dynamodb wait table-exists --table-name "$TABLE" --region "$REGION"
  echo "   Active"
fi

echo ""
echo "Done. Next steps for each team member:"
echo "  1. cd infra/terraform"
echo "  2. terraform init -migrate-state   # first person migrates local state"
echo "  3. terraform init                  # everyone else just inits"
