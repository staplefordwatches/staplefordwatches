import { refreshDataCache } from "../_utils/data-cache.js";
import {
  drainWebhookPayloads,
  findVerifiedCatalog,
  recordWebhookRefresh,
  releaseNotificationRefresh,
  shouldRefreshForNotification,
  webhookPublicStatus,
} from "../_utils/airtable-webhooks.js";
import { loadJournal } from "./journal.js";
import { loadWatches } from "./watches.js";

const MAX_NOTIFICATION_BYTES = 16 * 1024;
const catalogRefreshes = new Map();

async function queueCatalogRefresh(key, refresh) {
  const previous = catalogRefreshes.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(refresh);
  catalogRefreshes.set(key, next);
  try {
    return await next;
  } finally {
    if (catalogRefreshes.get(key) === next) catalogRefreshes.delete(key);
  }
}

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function rebuildCatalog(context, key) {
  const request = new Request(`https://staplefordwatches.co.uk/api/${key}`);
  const refreshContext = {
    env: context.env || {},
    request,
    data: context.data,
    params: context.params,
  };
  const isWatches = key === "watches";
  const dataCacheKey = isWatches ? key : "journal-v2";
  const response = await refreshDataCache(refreshContext, {
    key: dataCacheKey,
    browserSeconds: isWatches ? 0 : 60,
    producer: () => isWatches ? loadWatches(refreshContext) : loadJournal(refreshContext),
  });
  if (!response.ok || response.headers.get("X-Stapleford-Cache") === "STALE") {
    throw new Error(`${key} refresh did not produce a current catalogue (${response.status})`);
  }
}

export async function onRequestGet(context) {
  return json(await webhookPublicStatus(context.env || {}));
}

export async function onRequestPost(context) {
  const declaredLength = Number(context.request.headers.get("Content-Length")) || 0;
  if (declaredLength > MAX_NOTIFICATION_BYTES) return json({ ok: false }, 413);

  const body = await context.request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_NOTIFICATION_BYTES) {
    return json({ ok: false }, 413);
  }

  const verified = await findVerifiedCatalog(
    context.env || {},
    body,
    context.request.headers.get("X-Airtable-Content-MAC") || ""
  );
  if (!verified) return json({ ok: false }, 401);

  const shouldRefresh = await shouldRefreshForNotification(context.env || {}, verified.catalog.key);
  if (shouldRefresh) {
    try {
      // An edit arriving during a refresh needs a subsequent read, rather than
      // sharing the in-flight snapshot that may contain only the first letters.
      await queueCatalogRefresh(verified.catalog.key, async () => {
        const latest = await findVerifiedCatalog(
          context.env || {}, body, context.request.headers.get("X-Airtable-Content-MAC") || ""
        );
        if (!latest) throw new Error("Webhook configuration changed during refresh");
        await drainWebhookPayloads(context.env || {}, latest.catalog, latest.state);
        await rebuildCatalog(context, latest.catalog.key);
        await recordWebhookRefresh(context.env || {}, latest.catalog.key);
      });
    } catch (error) {
      console.error(`Airtable webhook catalogue refresh failed: ${error.message}`);
      await releaseNotificationRefresh(context.env || {}, verified.catalog.key).catch(() => {});
      await recordWebhookRefresh(context.env || {}, verified.catalog.key, { error: error.message }).catch(() => {});
      return json({ ok: false, retry: true }, 503);
    }
  }

  return json({ ok: true, accepted: shouldRefresh });
}
