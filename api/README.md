# Earendil Subscribe API

Cloudflare Worker that adds contacts to a Resend audience.

## Endpoint

`POST /api/subscribe` with `{"email": "..."}` → `{"ok": true}`

**Production:** https://earendil-subscribe-api.earendil-subscribe.workers.dev

## Local dev

```bash
npm install
npx wrangler dev
```

## Deploy

```bash
npm run deploy
```

## Secrets (set via `wrangler secret put`)

- `RESEND_API_KEY`
- `RESEND_SEGMENT_ID`
