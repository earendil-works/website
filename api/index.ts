import { Hono, type Context } from "hono";
import { serve } from "@hono/node-server";
import { Resend } from "resend";

const PORT = Number(process.env.PORT || 3000);

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

const RESEND_API_KEY = getRequiredEnv("RESEND_API_KEY");
const RESEND_SEGMENT_ID = getRequiredEnv("RESEND_SEGMENT_ID");

const resend = new Resend(RESEND_API_KEY);
const app = new Hono();

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

interface AddToSegmentResult {
  ok: boolean;
  error?: unknown;
}

async function addToSegment(email: string): Promise<AddToSegmentResult> {
  const create = await resend.contacts.create({
    email,
    unsubscribed: false,
    segments: [{ id: RESEND_SEGMENT_ID }],
  });

  if (!create.error) return { ok: true };

  const msg = (create.error.message || "").toLowerCase();
  const alreadyExists =
    create.error.name === "validation_error" ||
    msg.includes("already") ||
    msg.includes("exists");

  if (!alreadyExists) return { ok: false, error: create.error };

  // Contact already exists, that's fine
  return { ok: true };
}

app.options("/api/subscribe", (c: Context) => {
  c.header("Access-Control-Allow-Origin", "https://earendil.com");
  c.header("Access-Control-Allow-Methods", "POST, OPTIONS");
  c.header("Access-Control-Allow-Headers", "Content-Type");
  return c.body(null, 204);
});

interface SubscribeBody {
  email?: string;
}

app.post("/api/subscribe", async (c: Context) => {
  c.header("Access-Control-Allow-Origin", "https://earendil.com");

  let body: SubscribeBody;
  try {
    body = await c.req.json<SubscribeBody>();
  } catch {
    return c.json({ ok: false, error: "invalid_json" }, 400);
  }

  const email = String(body?.email || "").trim().toLowerCase();
  if (!isValidEmail(email)) {
    return c.json({ ok: false, error: "invalid_email" }, 400);
  }

  const result = await addToSegment(email);
  if (!result.ok) {
    console.error("Subscribe failed:", result.error);
    return c.json({ ok: false, error: "subscribe_failed" }, 500);
  }

  return c.json({ ok: true });
});

app.get("/health", (c: Context) => c.json({ ok: true }));

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});
