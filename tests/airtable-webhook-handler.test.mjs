import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

function moduleUrl(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}

async function loadHandler({ refreshFails = false, staleFallback = false } = {}) {
  const cacheStub = moduleUrl([
    "export async function refreshDataCache(context, options) {",
    "  globalThis.__webhookRefreshContext = context;",
    "  if (globalThis.__webhookRefreshFails) throw new Error('refresh failed');",
    "  if (globalThis.__webhookStaleFallback) return Response.json({ ok: true }, { headers: { 'X-Stapleford-Cache': 'STALE' } });",
    "  return options.producer();",
    "}",
  ].join("\n"));
  const webhookStub = moduleUrl([
    "export async function findVerifiedCatalog() { return { catalog: { key: 'watches' } }; }",
    "export async function drainWebhookPayloads() { globalThis.__webhookEvents.push('payloads'); }",
    "export async function recordWebhookRefresh(_env, _key, options = {}) { globalThis.__webhookEvents.push(options.error ? 'record-error' : 'record-success'); }",
    "export async function releaseNotificationRefresh() { globalThis.__webhookEvents.push('release'); }",
    "export async function shouldRefreshForNotification() { return true; }",
    "export async function webhookPublicStatus() { return {}; }",
  ].join("\n"));
  const journalStub = moduleUrl("export async function loadJournal() { return Response.json({ ok: true }); }");
  const watchesStub = moduleUrl([
    "export async function loadWatches(context) {",
    "  globalThis.__webhookEvents.push('producer');",
    "  globalThis.__webhookProducerStarted = true;",
    "  if (globalThis.__catalogTitles) globalThis.__catalogTitles.push(globalThis.__watchTitle);",
    "  if (globalThis.__holdProducer) await globalThis.__holdProducer;",
    "  if (!context.env.AIRTABLE_TOKEN) return Response.json({ ok: false }, { status: 500 });",
    "  return Response.json({ ok: true });",
    "}",
  ].join("\n"));

  globalThis.__webhookRefreshFails = refreshFails;
  globalThis.__webhookStaleFallback = staleFallback;
  globalThis.__webhookProducerStarted = false;
  globalThis.__webhookRefreshContext = null;
  globalThis.__webhookEvents = [];

  const source = (await readFile(new URL("../functions/api/airtable-webhook.js", import.meta.url), "utf8"))
    .replace('"../_utils/data-cache.js"', `"${cacheStub}"`)
    .replace('"../_utils/airtable-webhooks.js"', `"${webhookStub}"`)
    .replace('"./journal.js"', `"${journalStub}"`)
    .replace('"./watches.js"', `"${watchesStub}"`);
  return import(`${moduleUrl(source)}#${Math.random()}`);
}

function context() {
  return {
    env: { AIRTABLE_TOKEN: "private-token" },
    request: new Request("https://example.com/api/airtable-webhook", {
      method: "POST",
      headers: { "X-Airtable-Content-MAC": "valid" },
      body: JSON.stringify({ base: { id: "appBase" }, webhook: { id: "achWebhook" } }),
    }),
  };
}

test.afterEach(() => {
  delete globalThis.__webhookRefreshFails;
  delete globalThis.__webhookStaleFallback;
  delete globalThis.__webhookProducerStarted;
  delete globalThis.__webhookRefreshContext;
  delete globalThis.__webhookEvents;
  delete globalThis.__holdProducer;
  delete globalThis.__catalogTitles;
  delete globalThis.__watchTitle;
});

test("confirms a webhook only after the catalogue refresh succeeds", async () => {
  const { onRequestPost } = await loadHandler();
  const response = await onRequestPost(context());

  assert.equal(response.status, 200);
  assert.equal(globalThis.__webhookProducerStarted, true);
  assert.equal(globalThis.__webhookRefreshContext.env.AIRTABLE_TOKEN, "private-token");
  assert.equal(globalThis.__webhookRefreshContext.request.url, "https://staplefordwatches.co.uk/api/watches");
  assert.deepEqual(globalThis.__webhookEvents, ["payloads", "producer", "record-success"]);
  assert.deepEqual(await response.json(), { ok: true, accepted: true });
});

test("asks Airtable to retry when rebuilding the catalogue fails", async () => {
  const { onRequestPost } = await loadHandler({ refreshFails: true });
  const response = await onRequestPost(context());

  assert.equal(response.status, 503);
  assert.deepEqual(globalThis.__webhookEvents, ["payloads", "release", "record-error"]);
  assert.deepEqual(await response.json(), { ok: false, retry: true });
});


test("a completed title arriving during a refresh gets its own subsequent read", async () => {
  const { onRequestPost } = await loadHandler();
  let release;
  globalThis.__holdProducer = new Promise(resolve => { release = resolve; });
  globalThis.__catalogTitles = [];
  globalThis.__watchTitle = "Se";
  const first = onRequestPost(context());
  while (!globalThis.__webhookProducerStarted) await new Promise(resolve => setImmediate(resolve));
  globalThis.__watchTitle = "Seamaster Bumper";
  const completedEdit = onRequestPost(context());
  release();
  const responses = await Promise.all([first, completedEdit]);
  assert.deepEqual(responses.map(response => response.status), [200, 200]);
  assert.deepEqual(globalThis.__catalogTitles, ["Se", "Seamaster Bumper"]);
});


test("a stale success response is retried rather than acknowledging a lost edit", async () => {
  const { onRequestPost } = await loadHandler({ staleFallback: true });
  const response = await onRequestPost(context());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ok: false, retry: true });
});
