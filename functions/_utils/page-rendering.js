import {
  SITE_ORIGIN, brandSlug, catalogBrands, cleanText, isAvailableWatch, isPublishedWatch,
  numericPrice, safeImageUrl, truncateAtWord, validGtin, watchDescription, watchDisplayName,
  watchReference, watchSlug, watchStatus, watchUrl, xmlEscape,
} from "./catalog-seo.js";
import { INFO_CONTENT } from "./site-pages.js";

export const PAGE_SEO = {
  home: { path: "/", title: "Pre-Owned Luxury & Vintage Watches | Stapleford Watches", description: "Explore pre-owned luxury and vintage watches from Stapleford Watches, an independent UK dealer. Discover individual timepieces with insured UK delivery." },
  buy: { path: "/buy/", title: "Buy Pre-Owned & Vintage Watches UK | Stapleford Watches", description: "Browse pre-owned and vintage watches by brand, model and reference. View original photographs, condition details and prices with insured UK delivery." },
  sell: { path: "/sell/", title: "Sell Your Watch | Stapleford Watches", description: "Sell your watch to Stapleford Watches. Share its reference, condition and photographs for a no-obligation offer." },
  contact: { path: "/contact/", title: "Contact | Stapleford Watches", description: "Contact Stapleford Watches for watch enquiries, sourcing, selling, order support and returns. Find our UK business and customer-service details." },
  delivery: { path: "/delivery/", title: "Insured Watch Delivery | Stapleford Watches", description: "Read our insured watch delivery policy, UK and international shipping costs, delivery estimates and collection information." },
  returns: { path: "/returns/", title: "Returns Policy | Stapleford Watches", description: "Read Stapleford Watches' online returns policy, including the 14-day return window, return process, costs and refunds." },
  terms: { path: "/terms-and-conditions/", title: "Terms & Conditions | Stapleford Watches", description: "Read Stapleford Watches' terms for purchasing and selling watches, payment, delivery, returns, warranties and product condition." },
  privacy: { path: "/privacy-policy/", title: "Privacy Policy | Stapleford Watches", description: "How Stapleford Watches handles enquiries, order information, payments, newsletters and personal data." },
  journal: { path: "/journal/", title: "Watch Journal & Buying Guides | Stapleford Watches", description: "Watch reviews, reference guides and collecting advice from the Stapleford Watches journal." },
  search: { path: "/search/", title: "Search Watches | Stapleford Watches", description: "Search Stapleford Watches by brand, model and reference.", noindex: true },
};
export const ROUTE_ALIASES = {
  "/index.html": "/", "/returns-policy/": "/returns/", "/refund-policy/": "/returns/",
  "/terms/": "/terms-and-conditions/", "/tcs/": "/terms-and-conditions/",
  "/terms-conditions/": "/terms-and-conditions/", "/privacy/": "/privacy-policy/",
};
function normalizedId(value) {
  const id = cleanText(value).toLowerCase(), match = id.match(/^sw-?0*(\d+)$/);
  return match ? "sw" + Number(match[1]) : id;
}
export function findProduct(watches, token) {
  const wanted = cleanText(token).toLowerCase(), published = watches.filter(isPublishedWatch);
  const exact = published.find(watch => wanted === watchSlug(watch)
    || wanted === cleanText(watch.listingId || watch.id).toLowerCase()
    || wanted.endsWith("-" + cleanText(watch.listingId || watch.id).toLowerCase()));
  if (exact) return exact;
  const suffix = wanted.match(/(?:^|-)(sw-?\d+|rec[a-z0-9]+)$/i)?.[1];
  const matches = suffix ? published.filter(watch => normalizedId(watch.listingId || watch.id) === normalizedId(suffix)) : [];
  return matches.length === 1 ? matches[0] : null;
}
export function pageModel(path, { watches = [], posts = [] } = {}) {
  const product = path.match(/^\/watches\/([^/]+)\/$/i), article = path.match(/^\/journal\/([^/]+)\/$/i), brandMatch = path.match(/^\/brands\/([^/]+)\/$/i);
  if (product) {
    const watch = findProduct(watches, decodeURIComponent(product[1]));
    if (!watch) return null;
    return { key: "product", watch, canonical: watchUrl(watch), title: watchDisplayName(watch) + " | Stapleford Watches",
      description: truncateAtWord(watchDescription(watch), 155), image: safeImageUrl(watch.image), type: "product" };
  }
  if (article) {
    const post = posts.find(item => item.slug === decodeURIComponent(article[1]));
    if (!post) return null;
    return { key: "article", post, canonical: SITE_ORIGIN + "/journal/" + encodeURIComponent(post.slug) + "/",
      title: post.title + " | Stapleford Watches", description: truncateAtWord(post.excerpt || post.subtitle || post.title, 155),
      image: safeImageUrl(post.heroImage || post.image), type: "article" };
  }
  if (brandMatch) {
    const brand = catalogBrands(watches).find(item => item.slug === decodeURIComponent(brandMatch[1]));
    if (!brand) return null;
    return { key: "brand", brand, canonical: brand.url, title: "Pre-Owned & Vintage " + brand.name + " Watches | Stapleford Watches",
      description: "Explore pre-owned and vintage " + brand.name + " watches at Stapleford Watches. Compare references, condition, original photographs and available UK stock.", type: "website" };
  }
  const entry = Object.entries(PAGE_SEO).find(([, page]) => page.path === path);
  return entry ? { key: entry[0], ...entry[1], canonical: SITE_ORIGIN + entry[1].path, type: "website" } : null;
}
export function productGraph(watch) {
  const url = watchUrl(watch), price = numericPrice(watch.price), gtin = validGtin(watch.gtin);
  const product = { "@type": "Product", "@id": url + "#product", name: watchDisplayName(watch), url,
    brand: { "@type": "Brand", name: cleanText(watch.brand) }, description: watchDescription(watch),
    image: [...new Set([watch.image, ...(watch.images || [])].map(safeImageUrl).filter(Boolean))],
    sku: cleanText(watch.listingId || watch.id), ...(watchReference(watch) ? { mpn: watchReference(watch) } : {}),
    ...(gtin ? { ["gtin" + gtin.length]: gtin } : {}),
    additionalProperty: Object.entries(watch.specs || {}).filter(([name, value]) => value && !name.endsWith("Notes"))
      .map(([name, value]) => ({ "@type": "PropertyValue", name, value: cleanText(value) })) };
  if (price) product.offers = { "@type": "Offer", url, price, priceCurrency: "GBP",
    availability: isAvailableWatch(watch) ? "https://schema.org/InStock" : watchStatus(watch) === "sold" ? "https://schema.org/SoldOut" : "https://schema.org/OutOfStock",
    itemCondition: "https://schema.org/UsedCondition", seller: { "@id": SITE_ORIGIN + "/#organization" },
    shippingDetails: { "@type": "OfferShippingDetails", shippingRate: { "@type": "MonetaryAmount", value: 0, currency: "GBP" },
      shippingDestination: { "@type": "DefinedRegion", addressCountry: "GB" },
      deliveryTime: { "@type": "ShippingDeliveryTime", handlingTime: { "@type": "QuantitativeValue", minValue: 0, maxValue: 1, unitCode: "DAY" },
        transitTime: { "@type": "QuantitativeValue", minValue: 1, maxValue: 1, unitCode: "DAY" } } },
    hasMerchantReturnPolicy: { "@type": "MerchantReturnPolicy", applicableCountry: "GB",
      returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow", merchantReturnDays: 14,
      returnMethod: "https://schema.org/ReturnByMail", returnFees: "https://schema.org/ReturnFeesCustomerResponsibility",
      merchantReturnLink: SITE_ORIGIN + "/returns/" } };
  return [product, { "@type": "BreadcrumbList", itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: SITE_ORIGIN + "/" },
    { "@type": "ListItem", position: 2, name: "Buy watches", item: SITE_ORIGIN + "/buy/" },
    { "@type": "ListItem", position: 3, name: watchDisplayName(watch), item: url },
  ] }];
}
function scriptJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}
function priceText(watch) {
  const price = numericPrice(watch.price);
  return price ? "£" + price.toLocaleString("en-GB", { maximumFractionDigits: 2 }) : "Price on request";
}
function imageVariant(value, width, detail = false) {
  const raw = safeImageUrl(value);
  if (!raw) return "";
  const url = new URL(raw), marker = "/image/upload/", index = url.pathname.indexOf(marker);
  if (url.hostname !== "res.cloudinary.com" || index < 0) return raw;
  const parts = url.pathname.slice(index + marker.length).split("/").filter(Boolean);
  const transformPart = /^(?:a_|ar_|b_|bo_|c_|co_|d_|dpr_|e_|f_|fl_|g_|h_|l_|o_|q_|r_|so_|t_|u_|w_|x_|y_|z_|if_|if$|fn_|pg_|vc_|vs_)/i;
  while (parts.length && !/^v\d+$/.test(parts[0]) && parts[0].split(",").every(part => transformPart.test(part))) parts.shift();
  url.pathname = url.pathname.slice(0, index + marker.length) + "f_auto,q_auto:best,fl_progressive," + (detail ? "c_limit" : "c_fill,g_auto,ar_4:5") + ",w_" + width + "/" + parts.join("/");
  return url.href;
}
function imageAttributes(value, detail = false, first = false) {
  const raw = safeImageUrl(value), source = imageVariant(raw, detail ? 1600 : first ? 800 : 640, detail);
  const responsive = raw && new URL(raw).hostname === "res.cloudinary.com" && new URL(raw).pathname.includes("/image/upload/");
  const widths = detail ? [900,1200,1600,2000,2400] : [320,480,640,800,1040,1280,1600,2000,2400];
  return ' src="' + xmlEscape(source) + '"' + (responsive ? ' srcset="' + xmlEscape(widths.map(width => imageVariant(raw,width,detail) + " " + width + "w").join(", ")) + '" sizes="' + (detail ? "(max-width: 767px) 100vw, (max-width: 1023px) 58vw, 760px" : "(max-width: 767px) calc((100vw - 3px) / 2), (max-width: 1199px) calc((100vw - 6px) / 3), calc((100vw - 9px) / 4)") + '"' : "");
}
function opening(html, id, change) {
  return html.replace(new RegExp('<([a-z][a-z0-9]*)\\b(?=[^>]*\\bid="' + id + '")[^>]*>', "i"), change);
}
function content(html, id, value, tag) {
  // These identified slots are empty in the static shell.
  return html.replace(new RegExp('<([a-z][a-z0-9]*)\\b(?=[^>]*\\bid="' + id + '")([^>]*)>[\\s\\S]*?<\\/\\1>', "i"),
    (_, original, attributes) => "<" + (tag || original) + attributes + ">" + value + "</" + (tag || original) + ">");
}
function hidden(html, id, value) {
  return opening(html, id, tag => {
    tag = tag.replace(/\s+hidden(?:="[^"]*")?/g, "");
    return value ? tag.replace(/>$/, " hidden>") : tag;
  });
}
function cards(watches) {
  return watches.map((watch, index) => {
    const image = safeImageUrl(watch.image), name = watchDisplayName(watch);
    const state = isAvailableWatch(watch) ? priceText(watch) : watchStatus(watch).toUpperCase();
    return '<a class="card" href="' + xmlEscape(watchUrl(watch)) + '"><div class="image">' + (image ? '<img' + imageAttributes(image,false,index===0) + ' alt="' + xmlEscape(name) + '" width="640" height="800" loading="' + (index < 2 ? "eager" : "lazy") + '" fetchpriority="' + (index === 0 ? "high" : "auto") + '">' : "") + '</div><div class="info"><div class="title"><div class="listing-brand">' + xmlEscape(watch.brand.toUpperCase()) + '</div><div class="listing-title">' + xmlEscape(watch.title) + '</div><div class="listing-details"><div class="listing-reference">' + xmlEscape(watchReference(watch)) + '</div><div class="listing-meta">' + xmlEscape(watch.specs?.year || "") + '</div></div></div><div class="info-right"><div class="price">' + xmlEscape(state) + "</div></div></div></a>";
  }).join("");
}
export function renderPageDocument(document, page, { watches = [], posts = [] } = {}) {
  const boundary = document.indexOf('<script id="stapleford-production-js">');
  if (boundary < 0) throw new Error("Missing application shell");
  let html = document.slice(0, boundary), application = document.slice(boundary);
  html = html.replace(/<title>[\s\S]*?<\/title>/i, () => "<title>" + xmlEscape(page.title) + "</title>");
  html = html.replace(/<meta\b[^>]*\b(?:name="description"|property="og:(?:title|description|url|type|image)")[^>]*>/gi, "")
    .replace(/<link\b[^>]*\brel="canonical"[^>]*>/gi, "");
  const graph = page.key === "product" ? productGraph(page.watch) : page.key === "article" ? [{ "@type": "Article",
    headline: page.post.title, description: page.description, image: page.image ? [page.image] : [],
    ...(page.post.publishedDate ? { datePublished: page.post.publishedDate } : {}),
    ...(page.post.updatedDate ? { dateModified: page.post.updatedDate } : {}),
    author: { "@type": "Person", name: page.post.author || "Stapleford Watches" },
    publisher: { "@id": SITE_ORIGIN + "/#organization" }, mainEntityOfPage: page.canonical,
  }] : null;
  const published = watches.filter(isPublishedWatch);
  const bootstrap = { watches: published.map(watch => ({ ...watch, description: watchDescription(watch) })), ...(["journal", "article"].includes(page.key) ? { posts } : {}),
    page: { key: page.key, title: page.title, description: page.description, canonical: page.canonical },
    ...(page.brand ? { brand: page.brand.name } : {}), ...(page.key === "product" ? { productGraph: graph } : {}) };
  const head = '<link rel="canonical" href="' + xmlEscape(page.canonical) + '"><meta name="description" content="' + xmlEscape(page.description) + '">'
    + '<meta property="og:title" content="' + xmlEscape(page.title) + '"><meta property="og:description" content="' + xmlEscape(page.description) + '">'
    + '<meta property="og:url" content="' + xmlEscape(page.canonical) + '"><meta property="og:type" content="' + page.type + '">'
    + (page.image ? '<meta property="og:image" content="' + xmlEscape(page.image) + '">' : "")
    + (page.noindex ? '<meta name="robots" content="noindex,follow">' : "")
    + (graph ? '<script id="stapleford-server-jsonld" type="application/ld+json">' + scriptJson({ "@context": "https://schema.org", "@graph": graph }) + "</script>" : "")
    + '<script id="stapleford-bootstrap" type="application/json">' + scriptJson(bootstrap) + "</script>";
  html = html.replace(/<\/head>/i, () => head + "</head>").replace('class="sw-booting"', 'class=""');
  const isProduct = page.key === "product", isJournal = ["journal", "article"].includes(page.key);
  for (const [id, visible] of [["buyPage", ["home", "buy", "search", "brand"].includes(page.key)],
    ["infoPage", Boolean(INFO_CONTENT[page.key])], ["sellPage", page.key === "sell"], ["journalPage", isJournal]]) html = hidden(html, id, !visible);
  if (INFO_CONTENT[page.key]) {
    const copy = INFO_CONTENT[page.key];
    html = html.replace("<body>", '<body class="info-active' + (copy.variant === "legal" ? " legal-info-active" : "") + '">');
    html = content(html, "infoTitle", copy.title);
    html = content(html, "infoCopy", copy.copy.join(" "));
    html = content(html, "infoBody", '<div class="info-policy">' + (copy.body || []).join("") + "</div>");
    html = hidden(html, "infoHeroKicker", !copy.showKicker);
    const actions = copy.actions || [];
    html = content(html, "infoActions", actions.map(action => '<a class="curated-hero-action" href="' + xmlEscape(action.href) + '">' + xmlEscape(action.label) + "</a>").join(""));
    html = hidden(html, "infoActions", !actions.length);
  } else if (isProduct) {
    const watch = page.watch, specs = watch.specs || {}, available = isAvailableWatch(watch), price = numericPrice(watch.price);
    html = html.replace("<body>", '<body class="product-page-open" style="overflow:hidden">');
    html = opening(html, "lightbox", tag => tag.replace('class="lightbox"', 'class="lightbox open"').replace('aria-hidden="true"', 'aria-hidden="false"'));
    html = content(html, "lightboxDetailBrand", xmlEscape(watch.brand.toUpperCase()));
    html = content(html, "lightboxDetailTitle", xmlEscape(watchDisplayName(watch)), "h1");
    for (const [id, value] of [["Reference", watchReference(watch)], ["Year", specs.year], ["Contents", specs.contents]]) html = content(html, "lightboxDetail" + id, xmlEscape(value ? id.toUpperCase() + ": " + value : ""));
    html = content(html, "lightboxDetailPrice", xmlEscape(available ? priceText(watch) : price ? "Last listed at " + priceText(watch) : ""));
    html = content(html, "lightboxDetailBuy", available && price ? "BUY NOW" : watchStatus(watch) === "sold" ? "SOLD" : watchStatus(watch) === "reserved" ? "RESERVED" : "ENQUIRE");
    html = opening(html, "lightboxDetailBuy", tag => tag.replace(/>$/, (available && price ? "" : " disabled") + ' data-watch-id="' + xmlEscape(watch.listingId || watch.id) + '">'));
    html = content(html, "lightboxDetailDescription", xmlEscape(watchDescription(watch)));
    for (const type of ["Condition", "Contents"]) {
      const notes = specs[type.toLowerCase() + "Notes"] || "";
      html = content(html, "lightboxDetail" + type + "Copy", xmlEscape(notes));
      html = hidden(html, "lightboxDetail" + type + "Section", !notes);
      html = hidden(html, "lightboxDetail" + type + "Copy", false);
      if (notes) html = opening(html, "lightboxDetail" + type + "Toggle", tag => tag.replace('aria-expanded="false"', 'aria-expanded="true"'));
    }
    html = content(html, "lightboxDetailSpecs", Object.entries(specs).filter(([name, value]) => value && !name.endsWith("Notes")).map(([name, value]) => "<dt>" + xmlEscape(name) + "</dt><dd>" + xmlEscape(value) + "</dd>").join(""));
    html = hidden(html, "lightboxDetailSpecs", false);
    html = opening(html, "lightboxDetailSpecToggle", tag => tag.replace('aria-expanded="false"', 'aria-expanded="true"'));
    const image = safeImageUrl(watch.image);
    if (image) html = opening(html, "lightboxImage", tag => tag.replace('alt=""', 'alt="' + xmlEscape(watchDisplayName(watch)) + '"').replace(/\s+sizes="[^"]*"/g, "").replace(/\/?\s*>$/, imageAttributes(image,true) + ' loading="eager" fetchpriority="high">'));
    const enquiry = "Hi Stapleford Watches, I am interested in " + watchDisplayName(watch) + " (" + watch.listingId + ")." + (available ? "" : " Can you source a similar watch?");
    html = opening(html, "lightboxDetailWhatsapp", tag => tag.replace('href="#"', 'href="https://wa.me/447438196047?text=' + encodeURIComponent(enquiry) + '"'));
    html = opening(html, "lightboxDetailEmail", tag => tag.replace('href="#"', 'href="mailto:ben@staplefordwatches.co.uk?subject=' + encodeURIComponent(enquiry) + '"'));
    const related = published.filter(item => isAvailableWatch(item) && item.listingId !== watch.listingId).sort((a, b) => Number(b.brand === watch.brand) - Number(a.brand === watch.brand)).slice(0, 8);
    html = hidden(html, "lightboxRelated", !related.length);
    html = content(html, "lightboxRelatedGrid", related.map(item => '<a class="lightbox-related-card" href="' + xmlEscape(watchUrl(item)) + '">' + xmlEscape(watchDisplayName(item)) + " — " + xmlEscape(priceText(item)) + "</a>").join(""));
  } else if (["home", "buy", "search", "brand"].includes(page.key)) {
    const inventory = published.filter(watch => !page.brand || brandSlug(watch.brand) === page.brand.slug).sort((a, b) => {
      const stock = Number(isAvailableWatch(b)) - Number(isAvailableWatch(a));
      if (stock) return stock;
      const first = Date.parse(a.dateAdded), second = Date.parse(b.dateAdded);
      if (Number.isFinite(first) && Number.isFinite(second)) return second - first || Number(a._airtableEntryOrder || 0) - Number(b._airtableEntryOrder || 0);
      if (Number.isFinite(first)) return -1;
      if (Number.isFinite(second)) return 1;
      return Number(a._airtableEntryOrder || 0) - Number(b._airtableEntryOrder || 0);
    });
    html = content(html, "gallery", cards(inventory));
    const title = page.brand ? "Pre-owned and vintage " + page.brand.name + " watches." : "Curator of modern and vintage timepieces.";
    const intro = '<section class="curated-hero" id="catalogIntro" aria-labelledby="catalogIntroTitle"><h1 class="curated-hero-title" id="catalogIntroTitle">' + xmlEscape(title) + '</h1><p class="curated-hero-copy">' + xmlEscape(page.description) + '</p><div class="curated-hero-actions"><a class="curated-hero-action" href="#gallery">BUY</a><a class="curated-hero-action" href="/sell/">SELL</a></div></section>';
    const brands = '<nav id="brandDirectory" aria-label="Watch brands" style="max-width:935px;margin:20px auto;padding:0 18px;display:flex;flex-wrap:wrap;gap:14px">' + catalogBrands(published).map(brand => '<a href="/brands/' + brand.slug + '/">' + xmlEscape(brand.name) + "</a>").join("") + "</nav>";
    html = opening(html, "buyPage", tag => tag + intro + brands);
  } else if (isJournal) {
    html = html.replace("<body>", '<body class="journal-active' + (page.key === "article" ? " journal-entry-active" : "") + '">');
    html = hidden(html, "journalListView", page.key === "article");
    html = hidden(html, "journalEntryView", page.key !== "article");
    if (page.key === "article") {
      const post = page.post;
      html = content(html, "journalEntry", '<p class="journal-entry-meta">' + xmlEscape(post.category || "Journal") + '</p><h1 class="journal-entry-title">' + xmlEscape(post.title) + '</h1><p class="journal-entry-byline">' + xmlEscape(post.author || "Stapleford Watches") + "</p>" + (page.image ? '<div class="journal-entry-image"><img src="' + xmlEscape(page.image) + '" alt="' + xmlEscape(post.imageAlt || post.title) + '" width="1600" height="1000" loading="eager"></div>' : "") + '<div class="journal-entry-body">' + (post.bodyHtml || "<p>" + xmlEscape(post.excerpt || "") + "</p>") + "</div>");
    } else {
      html = content(html, "journalList", posts.map(post => '<a class="journal-row" href="/journal/' + encodeURIComponent(post.slug) + '/"><div class="journal-row-text"><h2 class="journal-row-title">' + xmlEscape(post.title) + '</h2><p class="journal-row-excerpt">' + xmlEscape(post.excerpt || "") + "</p></div></a>").join(""));
      html = hidden(html, "journalList", !posts.length);
      html = hidden(html, "journalEmpty", Boolean(posts.length));
    }
  } else if (page.key === "sell") html = html.replace("<body>", '<body class="sell-active">');
  html = html.replace(/(<li aria-label="Visa"[^>]*><svg) /, '$1 style="width:34px;height:16px;max-width:34px;max-height:16px" ');
  return html + application;
}
export function unavailableDocument(status) {
  const temporary = status === 503;
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + (temporary ? "Temporarily unavailable" : "Page not found") + ' | Stapleford Watches</title></head><body><main><h1>' + (temporary ? "Please try again shortly." : "This page could not be found.") + '</h1><p><a href="/buy/">Browse our watches</a> or <a href="/contact/">contact Stapleford Watches</a>.</p></main></body></html>';
}

