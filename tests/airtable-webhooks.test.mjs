import assert from "node:assert/strict";
import { createHmac, webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const source = await readFile(new URL("../functions/_utils/airtable-webhooks.js", import.meta.url), "utf8");
const webhookModule = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const {
  AIRTABLE_CATALOGS,
  ensureAirtableWebhook,
  findVerifiedCatalog,
  shouldRefreshForNotification,
  verifyAirtableNotification,
  webhookPublicStatus,
  webhookStateKey,
} = webhookModule;

class MemoryKv {
  constructor() {
    this.values = new Map();
  }

  async get(key) {
    return this.values.get(key) || null;
  }

  async put(key, value) {
    this.values.set(key, value);
  }
}

function signedNotification(secret, webhookId = "achWebhook123") {
  const body = JSON.stringify({
    base: { id: "appBase123" },
    webhook: { id: webhookId },
    timestamp: "2026-09-09T18:00:00.000Z",
  });
  const header = `hmac-sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  return { body, header };
}

test("creates one table-scoped webhook and reuses it while healthy", async () => {
  const originalFetch = globalThis.fetch;
  const kv = new MemoryKv();
  const requests = [];
  globalThis.fetch = async (request, options) => {
    requests.push({ url: String(request), options });
    return Response.json({
      id: "achWebhook123",
      macSecretBase64: Buffer.from("verification-secret").toString("base64"),
      expirationTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });
  };

  try {
    const context = {
      env: {
        AIRTABLE_TOKEN: "private-token",
        AIRTABLE_BASE_ID: "appBase123",
        CATALOG_CACHE: kv,
        CF_PAGES_BRANCH: "main",
      },
    };
    const first = await ensureAirtableWebhook(context, AIRTABLE_CATALOGS[0]);
    const second = await ensureAirtableWebhook(context, AIRTABLE_CATALOGS[0]);

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "https://api.airtable.com/v0/bases/appBase123/webhooks");
    assert.equal(requests[0].options.headers.Authorization, "Bearer private-token");
    const requestBody = JSON.parse(requests[0].options.body);
    assert.equal(requestBody.specification.options.filters.recordChangeScope, "tblr4O0WXZeRBunyh");
    assert.equal(first.id, "achWebhook123");
    assert.equal(second.id, "achWebhook123");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("stores a safe retry state when the token cannot manage webhooks", async () => {
  const originalFetch = globalThis.fetch;
  const kv = new MemoryKv();
  globalThis.fetch = async () => Response.json(
    { error: { type: "AUTHENTICATION_REQUIRED", message: "Missing webhook scope" } },
    { status: 403 }
  );

  try {
    const state = await ensureAirtableWebhook({
      env: {
        AIRTABLE_TOKEN: "private-token",
        AIRTABLE_BASE_ID: "appBase123",
        CATALOG_CACHE: kv,
      },
    }, AIRTABLE_CATALOGS[0]);
    assert.match(state.lastError, /403/);
    assert.equal(state.lastError.includes("private-token"), false);
    assert.ok(state.nextAttemptAt > Date.now());
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("accepts only correctly signed notifications for the configured base and webhook", async () => {
  const kv = new MemoryKv();
  const secret = "verification-secret";
  await kv.put(webhookStateKey("watches"), JSON.stringify({
    id: "achWebhook123",
    macSecretBase64: Buffer.from(secret).toString("base64"),
    expirationTime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  }));
  const env = { AIRTABLE_BASE_ID: "appBase123", CATALOG_CACHE: kv };
  const { body, header } = signedNotification(secret);

  assert.equal(await verifyAirtableNotification(body, header, Buffer.from(secret).toString("base64")), true);
  assert.equal(await verifyAirtableNotification(body, `${header}bad`, Buffer.from(secret).toString("base64")), false);
  const verified = await findVerifiedCatalog(env, body, header);
  assert.equal(verified.catalog.key, "watches");
  assert.equal(await findVerifiedCatalog(env, body, "hmac-sha256=bad"), null);
});

test("debounces duplicate formula notifications and exposes secret-free health", async () => {
  const kv = new MemoryKv();
  const env = { CATALOG_CACHE: kv };
  assert.equal(await shouldRefreshForNotification(env, "watches"), true);
  assert.equal(await shouldRefreshForNotification(env, "watches"), false);

  await kv.put(webhookStateKey("watches"), JSON.stringify({
    id: "achWebhook123",
    macSecretBase64: "secret-value",
    expirationTime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  }));
  const status = await webhookPublicStatus(env);
  assert.equal(status.catalogs[0].active, true);
  assert.equal(JSON.stringify(status).includes("achWebhook123"), false);
  assert.equal(JSON.stringify(status).includes("secret-value"), false);
});
