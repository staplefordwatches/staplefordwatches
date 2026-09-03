// functions/api/newsletter-signup.js

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch (_err) {
    return jsonResponse({ ok: false, error: 'Invalid request body' }, 400);
  }

  const email = (body.email || '').trim().toLowerCase();
  const company = body.company || ''; // honeypot field
  const source = body.source || 'website';

  // Honeypot: if this hidden field is filled in, it's almost certainly a bot.
  // Pretend success so bots don't learn anything.
  if (company) {
    return jsonResponse({ ok: true, alreadySubscribed: false }, 200);
  }

  if (!email || !EMAIL_RE.test(email)) {
    return jsonResponse({ ok: false, error: 'Please enter a valid email address' }, 400);
  }

  const AIRTABLE_TOKEN = env.AIRTABLE_TOKEN;
  const AIRTABLE_BASE_ID = env.AIRTABLE_BASE_ID;
  const AIRTABLE_TABLE = env.AIRTABLE_NEWSLETTER_TABLE || 'Newsletter Signups';

  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) {
