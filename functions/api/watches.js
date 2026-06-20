export async function onRequestGet(context) {
  const env = context.env;

  const AIRTABLE_TOKEN = env.AIRTABLE_TOKEN;
  const AIRTABLE_BASE_ID = env.AIRTABLE_BASE_ID;
  const AIRTABLE_TABLE_NAME = env.AIRTABLE_TABLE_NAME || "Watches";
  const CLOUDINARY_CLOUD_NAME = env.CLOUDINARY_CLOUD_NAME;

  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID || !CLOUDINARY_CLOUD_NAME) {
    return Response.json(
      { error: "Missing required environment variables." },
      { status: 500 }
    );
  }

  try {
    const records = await getAirtableRecords({
      token: AIRTABLE_TOKEN,
      baseId: AIRTABLE_BASE_ID,
      tableName: AIRTABLE_TABLE_NAME
    });

    const watches = records
      .map(record => normaliseWatch(record.fields, CLOUDINARY_CLOUD_NAME))
      .filter(Boolean)
      .sort((a, b) => Number(a.sortOrder || 9999) - Number(b.sortOrder || 9999));

    return Response.json(
      { watches },
      {
        headers: {
          "Cache-Control": "public, max-age=300, s-maxage=300"
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

async function getAirtableRecords({ token, baseId, tableName }) {
  const records = [];
  let offset = "";

  do {
    const params = new URLSearchParams();
    params.set("pageSize", "100");

    // This assumes Published is a checkbox field.
    // If your Published field is text instead of a checkbox, change this formula.
    params.set("filterByFormula", "{Published}=TRUE()");

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
  const listingId = clean(fields["Listing ID"] || fields["SKU"] || fields["Sku"]);
  const cloudinaryFolder = clean(
    fields["Cloudinary Folder"] ||
    fields["SKU"] ||
    fields["Sku"] ||
    listingId
  );

  if (!listingId || !cloudinaryFolder) return null;

  const imageCount = Number(fields["Image Count"] || 1);

  return {
    listingId,
    id: listingId,

    brand: clean(fields["Brand"]),
    title: clean(fields["Title"] || fields["Model"]),

    price: Number(fields["Price"] || 0),
    status: clean(fields["Status"] || "available").toLowerCase(),

    image: buildCardImageUrl(cloudName, cloudinaryFolder),
    gallery: buildGalleryUrls(cloudName, cloudinaryFolder, imageCount),

    description: clean(fields["Description"]),
    sortOrder: Number(fields["Sort Order"] || 9999),

    specs: {
      reference: clean(fields["Reference"]),
      year: clean(fields["Year"]),
      caseSize: clean(fields["Case Size"]),
      condition: clean(fields["Condition"]),
      contents: clean(fields["Contents"]),
      listingId
    }
  };
}

function buildCardImageUrl(cloudName, folder) {
  const publicId = `watches/${folder}/01`;
  const transform = "f_auto,q_auto,dpr_auto,w_900,h_1125,c_fill,g_auto";

  return cloudinaryUrl(cloudName, publicId, transform);
}

function buildGalleryUrls(cloudName, folder, imageCount) {
  const count = Math.max(1, Math.min(Number(imageCount || 1), 30));

  return Array.from({ length: count }, (_, index) => {
    const number = String(index + 1).padStart(2, "0");
    const publicId = `watches/${folder}/${number}`;
    const transform = "f_auto,q_auto,dpr_auto,w_1800,c_limit";

    return cloudinaryUrl(cloudName, publicId, transform);
  });
}

function cloudinaryUrl(cloudName, publicId, transform) {
  return `https://res.cloudinary.com/${cloudName}/image/upload/${transform}/${publicId}`;
}

function clean(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}
