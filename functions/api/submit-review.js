// functions/api/submit-review.js
//
// Cloudflare Pages Function — routes POST /api/submit-review to
// handleReviewSubmission, the same way functions/api/sell-watch.js
// wires up sell-watch-worker.js from functions/_utils/.

import { handleReviewSubmission, corsPreflightResponse } from "../_utils/submit-review-worker.js";

export async function onRequestPost(context) {
  return handleReviewSubmission(context.request, context.env);
}

export async function onRequestOptions(context) {
  return corsPreflightResponse(context.request);
}
