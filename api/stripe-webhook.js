const Stripe = require('stripe');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const AIRTABLE_API_BASE = 'https://api.airtable.com/v0';
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE_NAME = process.env.AIRTABLE_TABLE_NAME || 'Watches';
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
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

async function getRecord(recordId) {
  return airtableFetch(`/${recordId}`);
}

async function setStatus(recordId, status) {
  return airtableFetch(`/${recordId}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields: { Status: status } })
  });
}

async function returnReservedWatchToAvailable(recordId) {
  const record = await getRecord(recordId);
  const currentStatus = String(record.fields?.Status || '').trim().toLowerCase();
  if (currentStatus === 'reserved') await setStatus(recordId, 'Available');
}

async function handleEvent(event) {
  const session = event.data && event.data.object;
  const recordId = session && session.metadata && session.metadata.airtableRecordId;
  if (!recordId) return;

  if (event.type === 'checkout.session.completed') {
    if (session.payment_status === 'paid') await setStatus(recordId, 'Sold');
    return;
  }

  if (event.type === 'checkout.session.expired') {
    await returnReservedWatchToAvailable(recordId);
  }
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end('Method not allowed');
  }

  let event;
  try {
    const rawBody = await readRawBody(req);
    const signature = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    console.error('Webhook signature verification failed:', error.message);
    res.statusCode = 400;
    return res.end(`Webhook Error: ${error.message}`);
  }

  try {
    await handleEvent(event);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ received: true }));
  } catch (error) {
    console.error(error);
    res.statusCode = 500;
    res.end('Webhook handler failed');
  }
}

module.exports = handler;
module.exports.config = { api: { bodyParser: false } };
