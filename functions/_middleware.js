const SITE_ORIGIN = "https://staplefordwatches.co.uk";

export function humanizeSlug(value, { product = false } = {}) {
  let slug = decodeURIComponent(value || "").replace(/-+$/g, "");
  if (product) slug = slug.replace(/-(?:sw\d+|rec[a-z0-9]+)$/i, "");
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) => word.length <= 3 && /^(gmt|utc|ii|iii|iv)$/i.test(word)
      ? word.toUpperCase()
      : word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

class ContentHandler {
  constructor(value) { this.value = value; }
  element(element) { element.setInnerContent(this.value); }
}

class AttributeHandler {
  constructor(name, value) { this.name = name; this.value = value; }
  element(element) { element.setAttribute(this.name, this.value); }
}

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const productMatch = url.pathname.match(/^\/watches\/([^/]+)\/?$/i);
  const articleMatch = url.pathname.match(/^\/journal\/([^/]+)\/?$/i);
  if (!productMatch && !articleMatch) return context.next();

  const response = await context.next();
  if (!response.headers.get("Content-Type")?.includes("text/html")) return response;

  const isProduct = Boolean(productMatch);
  const name = humanizeSlug((productMatch || articleMatch)[1], { product: isProduct });
  const canonical = `${SITE_ORIGIN}${url.pathname.replace(/\/+$/, "")}/`;
  const title = `${name || (isProduct ? "Pre-Owned Watch" : "Journal")} | Stapleford Watches`;
  const description = isProduct
    ? `View the pre-owned ${name} from Stapleford Watches, with insured delivery and a 14-day eligible online return window.`
    : `${name} — an article from the Stapleford Watches journal.`;

  return new HTMLRewriter()
    .on("title", new ContentHandler(title))
    .on('link[rel="canonical"]', new AttributeHandler("href", canonical))
    .on('meta[name="description"]', new AttributeHandler("content", description))
    .on('meta[property="og:type"]', new AttributeHandler("content", isProduct ? "product" : "article"))
    .on('meta[property="og:title"]', new AttributeHandler("content", title))
    .on('meta[property="og:description"]', new AttributeHandler("content", description))
    .on('meta[property="og:url"]', new AttributeHandler("content", canonical))
    .transform(response);
}
