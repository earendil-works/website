import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { Resend } from 'resend';

const PORT = Number(process.env.PORT || 3000);
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_SEGMENT_ID = process.env.RESEND_SEGMENT_ID;

if (!RESEND_API_KEY || !RESEND_SEGMENT_ID) {
  console.error('Missing RESEND_API_KEY or RESEND_SEGMENT_ID');
  process.exit(1);
}

const resend = new Resend(RESEND_API_KEY);
const app = new Hono();

function isValidEmail(email) {
  if (typeof email !== 'string') return false;
  const value = email.trim();
  const atIndex = value.indexOf('@');
  if (atIndex < 1) return false;
  const domain = value.slice(atIndex + 1);
  const dot = domain.lastIndexOf('.');
  if (dot < 1) return false;
  return domain.slice(dot + 1).length >= 2;
}

async function addToSegment(email) {
  const create = await resend.contacts.create({
    email,
    unsubscribed: false,
    segments: [{ id: RESEND_SEGMENT_ID }],
  });

  if (!create.error) return { ok: true };

  const msg = (create.error.message || '').toLowerCase();
  const alreadyExists = create.error.statusCode === 409 || msg.includes('already') || msg.includes('exists');
  if (!alreadyExists) return { ok: false, error: create.error };

  const add = await resend.contacts.segments.add({
    email,
    segmentId: RESEND_SEGMENT_ID,
  });

  if (!add.error) return { ok: true };

  if ((add.error.message || '').toLowerCase().includes('already in segment')) {
    return { ok: true };
  }

  return { ok: false, error: add.error };
}

app.options('/api/subscribe', (c) => {
  c.header('Access-Control-Allow-Origin', 'https://earendil.com');
  c.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type');
  return c.body(null, 204);
});

app.post('/api/subscribe', async (c) => {
  c.header('Access-Control-Allow-Origin', 'https://earendil.com');

  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'invalid_json' }, 400);
  }

  const email = String(body?.email || '').trim().toLowerCase();
  if (!isValidEmail(email)) {
    return c.json({ ok: false, error: 'invalid_email' }, 400);
  }

  const result = await addToSegment(email);
  if (!result.ok) {
    console.error('Subscribe failed:', result.error);
    return c.json({ ok: false, error: 'subscribe_failed' }, 500);
  }

  return c.json({ ok: true });
});

app.get('/health', (c) => c.json({ ok: true }));

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});
