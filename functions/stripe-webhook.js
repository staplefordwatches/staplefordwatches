function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function hexToBytes(hex) {
  if (!hex) return null;
  const cleanHex = String(hex).trim().replace(/^0x/, '').replace(/[^0-9a-fA-F]/g, '');
  if (cleanHex.length % 2 !== 0) return null;
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.substr(i * 2, 2), 16);
  }
  return bytes;
}

function timingSafeEqual(a, b) {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a[i] ^ b[i];
  return result === 0;
}

async function verifyStripeSignature(rawBody, signatureHeader, webhookSecret) {
  // Basic guards
  if (!signatureHeader || !webhookSecret) return false;

  // Parse header robustly (handles optional spaces and unexpected characters)
  const parts = {};
  for (const part of signatureHeader.split(',')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    parts[key] = value;
  }

  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;

  // Protect against replay attacks (5 minute tolerance)
  const toleranceSeconds = 300;
  const tsNum = Number(timestamp);
  if (!Number.isFinite(tsNum)) return false;
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - tsNum) > toleranceSeconds) return false;

  const encoder = new TextEncoder();
  // Use the correct WebCrypto algorithm shape
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(webhookSecret),
    { name: "HMAC", hash: { name: "SHA-256" } },
    false,
    ["sign"]
  );

  const signedPayload = `${timestamp}.${rawBody}`;
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(signedPayload));
  const expected = hexToBytes(signature);
  if (!expected) return false;
  return timingSafeEqual(new Uint8Array(digest), expected);
}

async function patchAirtableBatch(records, env) {
  const url = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(env.AIRTABLE_TABLE_NAME)}`;
  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${env.AIRTABLE_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ records })
  });
  return response;
}

async function markRecordsSold(recordIds, env) {
  const ids = [...new Set((recordIds || []).filter(Boolean))];
  if (!ids.length) return;

  if (!env.AIRTABLE_BASE_ID || !env.AIRTABLE_TABLE_NAME || !env.AIRTABLE_TOKEN) {
    throw new Error('Missing Airtable environment configuration');
  }

  const batches = [];
  const BATCH_SIZE = 10; // Airtable allows up to 10 records per batch
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const chunk = ids.slice(i, i + BATCH_SIZE);
    const records = chunk.map(id => ({
      id,
      fields: {
        "Listing Status": "Sold",
        "Stock Quantity": 0
      }
    }));
    batches.push(records);
  }

  for (const records of batches) {
    let attempt = 0;
    const maxAttempts = 4;
    while (attempt < maxAttempts) {
      attempt += 1;
      try {
        const res = await patchAirtableBatch(records, env);
        if (res.ok) break;
        const text = await res.text();
        // Retry on 429 or 5xx
        if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
          const delay = Math.pow(2, attempt) * 200 + Math.random() * 100;
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        // Non-retryable error
        console.error('Airtable error', res.status, text);
        throw new Error('Could not update Airtable sold status.');
      } catch (err) {
        if (attempt >= maxAttempts) {
          console.error('Airtable patch failed after retries', err);
          throw new Error('Could not update Airtable sold status.');
        }
        // Wait before retrying
        const delay = Math.pow(2, attempt) * 200 + Math.random() * 100;
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
}

export async function onRequestPost({ request, env }) {
  try {
    if (request.method !== 'POST') return new Response(null, { status: 405 });

    const rawBody = await request.text();
    const signature = request.headers.get("stripe-signature");

    if (!env.STRIPE_WEBHOOK_SECRET) {
      console.error('Missing STRIPE_WEBHOOK_SECRET');
      return json({ error: 'Server misconfigured.' }, 500);
    }

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
