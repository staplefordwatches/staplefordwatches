const CACHE_VERSION = "v8";
const EDGE_RETENTION_SECONDS = 60 * 60 * 24 * 30;
const DEFAULT_FRESH_SECONDS = 60 * 60 * 6;
const DEFAULT_BROWSER_SECONDS = 60;
const inFlightRefreshes = new Map();

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function sharedBinding(env) {
  const binding = env?.CATALOG_CACHE;
  return binding && typeof binding.get === "function" && typeof binding.put === "function"
    ? binding
    : null;
}

function sharedKey(key) {
  return `stapleford:data:${CACHE_VERSION}:${key}`;
}

function lockKey(key) {
  return `${sharedKey(key)}:refreshing`;
}

function edgeRequest(requestUrl, key) {
  const url = new URL(requestUrl);
  url.pathname = `/__stapleford-data-cache/${CACHE_VERSION}/${encodeURIComponent(key)}`;
  url.search = "";
  url.hash = "";
  return new Request(url.toString(), { method: "GET" });
}

function responseHeaders({ cacheState, cacheScope = "LOCAL", savedAt, browserSeconds = DEFAULT_BROWSER_SECONDS }) {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": browserSeconds > 0
      ? `public, max-age=${browserSeconds}, stale-while-revalidate=86400`
      : "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Stapleford-Cache": cacheState,
    "X-Stapleford-Cache-Scope": cacheScope,
    "X-Stapleford-Saved-At": String(savedAt),
  };
}

function clientResponse(response, cacheState, browserSeconds, cacheScope) {
  const headers = new Headers(response.headers);
  const savedAt = Number(headers.get("X-Stapleford-Saved-At")) || Date.now();
  const clientHeaders = responseHeaders({ cacheState, cacheScope, savedAt, browserSeconds });
  for (const [name, value] of Object.entries(clientHeaders)) headers.set(name, value);
  return new Response(response.body, { status: response.status, headers });
}

function responseFromSnapshot(snapshot, cacheState, browserSeconds, cacheScope) {
  return new Response(snapshot.body, {
    status: snapshot.status || 200,
    headers: responseHeaders({
      cacheState,
      cacheScope,
      savedAt: snapshot.savedAt,
      browserSeconds,
    }),
  });
}

function edgeStoredResponse(snapshot, cacheScope) {
  const headers = responseHeaders({
    cacheState: "EDGE",
    cacheScope,
    savedAt: snapshot.savedAt,
    browserSeconds: EDGE_RETENTION_SECONDS,
  });
  headers["Cache-Control"] = `public, max-age=${EDGE_RETENTION_SECONDS}`;
  headers["X-Stapleford-Edge-Cached-At"] = String(Date.now());
  return new Response(snapshot.body, { status: snapshot.status || 200, headers });
}

function isFresh(savedAt, freshSeconds) {
  return Number(savedAt) > 0 && Date.now() - Number(savedAt) < freshSeconds * 1000;
}

async function readSharedSnapshot(binding, key) {
  if (!binding) return null;
  try {
    const raw = await binding.get(sharedKey(key));
    if (!raw) return null;
    const snapshot = JSON.parse(raw);
    return snapshot && typeof snapshot.body === "string" && Number(snapshot.savedAt)
      ? snapshot
      : null;
  } catch (error) {
    console.error(`Shared data cache read failed for ${key}: ${errorMessage(error)}`);
    return null;
  }
}

async function writeSharedSnapshot(binding, key, snapshot) {
  if (!binding) return;
  await binding.put(sharedKey(key), JSON.stringify(snapshot));
}

function runOnce(key, task) {
  if (inFlightRefreshes.has(key)) return inFlightRefreshes.get(key);
  const promise = Promise.resolve()
    .then(task)
    .finally(() => inFlightRefreshes.delete(key));
  inFlightRefreshes.set(key, promise);
  return promise;
}

async function produceSnapshot(producer) {
  const response = await producer();
  if (!(response instanceof Response)) throw new Error("Data producer did not return a Response");
  if (!response.ok) {
    const error = new Error(`Data producer returned ${response.status}`);
    error.response = response;
    throw error;
  }
  return {
    savedAt: Date.now(),
    status: response.status,
    body: await response.text(),
  };
}

async function storeSnapshot(cache, edgeKey, binding, key, snapshot) {
  const writes = [cache.put(edgeKey, edgeStoredResponse(snapshot, binding ? "GLOBAL" : "LOCAL"))];
  if (binding) writes.push(writeSharedSnapshot(binding, key, snapshot));
  await Promise.all(writes);
  return snapshot;
}

async function refreshSnapshot(context, options) {
  const { cache, edgeKey, binding, key, producer } = options;
  return runOnce(key, async () => {
    const snapshot = await produceSnapshot(producer);
    return storeSnapshot(cache, edgeKey, binding, key, snapshot);
  });
}

async function mayRefreshInBackground(context, options) {
  const { binding, key } = options;

  if (binding) {
    try {
      const refreshing = await binding.get(lockKey(key));
      if (refreshing) return;
      await binding.put(lockKey(key), String(Date.now()), { expirationTtl: 60 });
    } catch (error) {
      console.error(`Shared data cache lock failed for ${key}: ${errorMessage(error)}`);
    }
  }

  const refresh = refreshSnapshot(context, options).catch((error) => {
    console.error(`Background data refresh failed for ${key}: ${errorMessage(error)}`);
  });
  if (typeof context.waitUntil === "function") context.waitUntil(refresh);
  else void refresh;
}

function validRefreshRequest(context) {
  const expected = String(context.env?.CACHE_REFRESH_TOKEN || "");
  const supplied = String(context.request.headers.get("X-Stapleford-Refresh-Token") || "");
  return Boolean(expected && supplied && expected === supplied);
}

export async function withDataCache(context, {
  key,
  producer,
  freshSeconds = DEFAULT_FRESH_SECONDS,
  browserSeconds = DEFAULT_BROWSER_SECONDS,
  blockingRefreshWhenStale = false,
}) {
  const cache = caches.default;
  const edgeKey = edgeRequest(context.request.url, key);
  const binding = sharedBinding(context.env);
  const edgeFreshSeconds = binding ? Math.min(freshSeconds, 60) : freshSeconds;
  const cacheScope = binding ? "GLOBAL" : "LOCAL";
  const forceRefresh = validRefreshRequest(context);
  let staleResponse = null;

  if (!forceRefresh) {
    const edge = await cache.match(edgeKey);
    if (edge) {
      const savedAt = Number(edge.headers.get("X-Stapleford-Saved-At"));
      const edgeCachedAt = Number(edge.headers.get("X-Stapleford-Edge-Cached-At")) || savedAt;
      if (isFresh(edgeCachedAt, edgeFreshSeconds) && isFresh(savedAt, freshSeconds)) {
        return clientResponse(edge, "EDGE", browserSeconds, cacheScope);
      }
      staleResponse = clientResponse(edge.clone(), "STALE", browserSeconds, cacheScope);
    }

    const shared = await readSharedSnapshot(binding, key);
    if (shared && (!staleResponse || Number(shared.savedAt) > Number(staleResponse.headers.get("X-Stapleford-Saved-At")))) {
      staleResponse = responseFromSnapshot(shared, "STALE", browserSeconds, cacheScope);
    }
    if (shared && isFresh(shared.savedAt, freshSeconds)) {
      const edgeWrite = cache.put(edgeKey, edgeStoredResponse(shared, cacheScope));
      if (typeof context.waitUntil === "function") context.waitUntil(edgeWrite);
      else void edgeWrite;
      return responseFromSnapshot(shared, "SHARED", browserSeconds, cacheScope);
    }
  }

  const refreshOptions = { cache, edgeKey, binding, key, producer };

  if (staleResponse && !forceRefresh) {
    if (blockingRefreshWhenStale) {
      try {
        const snapshot = await refreshSnapshot(context, refreshOptions);
        return responseFromSnapshot(snapshot, "REFRESHED", browserSeconds, cacheScope);
      } catch (error) {
        console.error(`Blocking data refresh failed for ${key}: ${errorMessage(error)}`);
        return staleResponse;
      }
    }
    await mayRefreshInBackground(context, refreshOptions);
    return staleResponse;
  }

  try {
    const snapshot = await refreshSnapshot(context, refreshOptions);
    return responseFromSnapshot(snapshot, forceRefresh ? "REFRESHED" : "MISS", browserSeconds, cacheScope);
  } catch (error) {
    if (staleResponse) return staleResponse;
    if (error.response) {
      const headers = new Headers(error.response.headers);
      headers.set("X-Stapleford-Cache-Scope", cacheScope);
      return new Response(error.response.body, {
        status: error.response.status,
        statusText: error.response.statusText,
        headers,
      });
    }
    throw error;
  }
}

export async function purgeEdgeDataCache(requestUrl, key) {
  if (!requestUrl || !key) return false;
  return caches.default.delete(edgeRequest(requestUrl, key));
}

export async function refreshDataCache(context, {
  key,
  producer,
  browserSeconds = DEFAULT_BROWSER_SECONDS,
}) {
  const cache = caches.default;
  const edgeKey = edgeRequest(context.request.url, key);
  const binding = sharedBinding(context.env);
  const cacheScope = binding ? "GLOBAL" : "LOCAL";
  const previous = await readSharedSnapshot(binding, key);

  try {
    const snapshot = await refreshSnapshot(context, { cache, edgeKey, binding, key, producer });
    return responseFromSnapshot(snapshot, "REFRESHED", browserSeconds, cacheScope);
  } catch (error) {
    if (previous) return responseFromSnapshot(previous, "STALE", browserSeconds, cacheScope);
    if (error.response) return error.response;
    throw error;
  }
}

export async function updateCachedWatchStatus(env, recordId, status) {
  const binding = sharedBinding(env);
  if (!binding || !recordId) return false;
  const key = "watches";
  const snapshot = await readSharedSnapshot(binding, key);
  if (!snapshot) return false;

  const payload = JSON.parse(snapshot.body);
  const collections = [payload.watches, payload.items, payload.data].filter(Array.isArray);
  let updated = false;
  for (const watches of collections) {
    for (const watch of watches) {
      if (watch?.airtableId === recordId || watch?.id === recordId) {
        watch.status = status;
        watch.sold = String(status).toLowerCase().includes("sold");
        watch.reserved = String(status).toLowerCase().includes("reserved");
        updated = true;
      }
    }
  }
  if (!updated) return false;

  snapshot.savedAt = Date.now();
  snapshot.body = JSON.stringify(payload);
  await writeSharedSnapshot(binding, key, snapshot);
  return true;
}
