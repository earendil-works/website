# Subscribe API deployment checklist

This is the minimal infra/deploy setup for `POST /api/subscribe`.

## 1) ECS service/runtime

- [ ] Create ECR repo: `website-api-prod`
- [ ] Create ECS service: `website-api-prod` in cluster `website-prod`
- [ ] Container port: `3000`
- [ ] Health check endpoint: `GET /health`

## 2) Runtime environment variables (ECS task)

- [ ] `RESEND_API_KEY`
- [ ] `RESEND_SEGMENT_ID`
- [ ] `PORT=3000`

## 3) DNS/routing

The website is static, so `/api/*` must be routed to this ECS service.

- [ ] Route `https://earendil.com/api/*` to the API origin (ALB/CloudFront behavior)
- [ ] Confirm `https://earendil.com/api/subscribe` reaches this service

## 4) GitHub deployment config

Workflow file: `.github/workflows/deploy-api.yml`

Required repo/environment secret:

- [ ] `AWS_DEPLOY_ROLE_ARN`

Optional GitHub repository/environment variables (to match your exact infra names):

- [ ] `WEBSITE_API_AWS_REGION`
- [ ] `WEBSITE_API_ECR_REPOSITORY`
- [ ] `WEBSITE_API_ECS_CLUSTER`
- [ ] `WEBSITE_API_ECS_SERVICE`

Defaults (used if vars are not set):

- Region: `us-east-2`
- ECR repo: `website-api-prod`
- ECS cluster: `website-prod`
- ECS service: `website-api-prod`

## 5) IAM permissions (for deploy role)

- [ ] ECR push permissions (`GetAuthorizationToken`, `PutImage`, upload layer actions)
- [ ] ECS deploy permissions (`ecs:UpdateService`, `ecs:DescribeServices`)

## 6) Post-deploy verification

- [ ] `GET https://earendil.com/health` (if exposed directly) or service-internal ALB health checks passing
- [ ] `POST https://earendil.com/api/subscribe` with `{ "email": "you@example.com" }` returns `{ "ok": true }`
- [ ] Confirm contact appears in Resend segment (`Lefos Alpha`)
