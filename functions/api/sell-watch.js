// functions/api/sell-watch.js
//
// Cloudflare Pages Function — automatically routes POST /api/sell-watch
// to handleSellSubmission, the same way your other functions/api/*.js
// files presumably wire up airtable-watch.js from functions/_utils/.

import { handleSellSubmission, corsPreflightResponse } from "../_utils/sell-watch-worker.js";

export async function onRequestPost(context) {
  return handleSellSubmission(context.request, context.env);
}

export async function onRequestOptions(context) {
  return corsPreflightResponse(context.request);
}
