import { getCatalog } from "./api/watches.js";
import { onRequest as getJournal } from "./api/journal.js";
import { PAGE_SEO, ROUTE_ALIASES, pageModel, renderPageDocument, unavailableDocument } from "./_utils/page-rendering.js";

export function humanizeSlug(value, { product = false } = {}) {
  let slug = decodeURIComponent(value || "").replace(/-+$/g, "");
  if (product) slug = slug.replace(/-(?:sw\d+|rec[a-z0-9]+)$/i, "");
  return slug.split("-").filter(Boolean).map(word => word.length <= 3 && /^(gmt|utc|ii|iii|iv)$/i.test(word)
    ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

function errorResponse(status, head = false) {
  return new Response(head ? null : unavailableDocument(status), { status, headers: {
    "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
    ...(status === 503 ? { "Retry-After": "60" } : {}),
  } });
}

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const head = context.request.method === "HEAD";
  if (url.pathname.startsWith("/api/") || /\.[a-z0-9]+$/i.test(url.pathname) && url.pathname !== "/index.html") return context.next();
  if (!["GET", "HEAD"].includes(context.request.method)) return context.next();
  const path = url.pathname === "/" ? "/" : url.pathname.replace(/\/+$/, "") + "/";
  const alias = ROUTE_ALIASES[url.pathname] || ROUTE_ALIASES[path];
  if (alias || path !== url.pathname) {
    url.pathname = alias || path;
    return Response.redirect(url.href, 301);
  }
  const catalogue = ["/", "/buy/", "/search/"].includes(path) || /^\/(?:watches|brands)\/[^/]+\/$/.test(path);
  const journal = /^\/journal\//.test(path);
  if (!catalogue && !journal && !Object.values(PAGE_SEO).some(page => page.path === path)) return errorResponse(404, head);
  try {
    let watches = [], posts = [];
    if (catalogue) {
      const response = await getCatalog(context, { requireFresh: true });
      if (!response.ok) return errorResponse(503, head);
      watches = (await response.json()).watches || [];
    }
    if (journal) {
      const response = await getJournal(context, { requireFresh: true });
      if (!response.ok) return errorResponse(503, head);
      posts = (await response.json()).posts || [];
    }
    const page = pageModel(path, { watches, posts });
    if (!page) return errorResponse(404, head);
    if (new URL(page.canonical).pathname !== path) {
      url.pathname = new URL(page.canonical).pathname;
      return Response.redirect(url.href, 301);
    }
    const response = await context.next();
    if (!response.ok || !response.headers.get("Content-Type")?.includes("text/html")) return response;
    const html = renderPageDocument(await response.text(), page, { watches, posts });
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-store");
    headers.delete("Content-Length");
    headers.delete("ETag");
    headers.delete("Last-Modified");
    return new Response(context.request.method === "HEAD" ? null : html, { status: 200, headers });
  } catch (error) {
    console.error("Server page rendering failed:", error.message);
    return errorResponse(503, head);
  }
}

