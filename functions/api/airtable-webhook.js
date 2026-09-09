import { refreshDataCache } from "../_utils/data-cache.js";
import {
  findVerifiedCatalog,
  shouldRefreshForNotification,
  webhookPublicStatus,
} from "../_utils/airtable-webhooks.js";
import { loadJournal } from "./journal.js";
import { loadWatches } from "./watches.js";

const MAX_NOTIFICATION_BYTES = 16 * 1024;

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
  const refreshContext = { ...context, request };
  const isWatches = key === "watches";
  const response = await refreshDataCache(refreshContext, {
    key,
    browserSeconds: isWatches ? 60 : 300,
    producer: () => isWatches ? loadWatches(refreshContext) : loadJournal(refreshContext),
  });
  if (!response.ok) throw new Error(`${key} refresh returned ${response.status}`);
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
    const refresh = rebuildCatalog(context, verified.catalog.key).catch((error) => {
      console.error(`Airtable webhook catalogue refresh failed: ${error.message}`);
    });
    if (typeof context.waitUntil === "function") context.waitUntil(refresh);
    else await refresh;
  }

  return json({ ok: true, accepted: shouldRefresh }, 202);
}
