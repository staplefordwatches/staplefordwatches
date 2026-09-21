import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildMerchantFeed } from "../functions/api/google-merchant-feed.js";
import { buildSitemap } from "../functions/sitemap.xml.js";
import { humanizeSlug } from "../functions/_middleware.js";

const availableWatch = {
  id: "recAvailable",
  listingId: "SW060",
  brand: "Zenith",
  title: "Rainbow Flyback",
  price: 6750,
  status: "Available",
  dateAdded: "2026-09-20",
  description: "A rare & exceptionally well-preserved example.",
  image: "https://images.example.com/sw060/01.jpg",
  images: [
    "https://images.example.com/sw060/01.jpg",
    "https://images.example.com/sw060/02.jpg",
  ],
  mpn: "01.02.0470.405",
  gtin: "1234567890123",
  productType: "Chronograph",
  specs: { reference: "01.02.0470.405", year: "1999" },
};

const soldWatch = {
  ...availableWatch,
  id: "recSold",
  listingId: "SW061",
  status: "Sold",
};

test("Merchant Center feed contains complete available inventory and excludes sold watches", () => {
  const xml = buildMerchantFeed([availableWatch, soldWatch]);

  assert.match(xml, /<g:id>SW060<\/g:id>/);
  assert.doesNotMatch(xml, /<g:id>SW061<\/g:id>/);
  assert.match(xml, /<g:availability>in_stock<\/g:availability>/);
  assert.match(xml, /<g:condition>used<\/g:condition>/);
  assert.match(xml, /<g:price>6750\.00 GBP<\/g:price>/);
  assert.match(xml, /<g:gtin>1234567890123<\/g:gtin>/);
  assert.match(xml, /<g:mpn>01\.02\.0470\.405<\/g:mpn>/);
  assert.match(xml, /A rare &amp; exceptionally well-preserved example/);
  assert.match(xml, /Apparel &amp; Accessories &gt; Jewelry &gt; Watches/);
  assert.match(xml, /<g:price>0\.00 GBP<\/g:price>/);
  assert.match(xml, /<g:country>FR<\/g:country>[\s\S]*?<g:price>50\.00 GBP<\/g:price>/);
  assert.match(xml, /<g:country>US<\/g:country>[\s\S]*?<g:price>80\.00 GBP<\/g:price>/);
});

test("dynamic sitemap includes product and journal URLs with modification dates", () => {
  const xml = buildSitemap({
    watches: [availableWatch],
    posts: [{ slug: "collecting-vintage-zenith", updatedDate: "2026-09-21T10:30:00Z" }],
  });

  assert.match(xml, /<loc>https:\/\/staplefordwatches\.co\.uk\/buy\/<\/loc>/);
  assert.match(xml, /<loc>https:\/\/staplefordwatches\.co\.uk\/watches\/zenith-rainbow-flyback-01-02-0470-405-sw060\/<\/loc>/);
  assert.match(xml, /<loc>https:\/\/staplefordwatches\.co\.uk\/journal\/collecting-vintage-zenith\/<\/loc>/);
  assert.match(xml, /<lastmod>2026-09-20<\/lastmod>/);
  assert.match(xml, /<lastmod>2026-09-21<\/lastmod>/);
});

test("client SEO is route-specific instead of publishing every watch as a Product", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

  assert.match(html, /function syncPrimaryHeading\(\)/);
  assert.match(html, /activeWatch \? productStructuredData\(activeWatch\)/);
  assert.match(html, /'@type':'BreadcrumbList'/);
  assert.match(html, /'@type':'OfferShippingDetails'/);
  assert.match(html, /'@type':'Article'/);
  assert.doesNotMatch(html, /const graph = watches\.map\(w => \(\{ '@type':'Product'/);
});

test("edge-rendered product and article metadata starts with a human-readable title", () => {
  assert.equal(
    humanizeSlug("zenith-rainbow-flyback-01-02-0470-405-sw060", { product: true }),
    "Zenith Rainbow Flyback 01 02 0470 405",
  );
  assert.equal(humanizeSlug("how-to-buy-a-vintage-watch"), "How To Buy A Vintage Watch");
});
