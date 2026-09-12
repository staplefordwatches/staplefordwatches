import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

class MemoryCache {
  constructor() {
    this.values = new Map();
  }

  async match(request) {
    const value = this.values.get(request.url);
    return value ? value.clone() : undefined;
  }

  async put(request, response) {
    this.values.set(request.url, response.clone());
  }

  async delete(request) {
    return this.values.delete(request.url);
  }
}

test("watches endpoint returns one compact catalogue and caches the Airtable read", async () => {
  globalThis.caches = { default: new MemoryCache() };
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  globalThis.__airtableWebhookChecks = 0;
  let airtableReads = 0;
  globalThis.fetch = async (request) => {
    const url = new URL(request.url || request);
    assert.equal(url.hostname, "api.airtable.com");
    airtableReads += 1;
    return Response.json({
      records: [{
        id: "rec123",
        fields: {
          SKU: "SW001",
          Brand: "Rolex",
          Title: "Submariner",
          Price: 10000 + airtableReads,
          Status: "Available",
          "Date Added": "2026-09-09",
          "Image Count": 3,
          Reference: "126610LN",
          Year: "2024",
        },
      }],
    });
  };

  try {
    const cacheSource = await readFile(new URL("../functions/_utils/data-cache.js", import.meta.url), "utf8");
    const cacheUrl = `data:text/javascript;base64,${Buffer.from(cacheSource).toString("base64")}`;
    const webhookSource = [
      "export const AIRTABLE_CATALOGS = [{}];",
      "export function ensureAirtableWebhook(){",
      "  globalThis.__airtableWebhookChecks += 1;",
      "  return Promise.resolve(null);",
      "}",
    ].join("\n");
    const webhookUrl = `data:text/javascript;base64,${Buffer.from(webhookSource).toString("base64")}`;
    const watchesSource = (await readFile(new URL("../functions/api/watches.js", import.meta.url), "utf8"))
      .replace('"../_utils/data-cache.js"', `"${cacheUrl}"`)
      .replace('"../_utils/airtable-webhooks.js"', `"${webhookUrl}"`);
    const { onRequest } = await import(`data:text/javascript;base64,${Buffer.from(watchesSource).toString("base64")}`);
    const makeContext = () => ({
      env: { AIRTABLE_TOKEN: "test", AIRTABLE_BASE_ID: "app123" },
      request: new Request("https://example.com/api/watches"),
      waitUntil() {},
    });

    const first = await onRequest(makeContext());
    const payload = await first.json();
    const second = await onRequest(makeContext());
    now += 61 * 1000;
    const refreshed = await onRequest(makeContext());
    const refreshedPayload = await refreshed.json();

    assert.equal(first.status, 200);
    assert.equal(first.headers.get("Cache-Control"), "no-store");
    assert.equal(second.headers.get("X-Stapleford-Cache"), "EDGE");
    assert.equal(airtableReads, 2);
    assert.equal(globalThis.__airtableWebhookChecks, 3);
    assert.equal(refreshed.headers.get("X-Stapleford-Cache"), "REFRESHED");
    assert.equal(refreshedPayload.watches[0].price, 10002);
    assert.equal(payload.count, 1);
    assert.equal(payload.watches[0].listingId, "SW001");
    assert.equal(payload.watches[0].images.length, 3);
    assert.equal(payload.watches[0].specs.reference, "126610LN");
    assert.equal(payload.watches[0].dateAdded, "2026-09-09");
    assert.equal("items" in payload, false);
    assert.equal("data" in payload, false);
    assert.equal("gallery" in payload.watches[0], false);
    assert.equal("mainImageUrl" in payload.watches[0], false);
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
    delete globalThis.__airtableWebhookChecks;
  }
});

test("watches use a one-minute blocking source-of-truth fallback", async () => {
  const source = await readFile(new URL("../functions/api/watches.js", import.meta.url), "utf8");
  assert.match(source, /freshSeconds: 60,/);
  assert.match(source, /blockingRefreshWhenStale: true,/);
  assert.match(source, /browserSeconds: 0,/);
});
