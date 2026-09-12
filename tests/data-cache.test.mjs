import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../functions/_utils/data-cache.js", import.meta.url), "utf8");
const cacheModule = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const { refreshDataCache, withDataCache } = cacheModule;

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

function context(url, env = {}, headers = {}) {
  const pending = [];
  return {
    env,
    request: new Request(url, { headers }),
    waitUntil(promise) {
      pending.push(promise);
    },
    pending,
  };
}

function jsonProducer(counter, value = { watches: [{ id: "one" }] }) {
  return async () => {
    counter.count += 1;
    return Response.json(value);
  };
}

test.beforeEach(() => {
  globalThis.caches = { default: new MemoryCache() };
});

test("one origin read serves repeated and cache-busted visitor URLs", async () => {
  const counter = { count: 0 };
  const producer = jsonProducer(counter);

  const first = await withDataCache(context("https://example.com/api/watches?fresh=1"), {
    key: "watches",
    producer,
  });
  const second = await withDataCache(context("https://example.com/api/watches?fresh=2"), {
    key: "watches",
    producer,
  });

  assert.equal(counter.count, 1);
  assert.equal(first.headers.get("X-Stapleford-Cache"), "MISS");
  assert.equal(first.headers.get("X-Stapleford-Cache-Scope"), "LOCAL");
  assert.equal(second.headers.get("X-Stapleford-Cache"), "EDGE");
  assert.deepEqual(await second.json(), { watches: [{ id: "one" }] });
});

test("a zero browser lifetime prevents stale client catalogue responses", async () => {
  const counter = { count: 0 };
  const response = await withDataCache(context("https://example.com/api/watches"), {
    key: "watches",
    browserSeconds: 0,
    producer: jsonProducer(counter),
  });

  assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("shared snapshot prevents a second data centre from reading Airtable", async () => {
  const kv = new MemoryKv();
  const counter = { count: 0 };
  const producer = jsonProducer(counter);

  await withDataCache(context("https://example.com/api/watches", { CATALOG_CACHE: kv }), {
    key: "watches",
    producer,
  });

  globalThis.caches = { default: new MemoryCache() };
  const response = await withDataCache(
    context("https://example.com/api/watches", { CATALOG_CACHE: kv }),
    { key: "watches", producer }
  );

  assert.equal(counter.count, 1);
  assert.equal(response.headers.get("X-Stapleford-Cache"), "SHARED");
  assert.equal(response.headers.get("X-Stapleford-Cache-Scope"), "GLOBAL");

  const sameDataCentre = await withDataCache(
    context("https://example.com/api/watches", { CATALOG_CACHE: kv }),
    { key: "watches", producer }
  );
  assert.equal(sameDataCentre.headers.get("X-Stapleford-Cache"), "EDGE");
  assert.equal(counter.count, 1);
});

test("authenticated refresh bypasses a fresh snapshot", async () => {
  const kv = new MemoryKv();
  const counter = { count: 0 };
  const producer = jsonProducer(counter);
  const env = { CATALOG_CACHE: kv, CACHE_REFRESH_TOKEN: "correct-secret" };

  await withDataCache(context("https://example.com/api/watches", env), {
    key: "watches",
    producer,
  });
  const response = await withDataCache(
    context("https://example.com/api/watches", env, { "X-Stapleford-Refresh-Token": "correct-secret" }),
    { key: "watches", producer }
  );

  assert.equal(counter.count, 2);
  assert.equal(response.headers.get("X-Stapleford-Cache"), "REFRESHED");
});

test("an incorrect refresh token cannot bypass the cache", async () => {
  const counter = { count: 0 };
  const producer = jsonProducer(counter);
  const env = { CACHE_REFRESH_TOKEN: "correct-secret" };

  await withDataCache(context("https://example.com/api/watches", env), {
    key: "watches",
    producer,
  });
  await withDataCache(
    context("https://example.com/api/watches", env, { "X-Stapleford-Refresh-Token": "wrong-secret" }),
    { key: "watches", producer }
  );

  assert.equal(counter.count, 1);
});

test("stale catalogue stays available when Airtable fails", async () => {
  const counter = { count: 0 };
  await withDataCache(context("https://example.com/api/watches"), {
    key: "watches",
    freshSeconds: -1,
    producer: jsonProducer(counter),
  });

  const failedRefreshContext = context("https://example.com/api/watches");
  const response = await withDataCache(failedRefreshContext, {
    key: "watches",
    freshSeconds: -1,
    producer: async () => {
      counter.count += 1;
      return Response.json({ error: "Airtable unavailable" }, { status: 503 });
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-Stapleford-Cache"), "STALE");
  assert.deepEqual(await response.json(), { watches: [{ id: "one" }] });
  await Promise.all(failedRefreshContext.pending);
  assert.equal(counter.count, 2);
});

test("blocking stale refresh returns new Journal content in the same request", async () => {
  const kv = new MemoryKv();
  const env = { CATALOG_CACHE: kv };
  const counter = { count: 0 };

  await withDataCache(context("https://example.com/api/journal", env), {
    key: "journal",
    freshSeconds: -1,
    producer: jsonProducer(counter, { posts: [{ id: "old" }] }),
  });

  const response = await withDataCache(context("https://example.com/api/journal", env), {
    key: "journal",
    freshSeconds: -1,
    blockingRefreshWhenStale: true,
    producer: jsonProducer(counter, { posts: [{ id: "new" }] }),
  });

  assert.equal(counter.count, 2);
  assert.equal(response.headers.get("X-Stapleford-Cache"), "REFRESHED");
  assert.deepEqual(await response.json(), { posts: [{ id: "new" }] });
});

test("webhook refresh replaces a snapshot without discarding the last good copy on failure", async () => {
  const kv = new MemoryKv();
  const env = { CATALOG_CACHE: kv };
  const counter = { count: 0 };
  const initialContext = context("https://example.com/api/watches", env);

  await withDataCache(initialContext, {
    key: "watches",
    producer: jsonProducer(counter, { watches: [{ id: "old" }] }),
  });

  const refreshed = await refreshDataCache(context("https://example.com/api/watches", env), {
    key: "watches",
    producer: jsonProducer(counter, { watches: [{ id: "new" }] }),
  });
  assert.equal(refreshed.headers.get("X-Stapleford-Cache"), "REFRESHED");
  assert.deepEqual(await refreshed.json(), { watches: [{ id: "new" }] });

  const failed = await refreshDataCache(context("https://example.com/api/watches", env), {
    key: "watches",
    producer: async () => Response.json({ error: "offline" }, { status: 503 }),
  });
  assert.equal(failed.status, 200);
  assert.equal(failed.headers.get("X-Stapleford-Cache"), "STALE");
  assert.deepEqual(await failed.json(), { watches: [{ id: "new" }] });
});
