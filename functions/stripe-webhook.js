function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a[i] ^ b[i];
  return result === 0;
}

async function verifyStripeSignature(rawBody, signatureHeader, webhookSecret) {
  if (!signatureHeader || !webhookSecret) return false;

  const parts = Object.fromEntries(signatureHeader.split(",").map(part => {
    const [key, value] = part.split("=");
    return [key, value];
  }));

  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(webhookSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signedPayload = `${timestamp}.${rawBody}`;
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(signedPayload));
  return timingSafeEqual(new Uint8Array(digest), hexToBytes(signature));
}

async function markRecordsSold(recordIds, env) {
  const ids = [...new Set(recordIds.filter(Boolean))];
  if (!ids.length) return;

  const url = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(env.AIRTABLE_TABLE_NAME)}`;
  const records = ids.map(id => ({
    id,
    fields: {
      "Listing Status": "Sold",
      "Stock Quantity": 0
    }
  }));

  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${env.AIRTABLE_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ records })
  });

  if (!response.ok) {
    const data = await response.text();
    console.error(data);
    throw new Error("Could not update Airtable sold status.");
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get("stripe-signature");
    const valid = await verifyStripeSignature(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);

    if (!valid) return json({ error: "Invalid signature." }, 400);

    const event = JSON.parse(rawBody);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const recordIds = String(session.metadata?.airtable_record_ids || "")
        .split(",")
        .map(id => id.trim())
        .filter(Boolean);

      await markRecordsSold(recordIds, env);
    }

    return json({ received: true });
  } catch (error) {
    console.error(error);
    return json({ error: error.message || "Webhook failed." }, 500);
  }
}
