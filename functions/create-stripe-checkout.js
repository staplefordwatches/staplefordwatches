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
  const cleaned = clean(value).replace(/,/g, "").replace(/[^0-9.]/g, "");
  return cleaned ? Number(cleaned) : 0;
}

function firstNonEmptyField(fields, names) {
  for (const name of names) {
    if (!name) continue;
    const value = fields[name];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return undefined;
}

function getField(fields, names) {
  return firstNonEmptyField(fields, names);
}

function normaliseStatus(fields, env) {
  const raw = clean(firstNonEmptyField(fields, [
    clean(env.AIRTABLE_STATUS_FIELD),
    "Listing Status",
    "Status",
    "status"
  ])).toLowerCase();

  const stockRaw = firstNonEmptyField(fields, [
    clean(env.AIRTABLE_STOCK_FIELD),
    "Stock Quantity",
    "Quantity",
    "Stock"
  ]);
  const stock = stockRaw === undefined ? null : Number(stockRaw);

  if (raw === "hidden") return "hidden";
  if (raw === "sold" || raw.includes("sold")) return "sold";
  if (raw === "reserved" || raw.includes("reserved")) return "reserved";
  if (stock !== null && Number.isFinite(stock) && stock <= 0) return "sold";
  return "available";
}

function normaliseWatch(record, env) {
  const fields = record.fields || {};
  const listingId = clean(getField(fields, ["Listing ID", "SKU", "Sku", "sku", "Stock Number", "Stock No", "Stock ID"])) || record.id;
  const brand = clean(getField(fields, ["Brand", "brand"]));
  const model = clean(getField(fields, ["Model", "Title", "Watch", "Name", "model", "name"]));
  return {
    airtableRecordId: record.id,
    listingId,
    name: `${brand} ${model}`.trim() || listingId,
    price: moneyToNumber(getField(fields, ["Selling Price", "Price", "price"])),
    status: normaliseStatus(fields, env)
  };
}

async function fetchAirtableRecords(env) {
  if (!env.AIRTABLE_TOKEN || !env.AIRTABLE_BASE_ID || !env.AIRTABLE_TABLE_NAME) {
    throw new Error("Missing Airtable settings.");
  }

  const url = new URL(`https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(env.AIRTABLE_TABLE_NAME)}`);
  url.searchParams.set("pageSize", "100");
  const view = clean(env.AIRTABLE_VIEW_NAME || env.AIRTABLE_VIEW);
  if (view) url.searchParams.set("view", view);

  const records = [];
  let offset = "";
  do {
    if (offset) url.searchParams.set("offset", offset);
    else url.searchParams.delete("offset");

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` }
    });

    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { error: text }; }

    if (!response.ok) {
      console.error(data);
      throw new Error("Could not check Airtable inventory.");
    }

    records.push(...(data.records || []));
    offset = data.offset || "";
  } while (offset);

  return records;
}

const EUROPE_COUNTRIES = [
  "AL","AD","AM","AT","AZ","BE","BA","BG","HR","CY","CZ","DK","EE","FI","FR","GE","DE","GI","GR","HU","IS","IE","IT","XK","LV","LI","LT","LU","MT","MD","MC","ME","NL","MK","NO","PL","PT","RO","SM","RS","SK","SI","ES","SE","CH","TR","UA","VA"
];

const WORLD_COUNTRIES = [
  "AR","AU","BH","BR","CA","CL","CN","CO","HK","IL","IN","ID","JP","KR","KW","MY","MX","NZ","PH","QA","SA","SG","ZA","TH","AE","US","UY","VN"
];

function normaliseDeliveryRegion(value) {
  const region = clean(value || "uk").toLowerCase();
  if (["uk", "gb", "united kingdom"].includes(region)) return "uk";
  if (["eu", "europe", "european"].includes(region)) return "europe";
  if (["world", "rest-of-world", "rest_of_world", "international", "row"].includes(region)) return "world";
  return "";
}

function shippingConfig(env, deliveryRegion) {
  const rates = {
    uk: {
      countries: ["GB"],
      shippingRateId: clean(env.STRIPE_UK_SHIPPING_RATE_ID),
      displayName: "UK insured delivery",
      amount: 0,
      minDays: 1,
      maxDays: 1
    },
    europe: {
      countries: EUROPE_COUNTRIES,
      shippingRateId: clean(env.STRIPE_EUROPE_SHIPPING_RATE_ID),
      displayName: "Europe insured delivery",
      amount: 5000,
      minDays: 2,
      maxDays: 5
    },
    world: {
      countries: WORLD_COUNTRIES,
      shippingRateId: clean(env.STRIPE_WORLD_SHIPPING_RATE_ID),
      displayName: "Rest of world insured delivery",
      amount: 8000,
      minDays: 2,
      maxDays: 7
    }
  };
  const config = rates[deliveryRegion];
  if (!config) throw new Error("Please choose a valid delivery option.");
  return config;
}

function applyShipping(params, config) {
  config.countries.forEach((country, index) => {
    params.set(`shipping_address_collection[allowed_countries][${index}]`, country);
  });

  if (config.shippingRateId) {
    params.set("shipping_options[0][shipping_rate]", config.shippingRateId);
    return;
  }

  params.set("shipping_options[0][shipping_rate_data][display_name]", config.displayName);
  params.set("shipping_options[0][shipping_rate_data][type]", "fixed_amount");
  params.set("shipping_options[0][shipping_rate_data][fixed_amount][amount]", String(config.amount));
  params.set("shipping_options[0][shipping_rate_data][fixed_amount][currency]", "gbp");
  params.set("shipping_options[0][shipping_rate_data][delivery_estimate][minimum][unit]", "business_day");
  params.set("shipping_options[0][shipping_rate_data][delivery_estimate][minimum][value]", String(config.minDays));
  params.set("shipping_options[0][shipping_rate_data][delivery_estimate][maximum][unit]", "business_day");
  params.set("shipping_options[0][shipping_rate_data][delivery_estimate][maximum][value]", String(config.maxDays));
}

function siteUrl(env) {
  return clean(env.SITE_URL || env.PUBLIC_SITE_URL || "https://staplefordwatches.co.uk").replace(/\/$/, "");
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.STRIPE_SECRET_KEY) return json({ error: "Missing Stripe secret key." }, 500);

    const body = await request.json().catch(() => ({}));
    const items = Array.isArray(body.items) ? body.items : [];
    const requestedIds = [...new Set(items.map(item => clean(item.id)).filter(Boolean))];
    const deliveryRegion = normaliseDeliveryRegion(body.deliveryRegion || body.fulfilment || body.shippingRegion);

    if (!requestedIds.length) return json({ error: "Your cart is empty." }, 400);
    if (!deliveryRegion) return json({ error: "Please choose a valid delivery option." }, 400);

    const records = await fetchAirtableRecords(env);
    const watches = records.map(record => normaliseWatch(record, env));
    const selected = requestedIds.map(id => {
      const watch = watches.find(w => w.listingId === id || w.airtableRecordId === id);
      if (!watch) throw new Error(`Listing not found: ${id}`);
      if (watch.status !== "available") throw new Error(`${watch.name} is no longer available.`);
      if (!watch.price || watch.price <= 0) throw new Error(`${watch.name} is missing a valid price.`);
      return watch;
    });

    const delivery = shippingConfig(env, deliveryRegion);
    const origin = siteUrl(env);
    const params = new URLSearchParams();

    params.set("mode", "payment");
    params.set("success_url", `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`);
    params.set("cancel_url", `${origin}/checkout.html?watch=${encodeURIComponent(selected[0].listingId)}`);
    params.set("billing_address_collection", "required");
    params.set("phone_number_collection[enabled]", "true");
    params.set("consent_collection[terms_of_service]", "required");
    params.set("client_reference_id", selected.map(w => w.listingId).join(","));
    params.set("metadata[listing_ids]", selected.map(w => w.listingId).join(","));
    params.set("metadata[airtable_record_ids]", selected.map(w => w.airtableRecordId).join(","));
    params.set("metadata[delivery_region]", deliveryRegion);
    params.set("metadata[source]", "hosted_checkout");

    if (String(env.STRIPE_AUTOMATIC_TAX || "").toLowerCase() === "true") {
      params.set("automatic_tax[enabled]", "true");
    }

    applyShipping(params, delivery);

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
      return json({ error: session.error?.message || "Checkout unavailable." }, 500);
    }

    return json({ checkoutUrl: session.url });
  } catch (error) {
    console.error(error);
    return json({ error: error.message || "Checkout unavailable." }, 400);
  }
}
