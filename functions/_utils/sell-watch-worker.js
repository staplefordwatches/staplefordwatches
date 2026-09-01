// sell-watch-worker.js
//
// Handles submissions from the "Sell Your Watch" form on staplefordwatches.co.uk.
// Writes each submission to its OWN Airtable table (kept separate from your
// "Watches" listings table), attaches any uploaded photos directly to the
// record, and lets a native Airtable Automation handle the email alert.
//
// This file mirrors the style of airtable-watch.js so it can sit alongside it
// in the same Worker project. Wire it into your existing fetch handler, e.g.:
//
//   import { handleSellSubmission } from "./sell-watch-worker.js";
//
//   export default {
//     async fetch(request, env, ctx) {
//       const url = new URL(request.url);
//       if (url.pathname === "/api/sell-watch" && request.method === "POST") {
//         return handleSellSubmission(request, env);
//       }
//       if (url.pathname === "/api/sell-watch" && request.method === "OPTIONS") {
//         return corsPreflightResponse();
//       }
//       // ...your existing routes (checkout, airtable-watch lookups, etc.)
//     },
//   };
//
// ---------------------------------------------------------------------------
// Required environment variables / secrets (add via `wrangler secret put` or
// the Cloudflare dashboard):
//
//   AIRTABLE_TOKEN            Personal access token / API key with
//                              data.records:write and data.records:read scope
//                              on the base below.
//   AIRTABLE_BASE_ID          Same base as your Watches table (or a
//                              different base — either works).
//   AIRTABLE_SELL_TABLE_NAME  Name of the NEW table for submissions, e.g.
//                              "Sell Submissions". Defaults to that if unset.
//
// ---------------------------------------------------------------------------
// Airtable setup (one-time):
//
// 1. In your existing base, create a new table called "Sell Submissions"
//    (or whatever you set AIRTABLE_SELL_TABLE_NAME to). This is separate
//    from "Watches" — nothing here touches your listings.
//
//    Suggested fields (names must match exactly, or update FIELD_MAP below):
//      Brand            - Single line text
//      Model            - Single line text
//      Reference        - Single line text
//      Year             - Single line text
//      Condition        - Single line text (or Single select)
//      Box & Papers     - Single line text (or Single select)
//      Asking Price     - Single line text
//      Details          - Long text
//      Name             - Single line text
//      Email            - Email
//      Phone            - Phone number
//      Photos           - Attachment
//      Status           - Single select (e.g. New / Reviewing / Offer Sent / Closed) — default "New"
//      Submitted At     - Date (include time)
//      Source URL       - URL
//
// 2. Create an Airtable Automation on that table:
//      Trigger: "When a record is created" (watching Sell Submissions)
//      Action:  "Send an email" -> your inbox, with a template referencing
//               the new record's fields.
//    This needs no extra email service — Airtable sends it for you.
//
// ---------------------------------------------------------------------------

const DEFAULT_SELL_TABLE_NAME = "Sell Submissions";
const MAX_PHOTOS = 8;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // Airtable's direct-upload cap per file

// Map form field name -> Airtable column name. Edit the right-hand side if
// your Airtable columns are named differently.
const FIELD_MAP = {
  brand: "Brand",
  model: "Model",
  reference: "Reference",
  year: "Year",
  condition: "Condition",
  boxPapers: "Box & Papers",
  askingPrice: "Asking Price",
  details: "Details",
  name: "Name",
  email: "Email",
  phone: "Phone",
  source: "Source URL",
};

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export function corsPreflightResponse(request) {
  const origin = request?.headers?.get("Origin");
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

function jsonResponse(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(origin),
    },
  });
}

function clean(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

async function fileToBase64(file) {
  const buffer = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export async function handleSellSubmission(request, env) {
  const origin = request.headers.get("Origin");

  const token = env.AIRTABLE_TOKEN || env.AIRTABLE_API_KEY;
  const baseId = env.AIRTABLE_BASE_ID;
  const table = env.AIRTABLE_SELL_TABLE_NAME || DEFAULT_SELL_TABLE_NAME;

  if (!token || !baseId) {
    return jsonResponse({ ok: false, error: "Server is not configured (missing Airtable settings)." }, 500, origin);
  }

  let form;
  try {
    form = await request.formData();
  } catch (_error) {
    return jsonResponse({ ok: false, error: "Could not read submission." }, 400, origin);
  }

  const name = clean(form.get("name"));
  const email = clean(form.get("email"));
  const brand = clean(form.get("brand"));
  const model = clean(form.get("model"));

  if (!name || !email || !brand || !model) {
    return jsonResponse({ ok: false, error: "Please fill in the required fields." }, 400, origin);
  }

  // Build the Airtable record fields from the form, via FIELD_MAP.
  const fields = {};
  for (const [formKey, airtableColumn] of Object.entries(FIELD_MAP)) {
    const value = clean(form.get(formKey));
    if (value) fields[airtableColumn] = value;
  }
  fields["Status"] = "New";
  fields["Submitted At"] = new Date().toISOString();

  // 1. Create the record (fields only — photos are attached after, since
  //    Airtable's direct-upload endpoint needs a record ID to attach to).
  const createUrl = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`;
  const createResponse = await fetch(createUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields }),
  });

  const createText = await createResponse.text();
  if (!createResponse.ok) {
    console.error("Airtable create record failed:", createResponse.status, createText);
    return jsonResponse({ ok: false, error: `Could not save submission: ${createText}` }, 500, origin);
  }

  const record = JSON.parse(createText);
  const recordId = record.id;

  // 2. Attach photos directly to the record, one at a time, via Airtable's
  //    direct attachment upload endpoint. Failures here are logged but don't
  //    fail the whole submission — the text record has already been saved.
  const photos = form.getAll("photos").filter((f) => f && typeof f === "object" && "arrayBuffer" in f);
  const uploadErrors = [];

  for (const file of photos.slice(0, MAX_PHOTOS)) {
    if (file.size > MAX_PHOTO_BYTES) {
      uploadErrors.push(`${file.name}: too large (max 5MB)`);
      continue;
    }
    try {
      const base64 = await fileToBase64(file);
      const uploadUrl = `https://content.airtable.com/v0/${baseId}/${recordId}/${encodeURIComponent("Photos")}/uploadAttachment`;
      const uploadResponse = await fetch(uploadUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contentType: file.type || "image/jpeg",
          filename: file.name || "photo.jpg",
          file: base64,
        }),
      });
      if (!uploadResponse.ok) {
        const uploadText = await uploadResponse.text();
        console.error("Airtable attachment upload failed:", file.name, uploadResponse.status, uploadText);
        uploadErrors.push(`${file.name}: ${uploadText}`);
      }
    } catch (error) {
      console.error("Attachment upload threw:", file.name, error);
      uploadErrors.push(`${file.name}: ${error.message || "upload failed"}`);
    }
  }

  return jsonResponse(
    {
      ok: true,
      recordId,
      photoWarnings: uploadErrors.length ? uploadErrors : undefined,
    },
    200,
    origin
  );
}
