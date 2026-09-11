import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

function moduleUrl(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}

async function loadHandler({ refreshFails = false } = {}) {
  const cacheStub = moduleUrl([
    "export async function refreshDataCache(context, options) {",
    "  globalThis.__webhookRefreshContext = context;",
    "  if (globalThis.__webhookRefreshFails) throw new Error('refresh failed');",
    "  return options.producer();",
    "}",
  ].join("\n"));
  const webhookStub = moduleUrl([
    "export async function findVerifiedCatalog() { return { catalog: { key: 'watches' } }; }",
    "export async function shouldRefreshForNotification() { return true; }",
    "export async function webhookPublicStatus() { return {}; }",
  ].join("\n"));
  const journalStub = moduleUrl("export async function loadJournal() { return Response.json({ ok: true }); }");
  const watchesStub = moduleUrl([
    "export async function loadWatches(context) {",
    "  globalThis.__webhookProducerStarted = true;",
    "  if (!context.env.AIRTABLE_TOKEN) return Response.json({ ok: false }, { status: 500 });",
    "  return Response.json({ ok: true });",
    "}",
  ].join("\n"));

  globalThis.__webhookRefreshFails = refreshFails;
  globalThis.__webhookProducerStarted = false;
  globalThis.__webhookRefreshContext = null;

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
  delete globalThis.__webhookProducerStarted;
  delete globalThis.__webhookRefreshContext;
});

test("confirms a webhook only after the catalogue refresh succeeds", async () => {
  const { onRequestPost } = await loadHandler();
  const response = await onRequestPost(context());

  assert.equal(response.status, 200);
  assert.equal(globalThis.__webhookProducerStarted, true);
  assert.equal(globalThis.__webhookRefreshContext.env.AIRTABLE_TOKEN, "private-token");
  assert.equal(globalThis.__webhookRefreshContext.request.url, "https://staplefordwatches.co.uk/api/watches");
  assert.deepEqual(await response.json(), { ok: true, accepted: true });
});

test("asks Airtable to retry when rebuilding the catalogue fails", async () => {
  const { onRequestPost } = await loadHandler({ refreshFails: true });
  const response = await onRequestPost(context());

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ok: false, retry: true });
});
