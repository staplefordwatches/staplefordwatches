export async function onRequestGet(context) {
  const env = context.env;

  const AIRTABLE_TOKEN = env.AIRTABLE_TOKEN;
  const AIRTABLE_BASE_ID = env.AIRTABLE_BASE_ID;
  const AIRTABLE_TABLE_NAME = env.AIRTABLE_TABLE_NAME || "Watches";
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
      tableName: AIRTABLE_TABLE_NAME
    });

    const watches = records
      .map((record, index) => normaliseWatch(record, CLOUDINARY_CLOUD_NAME, index))
      .filter(Boolean)
      .sort(sortNewestAvailableThenNewestSold);

    return Response.json(
      {
        watches,
        count: watches.length,
        source: "airtable-cloudinary-sw-sku"
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

async function getAirtableRecords({ token, baseId, tableName }) {
  const records = [];
  let offset = "";

  do {
    const params = new URLSearchParams();
    params.set("pageSize", "100");

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

function normaliseWatch(record, cloudName, index) {
  const fields = record.fields || {};

  const sku = clean(pick(fields, ["SKU", "Sku"]));

  if (!sku) return null;

  const rawStatus = clean(pick(fields, ["Status", "Availability"]) || "available").toLowerCase();
  const status = normaliseStatus(rawStatus);

  const imageCount = toNumber(
    pick(fields, ["Image Count", "Images Count", "Photo Count", "Photos", "ImageCount"]),
    1
  );

  const brand = clean(pick(fields, ["Brand", "Make"]));
  const title = clean(pick(fields, ["Title", "Model", "Watch", "Watch Title", "Name"]));

  const sellingPrice = normalisePrice(
    pick(fields, [
      "Price",
      "Selling Price",
      "Sale Price",
      "Website Price",
      "Asking Price",
      "Retail Price",
      "Price GBP",
      "Price (£)"
    ])
  );

  const createdTime = record.createdTime || "";
  const createdAt = Date.parse(createdTime) || 0;

  return {
    listingId: sku,
    id: sku,
    sku,

    brand,
    title,

    price: sellingPrice,
    status,

    image: buildCardImageUrl(cloudName, sku),
    gallery: buildGalleryUrls(cloudName, sku, imageCount),

    description: clean(
      pick(fields, ["Description", "Watch Description", "Long Description", "Notes"])
    ),

    createdTime,
    createdAt,
    sortOrder: index + 1,

    specs: {
      reference: clean(pick(fields, ["Reference", "Ref", "Reference Number"])),
      year: clean(pick(fields, ["Year", "Watch Year"])),
      caseSize: clean(pick(fields, ["Case Size", "Case", "Size"])),
      condition: clean(pick(fields, ["Condition"])),
      contents: clean(pick(fields, ["Contents", "Box/Papers", "Box & Papers", "Set"])),
      listingId: sku
    }
  };
}

function sortNewestAvailableThenNewestSold(a, b) {
  const aSoldGroup = isSoldGroup(a.status) ? 1 : 0;
  const bSoldGroup = isSoldGroup(b.status) ? 1 : 0;

  if (aSoldGroup !== bSoldGroup) return aSoldGroup - bSoldGroup;

  const aTime = Number(a.createdAt || 0);
  const bTime = Number(b.createdAt || 0);
  if (aTime !== bTime) return bTime - aTime;

  return String(b.listingId || "").localeCompare(String(a.listingId || ""));
}

function isSoldGroup(status) {
  return ["sold", "reserved"].includes(String(status || "").toLowerCase());
}

function normaliseStatus(status) {
  const cleanStatus = String(status || "available").toLowerCase().trim();

  if (["sold", "sale agreed", "completed"].includes(cleanStatus)) return "sold";
  if (["reserved", "reserve", "on hold", "hold", "resolved"].includes(cleanStatus)) return "reserved";
  return "available";
}

function buildCardImageUrl(cloudName, sku) {
  const publicId = `watches/${sku}/01`;
  const transform = "f_auto,q_auto,dpr_auto,w_900,h_1125,c_fill,g_auto";
  return cloudinaryUrl(cloudName, publicId, transform);
}

function buildGalleryUrls(cloudName, sku, imageCount) {
  const count = Math.max(1, Math.min(toNumber(imageCount, 1), 30));

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

function pick(source, names) {
  if (!source || typeof source !== "object") return "";

  for (const name of names) {
    if (source[name] !== undefined && source[name] !== null && String(source[name]).trim() !== "") {
      return source[name];
    }
  }

  const normalised = {};
  for (const [key, value] of Object.entries(source)) {
    normalised[normaliseKey(key)] = value;
  }

  for (const name of names) {
    const value = normalised[normaliseKey(name)];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }

  return "";
}

function normaliseKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalisePrice(value) {
  if (value === undefined || value === null || value === "") return 0;

  if (typeof value === "number") return value;

  const cleaned = String(value).replace(/[£,\s]/g, "");
  const number = Number(cleaned);

  return Number.isFinite(number) ? number : 0;
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clean(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}
