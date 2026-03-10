// Cloudflare Worker for /api/subscribe

export interface Env {
  RESEND_API_KEY: string;
  RESEND_AUDIENCE_ID: string;
  ALLOWED_ORIGIN?: string;
}

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

async function addToAudience(
  email: string,
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
      audience_id: env.RESEND_AUDIENCE_ID,
    }),
  });

  if (res.ok) return { ok: true };

  const body = await res.json().catch(() => ({}));
  console.log("Resend response:", res.status, JSON.stringify(body));
  
  const msg = ((body as { message?: string }).message || "").toLowerCase();
  const alreadyExists =
    res.status === 409 || msg.includes("already") || msg.includes("exists");

  if (alreadyExists) return { ok: true };
  return { ok: false, error: body };
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

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    // Health check
    if (url.pathname === "/health" || url.pathname === "/api/health") {
      return json({ ok: true }, 200, origin);
    }

    // Only POST /api/subscribe
    if (url.pathname !== "/api/subscribe") {
      return json({ ok: false, error: "not_found" }, 404, origin);
    }

    if (request.method !== "POST") {
      return json({ ok: false, error: "method_not_allowed" }, 405, origin);
    }

    // Parse body
    let body: { email?: string };
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: "invalid_json" }, 400, origin);
    }

    // Validate email
    const email = String(body?.email || "").trim().toLowerCase();
    if (!isValidEmail(email)) {
      return json({ ok: false, error: "invalid_email" }, 400, origin);
    }

    // Add to Resend audience
    const result = await addToAudience(email, env);
    if (!result.ok) {
      console.error("Subscribe failed:", result.error);
      return json({ ok: false, error: "subscribe_failed" }, 500, origin);
    }

    return json({ ok: true }, 200, origin);
  },
};
