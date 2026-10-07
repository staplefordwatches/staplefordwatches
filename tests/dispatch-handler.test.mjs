import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createDispatchHandlers } from '../functions/api/dispatch.js';
import { sessionCookie, issueToken, readToken } from '../functions/_utils/dispatch-auth.js';
import { MailSubmissionError } from '../functions/_utils/ionos-smtp.js';

const ORIGIN = 'https://staplefordwatches.co.uk';
const key = 'private-random-dispatch-test-key-0123456789';
const data = { customerName: 'Alex', customerEmail: 'alex@example.com', orderNumber: 'SW-1001', watchName: 'OMEGA Seamaster', trackingNumber: 'AB123456789GB', trackingUrl: 'https://www.royalmail.com/track-your-item#/tracking-results/AB123456789GB' };

function database() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0001_dispatch_emails.sql', import.meta.url), 'utf8'));
  return {
    raw: db,
    prepare(sql) {
      const statement = db.prepare(sql);
      let values = [];
      return {
        bind(...args) { values = args; return this; },
        async run() { return { meta: { changes: Number(statement.run(...values).changes) } }; },
        async all() { return { results: statement.all(...values) }; },
      };
    },
  };
}

async function setup(submit) {
  const env = { DISPATCH_ACCESS_KEY: key, DISPATCH_ENABLED: 'true', IONOS_SMTP_PASSWORD: 'secret-test-password', DISPATCH_DB: database() };
  const handlers = createDispatchHandlers(submit);
  const cookie = (await sessionCookie(key)).split(';')[0];
  function post(body, { auth = true, origin = ORIGIN } = {}) {
    return handlers.onRequestPost({ env, request: new Request(`${ORIGIN}/api/dispatch`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...(auth ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) }) });
  }
  async function preview(value = data) {
    const response = await post({ action: 'preview', data: value });
    assert.equal(response.status, 200);
    return response.json();
  }
  return { env, handlers, cookie, post, preview };
}

test('unauthenticated and cross-origin sends cannot reach the sender or reserve an order', async () => {
  let calls = 0;
  const app = await setup(async () => { calls++; return { accepted: true }; });
  assert.equal((await app.post({ action: 'send', data }, { auth: false })).status, 401);
  assert.equal((await app.post({ action: 'send', data }, { origin: 'https://other.example' })).status, 403);
  assert.equal(calls, 0);
  assert.equal(app.env.DISPATCH_DB.raw.prepare('SELECT count(*) AS n FROM dispatch_emails').get().n, 0);
});

test('login sets a secure session and rejects the wrong access key', async () => {
  const app = await setup();
  assert.equal((await app.post({ action: 'login', accessKey: 'wrong-key' }, { auth: false })).status, 401);
  const response = await app.post({ action: 'login', accessKey: key }, { auth: false });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Strict/);
  assert.match(response.headers.get('set-cookie'), /Path=\/api\/dispatch/);
  assert(!JSON.stringify(await response.json()).includes(key));
});

test('preview approval expires and cannot be used for altered customer or tracking details', async () => {
  let calls = 0;
  const app = await setup(async () => { calls++; return { accepted: true }; });
  const preview = await app.preview();
  assert(preview.html.includes('TRACK YOUR SHIPMENT'));
  const response = await app.post({ action: 'send', data: { ...data, customerEmail: 'other@example.com' }, previewToken: preview.previewToken, confirmedDispatched: true });
  assert.equal(response.status, 409);
  assert.equal(calls, 0);
  const expired = await issueToken(key, 'preview', 'payload', 1000, 0);
  assert.equal(await readToken(key, 'preview', expired, 1001), null);
  assert.equal(await readToken('a-different-secret', 'preview', preview.previewToken), null);
});

test('concurrent and repeated sends reserve one order and submit only once', async () => {
  let calls = 0;
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const app = await setup(async () => { calls++; await held; return { accepted: true }; });
  const { previewToken } = await app.preview();
  const body = { action: 'send', data, previewToken, confirmedDispatched: true };
  const first = app.post(body);
  while (!calls) await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal((await app.post(body)).status, 409);
  release();
  assert.equal((await first).status, 200);
  assert.equal((await app.post(body)).status, 409);
  assert.equal(calls, 1);
  assert.equal(app.env.DISPATCH_DB.raw.prepare('SELECT status FROM dispatch_emails').get().status, 'accepted');
});

test('customer sends require an actual-dispatch confirmation; self-test never sends to the entered buyer', async () => {
  const recipients = [];
  const subjects = [];
  const app = await setup(async message => { recipients.push(message.to); subjects.push(message.email.subject); return { accepted: true }; });
  const { previewToken } = await app.preview();
  assert.equal((await app.post({ action: 'send', data, previewToken })).status, 400);
  app.env.DISPATCH_ENABLED = 'false';
  assert.equal((await app.post({ action: 'send', data, previewToken, confirmedDispatched: true })).status, 503);
  assert.equal((await app.post({ action: 'send-test', data, previewToken })).status, 200);
  assert.deepEqual(recipients, ['ben@staplefordwatches.co.uk']);
  assert(subjects[0].startsWith('[TEST] '));
});

test('uncertain SMTP results block retries, but failures before submission can be corrected and retried', async () => {
  let calls = 0;
  const app = await setup(async () => { calls++; throw new MailSubmissionError('Lost confirmation', true); });
  const { previewToken } = await app.preview();
  const body = { action: 'send', data, previewToken, confirmedDispatched: true };
  const response = await app.post(body);
  assert.equal(response.status, 502);
  assert.equal((await response.json()).status, 'uncertain');
  assert.equal((await app.post(body)).status, 409);
  assert.equal(calls, 1);
  let retryCalls = 0;
  const retry = await setup(async () => { retryCalls++; if (retryCalls === 1) throw new MailSubmissionError('Auth rejected'); return { accepted: true }; });
  const retryPreview = await retry.preview();
  const retryBody = { ...body, previewToken: retryPreview.previewToken };
  assert.equal((await retry.post(retryBody)).status, 502);
  assert.equal((await retry.post(retryBody)).status, 200);
  assert.equal(retryCalls, 2);
});

test('a logging failure after SMTP acceptance cannot cause a second submission', async () => {
  let calls = 0;
  const app = await setup(async () => { calls++; return { accepted: true }; });
  const dbPrepare = app.env.DISPATCH_DB.prepare.bind(app.env.DISPATCH_DB);
  app.env.DISPATCH_DB.prepare = sql => {
    if (sql.startsWith('UPDATE')) throw new Error('Database temporarily unavailable');
    return dbPrepare(sql);
  };
  const { previewToken } = await app.preview();
  const body = { action: 'send', data, previewToken, confirmedDispatched: true };
  assert.equal((await app.post(body)).status, 502);
  assert.equal((await app.post(body)).status, 409);
  assert.equal(calls, 1);
  assert.equal(app.env.DISPATCH_DB.raw.prepare('SELECT status FROM dispatch_emails').get().status, 'sending');
});
