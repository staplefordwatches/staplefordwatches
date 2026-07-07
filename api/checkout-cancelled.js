const Stripe = require('stripe');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const AIRTABLE_API_BASE = 'https://api.airtable.com/v0';
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE_NAME = process.env.AIRTABLE_TABLE_NAME || 'Watches';
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const SITE_URL = (process.env.SITE_URL || 'https://staplefordwatches.co.uk').replace(/\/$/, '');

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

async function setAvailableIfStillReserved(recordId) {
  const record = await airtableFetch(`/${recordId}`);
  const status = String(record.fields?.Status || '').trim().toLowerCase();
  if (status === 'reserved') {
    await airtableFetch(`/${recordId}`, {
      method: 'PATCH',
      body: JSON.stringify({ fields: { Status: 'Available' } })
    });
  }
}

module.exports = async function handler(req, res) {
  try {
    const sessionId = String(req.query?.session_id || '').trim();
    if (sessionId) {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const recordId = session.metadata && session.metadata.airtableRecordId;
      if (recordId && session.payment_status !== 'paid') await setAvailableIfStillReserved(recordId);
      const productUrl = session.metadata?.productUrl || SITE_URL;
      res.statusCode = 302;
      res.setHeader('Location', productUrl);
      return res.end();
    }
  } catch (error) {
    console.error(error);
  }
  res.statusCode = 302;
  res.setHeader('Location', SITE_URL);
  res.end();
};
