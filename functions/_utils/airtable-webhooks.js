const WEBHOOK_VERSION = "v3";
const REFRESH_BEFORE_MS = 2 * 24 * 60 * 60 * 1000;
const RETRY_AFTER_MS = 5 * 60 * 1000;
const SETUP_LOCK_SECONDS = 60;
const NOTIFICATION_DEBOUNCE_MS = 5000;
const MAX_PAYLOAD_PAGES = 20;

export const AIRTABLE_CATALOGS = [
  {
    key: "watches",
    tableIdEnv: "AIRTABLE_WATCHES_TABLE_ID",
    defaultTableId: "tblr4O0WXZeRBunyh",
  },
  {
    key: "journal",
    tableIdEnv: "AIRTABLE_JOURNAL_TABLE_ID",
    defaultTableId: "tblOndjvATJ3rakxV",
  },
];

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function cacheBinding(env) {
  const binding = env?.CATALOG_CACHE;
  return binding && typeof binding.get === "function" && typeof binding.put === "function"
    ? binding
    : null;
}

export function webhookStateKey(key) {
  return `stapleford:webhook:${WEBHOOK_VERSION}:${key}`;
}

function webhookLockKey(key) {
  return `${webhookStateKey(key)}:setup`;
}

function webhookDebounceKey(key) {
  return `${webhookStateKey(key)}:notification`;
}

function token(env) {
  return env?.AIRTABLE_TOKEN || env?.AIRTABLE_API_KEY || "";
}

function notificationUrl(env) {
  return env?.AIRTABLE_WEBHOOK_URL || "https://staplefordwatches.co.uk/api/airtable-webhook";
}

function isProduction(env) {
  return !env?.CF_PAGES_BRANCH || env.CF_PAGES_BRANCH === "main";
}

function tableId(env, catalog) {
  return env?.[catalog.tableIdEnv] || catalog.defaultTableId;
}

async function readState(binding, key) {
  try {
    const raw = await binding.get(webhookStateKey(key));
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.error(`Airtable webhook state read failed for ${key}: ${errorMessage(error)}`);
    return null;
  }
}

async function writeState(binding, key, state) {
  await binding.put(webhookStateKey(key), JSON.stringify(state));
  return state;
}

async function airtableRequest(env, path, options = {}) {
  const response = await fetch(`https://api.airtable.com/v0/${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token(env)}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: { message: text.slice(0, 200) } };
  }
  if (!response.ok) {
    const detail = data?.error?.message || data?.error?.type || `HTTP ${response.status}`;
    const error = new Error(`Airtable webhook request failed (${response.status}): ${detail}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function refreshExistingWebhook(env, state) {
  const baseId = env.AIRTABLE_BASE_ID;
  const data = await airtableRequest(
    env,
    `bases/${encodeURIComponent(baseId)}/webhooks/${encodeURIComponent(state.id)}/refresh`,
    { method: "POST" }
  );
  return {
    ...state,
    expirationTime: data.expirationTime || state.expirationTime,
    checkedAt: Date.now(),
    lastError: "",
    nextAttemptAt: 0,
  };
}

async function createWebhook(env, catalog) {
  const baseId = env.AIRTABLE_BASE_ID;
  const data = await airtableRequest(env, `bases/${encodeURIComponent(baseId)}/webhooks`, {
    method: "POST",
    body: JSON.stringify({
      notificationUrl: notificationUrl(env),
      specification: {
        options: {
          filters: {
            dataTypes: ["tableData"],
            recordChangeScope: tableId(env, catalog),
          },
        },
      },
    }),
  });
  if (!data.id || !data.macSecretBase64) {
    throw new Error("Airtable did not return the webhook verification details");
  }
  return {
    id: data.id,
    macSecretBase64: data.macSecretBase64,
    cursor: 1,
    expirationTime: data.expirationTime || "",
    tableId: tableId(env, catalog),
    notificationUrl: notificationUrl(env),
    checkedAt: Date.now(),
    lastError: "",
    nextAttemptAt: 0,
  };
}

export async function ensureAirtableWebhook(context, catalog) {
  const env = context.env || {};
  const binding = cacheBinding(env);
  if (!binding || !token(env) || !env.AIRTABLE_BASE_ID || !catalog || !isProduction(env)) {
    return null;
  }

  const now = Date.now();
  let state = await readState(binding, catalog.key);
  const expiration = Date.parse(state?.expirationTime || "") || 0;
  if (state?.id && state?.macSecretBase64 && expiration > now + REFRESH_BEFORE_MS) return state;
  if (Number(state?.nextAttemptAt) > now) return state;

  const lockKey = webhookLockKey(catalog.key);
  try {
    if (await binding.get(lockKey)) return state;
    await binding.put(lockKey, String(now), { expirationTtl: SETUP_LOCK_SECONDS });

    if (state?.id && state?.macSecretBase64) {
      try {
        state = await refreshExistingWebhook(env, state);
        return await writeState(binding, catalog.key, state);
      } catch (error) {
        if (![404, 422].includes(Number(error.status))) throw error;
      }
    }

    state = await createWebhook(env, catalog);
    return await writeState(binding, catalog.key, state);
  } catch (error) {
    const failedState = {
      ...(state || {}),
      checkedAt: now,
      lastError: errorMessage(error).slice(0, 240),
      nextAttemptAt: now + RETRY_AFTER_MS,
    };
    await writeState(binding, catalog.key, failedState).catch(() => {});
    console.error(`Airtable webhook setup failed for ${catalog.key}: ${failedState.lastError}`);
    return failedState;
  }
}

function base64Bytes(value) {
  const binary = atob(String(value || ""));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function hex(bytes) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (a.charCodeAt(index % Math.max(a.length, 1)) || 0)
      ^ (b.charCodeAt(index % Math.max(b.length, 1)) || 0);
  }
  return difference === 0;
}

export async function verifyAirtableNotification(body, header, macSecretBase64) {
  if (!body || !header || !macSecretBase64) return false;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      base64Bytes(macSecretBase64),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
    return constantTimeEqual(header, `hmac-sha256=${hex(signature)}`);
  } catch {
    return false;
  }
}

export async function findVerifiedCatalog(env, body, header) {
  const binding = cacheBinding(env);
  if (!binding) return null;

  let notification;
  try {
    notification = JSON.parse(body);
  } catch {
    return null;
  }
  if (notification?.base?.id !== env.AIRTABLE_BASE_ID || !notification?.webhook?.id) return null;

  for (const catalog of AIRTABLE_CATALOGS) {
    const state = await readState(binding, catalog.key);
    if (state?.id !== notification.webhook.id) continue;
    if (await verifyAirtableNotification(body, header, state.macSecretBase64)) {
      return { catalog, state, notification };
    }
  }
  return null;
}

export async function shouldRefreshForNotification(env, key) {
  const binding = cacheBinding(env);
  if (!binding) return true;
  const debounceKey = webhookDebounceKey(key);
  const now = Date.now();
  const previous = Number(await binding.get(debounceKey)) || 0;
  if (now - previous < NOTIFICATION_DEBOUNCE_MS) return false;
  await binding.put(debounceKey, String(now), { expirationTtl: 60 });
  return true;
}

export async function releaseNotificationRefresh(env, key) {
  const binding = cacheBinding(env);
  if (!binding) return;
  await binding.put(webhookDebounceKey(key), "0", { expirationTtl: 60 });
}

export async function drainWebhookPayloads(env, catalog, state) {
  const binding = cacheBinding(env);
  if (!binding || !catalog || !state?.id || !env?.AIRTABLE_BASE_ID) {
    throw new Error("Airtable webhook payload state is incomplete");
  }

  let cursor = Math.max(1, Number(state.cursor) || 1);
  let payloadCount = 0;
  let lastPayloadAt = state.lastPayloadAt || "";

  for (let page = 0; page < MAX_PAYLOAD_PAGES; page += 1) {
    const path = `bases/${encodeURIComponent(env.AIRTABLE_BASE_ID)}`
      + `/webhooks/${encodeURIComponent(state.id)}/payloads?cursor=${cursor}`;
    const data = await airtableRequest(env, path);
    const payloads = Array.isArray(data.payloads) ? data.payloads : [];
    payloadCount += payloads.length;
    if (payloads.length) lastPayloadAt = payloads[payloads.length - 1]?.timestamp || lastPayloadAt;

    if (!data.mightHaveMore) {
      cursor += payloads.length;
      const updated = {
        ...state,
        cursor,
        lastNotificationAt: Date.now(),
        lastPayloadAt,
        lastError: "",
      };
      await writeState(binding, catalog.key, updated);
      return { payloadCount, state: updated };
    }

    const nextCursor = Number(data.cursor);
    if (!Number.isFinite(nextCursor) || nextCursor <= cursor) {
      throw new Error("Airtable webhook returned an invalid payload cursor");
    }
    cursor = nextCursor;
  }

  throw new Error("Airtable webhook payload page limit exceeded");
}

export async function recordWebhookRefresh(env, key, { error = "" } = {}) {
  const binding = cacheBinding(env);
  if (!binding) return null;
  const state = await readState(binding, key);
  if (!state) return null;
  return writeState(binding, key, {
    ...state,
    lastRefreshAt: Date.now(),
    lastRefreshError: String(error || "").slice(0, 240),
  });
}

export async function webhookPublicStatus(env) {
  const binding = cacheBinding(env);
  if (!binding) return { configured: false, catalogs: [] };
  const catalogs = [];
  for (const catalog of AIRTABLE_CATALOGS) {
    const state = await readState(binding, catalog.key);
    catalogs.push({
      key: catalog.key,
      active: Boolean(state?.id && state?.macSecretBase64 && Date.parse(state.expirationTime || "") > Date.now()),
      expirationTime: state?.expirationTime || "",
      lastError: state?.lastError || "",
      lastNotificationAt: state?.lastNotificationAt || 0,
      lastPayloadAt: state?.lastPayloadAt || "",
      lastRefreshAt: state?.lastRefreshAt || 0,
      lastRefreshError: state?.lastRefreshError || "",
    });
  }
  return { configured: true, catalogs };
}
