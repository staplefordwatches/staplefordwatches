import { onRequest as getWatches } from "./watches.js";
import {
  SITE_ORIGIN,
  cleanText,
  isAvailableWatch,
  numericPrice,
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

function itemXml(watch) {
  const price = numericPrice(watch.price);
  const images = [...new Set([watch.image, ...(Array.isArray(watch.images) ? watch.images : [])].filter(Boolean))];
  const rawGtin = cleanText(watch.gtin).replace(/[^0-9]/g, "");
  const gtin = [8, 12, 13, 14].includes(rawGtin.length) ? rawGtin : "";
  const mpn = cleanText(watch.mpn) || watchReference(watch);
  const productType = cleanText(watch.productType) || "Watches";
  const identifiers = [
    gtin ? `<g:gtin>${xmlEscape(gtin)}</g:gtin>` : "",
    mpn ? `<g:mpn>${xmlEscape(mpn)}</g:mpn>` : "",
    !gtin && !mpn ? "<g:identifier_exists>no</g:identifier_exists>" : "",
  ].filter(Boolean).join("");
  const additionalImages = images.slice(1, 11)
    .map((image) => `<g:additional_image_link>${xmlEscape(image)}</g:additional_image_link>`)
    .join("");
  const shipping = [
    shippingXml("GB", "Free tracked and insured", 0),
    ...EUROPE_COUNTRIES.map((country) => shippingXml(country, "Europe tracked and insured", 50)),
    ...GLOBAL_COUNTRIES.map((country) => shippingXml(country, "International tracked and insured", 80)),
  ].join("\n    ");

  return `<item>
    <g:id>${xmlEscape(watch.listingId || watch.id)}</g:id>
    <title>${xmlEscape(truncateAtWord(watchDisplayName(watch), 150))}</title>
    <description>${xmlEscape(truncateAtWord(watchDescription(watch), 5000))}</description>
    <link>${xmlEscape(watchUrl(watch))}</link>
    <g:image_link>${xmlEscape(images[0])}</g:image_link>
    ${additionalImages}
    <g:availability>in_stock</g:availability>
    <g:price>${price.toFixed(2)} GBP</g:price>
    <g:condition>used</g:condition>
    <g:brand>${xmlEscape(cleanText(watch.brand))}</g:brand>
    ${identifiers}
    <g:google_product_category>${xmlEscape(GOOGLE_WATCH_CATEGORY)}</g:google_product_category>
    <g:product_type>${xmlEscape(`Watches > ${productType}`)}</g:product_type>
    ${shipping}
  </item>`;
}

export function buildMerchantFeed(watches = []) {
  const items = watches
    .filter((watch) => isAvailableWatch(watch))
    .filter((watch) => cleanText(watch.brand) && cleanText(watch.listingId || watch.id))
    .filter((watch) => numericPrice(watch.price) > 0)
    .filter((watch) => cleanText(watch.image) || (Array.isArray(watch.images) && watch.images.some(Boolean)))
    .map(itemXml)
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
  const response = await getWatches(context);
  if (!response.ok) return response;
  const payload = await response.json();
  return new Response(buildMerchantFeed(payload.watches || []), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
