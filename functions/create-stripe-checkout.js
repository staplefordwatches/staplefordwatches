function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
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

function normaliseStatus(fields) {
  const raw = clean(fields["Listing Status"] || fields["Status"]).toLowerCase();
  const stock = Number(fields["Stock Quantity"] ?? 1);
  if (raw === "hidden") return "hidden";
  if (raw === "sold" || stock <= 0) return "sold";
  return "available";
}

function normaliseWatch(record) {
  const fields = record.fields || {};
  const listingId = clean(fields["Listing ID"] || fields["SKU"] || record.id);
  const brand = clean(fields["Brand"]);
  const model = clean(fields["Model"] || fields["Title"] || fields["Name"]);
  return {
    airtableRecordId: record.id,
    listingId,
    name: `${brand} ${model}`.trim() || listingId,
    price: moneyToNumber(fields["Selling Price"] || fields["Price"]),
    status: normaliseStatus(fields)
  };
}

async function fetchAirtableRecords(env) {
  const url = new URL(`https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(env.AIRTABLE_TABLE_NAME)}`);
  url.searchParams.set("pageSize", "100");
  if (env.AIRTABLE_VIEW_NAME) url.searchParams.set("view", env.AIRTABLE_VIEW_NAME);

  const records = [];
  let offset;
  do {
    if (offset) url.searchParams.set("offset", offset);
    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` }
    });
    const data = await response.json();
    if (!response.ok) {
      console.error(data);
      throw new Error("Could not check Airtable inventory.");
    }
    records.push(...(data.records || []));
    offset = data.offset;
  } while (offset);
  return records;
}

const SHIPPING_COUNTRIES = {
  uk: ["GB"],
  europe: ["BE", "DK", "FI", "FR", "DE", "IE", "IT", "NL", "NO", "PL", "PT", "ES", "SE", "CH"],
  world: ["AU", "CA", "HK", "IL", "JP", "NZ", "SG", "AE", "US"]
};

function getShippingRateId(env, deliveryRegion) {
  const rateIds = {
    uk: clean(env.STRIPE_UK_SHIPPING_RATE_ID) || "shr_1ToB0DA6uuNWF6Hy69rWm3w0",
    europe: clean(env.STRIPE_EUROPE_SHIPPING_RATE_ID) || "shr_1ToB32A6uuNWF6HynifT8qAX",
    world: clean(env.STRIPE_WORLD_SHIPPING_RATE_ID) || "shr_1ToB48A6uuNWF6Hy9lrugs1w"
  };
  return rateIds[deliveryRegion] || "";
}

function normaliseDeliveryRegion(value) {
  const region = clean(value || "uk").toLowerCase();
  if (["uk", "gb", "united kingdom"].includes(region)) return "uk";
  if (["eu", "europe", "european"].includes(region)) return "europe";
  if (["world", "rest-of-world", "rest_of_world", "international", "row"].includes(region)) return "world";
  if (["collection", "collect", "pickup", "pick-up"].includes(region)) return "collection";
  return "";
}

function applyDeliverySettings(params, env, deliveryRegion) {
  params.set("metadata[delivery_region]", deliveryRegion);

  if (deliveryRegion === "collection") {
    params.set("metadata[fulfilment_method]", "collection");
    return;
  }

  const countries = SHIPPING_COUNTRIES[deliveryRegion];
  const shippingRateId = getShippingRateId(env, deliveryRegion);

  if (!countries || !shippingRateId) {
    throw new Error("Delivery option is not available.");
  }

  countries.forEach((country, index) => {
    params.set(`shipping_address_collection[allowed_countries][${index}]`, country);
  });

  params.set("shipping_options[0][shipping_rate]", shippingRateId);
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.STRIPE_SECRET_KEY) return json({ error: "Missing Stripe secret key." }, 500);
    if (!env.AIRTABLE_TOKEN || !env.AIRTABLE_BASE_ID || !env.AIRTABLE_TABLE_NAME) {
      return json({ error: "Missing Airtable settings." }, 500);
    }

    const body = await request.json();
    const items = Array.isArray(body.items) ? body.items : [];
    const requestedIds = [...new Set(items.map(item => clean(item.id)).filter(Boolean))];
    const deliveryRegion = normaliseDeliveryRegion(body.deliveryRegion || body.fulfilment || body.shippingRegion);

    if (!requestedIds.length) return json({ error: "Your cart is empty." }, 400);
    if (!deliveryRegion) return json({ error: "Please choose a valid delivery option." }, 400);

    const records = await fetchAirtableRecords(env);
    const watches = records.map(normaliseWatch);
    const selected = requestedIds.map(id => {
      const watch = watches.find(w => w.listingId === id);
      if (!watch) throw new Error(`Listing not found: ${id}`);
      if (watch.status !== "available") throw new Error(`${watch.name} is no longer available.`);
      if (!watch.price || watch.price <= 0) throw new Error(`${watch.name} is missing a valid price.`);
      return watch;
    });

    const siteUrl = (env.SITE_URL || "https://staplefordwatches.co.uk").replace(/\/$/, "");
    const params = new URLSearchParams();

    params.set("mode", "payment");
    params.set("success_url", `${siteUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`);
    params.set("cancel_url", `${siteUrl}/`);
    params.set("billing_address_collection", "required");
    params.set("automatic_tax[enabled]", "true");
    params.set("consent_collection[terms_of_service]", "required");
    params.set("metadata[listing_ids]", selected.map(w => w.listingId).join(","));
    params.set("metadata[airtable_record_ids]", selected.map(w => w.airtableRecordId).join(","));
    applyDeliverySettings(params, env, deliveryRegion);

    selected.forEach((watch, index) => {
      params.set(`line_items[${index}][quantity]`, "1");
      params.set(`line_items[${index}][price_data][currency]`, "gbp");
      params.set(`line_items[${index}][price_data][unit_amount]`, String(Math.round(watch.price * 100)));
      params.set(`line_items[${index}][price_data][product_data][name]`, watch.name);
      params.set(`line_items[${index}][price_data][product_data][metadata][listing_id]`, watch.listingId);
      params.set(`line_items[${index}][price_data][product_data][metadata][airtable_record_id]`, watch.airtableRecordId);
    });

    const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params
    });

    const session = await stripeResponse.json();
    if (!stripeResponse.ok) {
      console.error(session);
      return json({ error: "Checkout unavailable." }, 500);
    }

    return json({ checkoutUrl: session.url });
  } catch (error) {
    console.error(error);
    return json({ error: error.message || "Checkout unavailable." }, 400);
  }
}
