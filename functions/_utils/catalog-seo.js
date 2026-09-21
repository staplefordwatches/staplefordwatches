export const SITE_ORIGIN = "https://staplefordwatches.co.uk";

export function cleanText(value) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

export function watchReference(watch) {
  return cleanText(watch?.specs?.reference || watch?.reference || watch?.mpn);
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
  const status = watchStatus(watch);
  return status === "available" || (!status.includes("sold") && !status.includes("reserved"));
}

export function numericPrice(value) {
  const number = Number(String(value ?? "").replace(/[^0-9.]/g, ""));
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
