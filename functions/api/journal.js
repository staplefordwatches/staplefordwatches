import { withDataCache } from "../_utils/data-cache.js";
import { AIRTABLE_CATALOGS, ensureAirtableWebhook } from "../_utils/airtable-webhooks.js";

function clean(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function hasValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value === undefined || value === null) return false;
  return String(value).trim() !== "";
}

function getRawField(fields, names) {
  for (const name of names) {
    const value = fields[name];
    if (hasValue(value)) return value;
  }
  return "";
}

function getField(fields, names) {
  return clean(getRawField(fields, names));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character]);
}

function safeImageUrl(value) {
  try {
    const url = new URL(clean(value));
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

export function attachmentImages(value) {
  if (!Array.isArray(value)) return [];
  return value.map((attachment, index) => {
    const url = safeImageUrl(attachment?.url);
    if (!url) return null;
    const filename = clean(attachment?.filename);
    const alt = filename
      .replace(/\.[a-z0-9]{2,5}$/i, "")
      .replace(/[-_]+/g, " ")
      .trim();
    return {
      url,
      alt,
      filename,
      width: Number(attachment?.width) || 0,
      height: Number(attachment?.height) || 0,
      position: index + 1,
    };
  }).filter(Boolean);
}

function inlineMarkup(value) {
  return escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|\s)_(.+?)_(?=\s|$|[.,!?;:])/g, "$1<em>$2</em>");
}

function figureHtml(image, caption = "") {
  if (!image?.url) return "";
  const finalCaption = clean(caption);
  const alt = finalCaption || image.alt || "Journal image";
  const dimensions = image.width && image.height
    ? ` width="${image.width}" height="${image.height}"`
    : "";
  return `<figure class="journal-body-image"><img src="${escapeHtml(image.url)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async"${dimensions}>${finalCaption ? `<figcaption>${inlineMarkup(finalCaption)}</figcaption>` : ""}</figure>`;
}

export function renderJournalBody(content, images = []) {
  const lines = String(content || "").replace(/\r\n?/g, "\n").split("\n");
  const output = [];
  const usedImages = new Set();
  let listType = "";
  let listItems = [];

  const flushList = () => {
    if (!listItems.length || !listType) return;
    output.push(`<${listType}>${listItems.map((item) => `<li>${inlineMarkup(item)}</li>`).join("")}</${listType}>`);
    listType = "";
    listItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      continue;
    }

    const imageMarker = line.match(/^\[\[image\s*:\s*(\d+)(?:\s*\|\s*(.+?))?\]\]$/i);
    if (imageMarker) {
      flushList();
      const imageIndex = Number(imageMarker[1]) - 1;
      const image = images[imageIndex];
      if (image) {
        output.push(figureHtml(image, imageMarker[2] || ""));
        usedImages.add(imageIndex);
      }
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushList();
      const level = heading[1].length >= 3 ? 3 : 2;
      output.push(`<h${level}>${inlineMarkup(heading[2])}</h${level}>`);
      continue;
    }

    const bullet = line.match(/^[-*]\s+(.+)$/);
    const numbered = line.match(/^\d+[.)]\s+(.+)$/);
    if (bullet || numbered) {
      const nextType = bullet ? "ul" : "ol";
      if (listType && listType !== nextType) flushList();
      listType = nextType;
      listItems.push((bullet || numbered)[1]);
      continue;
    }

    const quote = line.match(/^>\s+(.+)$/);
    if (quote) {
      flushList();
      output.push(`<blockquote>${inlineMarkup(quote[1])}</blockquote>`);
      continue;
    }

    flushList();
    output.push(`<p>${inlineMarkup(line)}</p>`);
  }

  flushList();
  images.forEach((image, index) => {
    if (!usedImages.has(index)) output.push(figureHtml(image));
  });
  return output.join("");
}

function plainText(value) {
  return clean(value)
    .replace(/^\[\[image[^\]]*\]\]$/gim, "")
    .replace(/^#{1,3}\s+/gm, "")
    .replace(/^[-*>]\s+/gm, "")
    .replace(/^\d+[.)]\s+/gm, "")
    .replace(/[\*_]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function excerptFrom(value, limit = 190) {
  const text = plainText(value);
  if (text.length <= limit) return text;
  return `${text.slice(0, limit).replace(/\s+\S*$/, "")}…`;
}

function dateDisplay(value) {
  if (!value) return "";
  const date = new Date(String(value).length === 10 ? `${value}T12:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return clean(value);
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/London",
  }).format(date);
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || "journal-entry";
}

function folderPath(value) {
  return clean(value)
    .replace(/^journal\//i, "")
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
}

function cloudinaryUrl(cloudName, transformation, folder, number) {
  const path = folderPath(folder);
  if (!cloudName || !path) return "";
  const file = String(number).padStart(2, "0");
  return `https://res.cloudinary.com/${encodeURIComponent(cloudName)}/image/upload/${transformation}/journal/${path}/${file}`;
}

async function loadAllRecords({ token, baseId, table, view }) {
  const records = [];
  let offset = "";

  do {
    const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`);
    url.searchParams.set("pageSize", "100");
    if (view) url.searchParams.set("view", view);
    if (offset) url.searchParams.set("offset", offset);

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const text = await response.text();

    if (!response.ok) {
      throw new Error(`Could not load Journal from Airtable: ${text}`);
    }

    const data = JSON.parse(text);
    records.push(...(data.records || []));
    offset = data.offset || "";
  } while (offset);

  return records;
}

export async function loadJournal(context) {
  try {
    const env = context.env || {};
    const token = env.AIRTABLE_TOKEN || env.AIRTABLE_API_KEY;
    const baseId = env.AIRTABLE_BASE_ID;
    const table = env.AIRTABLE_JOURNAL_TABLE_NAME || "Journal";
    // Publication is controlled by the Status field. An old or filtered
    // Airtable view must not hide otherwise-published Journal records.
    const view = "";
    const cloudName = env.CLOUDINARY_CLOUD_NAME || "dvm4pgghh";

    if (!token || !baseId) {
      return Response.json(
        { ok: false, error: "Missing Airtable settings" },
        { status: 500 }
      );
    }

    const records = await loadAllRecords({ token, baseId, table, view });

    const posts = records
      .map((record, index) => {
        const fields = record.fields || {};
        const title = clean(getField(fields, ["Title", "title", "Name"]));
        const subtitle = clean(getField(fields, ["Subtitle", "Sub Title", "Standfirst", "Summary"]));
        const category = clean(getField(fields, ["Category", "Type", "category"]));
        const author = clean(getField(fields, ["Author", "Written By", "By"]));
        const publishedDate = clean(getField(fields, ["Published Date", "Publication Date", "Date", "Published"]));
        const updatedDate = clean(getField(fields, ["Updated Date", "Last Updated"]));
        const content = getField(fields, ["Content", "Main Article Text", "Article", "Body"]);
        const excerpt = getField(fields, ["Excerpt", "Deck", "Summary", "Subtitle", "Standfirst"]);
        const imageFolder = clean(getField(fields, ["Image Folder", "Cloudinary Folder", "Folder"]));
        const rawImageCount = getField(fields, ["Image Count", "Photo Count"]);
        const imageCount = Math.max(0, Number(rawImageCount || (imageFolder ? 1 : 0)) || 0);
        const status = clean(getField(fields, ["Status", "status"]));
        const slug = slugify(title);

        const cloudinaryImages = Array.from({ length: imageCount }, (_, imageIndex) =>
          cloudinaryUrl(cloudName, "f_auto,q_auto,w_2000", imageFolder, imageIndex + 1)
        ).filter(Boolean).map((url, imageIndex) => ({
          url,
          alt: `${title} — image ${imageIndex + 1}`,
          filename: "",
          width: 0,
          height: 0,
          position: imageIndex + 1,
        }));
        const coverAttachments = attachmentImages(getRawField(fields, ["Cover Image", "Hero Image", "Featured Image"]));
        const inlineAttachments = attachmentImages(getRawField(fields, ["Images", "Article Images", "Gallery"]));
        const coverImage = coverAttachments[0] || inlineAttachments[0] || cloudinaryImages[0] || null;
        const articleImages = coverAttachments.length
          ? (inlineAttachments.length ? inlineAttachments : cloudinaryImages.slice(1))
          : (inlineAttachments.length ? inlineAttachments.slice(1) : cloudinaryImages.slice(1));
        const bodyHtml = renderJournalBody(content, articleImages);
        const readMinutes = Math.max(1, Math.ceil(plainText(content).split(/\s+/).filter(Boolean).length / 220));
        const finalExcerpt = excerpt || subtitle || excerptFrom(content);

        return {
          id: record.id,
          title,
          slug,
          subtitle,
          category: category || "Journal",
          author: author || "Stapleford Watches",
          publishedDate,
          dateDisplay: dateDisplay(publishedDate),
          updatedDate,
          content,
          bodyHtml,
          excerpt: finalExcerpt,
          readMinutes,
          imageFolder,
          imageCount: articleImages.length + (coverImage ? 1 : 0),
          status,
          image: coverImage?.url || "",
          imageAlt: coverImage?.alt || title,
          heroImage: coverImage?.url || "",
          cardImage: coverImage?.url || (imageFolder
            ? cloudinaryUrl(cloudName, "f_auto,q_auto,c_fill,g_auto,w_1000,h_1250", imageFolder, 1)
            : ""),
          images: articleImages.map((image) => image.url),
          _airtableEntryOrder: index,
        };
      })
      .filter((post) => post.title && post.status.toLowerCase() === "published")
      .sort((a, b) => {
        const aTime = Date.parse(a.publishedDate || "") || 0;
        const bTime = Date.parse(b.publishedDate || "") || 0;
        if (aTime !== bTime) return bTime - aTime;
        return a._airtableEntryOrder - b._airtableEntryOrder;
      });

    return Response.json({ ok: true, count: posts.length, posts });
  } catch (error) {
    return Response.json(
      { ok: false, error: "Could not load Journal", detail: error.message },
      { status: 500 }
    );
  }
}

export async function onRequest(context) {
  const response = await withDataCache(context, {
    key: "journal",
    freshSeconds: 15,
    browserSeconds: 0,
    blockingRefreshWhenStale: true,
    producer: () => loadJournal(context),
  });
  const cacheState = response.headers.get("X-Stapleford-Cache");
  if (["MISS", "STALE", "REFRESHED"].includes(cacheState)) {
    const maintenance = ensureAirtableWebhook(context, AIRTABLE_CATALOGS[1]);
    if (typeof context.waitUntil === "function") context.waitUntil(maintenance);
    else void maintenance;
  }
  return response;
}
