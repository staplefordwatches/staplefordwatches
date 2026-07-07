const Stripe = require('stripe');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const AIRTABLE_API_BASE = 'https://api.airtable.com/v0';
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE_NAME = process.env.AIRTABLE_TABLE_NAME || 'Watches';
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const SITE_URL = (process.env.SITE_URL || 'https://staplefordwatches.co.uk').replace(/\/$/, '');
const CHECKOUT_HOLD_MINUTES = Math.max(30, Math.min(24 * 60, Number(process.env.CHECKOUT_HOLD_MINUTES || 60)));
const ALLOWED_SHIPPING_COUNTRIES = String(process.env.STRIPE_SHIPPING_COUNTRIES || 'GB')
  .split(',')
  .map((country) => country.trim().toUpperCase())
  .filter(Boolean);

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  if (typeof req.body === 'object' && req.body) return req.body;
  if (typeof req.body === 'string' && req.body.trim()) return JSON.parse(req.body);
  return {};
}

function airtableString(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function parseGBPToPence(value) {
  const numeric = Number(String(value || '').replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.round(numeric * 100);
}

function productSlug(fields) {
  if (fields.Slug) return String(fields.Slug);
  const base = [fields.Brand, fields.Model, fields.Reference, fields.SKU]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || String(fields.SKU || 'watch').toLowerCase();
}

function productUrl(fields) {
  return fields['Product URL'] || `${SITE_URL}/watches/${encodeURIComponent(productSlug(fields))}/`;
}

async function airtableFetch(path, options = {}) {
  if (!AIRTABLE_BASE_ID || !AIRTABLE_TOKEN) throw new Error('Missing Airtable environment variables');
  const response = await fetch(`${AIRTABLE_API_BASE}/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE_NAME)}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${AIRTABLE_TOKEN}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || data.error || 'Airtable request failed');
  return data;
}

async function findWatchBySku(sku) {
  const formula = `{SKU}=${airtableString(sku)}`;
  const params = new URLSearchParams({ maxRecords: '1', filterByFormula: formula });
  const data = await airtableFetch(`?${params.toString()}`);
  return data.records && data.records[0];
}

async function setStatus(recordId, status) {
  await airtableFetch(`/${recordId}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields: { Status: status } })
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  let record;
  let reserved = false;

  try {
    const body = parseBody(req);
    const sku = String(body.watch || body.sku || '').trim();
    if (!sku) return json(res, 400, { error: 'Missing watch SKU' });

    record = await findWatchBySku(sku);
    if (!record) return json(res, 404, { error: 'Watch not found' });

    const fields = record.fields || {};
    const status = String(fields.Status || '').trim().toLowerCase();
    if (status !== 'available') {
      return json(res, 409, { error: 'This watch is not available to buy', status: fields.Status || 'Unavailable' });
    }

    const unitAmount = parseGBPToPence(fields.Price);
    if (!unitAmount) return json(res, 400, { error: 'Watch price is missing or invalid' });

    // Reserve first so a second visitor cannot start checkout for the same one-off watch.
    await setStatus(record.id, 'Reserved');
    reserved = true;

    const name = [fields.Brand, fields.Model].filter(Boolean).join(' ').trim() || fields.SKU || 'Stapleford Watch';
    const imageUrl = String(fields['Main Image URL'] || '').startsWith('http') ? fields['Main Image URL'] : undefined;
    const url = productUrl(fields);
    const successUrl = `${url}${url.includes('?') ? '&' : '?'}checkout=success`;
    const cancelUrl = `${SITE_URL}/api/checkout-cancelled?session_id={CHECKOUT_SESSION_ID}`;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      client_reference_id: sku,
      customer_creation: 'if_required',
      billing_address_collection: 'required',
      shipping_address_collection: ALLOWED_SHIPPING_COUNTRIES.length ? { allowed_countries: ALLOWED_SHIPPING_COUNTRIES } : undefined,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'gbp',
            unit_amount: unitAmount,
            product_data: {
              name,
              description: fields.Reference ? `Reference ${fields.Reference}` : undefined,
              images: imageUrl ? [imageUrl] : undefined,
              metadata: { sku }
            }
          }
        }
      ],
      metadata: {
        sku,
        airtableRecordId: record.id,
        productUrl: url
      },
      expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_HOLD_MINUTES * 60,
      success_url: successUrl,
      cancel_url: cancelUrl
    });

    return json(res, 200, { url: session.url });
  } catch (error) {
    // If Stripe fails after we reserved the watch, put it back.
    if (reserved && record && record.id) {
      try { await setStatus(record.id, 'Available'); } catch {}
    }
    console.error(error);
    return json(res, 500, { error: 'Unable to start checkout' });
  }
};
