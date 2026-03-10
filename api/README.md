# Earendil subscribe API (Hono + Resend)

This API provides:

- `POST /api/subscribe` → adds a contact to the Resend segment configured via env.

## Setup

```bash
cd api
npm install
cp .env.example .env
# set RESEND_API_KEY + RESEND_SEGMENT_ID
npm run dev
```

## Deploy target

Expected public endpoint:

- `https://earendil.com/api/subscribe`

The website frontend (`/_static/script.js`) already posts to this endpoint.

## Deployment files

- `api/Dockerfile` — container image for ECS
- `.github/workflows/deploy-api.yml` — build/push to ECR + ECS rollout
- `api/DEPLOYMENT_CHECKLIST.md` — minimal infra checklist

`deploy-api.yml` can be pointed to exact infra names via GitHub variables:
`WEBSITE_API_AWS_REGION`, `WEBSITE_API_ECR_REPOSITORY`, `WEBSITE_API_ECS_CLUSTER`, `WEBSITE_API_ECS_SERVICE`.
