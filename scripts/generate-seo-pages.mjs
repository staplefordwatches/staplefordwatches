import fs from "node:fs/promises";
import path from "node:path";

const SITE_ORIGIN = process.env.SITE_ORIGIN || "https://staplefordwatches.co.uk";
const WATCHES_API_URL = process.env.WATCHES_API_URL || `${SITE_ORIGIN}/api/watches`;
const OUT_DIR = process.env.OUT_DIR || "dist";
const SOURCE_INDEX = process.env.SOURCE_INDEX || "index.html";

const DELIVERY_POLICY_URL = `${SITE_ORIGIN}/#delivery`;
const RETURNS_POLICY_URL = `${SITE_ORIGIN}/#returns`;

function escapeHtml(value = ""){
  return String(value).replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[ch]));
}

function escapeAttr(value = ""){
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function trimMeta(value = "", max = 158){
  const text = String(value).replace(/\s+/g, " ").trim();
  if(text.length <= max) return text;
  return text.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
}

function slugify(value){
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getProductSlug(w){
  const listingId = String(w.listingId || w.id || "").toLowerCase();
  const name = slugify(`${w.brand || ""} ${w.title || ""}`) || "watch";
  return `${name}-${listingId}`.replace(/-+$/g, "");
}

function absUrl(value){
  if(!value) return "";
  try { return new URL(value, `${SITE_ORIGIN}/`).href; }
  catch { return ""; }
}

function formatPrice(value){
  const num = Number(value || 0);
  return num ? `£${num.toLocaleString("en-GB")}` : "Price on request";
}

function getWatchImages(w){
  const images = [];
  if(w.image) images.push(w.image);
  for(const key of ["gallery", "images", "detailImages"]){
    if(Array.isArray(w[key])) images.push(...w[key].filter(Boolean));
  }
  return [...new Set(images)].map(absUrl).filter(Boolean);
}

function getWatchDescription(w){
  const specs = w.specs || {};
  const condition = specs.condition ? String(specs.condition).toLowerCase() : "pre-owned";
  const caseSize = specs.caseSize ? ` ${specs.caseSize}` : "";
  const year = specs.year ? ` from ${specs.year}` : "";
  const contents = specs.contents ? ` Includes ${String(specs.contents).toLowerCase()}.` : "";
  return `${condition} ${w.brand || ""} ${w.title || ""}${caseSize}${year}, listed by Stapleford Watches.${contents} Contact us for current availability and further images.`.replace(/\s+/g, " ").trim();
}

function normaliseWatch(w, index){
  const listingId = w.listingId || w.id || `SW${String(index + 1).padStart(3, "0")}`;
  return {
    ...w,
    listingId,
    id: w.id || listingId,
    specs: { ...(w.specs || {}), listingId },
    description: String(w.description || w.watchDescription || w.longDescription || "").trim() || getWatchDescription({...w, listingId, specs:{...(w.specs || {}), listingId}})
  };
}

function productSchema(w, url, images){
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Product",
        "@id": `${url}#product`,
        "name": `${w.brand || ""} ${w.title || ""}`.trim(),
        "brand": { "@type": "Brand", "name": w.brand || "" },
        "sku": w.listingId,
        "description": w.description || getWatchDescription(w),
        "image": images,
        "url": url,
        "offers": {
          "@type": "Offer",
          "url": url,
          "priceCurrency": "GBP",
          "price": String(w.price || ""),
          "availability": w.status === "available" ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
          "itemCondition": "https://schema.org/UsedCondition",
          "seller": { "@type": "Organization", "name": "Stapleford Watches" },
          "shippingDetails": {
            "@type": "OfferShippingDetails",
            "shippingDestination": { "@type": "DefinedRegion", "addressCountry": "GB" },
            "shippingRate": { "@type": "MonetaryAmount", "value": "0", "currency": "GBP" },
            "deliveryTime": {
              "@type": "ShippingDeliveryTime",
              "handlingTime": { "@type": "QuantitativeValue", "minValue": 0, "maxValue": 1, "unitCode": "DAY" },
              "transitTime": { "@type": "QuantitativeValue", "minValue": 1, "maxValue": 1, "unitCode": "DAY" }
            }
          },
          "hasMerchantReturnPolicy": {
            "@type": "MerchantReturnPolicy",
            "applicableCountry": "GB",
            "returnPolicyCategory": "https://schema.org/MerchantReturnFiniteReturnWindow",
            "merchantReturnDays": 14,
            "returnMethod": "https://schema.org/ReturnByMail",
            "returnFees": "https://schema.org/ReturnShippingFees",
            "merchantReturnLink": RETURNS_POLICY_URL
          }
        }
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${url}#breadcrumbs`,
        "itemListElement": [
          { "@type": "ListItem", "position": 1, "name": "Home", "item": `${SITE_ORIGIN}/` },
          { "@type": "ListItem", "position": 2, "name": "Watches", "item": `${SITE_ORIGIN}/#buy` },
          { "@type": "ListItem", "position": 3, "name": `${w.brand || ""} ${w.title || ""}`.trim(), "item": url }
        ]
      }
    ]
  };
}

function specRows(w){
  const specs = w.specs || {};
  return [
    ["Brand", w.brand],
    ["Model", w.title],
    ["Reference", specs.reference],
    ["Year", specs.year],
    ["Case size", specs.caseSize],
    ["Condition", specs.condition],
    ["Contents", specs.contents],
    ["Listing ID", w.listingId]
  ].filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "");
}

function enquiryLinks(w){
  const title = `${w.brand || ""} ${w.title || ""}`.trim();
  const message = `Hi Ben, I am interested in ${title} (${w.listingId}). Is it still available?`;
  return {
    whatsapp: `https://wa.me/447438196047?text=${encodeURIComponent(message)}`,
    email: `mailto:ben@staplefordwatches.co.uk?subject=${encodeURIComponent(`Enquiry: ${title} ${w.listingId}`)}&body=${encodeURIComponent(message)}`
  };
}


function stripGeneratedSeo(html){
  return html
    .replace(/<title>[\s\S]*?<\/title>/i, "")
    .replace(/<meta\s+name=["']description["'][^>]*>\s*/ig, "")
    .replace(/<link\s+rel=["']canonical["'][^>]*>\s*/ig, "")
    .replace(/<meta\s+property=["']og:[^"']+["'][^>]*>\s*/ig, "")
    .replace(/<meta\s+name=["']twitter:[^"']+["'][^>]*>\s*/ig, "")
    .replace(/<script\s+type=["']application\/ld\+json["'][\s\S]*?<\/script>\s*/ig, "");
}

function renderProductAppShell(sourceIndex, w){
  const slug = getProductSlug(w);
  const url = `${SITE_ORIGIN}/watches/${slug}/`;
  const title = `${w.brand || ""} ${w.title || ""} for sale | Stapleford Watches`.replace(/\s+/g, " ").trim();
  const description = trimMeta(w.description || getWatchDescription(w));
  const images = getWatchImages(w);
  const hero = images[0] || "";
  const schema = productSchema(w, url, images);
  const seoBlock = `<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeAttr(description)}">
<link rel="canonical" href="${escapeAttr(url)}">
<meta property="og:type" content="product">
<meta property="og:title" content="${escapeAttr(title)}">
<meta property="og:description" content="${escapeAttr(description)}">
<meta property="og:url" content="${escapeAttr(url)}">
${hero ? `<meta property="og:image" content="${escapeAttr(hero)}">` : ""}
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${JSON.stringify(schema)}</script>
<script>window.__STAPLEFORD_PRODUCT_SLUG__=${JSON.stringify(slug)};</script>`;
  return stripGeneratedSeo(sourceIndex).replace(/<head>/i, `<head>\n${seoBlock}\n`);
}

// Direct product URLs use the main Stapleford site app shell, not a separate visible template.
// This prevents ugly standalone product pages from ever being generated.

function renderSitemap(watches){
  const now = new Date().toISOString().slice(0,10);
  const urls = [
    ["/", "daily", "1.0"],
    ["/#sell", "monthly", "0.5"],
    ["/#info", "monthly", "0.5"],
    ...watches.map(w => [`/watches/${getProductSlug(w)}/`, "daily", "0.9"])
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(([loc, freq, priority]) => `  <url><loc>${SITE_ORIGIN}${loc}</loc><lastmod>${now}</lastmod><changefreq>${freq}</changefreq><priority>${priority}</priority></url>`).join("\n")}\n</urlset>\n`;
}

async function copyDir(src, dest){
  try { await fs.mkdir(dest, { recursive:true }); }
  catch {}
  for(const entry of await fs.readdir(src, { withFileTypes:true })){
    if(["dist", ".git", "node_modules"].includes(entry.name)) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if(entry.isDirectory()) await copyDir(from, to);
    else await fs.copyFile(from, to).catch(()=>{});
  }
}

async function main(){
  const response = await fetch(WATCHES_API_URL, { headers:{ accept:"application/json" } });
  if(!response.ok) throw new Error(`Could not fetch watches from ${WATCHES_API_URL}: ${response.status} ${response.statusText}`);
  const data = await response.json();
  const watches = (Array.isArray(data.watches) ? data.watches : []).map(normaliseWatch);

  await fs.rm(OUT_DIR, { recursive:true, force:true });
  await fs.mkdir(OUT_DIR, { recursive:true });
  await copyDir(process.cwd(), OUT_DIR);

  const sourceIndex = await fs.readFile(SOURCE_INDEX, "utf8");
  await fs.writeFile(path.join(OUT_DIR, "index.html"), sourceIndex);
  await fs.writeFile(path.join(OUT_DIR, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`);
  await fs.writeFile(path.join(OUT_DIR, "sitemap.xml"), renderSitemap(watches));

  for(const watch of watches){
    const slug = getProductSlug(watch);
    const dir = path.join(OUT_DIR, "watches", slug);
    await fs.mkdir(dir, { recursive:true });
    await fs.writeFile(path.join(dir, "index.html"), renderProductAppShell(sourceIndex, watch));
    console.log(`App-shell page: /watches/${slug}/`);
  }

  console.log(`Generated ${watches.length} product app-shell pages in ${OUT_DIR}/watches/`);
  console.log(`Generated ${OUT_DIR}/sitemap.xml and ${OUT_DIR}/robots.txt`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
