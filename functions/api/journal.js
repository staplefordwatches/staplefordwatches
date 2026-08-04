function clean(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function getField(fields, names) {
  for (const name of names) {
    const value = fields[name];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
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

export async function onRequest(context) {
  try {
    const env = context.env || {};
    const token = env.AIRTABLE_TOKEN || env.AIRTABLE_API_KEY;
    const baseId = env.AIRTABLE_BASE_ID;
    const table = env.AIRTABLE_JOURNAL_TABLE_NAME || "Journal";
    const view = env.AIRTABLE_JOURNAL_VIEW || "";
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
        const content = clean(getField(fields, ["Content", "Main Article Text", "Article", "Body"]));
        const imageFolder = clean(getField(fields, ["Image Folder", "Cloudinary Folder", "Folder"]));
        const rawImageCount = getField(fields, ["Image Count", "Images", "Photo Count"]);
        const imageCount = Math.max(0, Number(rawImageCount || (imageFolder ? 1 : 0)) || 0);
        const status = clean(getField(fields, ["Status", "status"]));
        const slug = slugify(title);

        const images = Array.from({ length: imageCount }, (_, imageIndex) =>
          cloudinaryUrl(cloudName, "f_auto,q_auto,w_2000", imageFolder, imageIndex + 1)
        ).filter(Boolean);

        return {
          id: record.id,
          title,
          slug,
          subtitle,
          category: category || "Journal",
          author: author || "Stapleford Watches",
          publishedDate,
          updatedDate,
          content,
          imageFolder,
          imageCount,
          status,
          image: images[0] || "",
          heroImage: images[0] || "",
          cardImage: imageFolder
            ? cloudinaryUrl(cloudName, "f_auto,q_auto,c_fill,g_auto,w_1000,h_1250", imageFolder, 1)
            : "",
          images,
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

    return Response.json(
      { ok: true, count: posts.length, posts, items: posts, data: posts },
      {
        headers: {
          "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=86400",
        },
      }
    );
  } catch (error) {
    return Response.json(
      { ok: false, error: "Could not load Journal", detail: error.message },
      { status: 500 }
    );
  }
}
