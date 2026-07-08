#!/usr/bin/env bash
# Build, push, and deploy the backend image to all ccm Lambda functions.
# Usage:  ./scripts/deploy-backend.sh
set -euo pipefail

REGION="us-east-1"
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REPO="ccm-backend"
TAG=$(git rev-parse --short HEAD)
IMAGE="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com/${REPO}:${TAG}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo ">> Logging in to ECR"
aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com"

echo ">> Building image (linux/amd64) — tag: ${TAG}"
docker build --platform linux/amd64 -t "$IMAGE" "${ROOT}/backend"

echo ">> Pushing image"
docker push "$IMAGE"

echo ">> Resolving image digest"
DIGEST="$(aws ecr describe-images --region "$REGION" --repository-name "$REPO" \
  --image-ids imageTag="$TAG" --query 'imageDetails[0].imageDigest' --output text)"
IMAGE_URI="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com/${REPO}@${DIGEST}"

update_lambda() {
  local fn="$1"
  if aws lambda get-function --region "$REGION" --function-name "$fn" &>/dev/null; then
    echo ">> Updating Lambda: ${fn}"
    aws lambda update-function-code --region "$REGION" \
      --function-name "$fn" \
      --image-uri "$IMAGE_URI" \
      >/dev/null
    aws lambda wait function-updated --region "$REGION" --function-name "$fn"
    echo "   Done: ${fn}"
  else
    echo "   Skipping ${fn} (not yet deployed)"
  fi
}

update_lambda "ccm-backend"
update_lambda "ccm-admin-query"

echo ">> Done. Live image: ${REPO}@${DIGEST}"
