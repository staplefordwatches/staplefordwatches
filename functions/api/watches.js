function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}

function clean(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function moneyToNumber(value) {
  if (typeof value === "number") return value;
  const cleaned = clean(value).replace(/[^0-9.]/g, "");
  return cleaned ? Number(cleaned) : 0;
}

function attachmentUrls(value) {
  if (!Array.isArray(value)) return [];
  return value.map(file => file?.url).filter(Boolean);
}

function normaliseStatus(fields) {
  const raw = clean(fields["Listing Status"] || fields["Status"]).toLowerCase();
  const stock = Number(fields["Stock Quantity"] ?? 1);
  if (raw === "hidden") return "hidden";
  if (raw === "sold" || stock <= 0) return "sold";
  if (raw === "reserved") return "reserved";
  return "available";
}

function normaliseWatch(record) {
  const fields = record.fields || {};

  // Key Photo is the single main image for the product listing card.
  // Product Photos and Gallery Photos are extra images for the click-open product/gallery view.
  const keyPhotos = attachmentUrls(fields["Key Photo"] || fields["Key photo"] || fields["Main Photo"] || fields["Main Image"]);
  const productPhotos = attachmentUrls(fields["Product Photos"]);
  const galleryPhotos = attachmentUrls(fields["Gallery Photos"]);

  const mainImage = keyPhotos[0] || productPhotos[0] || galleryPhotos[0] || "";
  const gallery = [...keyPhotos, ...productPhotos, ...galleryPhotos].filter((url, index, arr) => url && arr.indexOf(url) === index);

  const id = clean(fields["Listing ID"] || fields["SKU"] || record.id);
  const brand = clean(fields["Brand"]).toUpperCase();
  const model = clean(fields["Model"] || fields["Title"] || fields["Name"]);

  return {
    airtableRecordId: record.id,
    id,
    listingId: id,
    sku: clean(fields["SKU"]),
    brand,
    title: model,
    price: moneyToNumber(fields["Selling Price"] || fields["Price"]),
    status: normaliseStatus(fields),
    image: mainImage,
    gallery,
    specs: {
      reference: clean(fields["Reference"] || fields["SKU"]),
      year: clean(fields["Year"]),
      caseSize: clean(fields["Case Size"]),
      condition: clean(fields["Condition"]),
      contents: clean(fields["Contents"])
    },
    specifications: clean(fields["Specifications"]),
    description: clean(fields["Watch Description"] || fields["Description"]),
    featured: Boolean(fields["Featured"]),
    stockQuantity: Number(fields["Stock Quantity"] ?? 1)
  };
}

async function fetchAirtable(env) {
  const baseId = env.AIRTABLE_BASE_ID;
  const tableName = env.AIRTABLE_TABLE_NAME;
  const token = env.AIRTABLE_TOKEN;

  if (!baseId || !tableName || !token) {
    throw new Error("Missing Airtable environment variables.");
  }

  const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`);
  url.searchParams.set("pageSize", "100");
  if (env.AIRTABLE_VIEW_NAME) url.searchParams.set("view", env.AIRTABLE_VIEW_NAME);

  const records = [];
  let offset;

  do {
    if (offset) url.searchParams.set("offset", offset);
    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` }
    });

    const data = await response.json();
    if (!response.ok) {
      console.error(data);
      throw new Error("Airtable request failed.");
    }

    records.push(...(data.records || []));
    offset = data.offset;
  } while (offset);

  return records;
}

export async function onRequestGet({ env }) {
  try {
    const records = await fetchAirtable(env);
    const watches = records
      .map(normaliseWatch)
      // Show Available, Sold and Reserved. Only Hidden is removed.
      // A sold watch will still appear on the main listing page if it has a Key Photo/main image.
      .filter(watch => watch.status !== "hidden" && watch.image)
      .sort((a, b) => Number(b.featured) - Number(a.featured));

    return json({ watches });
  } catch (error) {
    console.error(error);
    return json({ error: error.message || "Could not load watches." }, 500);
  }
}
