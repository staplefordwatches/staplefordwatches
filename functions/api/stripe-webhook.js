function textEncoder(value) {
  return new TextEncoder().encode(String(value));
}

function toHex(buffer) {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function safeEqual(a, b) {
  const left = String(a || "");
  const right = String(b || "");
  if (left.length !== right.length) return false;

  let result = 0;
  for (let i = 0; i < left.length; i += 1) {
    result |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return result === 0;
}

function parseStripeSignature(header) {
  const parts = String(header || "").split(",");
  const parsed = { timestamp: "", signatures: [] };

  for (const part of parts) {
    const [key, value] = part.split("=");
    if (key === "t") parsed.timestamp = value;
    if (key === "v1") parsed.signatures.push(value);
  }

  return parsed;
}

async function verifyStripeWebhook(rawBody, signatureHeader, webhookSecret) {
  if (!webhookSecret) throw new Error("Missing Stripe webhook secret");
  if (!signatureHeader) throw new Error("Missing Stripe signature header");

  const { timestamp, signatures } = parseStripeSignature(signatureHeader);
  if (!timestamp || !signatures.length) throw new Error("Invalid Stripe signature header");

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) throw new Error("Invalid Stripe webhook timestamp");

  const ageSeconds = Math.abs(Date.now() / 1000 - timestampSeconds);
  if (ageSeconds > 300) throw new Error("Stripe webhook timestamp is too old");

  const signedPayload = `${timestamp}.${rawBody}`;
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder(webhookSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const digest = await crypto.subtle.sign("HMAC", key, textEncoder(signedPayload));
  const expectedSignature = toHex(digest);

  const valid = signatures.some((signature) => safeEqual(signature, expectedSignature));
  if (!valid) throw new Error("Stripe webhook signature verification failed");
}

async function airtableRequest(env, recordId, body) {
  const token = env.AIRTABLE_TOKEN || env.AIRTABLE_API_KEY;
  const baseId = env.AIRTABLE_BASE_ID;
  const tableName = env.AIRTABLE_TABLE_NAME || "Watches";

  if (!token || !baseId) throw new Error("Missing Airtable settings");
  if (!recordId) throw new Error("Missing Airtable record ID");

  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}/${encodeURIComponent(recordId)}`;

  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Airtable update failed: ${text}`);
  }

  return text ? JSON.parse(text) : {};
}

function airtableRecordIdFromSession(session) {
  return (
    session?.metadata?.airtableId ||
    session?.metadata?.airtableRecordId ||
    session?.payment_intent?.metadata?.airtableId ||
    session?.payment_intent?.metadata?.airtableRecordId ||
    ""
  );
}

async function handleStripeEvent(event, env) {
  const session = event?.data?.object;
  const recordId = airtableRecordIdFromSession(session);

  if (!recordId) {
    return { ignored: true, reason: "No Airtable record ID on Stripe session metadata" };
  }

  if (event.type === "checkout.session.completed") {
    if (session.payment_status === "paid") {
      await airtableRequest(env, recordId, { fields: { Status: "Sold" } });
      return { updated: true, status: "Sold" };
    }

    return { ignored: true, reason: `Payment status is ${session.payment_status}` };
  }

  if (event.type === "checkout.session.async_payment_succeeded") {
    await airtableRequest(env, recordId, { fields: { Status: "Sold" } });
    return { updated: true, status: "Sold" };
  }

  if (event.type === "checkout.session.expired") {
    await airtableRequest(env, recordId, { fields: { Status: "Available" } });
    return { updated: true, status: "Available" };
  }

  return { ignored: true, reason: `Unhandled event type ${event.type}` };
}

export async function onRequestPost({ request, env }) {
  const rawBody = await request.text();

  try {
    await verifyStripeWebhook(
      rawBody,
      request.headers.get("stripe-signature"),
      env.STRIPE_WEBHOOK_SECRET
    );

    const event = JSON.parse(rawBody);
    const result = await handleStripeEvent(event, env);

    return Response.json({ received: true, ...result });
  } catch (error) {
    console.error("Stripe webhook error:", error);
    return new Response(`Webhook Error: ${error.message}`, { status: 400 });
  }
}

export async function onRequestGet() {
  return new Response("Stripe webhook endpoint is live.", { status: 200 });
}
