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
    return jsonResponse({ ok: false, error: 'Server misconfiguration' }, 500);
  }

  const airtableUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE)}`;

  try {
    // Check if this email is already subscribed
    const filterFormula = encodeURIComponent(`LOWER({Email}) = "${email.replace(/"/g, '\\"')}"`);
    const lookupRes = await fetch(`${airtableUrl}?filterByFormula=${filterFormula}&maxRecords=1`, {
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` }
    });

    if (!lookupRes.ok) {
      throw new Error(`Airtable lookup failed: ${lookupRes.status}`);
    }

    const lookupData = await lookupRes.json();
    if (lookupData.records && lookupData.records.length > 0) {
      return jsonResponse({ ok: true, alreadySubscribed: true }, 200);
    }

    // Create the new record
    const createRes = await fetch(airtableUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${AIRTABLE_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        fields: {
          Email: email,
          Source: source,
          'Signed Up At': new Date().toISOString()
        }
      })
    });

    if (!createRes.ok) {
      const errText = await createRes.text().catch(() => '');
      throw new Error(`Airtable create failed: ${createRes.status} ${errText}`);
    }

    return jsonResponse({ ok: true, alreadySubscribed: false }, 200);
  } catch (err) {
    console.error('Newsletter signup error:', err);
    return jsonResponse({ ok: false, error: 'Could not process signup' }, 500);
  }
}

function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
