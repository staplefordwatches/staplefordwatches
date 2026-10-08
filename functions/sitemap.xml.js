import { onRequest as getJournal } from "./api/journal.js";
import { onRequest as getWatches } from "./api/watches.js";
import { SITE_ORIGIN, dateOnly, watchUrl, xmlEscape } from "./_utils/catalog-seo.js";

const STATIC_PATHS = [
  "/",
  "/buy/",
  "/sell/",
  "/contact/",
  "/delivery/",
  "/returns/",
  "/terms-and-conditions/",
  "/privacy-policy/",
  "/journal/",
];

function urlEntry(location, lastModified = "") {
  const lastmod = dateOnly(lastModified);
  return `  <url><loc>${xmlEscape(location)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`;
}

export function buildSitemap({ watches = [], posts = [] } = {}) {
  const entries = STATIC_PATHS.map((path) => ({ location: `${SITE_ORIGIN}${path}`, lastModified: "" }));
  watches.forEach((watch) => entries.push({ location: watchUrl(watch), lastModified: watch.dateAdded }));
  posts.forEach((post) => {
    if (!post?.slug) return;
    entries.push({
      location: `${SITE_ORIGIN}/journal/${encodeURIComponent(post.slug)}/`,
      lastModified: post.updatedDate || post.publishedDate,
    });
  });

  const unique = [...new Map(entries.map((entry) => [entry.location, entry])).values()]
    .sort((a, b) => a.location.localeCompare(b.location));
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${unique.map((entry) => urlEntry(entry.location, entry.lastModified)).join("\n")}
</urlset>`;
}

export async function onRequest(context) {
  const [watchResponse, journalResponse] = await Promise.all([
    getWatches(context),
    getJournal(context),
  ]);
  const watchPayload = watchResponse.ok ? await watchResponse.json() : { watches: [] };
  const journalPayload = journalResponse.ok ? await journalResponse.json() : { posts: [] };

  return new Response(buildSitemap({
    watches: watchPayload.watches || [],
    posts: journalPayload.posts || [],
  }), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
