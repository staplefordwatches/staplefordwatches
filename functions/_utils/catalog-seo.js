export const SITE_ORIGIN = "https://staplefordwatches.co.uk";

export function cleanText(value) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

export function watchReference(watch) {
  const reference = cleanText(watch?.specs?.reference || watch?.reference || watch?.mpn);
  return /^(?:n\/?a|none|unknown|not\s+applicable|-+)$/i.test(reference) ? "" : reference;
}

function comparable(value) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function watchDisplayName(watch) {
  const base = cleanText(`${watch?.brand || ""} ${watch?.title || ""}`);
  const reference = watchReference(watch);
  if (!reference || comparable(base).includes(comparable(reference))) return base;
  return cleanText(`${base} ${reference}`);
}

export function watchSlug(watch) {
  const id = cleanText(watch?.listingId || watch?.id).toLowerCase();
  const name = watchDisplayName(watch)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "watch";
  return `${name}-${id}`;
}

export function watchUrl(watch, origin = SITE_ORIGIN) {
  return `${origin.replace(/\/+$/, "")}/watches/${encodeURIComponent(watchSlug(watch))}/`;
}

export function watchDescription(watch) {
  const explicit = cleanText(watch?.description || watch?.watchDescription || watch?.longDescription);
  if (explicit) return explicit;

  const specs = watch?.specs || {};
  const reference = watchReference(watch);
  const details = [
    specs.year ? `from ${cleanText(specs.year)}` : "",
    specs.caseSize ? `with a ${cleanText(specs.caseSize)} case` : "",
    specs.movement ? `and ${cleanText(specs.movement)} movement` : "",
  ].filter(Boolean).join(" ");
  const contents = specs.contents ? ` Includes ${cleanText(specs.contents).toLowerCase()}.` : "";
  return cleanText(`Pre-owned ${watch?.brand || ""} ${watch?.title || ""}${reference ? ` reference ${reference}` : ""} ${details}, listed by Stapleford Watches.${contents}`);
}

export function watchStatus(watch) {
  return cleanText(watch?.status).toLowerCase();
}

export function isAvailableWatch(watch) {
  return watchStatus(watch) === "available";
}

export function isPublishedWatch(watch) {
  return ["available", "sold", "reserved"].includes(watchStatus(watch))
    && Boolean(cleanText(watch?.brand) && cleanText(watch?.title) && cleanText(watch?.listingId || watch?.id));
}

export function safeImageUrl(value) {
  try {
    const url = new URL(cleanText(value));
    return url.protocol === "https:" ? url.href : "";
  } catch { return ""; }
}

export function merchantIssues(watch) {
  const issues = [];
  if (!isAvailableWatch(watch)) issues.push("not_available");
  if (!cleanText(watch?.brand)) issues.push("missing_brand");
  if (!cleanText(watch?.title)) issues.push("missing_title");
  if (!cleanText(watch?.listingId || watch?.id)) issues.push("missing_id");
  if (!numericPrice(watch?.price)) issues.push("missing_positive_price");
  if (![watch?.image, ...(Array.isArray(watch?.images) ? watch.images : [])].some(safeImageUrl)) issues.push("missing_https_image");
  // Preserve complete legacy listings while respecting an explicit editorial opt-out.
  const ready = cleanText(watch?.shoppingReady).toLowerCase();
  if (ready && !["yes", "true", "1", "ready", "checked"].includes(ready)) issues.push("shopping_not_ready");
  return issues;
}

export function validGtin(value) {
  const gtin = cleanText(value);
  if (!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(gtin)) return "";
  let sum = 0;
  for (let index = gtin.length - 2, weight = 3; index >= 0; index--, weight = 4 - weight) sum += Number(gtin[index]) * weight;
  return (10 - sum % 10) % 10 === Number(gtin.at(-1)) ? gtin : "";
}

export function brandSlug(value) {
  return cleanText(value).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function catalogBrands(watches = []) {
  return [...new Map(watches.filter(isPublishedWatch).map(watch => [brandSlug(watch.brand), cleanText(watch.brand)])).entries()]
    .filter(([slug]) => slug).map(([slug, name]) => ({ slug, name, url: `${SITE_ORIGIN}/brands/${slug}/` }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function numericPrice(value) {
  const text = cleanText(value).replace(/^£\s*/, "").replace(/\s*GBP$/i, "");
  if (!/^\d+(?:,\d{3})*(?:\.\d{1,2})?$/.test(text)) return 0;
  const number = Number(text.replace(/,/g, ""));
  return Number.isFinite(number) && number > 0 ? number : 0;
}

export function truncateAtWord(value, limit) {
  const text = cleanText(value);
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1).replace(/\s+\S*$/, "").trim()}…`;
}

export function xmlEscape(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  })[character]);
}

export function dateOnly(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

