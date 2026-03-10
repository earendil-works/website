// Cloudflare Worker for /api/subscribe and inbound Resend sync

export interface Env {
  RESEND_API_KEY: string;
  RESEND_SEGMENT_ID: string; // Website Subscribers
  LEFOS_ALPHA_SEGMENT_ID?: string;
  LEFOS_ALPHA_INBOUND?: string;
  ALLOWED_ORIGIN?: string;
}

const DEFAULT_LEFOS_ALPHA_SEGMENT_ID = "04a827b5-5c33-4698-95df-33cfb20d3ed9";
const DEFAULT_LEFOS_ALPHA_INBOUND = "lefos-alpha@mail.earendil.com";

function isValidEmail(email: unknown): email is string {
  if (typeof email !== "string") return false;
  const value = email.trim();
  const atIndex = value.indexOf("@");
  if (atIndex < 1) return false;
  const domain = value.slice(atIndex + 1);
  const dot = domain.lastIndexOf(".");
  if (dot < 1) return false;
  return domain.slice(dot + 1).length >= 2;
}

function parseAddress(raw: unknown): string {
  const value = String(raw || "").trim().toLowerCase();
  if (!value) return "";
  const match = value.match(/^(?:"?.+?"?\s+)?<?([^<>\s]+@[^<>\s]+)>?$/);
  const email = match ? match[1] : value;
  return isValidEmail(email) ? email : "";
}

async function addExistingContactToSegment(
  email: string,
  segmentId: string,
  env: Env
): Promise<{ ok: boolean; error?: unknown }> {
  const res = await fetch(
    `https://api.resend.com/contacts/${encodeURIComponent(email)}/segments/${segmentId}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (res.ok) return { ok: true };

  const body = await res.json().catch(() => ({}));
  const msg = ((body as { message?: string }).message || "").toLowerCase();
  if (msg.includes("already in segment")) return { ok: true };

  return { ok: false, error: body };
}

async function addToSegment(
  email: string,
  segmentId: string,
  env: Env
): Promise<{ ok: boolean; error?: unknown }> {
  const res = await fetch("https://api.resend.com/contacts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      unsubscribed: false,
      segments: [{ id: segmentId }],
    }),
  });

  if (res.ok) return { ok: true };

  const body = await res.json().catch(() => ({}));
  const msg = ((body as { message?: string }).message || "").toLowerCase();
  const alreadyExists =
    res.status === 409 || msg.includes("already") || msg.includes("exists");

  if (!alreadyExists) return { ok: false, error: body };

  return addExistingContactToSegment(email, segmentId, env);
}

function corsHeaders(origin: string): HeadersInit {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(
  data: Record<string, unknown>,
  status: number,
  origin: string
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(origin),
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = env.ALLOWED_ORIGIN || "https://earendil.com";

    // CORS preflight (used by /api/subscribe)
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    // Health check
    if (url.pathname === "/health" || url.pathname === "/api/health") {
      return json({ ok: true }, 200, origin);
    }

    // Public website subscribe endpoint
    if (url.pathname === "/api/subscribe") {
      if (request.method !== "POST") {
        return json({ ok: false, error: "method_not_allowed" }, 405, origin);
      }

      let body: { email?: string };
      try {
        body = await request.json();
      } catch {
        return json({ ok: false, error: "invalid_json" }, 400, origin);
      }

      const email = String(body?.email || "").trim().toLowerCase();
      if (!isValidEmail(email)) {
        return json({ ok: false, error: "invalid_email" }, 400, origin);
      }

      const result = await addToSegment(email, env.RESEND_SEGMENT_ID, env);
      if (!result.ok) {
        console.error("Subscribe failed:", result.error);
        return json({ ok: false, error: "subscribe_failed" }, 500, origin);
      }

      return json({ ok: true }, 200, origin);
    }

    // Resend inbound webhook for Lefos Alpha rolling sync
    if (url.pathname === "/api/resend/inbound-lefos-alpha") {
      if (request.method !== "POST") {
        return json({ ok: false, error: "method_not_allowed" }, 405, origin);
      }

      let payload: any;
      try {
        payload = await request.json();
      } catch {
        return json({ ok: false, error: "invalid_json" }, 400, origin);
      }

      const eventType = payload?.type || payload?.event;
      if (eventType && eventType !== "email.received") {
        return json({ ok: true, ignored: "event_type" }, 200, origin);
      }

      const data = payload?.data || payload;
      const toList = Array.isArray(data?.to)
        ? data.to.map((v: unknown) => String(v || "").trim().toLowerCase())
        : [];

      const inbound = (env.LEFOS_ALPHA_INBOUND || DEFAULT_LEFOS_ALPHA_INBOUND).toLowerCase();
      if (!toList.includes(inbound)) {
        return json({ ok: true, ignored: "recipient" }, 200, origin);
      }

      const sender = parseAddress(data?.from);
      if (!sender) {
        return json({ ok: false, error: "invalid_sender" }, 400, origin);
      }

      const targetSegmentId = env.LEFOS_ALPHA_SEGMENT_ID || DEFAULT_LEFOS_ALPHA_SEGMENT_ID;
      const result = await addToSegment(sender, targetSegmentId, env);
      if (!result.ok) {
        console.error("Inbound Lefos Alpha sync failed:", result.error);
        return json({ ok: false, error: "segment_sync_failed" }, 500, origin);
      }

      return json({ ok: true, email: sender }, 200, origin);
    }

    return json({ ok: false, error: "not_found" }, 404, origin);
  },
};
