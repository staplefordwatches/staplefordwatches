export async function onRequestGet(context) {
  const env = context.env;

  const AIRTABLE_TOKEN = env.AIRTABLE_TOKEN;
  const AIRTABLE_BASE_ID = env.AIRTABLE_BASE_ID;
  const AIRTABLE_TABLE_NAME = env.AIRTABLE_TABLE_NAME || "Watches";
  const AIRTABLE_VIEW_NAME = env.AIRTABLE_VIEW_NAME || "Website";
  const CLOUDINARY_CLOUD_NAME = env.CLOUDINARY_CLOUD_NAME;

  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID || !AIRTABLE_TABLE_NAME || !CLOUDINARY_CLOUD_NAME) {
    return Response.json(
      {
        error: "Missing environment variable",
        needed: [
          "AIRTABLE_TOKEN",
          "AIRTABLE_BASE_ID",
          "AIRTABLE_TABLE_NAME",
          "CLOUDINARY_CLOUD_NAME"
        ]
      },
      { status: 500 }
    );
  }

  try {
    const records = await getAirtableRecords({
      token: AIRTABLE_TOKEN,
      baseId: AIRTABLE_BASE_ID,
      tableName: AIRTABLE_TABLE_NAME,
      viewName: AIRTABLE_VIEW_NAME
    });

    const watches = records
      .map(record => normaliseWatch(record.fields, CLOUDINARY_CLOUD_NAME))
      .filter(Boolean)
      .filter(watch => watch.published !== false);

    return Response.json(
      {
        watches,
        count: watches.length,
        source: "airtable-cloudinary",
        view: AIRTABLE_VIEW_NAME
      },
      {
        headers: {
          "Cache-Control": "public, max-age=60, s-maxage=60"
        }
      }
    );
  } catch (error) {
    return Response.json(
      {
        error: "Could not load watches",
        detail: String(error.message || error)
      },
      { status: 500 }
    );
  }
}

async function getAirtableRecords({ token, baseId, tableName, viewName }) {
  const records = [];
  let offset = "";

  do {
    const params = new URLSearchParams();
    params.set("pageSize", "100");

    if (viewName) {
      params.set("view", viewName);
    }

    if (offset) {
      params.set("offset", offset);
    }

    const url =
      `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}?` +
      params.toString();

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Airtable error ${response.status}: ${text}`);
    }

    const data = await response.json();

    if (Array.isArray(data.records)) {
      records.push(...data.records);
    }

    offset = data.offset || "";
  } while (offset);

  return records;
}

function normaliseWatch(fields, cloudName) {
  const sku = clean(
    fields["SKU"] ||
    fields["Sku"] ||
    fields["Listing ID"] ||
    fields["Listing Id"] ||
    fields["ID"] ||
    fields["Id"]
  );

  if (!sku) return null;

  const imageCount = Number(
    fields["Image Count"] ||
    fields["Images Count"] ||
    fields["Photo Count"] ||
    fields["Photos"] ||
    1
  );

  const publishedValue = fields["Published"];
  const published =
    publishedValue === undefined ||
    publishedValue === null ||
    publishedValue === "" ||
    publishedValue === true ||
    String(publishedValue).toLowerCase() === "true" ||
    String(publishedValue).toLowerCase() === "yes" ||
    String(publishedValue).toLowerCase() === "live";

  const brand = clean(fields["Brand"]);
  const title = clean(fields["Title"] || fields["Model"] || fields["Watch"]);
  const status = clean(fields["Status"] || "available").toLowerCase();

  return {
    listingId: sku,
    id: sku,
    sku,

    brand,
    title,

    price: normalisePrice(fields["Price"]),
    status,

    image: buildCardImageUrl(cloudName, sku),
    gallery: buildGalleryUrls(cloudName, sku, imageCount),

    description: clean(fields["Description"] || fields["Watch Description"]),

    sortOrder: Number(fields["Sort Order"] || fields["Order"] || 9999),

    published,

    specs: {
      reference: clean(fields["Reference"] || fields["Ref"]),
      year: clean(fields["Year"]),
      caseSize: clean(fields["Case Size"] || fields["Case"]),
      condition: clean(fields["Condition"]),
      contents: clean(fields["Contents"] || fields["Box/Papers"] || fields["Box & Papers"]),
      listingId: sku
    }
  };
}

function buildCardImageUrl(cloudName, sku) {
  const publicId = `watches/${sku}/01`;
  const transform = "f_auto,q_auto,dpr_auto,w_900,h_1125,c_fill,g_auto";

  return cloudinaryUrl(cloudName, publicId, transform);
}

function buildGalleryUrls(cloudName, sku, imageCount) {
  const count = Math.max(1, Math.min(Number(imageCount || 1), 30));

  return Array.from({ length: count }, (_, index) => {
    const imageNumber = String(index + 1).padStart(2, "0");
    const publicId = `watches/${sku}/${imageNumber}`;
    const transform = "f_auto,q_auto,dpr_auto,w_1800,c_limit";

    return cloudinaryUrl(cloudName, publicId, transform);
  });
}

function cloudinaryUrl(cloudName, publicId, transform) {
  return `https://res.cloudinary.com/${cloudName}/image/upload/${transform}/${publicId}`;
}

function normalisePrice(value) {
  if (value === undefined || value === null || value === "") return 0;

  if (typeof value === "number") return value;

  const cleaned = String(value).replace(/[£,\s]/g, "");
  const number = Number(cleaned);

  return Number.isFinite(number) ? number : 0;
}

function clean(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}
