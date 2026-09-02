const ALLOWED_ORIGIN = "https://staplefordwatches.co.uk";

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  const allowOrigin = origin === ALLOWED_ORIGIN || origin.endsWith(".staplefordwatches.co.uk") ? origin : ALLOWED_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin"
  };
}

export function corsPreflightResponse(request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

function jsonResponse(body, status, request) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(request) }
  });
}

const MAX_NAME_LENGTH = 100;
const MAX_REVIEW_LENGTH = 2000;
const MAX_WATCH_LENGTH = 150;
const MAX_PHOTOS = 4;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ACCEPTED_PHOTO_TYPE = /^image\/(jpe?g|png|webp|heic|heif|avif)$/i;

function clean(value, maxLength) {
  const text = String(value ?? "").trim();
  return maxLength ? text.slice(0, maxLength) : text;
}

// Uploads one photo straight to Cloudinary using an unsigned upload preset
// (no API secret needed here) and returns its public URL, or null if the
// upload failed — a failed photo never blocks the rest of the review.
async function uploadPhotoToCloudinary(file, env) {
  const cloudName = env.CLOUDINARY_CLOUD_NAME;
  const uploadPreset = env.CLOUDINARY_REVIEWS_UPLOAD_PRESET || env.CLOUDINARY_UPLOAD_PRESET;
  if (!cloudName || !uploadPreset) return null;

  const uploadForm = new FormData();
  uploadForm.append("file", file, file.name);
  uploadForm.append("upload_preset", uploadPreset);
  uploadForm.append("folder", "reviews");

  try {
    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
      method: "POST",
      body: uploadForm
    });
    const data = await response.json();
    if (!response.ok || !data.secure_url) return null;
    return data.secure_url;
  } catch (_error) {
    return null;
  }
}

export async function handleReviewSubmission(request, env) {
  try {
    const token = env.AIRTABLE_TOKEN || env.AIRTABLE_API_KEY;
    const baseId = env.AIRTABLE_BASE_ID;
    const table = env.AIRTABLE_REVIEWS_TABLE_NAME || "Reviews";

    if (!token || !baseId) {
      return jsonResponse({ ok: false, error: "Reviews are not accepting submissions right now." }, 500, request);
    }

    let form;
    try {
      form = await request.formData();
    } catch (_error) {
      return jsonResponse({ ok: false, error: "Invalid submission." }, 400, request);
    }

    const name = clean(form.get("name"), MAX_NAME_LENGTH);
    const email = clean(form.get("email"), MAX_NAME_LENGTH);
    const watch = clean(form.get("watch"), MAX_WATCH_LENGTH);
    const review = clean(form.get("review"), MAX_REVIEW_LENGTH);
    const rating = Math.round(Number(form.get("rating")));
    const source = clean(form.get("source"), 300);

    if (!name) return jsonResponse({ ok: false, error: "Please enter your name." }, 400, request);
    if (!email || !EMAIL_PATTERN.test(email)) {
      return jsonResponse({ ok: false, error: "Please enter a valid email address." }, 400, request);
    }
    if (!review) return jsonResponse({ ok: false, error: "Please enter your review." }, 400, request);
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      return jsonResponse({ ok: false, error: "Please select a rating between 1 and 5." }, 400, request);
    }

    const incomingPhotos = form
      .getAll("photos")
      .filter((entry) => entry && typeof entry === "object" && "arrayBuffer" in entry)
      .filter((file) => file.size > 0 && file.size <= MAX_PHOTO_BYTES && ACCEPTED_PHOTO_TYPE.test(file.type || ""))
      .slice(0, MAX_PHOTOS);

    const uploadedUrls = (
      await Promise.all(incomingPhotos.map((file) => uploadPhotoToCloudinary(file, env)))
    ).filter(Boolean);

    // Status is always forced to Pending here — the public submission
    // endpoint must never be able to mark its own review Approved.
    // Flip it to Approved manually inside Airtable to publish it.
    const fields = {
      Name: name,
      Email: email,
      Watch: watch,
      Review: review,
      Rating: rating,
      Status: "Pending",
      Source: source
    };
    if (uploadedUrls.length) {
      fields.Photos = uploadedUrls.map((url) => ({ url }));
    }

    const airtableResponse = await fetch(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ fields })
    });

    const airtableText = await airtableResponse.text();

    if (!airtableResponse.ok) {
      return jsonResponse(
        { ok: false, error: "Could not save your review. Please try again.", detail: airtableText },
        airtableResponse.status,
        request
      );
    }

    const photoWarningCount = incomingPhotos.length - uploadedUrls.length;

    return jsonResponse({ ok: true, photoWarningCount }, 200, request);
  } catch (error) {
    return jsonResponse(
      { ok: false, error: "Something went wrong. Please try again.", detail: error.message },
      500,
      request
    );
  }
}
