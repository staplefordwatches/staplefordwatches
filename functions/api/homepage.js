import { withDataCache } from "../_utils/data-cache.js";

export const DEFAULT_HOMEPAGE = Object.freeze({
  imageUrl: "/assets/homepage-watch.jpg",
  mobileImageUrl: "",
  imageAlt: "Jaeger-LeCoultre perpetual calendar on a grey leather strap, worn against navy knitwear.",
  desktopFocus: "50% 38%",
  mobileFocus: "50% 50%",
});

function imageUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
  } catch { return ""; }
}

function focus(value, fallback) {
  const text = String(value || "").trim();
  const parts = text.match(/^(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%$/);
  return parts && Number(parts[1]) <= 100 && Number(parts[2]) <= 100 ? text : fallback;
}

export function homepageSettings(fields = {}) {
  return {
    imageUrl: imageUrl(fields["Image URL"]) || DEFAULT_HOMEPAGE.imageUrl,
    mobileImageUrl: imageUrl(fields["Mobile Image URL"]),
    imageAlt: String(fields["Image Alt"] || DEFAULT_HOMEPAGE.imageAlt).trim().slice(0, 500),
    desktopFocus: focus(fields["Desktop Focus"], DEFAULT_HOMEPAGE.desktopFocus),
    mobileFocus: focus(fields["Mobile Focus"], DEFAULT_HOMEPAGE.mobileFocus),
  };
}

export async function loadHomepage(context) {
  const env = context.env || {};
  const token = env.AIRTABLE_TOKEN || env.AIRTABLE_API_KEY;
  if (!token || !env.AIRTABLE_BASE_ID) return Response.json({ ok: true, homepage: DEFAULT_HOMEPAGE });
  try {
    const table = env.AIRTABLE_HOMEPAGE_TABLE_NAME || "Homepage";
    const url = new URL(`https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(table)}`);
    url.searchParams.set("filterByFormula", '{Name}="Homepage"');
    url.searchParams.set("maxRecords", "1");
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`Homepage settings returned ${response.status}`);
    const data = await response.json();
    return Response.json({ ok: true, homepage: homepageSettings(data.records?.[0]?.fields) });
  } catch (error) {
    // Let the shared cache retain the last good settings during Airtable outages.
    console.error("Could not refresh homepage settings:", error.message);
    return Response.json({ ok: false }, { status: 503 });
  }
}

export async function onRequest(context) {
  return withDataCache(context, {
    key: "homepage-v1", freshSeconds: 60, browserSeconds: 0,
    blockingRefreshWhenStale: true, producer: () => loadHomepage(context),
  });
}
