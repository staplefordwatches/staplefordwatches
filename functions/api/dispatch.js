import { renderDispatchEmail } from '../_utils/dispatch-email.js';
import { sendIonosMail } from '../_utils/ionos-smtp.js';
import { authenticated, equalSecrets, fingerprint, issueToken, readToken, sessionCookie, clearSessionCookie } from '../_utils/dispatch-auth.js';

const MAILBOX = 'ben@staplefordwatches.co.uk';
const EMAIL_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

function json(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', ...headers } });
}

function accessConfigured(env) {
  return typeof env.DISPATCH_ACCESS_KEY === 'string' && env.DISPATCH_ACCESS_KEY.length >= 32;
}

function field(value, name, max = 256) {
  if (typeof value !== 'string') throw new Error(`${name} is required.`);
  const text = value.trim();
  if (!text || text.length > max || /[\u0000-\u001f\u007f]/.test(text)) throw new Error(`Please check ${name.toLowerCase()}.`);
  return text;
}

export function dispatchData(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Please enter the dispatch details.');
  const data = {
    customerName: field(input.customerName, 'Customer name', 100),
    customerEmail: field(input.customerEmail, 'Customer email', 254),
    orderNumber: field(input.orderNumber, 'Order number', 100),
    watchName: field(input.watchName, 'Watch name and model', 256),
    trackingNumber: field(input.trackingNumber, 'Tracking number', 100),
    trackingUrl: field(input.trackingUrl, 'Tracking link', 2048),
  };
  if (!EMAIL_RE.test(data.customerEmail)) throw new Error('Please enter a valid customer email address.');
  if (!/^[a-zA-Z0-9-]+$/.test(data.trackingNumber)) throw new Error('Enter the tracking number without spaces or punctuation.');
  const url = new URL(data.trackingUrl);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Please use the courier’s complete HTTPS tracking link.');
  data.trackingUrl = url.href;
  return data;
}

async function bodyJson(request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new Error('Use a JSON request.');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Missing request body.');
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 8192) {
        await reader.cancel();
        throw new Error('The dispatch details are too long.');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const body = JSON.parse(new TextDecoder().decode(bytes));
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid request body.');
  return body;
}

function sameOrigin(request) {
  return request.headers.get('origin') === new URL(request.url).origin;
}

// Factory permits isolated SMTP protocol and SQLite tests without live sending.
export function createDispatchHandlers(submit = sendIonosMail) {
  async function onRequestGet({ request, env }) {
    if (!accessConfigured(env)) return json({ ok: false, error: 'Dispatch access has not been configured.' }, 503);
    if (!await authenticated(request, env.DISPATCH_ACCESS_KEY)) return json({ ok: false, error: 'Please sign in.' }, 401);
    if (new URL(request.url).searchParams.get('history') === '1') {
      if (!env.DISPATCH_DB) return json({ ok: false, error: 'The dispatch database has not been connected.' }, 503);
      try {
        const result = await env.DISPATCH_DB.prepare('SELECT order_number, customer_name, customer_email, watch_name, tracking_number, status, created_at, updated_at FROM dispatch_emails ORDER BY created_at DESC LIMIT 50').all();
        return json({ ok: true, records: result.results });
      } catch { return json({ ok: false, error: 'Could not load the dispatch history.' }, 503); }
    }
    return json({ ok: true, enabled: env.DISPATCH_ENABLED === 'true', sender: MAILBOX });
  }

  async function onRequestPost({ request, env }) {
    if (!sameOrigin(request)) return json({ ok: false, error: 'Open the dispatch page on this website.' }, 403);
    if (!accessConfigured(env)) return json({ ok: false, error: 'Dispatch access has not been configured.' }, 503);
    let body;
    try { body = await bodyJson(request); }
    catch { return json({ ok: false, error: 'Please check the request details.' }, 400); }
    if (body.action === 'login') {
      if (typeof body.accessKey !== 'string' || body.accessKey.length > 256 || !await equalSecrets(body.accessKey, env.DISPATCH_ACCESS_KEY)) {
        return json({ ok: false, error: 'The dispatch access key is incorrect.' }, 401);
      }
      return json({ ok: true, enabled: env.DISPATCH_ENABLED === 'true', sender: MAILBOX }, 200, { 'Set-Cookie': await sessionCookie(env.DISPATCH_ACCESS_KEY) });
    }
    if (!await authenticated(request, env.DISPATCH_ACCESS_KEY)) return json({ ok: false, error: 'Please sign in again.' }, 401);
    if (body.action === 'logout') return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie() });
    if (!['preview', 'send', 'send-test'].includes(body.action)) return json({ ok: false, error: 'Unknown dispatch action.' }, 400);

    let data;
    let email;
    try { data = dispatchData(body.data); email = renderDispatchEmail(data); }
    catch (error) { return json({ ok: false, error: error.message === 'Invalid URL' ? 'Please enter the complete tracking link.' : error.message }, 400); }
    const payloadHash = await fingerprint(JSON.stringify(data));
    if (body.action === 'preview') {
      return json({ ok: true, subject: email.subject, html: email.html, to: data.customerEmail, trackingUrl: data.trackingUrl, trackingHost: new URL(data.trackingUrl).hostname, previewToken: await issueToken(env.DISPATCH_ACCESS_KEY, 'preview', payloadHash, 60 * 60 * 1000) });
    }
    const previewHash = await readToken(env.DISPATCH_ACCESS_KEY, 'preview', body.previewToken);
    if (previewHash !== payloadHash) return json({ ok: false, error: 'Preview the current details before sending.' }, 409);
    const testOnly = body.action === 'send-test';
    if (!testOnly && env.DISPATCH_ENABLED !== 'true') return json({ ok: false, error: 'Customer sending is disabled. Send a test to Ben first, then enable dispatch sending in the hosting settings.' }, 503);
    if (!testOnly && body.confirmedDispatched !== true) return json({ ok: false, error: 'Confirm that the parcel has been handed to the courier.' }, 400);
    if (!env.IONOS_SMTP_PASSWORD || !env.DISPATCH_DB) return json({ ok: false, error: 'The mailbox password or dispatch database has not been connected.' }, 503);

    const orderKey = testOnly ? `test:${crypto.randomUUID()}` : await fingerprint(data.orderNumber.toUpperCase());
    const messageId = crypto.randomUUID();
    const now = new Date().toISOString();
    const recipient = testOnly ? MAILBOX : data.customerEmail;
    let claimed;
    try {
      claimed = await env.DISPATCH_DB.prepare(`INSERT INTO dispatch_emails (order_key, order_number, customer_name, customer_email, watch_name, tracking_number, tracking_url, payload_hash, message_id, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'sending', ?, ?)
        ON CONFLICT(order_key) DO UPDATE SET customer_name=excluded.customer_name, customer_email=excluded.customer_email, watch_name=excluded.watch_name, tracking_number=excluded.tracking_number, tracking_url=excluded.tracking_url, payload_hash=excluded.payload_hash, message_id=excluded.message_id, status='sending', updated_at=excluded.updated_at, error=NULL
        WHERE dispatch_emails.status='failed'`).bind(orderKey, `${testOnly ? '[TEST] ' : ''}${data.orderNumber}`, data.customerName, recipient, data.watchName, data.trackingNumber, data.trackingUrl, payloadHash, messageId, now, now).run();
    } catch { return json({ ok: false, error: 'Could not reserve this dispatch in the database. No email was submitted.' }, 503); }
    if (Number(claimed.meta?.changes) !== 1) {
      return json({ ok: false, error: 'This order already has a submission recorded or in progress. Check the history before trying anything else.' }, 409);
    }

    let accepted = false;
    try {
      const result = await submit({ password: env.IONOS_SMTP_PASSWORD, to: recipient, email: testOnly ? { ...email, subject: `[TEST] ${email.subject}` } : email, messageId });
      if (!result.accepted) throw new Error('Submission was not confirmed');
      accepted = true;
      await env.DISPATCH_DB.prepare("UPDATE dispatch_emails SET status='accepted', updated_at=?, error=NULL WHERE order_key=? AND message_id=?").bind(new Date().toISOString(), orderKey, messageId).run();
      return json({ ok: true, status: 'accepted', testOnly, to: recipient, message: 'IONOS has accepted the email for delivery.' });
    } catch (error) {
      const uncertain = accepted || error.uncertain === true || !(error.name === 'MailSubmissionError');
      const status = uncertain ? 'uncertain' : 'failed';
      try {
        await env.DISPATCH_DB.prepare('UPDATE dispatch_emails SET status=?, updated_at=?, error=? WHERE order_key=? AND message_id=?').bind(status, new Date().toISOString(), uncertain ? 'Submission outcome needs manual checking.' : 'IONOS did not accept the email.', orderKey, messageId).run();
      } catch {}
      return json({ ok: false, status, error: uncertain ? 'The submission outcome needs checking. Do not resend: IONOS may already have accepted the email. Check the recipient inbox and delivery records.' : 'IONOS did not accept the email. Check the mailbox settings before retrying.' }, 502);
    }
  }
  return { onRequestGet, onRequestPost };
}

export const { onRequestGet, onRequestPost } = createDispatchHandlers();
