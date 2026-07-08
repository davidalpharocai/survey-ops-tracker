# Infrastructure (Terraform, all-AWS)

Provisions everything: VPC, **RDS Postgres** (private), and both the
**FastAPI backend** and the **Express/EJS frontend** on **App Runner**
(managed HTTPS + autoscaling, no load balancer to run). Secrets (DB URL,
frontend↔backend shared secret, session key) are generated and stored in
Secrets Manager and injected by App Runner.

```
network.tf   VPC, public/private subnets (no NAT — see below)
rds.tf       RDS Postgres + SGs + parameter group (TLS enforced)
secrets.tf   DATABASE_URL, internal API secret, session secret
backend.tf   ECR + IAM + VPC connector + App Runner (FastAPI)
frontend.tf  ECR + IAM + App Runner (Express/EJS, no VPC connector)
outputs.tf   URLs, ECR repos, secret ARNs
```

## Deploy

```bash
cd infra/terraform
terraform init
terraform apply        # RDS, secrets, 2x ECR, 2x App Runner

# Build & push both images to the ECR repos Terraform created:
for svc in backend frontend; do
  REPO=$(terraform output -raw ${svc}_ecr_repository_url)
  aws ecr get-login-password --region us-east-1 \
    | docker login --username AWS --password-stdin "${REPO%/*}"
  docker build -t "$REPO:latest" "../../$svc"
  docker push "$REPO:latest"
done

# Roll each App Runner service onto the pushed image:
for name in ccm-backend ccm-frontend; do
  aws apprunner start-deployment --service-arn \
    "$(aws apprunner list-services \
       --query "ServiceSummaryList[?ServiceName=='$name'].ServiceArn" \
       --output text)"
done
```

The backend applies `app/schema.sql` idempotently on boot, so RDS tables
are created on first start — no separate migration step. `terraform
output frontend_url` is the app's public URL.

## Networking: no NAT gateway (by design)

The private subnets have **no internet route**. The backend's only
in-VPC outbound is to RDS (same-VPC local route). App Runner pulls
images and resolves `runtime_environment_secrets` on its own managed
infrastructure — *not* through the customer VPC connector — so the
private subnets need no NAT and no VPC endpoints. This removes the
single biggest fixed cost (~$33/mo) at zero maintenance. If app code
ever needs to call an AWS API directly from inside the VPC, add one
Secrets Manager interface endpoint then.

## Cost (rough, us-east-1 — verify on AWS pricing)

| Item | ~Monthly |
|---|---|
| App Runner backend (0.25 vCPU / 0.5 GB) | ~$5–10 |
| App Runner frontend (0.25 vCPU / 0.5 GB) | ~$5–10 |
| RDS `db.t4g.micro` + 20 GB gp3 | ~$15 |
| Secrets Manager, ECR | ~$1–3 |
| **Total** | **~$25–40/mo** |

App Runner autoscales on request volume (min 1 instance — it does not
scale to zero; idle instances bill memory only). No load balancer.

## Caveats

- **Auth gap (must address before exposing):** moving off Google Cloud
  IAP, nothing authenticates end users yet. The frontend's
  `middleware/auth.js` expects an `X-Goog-Authenticated-User-Email`
  header (or `DEV_USER_EMAIL`); with neither, every request is `401`.
  Put a real IdP in front before going live — e.g. an ALB + Cognito/OIDC
  ahead of the frontend App Runner service, or Cloudflare Access — and
  have it set that email header. The backend already rejects any call
  lacking the shared secret, so it is not internet-trustable on its own
  either; keep it reachable only via the frontend.
- RDS has `deletion_protection = true` and takes a final snapshot;
  destroying the DB is deliberately a manual two-step.
- Single-AZ RDS by default (`db_multi_az = false`); flip for HA.
