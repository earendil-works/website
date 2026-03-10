# Earendil Subscribe API

Cloudflare Worker that handles:

- `POST /api/subscribe` → adds a contact to Website Subscribers.
- `POST /api/resend/inbound-lefos-alpha` → adds inbound senders to Lefos Alpha.

## Endpoints

- `POST /api/subscribe` with `{"email":"..."}` → `{"ok": true}`
- `POST /api/resend/inbound-lefos-alpha` for Resend inbound webhook payloads
- `GET /health` (or `/api/health`) → `{"ok": true}`

Production worker URL:

- `https://earendil-subscribe-api.earendil-subscribe.workers.dev`

## Local dev

```bash
npm install
npx wrangler dev
```

## Deploy

```bash
npm run deploy
```

## Required secrets / vars

Secrets (set via `wrangler secret put`):

- `RESEND_API_KEY`
- `RESEND_SEGMENT_ID` (Website Subscribers)
- `LEFOS_ALPHA_SEGMENT_ID` (Lefos Alpha)

Vars (in `wrangler.toml`):

- `ALLOWED_ORIGIN` (default `https://earendil.com`)
- `LEFOS_ALPHA_INBOUND` (default `lefos-alpha@mail.earendil.com`)

## Resend webhook config

Create a Resend webhook with:

- Event: `email.received`
- URL: `https://earendil.com/api/resend/inbound-lefos-alpha`

Duplicate inbound emails are safe: contact/segment sync is idempotent.
