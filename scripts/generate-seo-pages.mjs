import fs from "node:fs/promises";
import path from "node:path";

const SITE_ORIGIN = process.env.SITE_ORIGIN || "https://staplefordwatches.co.uk";
const WATCHES_API_URL = process.env.WATCHES_API_URL || `${SITE_ORIGIN}/api/watches`;
const OUT_DIR = process.env.OUT_DIR || "dist";
const SOURCE_INDEX = process.env.SOURCE_INDEX || "index.html";

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
          "seller": { "@type": "Organization", "name": "Stapleford Watches" }
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

function renderProductPage(w){
  const slug = getProductSlug(w);
  const url = `${SITE_ORIGIN}/watches/${slug}/`;
  const title = `${w.brand || ""} ${w.title || ""} for sale | Stapleford Watches`.replace(/\s+/g, " ").trim();
  const description = trimMeta(w.description || getWatchDescription(w));
  const images = getWatchImages(w);
  const hero = images[0] || "";
  const rows = specRows(w);
  const status = String(w.status || "available").toUpperCase();
  const available = w.status === "available";
  const links = enquiryLinks(w);
  const schema = productSchema(w, url, images);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeAttr(description)}">
<link rel="canonical" href="${escapeAttr(url)}">
<meta property="og:type" content="product">
<meta property="og:title" content="${escapeAttr(title)}">
<meta property="og:description" content="${escapeAttr(description)}">
<meta property="og:url" content="${escapeAttr(url)}">
${hero ? `<meta property="og:image" content="${escapeAttr(hero)}">` : ""}
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${JSON.stringify(schema)}</script>
<style>
:root{--ink:#111;--muted:#666;--line:#e8e2dc;--paper:#fffaf5;--accent:#111}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:Arial,Helvetica,sans-serif;letter-spacing:.02em}.top{display:flex;justify-content:space-between;align-items:center;padding:20px 24px;border-bottom:1px solid var(--line)}.brandmark{font-size:22px;text-decoration:none;color:inherit}.nav{display:flex;gap:18px;font-size:12px;text-transform:uppercase}.nav a{color:inherit;text-decoration:none}.wrap{max-width:1180px;margin:0 auto;padding:40px 22px 70px}.crumbs{font-size:12px;text-transform:uppercase;margin-bottom:24px;color:var(--muted)}.crumbs a{color:inherit}.product{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(320px,.9fr);gap:48px;align-items:start}.gallery{display:grid;gap:14px}.gallery img{width:100%;display:block;background:#eee;object-fit:cover}.thumbs{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.thumbs img{aspect-ratio:1;object-fit:cover}.kicker{font-size:12px;text-transform:uppercase;color:var(--muted);margin-bottom:10px}.title{font-size:38px;line-height:1.05;margin:0 0 16px}.price{font-size:22px;margin:0 0 18px}.status{display:inline-block;border:1px solid var(--ink);padding:6px 10px;font-size:12px;text-transform:uppercase;margin-bottom:22px}.desc{line-height:1.65;color:#222;margin:0 0 26px}.actions{display:flex;flex-wrap:wrap;gap:12px;margin:26px 0}.button{appearance:none;border:1px solid var(--ink);background:var(--ink);color:#fff;text-decoration:none;padding:14px 18px;font-size:12px;text-transform:uppercase;letter-spacing:.12em}.button.secondary{background:transparent;color:var(--ink)}.specs{border-top:1px solid var(--line);margin-top:30px}.row{display:grid;grid-template-columns:145px 1fr;gap:18px;border-bottom:1px solid var(--line);padding:14px 0;font-size:13px}.row dt{text-transform:uppercase;color:var(--muted)}.row dd{margin:0}.footer{border-top:1px solid var(--line);padding:26px 24px;color:var(--muted);font-size:12px;text-align:center}@media(max-width:800px){.product{grid-template-columns:1fr}.title{font-size:30px}.top{padding:16px}.nav{gap:10px}.row{grid-template-columns:120px 1fr}}
</style>
</head>
<body>
<header class="top"><a class="brandmark" href="/">Stapleford Watches</a><nav class="nav"><a href="/">Buy</a><a href="/#sell">Sell</a><a href="/#info">Info</a></nav></header>
<main class="wrap">
<div class="crumbs"><a href="/">Home</a> / <a href="/">Watches</a> / ${escapeHtml(`${w.brand || ""} ${w.title || ""}`.trim())}</div>
<article class="product" itemscope itemtype="https://schema.org/Product">
<section class="gallery" aria-label="Product images">
${hero ? `<img itemprop="image" src="${escapeAttr(hero)}" alt="${escapeAttr(`${w.brand || ""} ${w.title || ""} ${w.listingId}`.trim())}">` : ""}
${images.length > 1 ? `<div class="thumbs">${images.slice(1,5).map((img, i) => `<img src="${escapeAttr(img)}" alt="${escapeAttr(`${w.brand || ""} ${w.title || ""} image ${i+2}`.trim())}">`).join("")}</div>` : ""}
</section>
<section>
<div class="kicker">Luxury watch for sale</div>
<h1 class="title" itemprop="name">${escapeHtml(`${w.brand || ""} ${w.title || ""}`.trim())}</h1>
<meta itemprop="sku" content="${escapeAttr(w.listingId)}">
<div class="price">${available ? escapeHtml(formatPrice(w.price)) : escapeHtml(status)}</div>
<div class="status">${escapeHtml(available ? "Available" : status)}</div>
<p class="desc" itemprop="description">${escapeHtml(w.description || getWatchDescription(w))}</p>
<div itemprop="offers" itemscope itemtype="https://schema.org/Offer">
<meta itemprop="priceCurrency" content="GBP">
<meta itemprop="price" content="${escapeAttr(String(w.price || ""))}">
<link itemprop="availability" href="${available ? "https://schema.org/InStock" : "https://schema.org/OutOfStock"}">
<link itemprop="itemCondition" href="https://schema.org/UsedCondition">
</div>
<div class="actions">
${available ? `<a class="button" href="/?watch=${escapeAttr(slug)}">Buy on site</a>` : ""}
<a class="button secondary" href="${escapeAttr(links.whatsapp)}" rel="noopener">WhatsApp</a>
<a class="button secondary" href="${escapeAttr(links.email)}">Email enquiry</a>
</div>
<h2>Specification</h2>
<dl class="specs">${rows.map(([label, value]) => `<div class="row"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>
</section>
</article>
</main>
<footer class="footer">Stapleford Watches · ben@staplefordwatches.co.uk · +44 7438 196047</footer>
</body>
</html>`;
}

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
    await fs.writeFile(path.join(dir, "index.html"), renderProductPage(watch));
  }

  console.log(`Generated ${watches.length} crawlable product pages in ${OUT_DIR}/watches/`);
  console.log(`Generated ${OUT_DIR}/sitemap.xml and ${OUT_DIR}/robots.txt`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
