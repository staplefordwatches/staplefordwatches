import { getCatalog } from "./watches.js";
import {
  SITE_ORIGIN,
  cleanText,
  merchantIssues,
  numericPrice,
  safeImageUrl,
  validGtin,
  truncateAtWord,
  watchDescription,
  watchDisplayName,
  watchReference,
  watchUrl,
  xmlEscape,
} from "../_utils/catalog-seo.js";

const GOOGLE_WATCH_CATEGORY = "Apparel & Accessories > Jewelry > Watches";
const EUROPE_COUNTRIES = [
  "AT", "BE", "BG", "CH", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR",
  "GR", "HR", "HU", "IE", "IS", "IT", "LI", "LT", "LU", "LV", "MT", "NL",
  "NO", "PL", "PT", "RO", "SE", "SI", "SK",
];
const GLOBAL_COUNTRIES = ["AE", "AU", "CA", "HK", "JP", "NZ", "SG", "US"];

function shippingXml(country, service, price) {
  return `<g:shipping>
      <g:country>${country}</g:country>
      <g:service>${service}</g:service>
      <g:price>${price.toFixed(2)} GBP</g:price>
    </g:shipping>`;
}

function meaningfulIdentifier(value) {
  const identifier = cleanText(value);
  return /^(?:n\/?a|none|unknown|not\s+applicable|-+)$/i.test(identifier) ? "" : identifier;
}

function imageAssetKey(value) {
  const image = cleanText(value);
  try {
    const url = new URL(image);
    url.hash = "";
    url.search = "";
    let path = url.pathname;

    // Cloudinary transformations and version segments can give the same asset
    // several different URLs. Use the underlying watches asset path instead.
    if (url.hostname.endsWith("cloudinary.com")) {
      const watchesIndex = path.indexOf("/watches/");
      if (watchesIndex >= 0) path = path.slice(watchesIndex + 1);
    }

    return `${url.hostname.toLowerCase()}/${path.replace(/\.[a-z0-9]+$/i, "")}`;
  } catch {
    return image;
  }
}

function uniqueProductImages(watch) {
  const seen = new Set();
  return [watch.image, ...(Array.isArray(watch.images) ? watch.images : [])]
    .map(safeImageUrl).filter(Boolean)
    .filter((image) => {
      const key = imageAssetKey(image);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function itemXml(watch, countries) {
  const price = numericPrice(watch.price);
  const images = uniqueProductImages(watch);
  const gtin = validGtin(watch.gtin);
  const mpn = meaningfulIdentifier(cleanText(watch.mpn) || watchReference(watch));
  const merchantWatch = {
    ...watch,
    mpn,
    reference: mpn,
    specs: { ...(watch.specs || {}), reference: mpn },
  };
  const productType = cleanText(watch.productType) || "Luxury Watches";
  const googleCategory = cleanText(watch.googleCategory) || GOOGLE_WATCH_CATEGORY;
  const color = cleanText(watch.color);
  const rawAgeGroup = cleanText(watch.ageGroup).toLowerCase();
  const rawGender = cleanText(watch.gender).toLowerCase();
  const ageGroup = ["newborn", "infant", "toddler", "kids", "adult"].includes(rawAgeGroup) ? rawAgeGroup : "";
  const gender = ["male", "female", "unisex"].includes(rawGender) ? rawGender : "";
  const identifiers = [
    gtin ? `<g:gtin>${xmlEscape(gtin)}</g:gtin>` : "",
    mpn ? `<g:mpn>${xmlEscape(mpn)}</g:mpn>` : "",
  ].filter(Boolean).join("");
  const additionalImages = images.slice(1, 11)
    .map((image) => `<g:additional_image_link>${xmlEscape(image)}</g:additional_image_link>`)
    .join("");
  const shipping = [
    ...countries.map((country) => shippingXml(country,
      country === "GB" ? "Free tracked and insured" : EUROPE_COUNTRIES.includes(country) ? "Europe tracked and insured" : "International tracked and insured",
      country === "GB" ? 0 : EUROPE_COUNTRIES.includes(country) ? 50 : 80)),
  ].join("\n    ");

  return `<item>
    <g:id>${xmlEscape(watch.listingId || watch.id)}</g:id>
    <title>${xmlEscape(truncateAtWord(watchDisplayName(merchantWatch), 150))}</title>
    <description>${xmlEscape(truncateAtWord(watchDescription(merchantWatch), 5000))}</description>
    <link>${xmlEscape(watchUrl(watch))}</link>
    <g:image_link>${xmlEscape(images[0])}</g:image_link>
    ${additionalImages}
    <g:availability>in_stock</g:availability>
    <g:price>${price.toFixed(2)} GBP</g:price>
    <g:condition>used</g:condition>
    <g:brand>${xmlEscape(cleanText(watch.brand))}</g:brand>
    ${identifiers}
    <g:google_product_category>${xmlEscape(googleCategory)}</g:google_product_category>
    <g:product_type>${xmlEscape(productType)}</g:product_type>
    ${color ? `<g:color>${xmlEscape(color)}</g:color>` : ""}
    ${ageGroup ? `<g:age_group>${xmlEscape(ageGroup)}</g:age_group>` : ""}
    ${gender ? `<g:gender>${xmlEscape(gender)}</g:gender>` : ""}
    ${shipping}
  </item>`;
}

export function merchantCountries(value = "GB") {
  const supported = new Set(["GB", ...EUROPE_COUNTRIES, ...GLOBAL_COUNTRIES]);
  const countries = [...new Set(String(value || "GB").toUpperCase().split(",").map(country => country.trim()).filter(Boolean))];
  if (countries.some(country => !supported.has(country))) throw new Error("Unsupported Merchant target country");
  return countries;
}

export function buildMerchantFeed(watches = [], { countries = ["GB"] } = {}) {
  const allowedCountries = merchantCountries(countries.join(","));
  const counts = new Map();
  for (const watch of watches) {
    const id = cleanText(watch.listingId || watch.id).toLowerCase();
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  const items = watches
    .filter((watch) => merchantIssues(watch).length === 0)
    .filter(watch => counts.get(cleanText(watch.listingId || watch.id).toLowerCase()) === 1)
    .map(watch => itemXml(watch, allowedCountries))
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>Stapleford Watches</title>
    <link>${SITE_ORIGIN}/</link>
    <description>Available pre-owned watches from Stapleford Watches</description>
    ${items}
  </channel>
</rss>`;
}

export async function onRequest(context) {
  const response = await getCatalog(context, { requireFresh: true });
  if (!response.ok) return response;
  const payload = await response.json();
  return new Response(buildMerchantFeed(payload.watches || [], {
    countries: merchantCountries(context.env?.MERCHANT_TARGET_COUNTRIES),
  }), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

