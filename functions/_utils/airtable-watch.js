function clean(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function field(fields, names) {
  for (const name of names) {
    const value = fields[name];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function formulaString(value) {
  return `"${String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

async function airtableJson(url, token) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`Could not load watch from Airtable: ${text}`);
    error.status = response.status;
    throw error;
  }
  return text ? JSON.parse(text) : {};
}

export function parsePriceToPence(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value * 100);
  }

  const cleaned = String(value || "").replace(/[^0-9.]/g, "");
  const pounds = Number(cleaned);

  if (!Number.isFinite(pounds) || pounds <= 0) return 0;
  return Math.round(pounds * 100);
}

export async function findWatchByListingId(env, listingId) {
  const token = env.AIRTABLE_TOKEN || env.AIRTABLE_API_KEY;
  const baseId = env.AIRTABLE_BASE_ID;
  const table = env.AIRTABLE_TABLE_NAME || "Watches";
  const view = env.AIRTABLE_VIEW || "Grid view";

  if (!token || !baseId) {
    throw new Error("Missing Airtable settings");
  }

  const wanted = normalize(listingId);
  if (!wanted) return null;

  const tableUrl = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`;
  let records = [];

  if (/^rec[a-z0-9]+$/i.test(clean(listingId))) {
    const record = await airtableJson(`${tableUrl}/${encodeURIComponent(clean(listingId))}`, token);
    records = record?.id ? [record] : [];
  } else {
    const url = new URL(tableUrl);
    url.searchParams.set("maxRecords", "1");
    url.searchParams.set("pageSize", "1");
    url.searchParams.set("filterByFormula", `LOWER({SKU})=LOWER(${formulaString(listingId)})`);
    if (view) url.searchParams.set("view", view);
    const data = await airtableJson(url, token);
    records = data.records || [];
  }

  const record = records.find((item) => {
    const fields = item.fields || {};
    const possibleIds = [
      item.id,
      field(fields, [
        "SKU",
        "Sku",
        "sku",
        "Stock Number",
        "Stock No",
        "Stock ID",
        "Cloudinary Folder",
        "Folder",
        "Image Folder",
      ]),
    ];

    return possibleIds.some((value) => normalize(value) === wanted);
  });

  if (!record) return null;

  const fields = record.fields || {};
  const sku = clean(field(fields, [
    "SKU",
    "Sku",
    "sku",
    "Stock Number",
    "Stock No",
    "Stock ID",
    "Cloudinary Folder",
    "Folder",
    "Image Folder",
  ]));

  const brand = clean(field(fields, ["Brand", "brand"]));
  const title = clean(field(fields, ["Title", "Model", "Watch", "Name", "model", "name"]));
  const status = clean(field(fields, ["Status", "status"])) || "Available";
  const price = field(fields, ["Price", "price"]);
  const pricePence = parsePriceToPence(price);

  return {
    airtableId: record.id,
    listingId: sku || record.id,
    brand,
    title,
    status,
    price,
    pricePence,
    name: [brand, title].filter(Boolean).join(" ") || sku || record.id,
  };
}
