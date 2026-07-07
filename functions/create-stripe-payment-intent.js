function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
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

function booleanValue(value) {
  if (value === true) return true;
  if (value === false || value === undefined || value === null || value === "") return false;
  if (Array.isArray(value)) return value.some(booleanValue);
  if (typeof value === "number") return value > 0;
  return ["true","yes","y","1","checked","tick","ticked","on","included","include","show"].includes(String(value).trim().toLowerCase());
}

function getField(fields, names) {
  for (const name of names) {
    const value = fields[name];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
}

function numberValue(value) {
  if (value === undefined || value === null || value === "") return "";
  const n = Number(String(value).replace(/,/g, "").replace(/[^0-9.]/g, ""));
  return Number.isNaN(n) ? value : n;
}

function envList(value) {
  return clean(value).split(",").map(item => clean(item).toUpperCase()).filter(Boolean);
}

const DEFAULT_ALLOWED_COUNTRIES = [
  "GB",
  "AL","AD","AM","AT","AZ","BE","BA","BG","HR","CY","CZ","DK","EE","FI","FR","GE","DE","GI","GR","HU","IS","IE","IT","XK","LV","LI","LT","LU","MT","MD","MC","ME","NL","MK","NO","PL","PT","RO","SM","RS","SK","SI","ES","SE","CH","TR","UA","VA",
  "AR","AU","BH","BR","CA","CL","CN","CO","HK","IL","IN","ID","JP","KR","KW","MY","MX","NZ","PH","QA","SA","SG","ZA","TH","AE","US","UY","VN"
];

const EUROPE_DELIVERY_COUNTRIES = new Set([
  "AL","AD","AM","AT","AZ","BE","BA","BG","HR","CY","CZ","DK","EE","FI","FR","GE","DE","GI","GR","HU","IS","IE","IT","XK","LV","LI","LT","LU","MT","MD","MC","ME","NL","MK","NO","PL","PT","RO","SM","RS","SK","SI","ES","SE","CH","TR","UA","VA"
]);

function allowedShippingCountries(env) {
  const configured = envList(env.STRIPE_ALLOWED_COUNTRIES);
  return configured.length ? configured : DEFAULT_ALLOWED_COUNTRIES;
}

function shippingRegionForCountry(country) {
  const code = clean(country).toUpperCase();
  if (code === "GB") return "uk";
  if (EUROPE_DELIVERY_COUNTRIES.has(code)) return "europe";
  return "world";
}

function shippingRateConfig(env, countryOrRegion) {
  const region = ["uk","europe","world"].includes(clean(countryOrRegion).toLowerCase())
    ? clean(countryOrRegion).toLowerCase()
    : shippingRegionForCountry(countryOrRegion);

  const rates = {
    uk: {
      region: "uk",
      id: clean(env.STRIPE_UK_SHIPPING_RATE_ID) || "shr_1ToB0DA6uuNWF6Hy69rWm3w0",
      displayName: "UK insured delivery",
      amount: 0,
      minDays: 1,
      maxDays: 1
    },
    europe: {
      region: "europe",
      id: clean(env.STRIPE_EUROPE_SHIPPING_RATE_ID) || "shr_1ToB32A6uuNWF6HynifT8qAX",
      displayName: "Europe insured delivery",
      amount: 5000,
      minDays: 2,
      maxDays: 5
    },
    world: {
      region: "world",
      id: clean(env.STRIPE_WORLD_SHIPPING_RATE_ID) || "shr_1ToB48A6uuNWF6Hy9lrugs1w",
      displayName: "Rest of world insured delivery",
      amount: 8000,
      minDays: 2,
      maxDays: 7
    }
  };

  return rates[region] || rates.world;
}

function appendShippingOption(params, index, rate) {
  if (rate.id) {
    params.set(`shipping_options[${index}][shipping_rate]`, rate.id);
    return;
  }
  params.set(`shipping_options[${index}][shipping_rate_data][display_name]`, rate.displayName);
  params.set(`shipping_options[${index}][shipping_rate_data][type]`, "fixed_amount");
  params.set(`shipping_options[${index}][shipping_rate_data][fixed_amount][amount]`, String(rate.amount));
  params.set(`shipping_options[${index}][shipping_rate_data][fixed_amount][currency]`, "gbp");
  params.set(`shipping_options[${index}][shipping_rate_data][delivery_estimate][minimum][unit]`, "business_day");
  params.set(`shipping_options[${index}][shipping_rate_data][delivery_estimate][minimum][value]`, String(rate.minDays));
  params.set(`shipping_options[${index}][shipping_rate_data][delivery_estimate][maximum][unit]`, "business_day");
  params.set(`shipping_options[${index}][shipping_rate_data][delivery_estimate][maximum][value]`, String(rate.maxDays));
}

function normaliseStatus(fields, env) {
  const configuredStatusField = clean(env.AIRTABLE_STATUS_FIELD);
  const raw = clean(
    (configuredStatusField && fields[configuredStatusField]) ||
    fields["Listing Status"] ||
    fields["Status"] ||
    fields["status"]
  ).toLowerCase();

  const configuredStockField = clean(env.AIRTABLE_STOCK_FIELD);
  const stockRaw =
    (configuredStockField && fields[configuredStockField]) ??
    fields["Stock Quantity"] ??
    fields["Quantity"] ??
    fields["Stock"] ??
    1;
  const stock = Number(stockRaw);

  if (raw === "hidden") return "hidden";
  if (raw === "sold" || raw.includes("sold") || Number.isFinite(stock) && stock <= 0) return "sold";
  if (raw === "reserved" || raw.includes("reserved")) return "reserved";
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

async function getAvailableWatch(env, requestedId) {
  const id = clean(requestedId);
  if (!id) throw new Error("No watch was selected.");

  const records = await fetchAirtableRecords(env);
  const watches = records.map(record => normaliseWatch(record, env));
  const watch = watches.find(item => item.listingId === id || item.airtableRecordId === id);

  if (!watch) throw new Error("This watch could not be found.");
  if (watch.status !== "available") throw new Error(`${watch.name} is no longer available.`);
  if (!watch.price || watch.price <= 0) throw new Error(`${watch.name} is missing a valid price.`);

  return watch;
}

async function stripeFetch(env, path, params, method = "POST") {
  if (!env.STRIPE_SECRET_KEY) throw new Error("Missing Stripe secret key.");

  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: method === "GET" ? undefined : params
  });

  const data = await response.json();
  if (!response.ok) {
    console.error(data);
    throw new Error(data.error?.message || "Stripe request failed.");
  }

  return data;
}

function siteUrl(env, request) {
  const configured = clean(env.SITE_URL || env.PUBLIC_SITE_URL);
  if (configured) return configured.replace(/\/$/, "");
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

function safeMetadata(value) {
  return clean(value).slice(0, 500);
}


function normaliseExpressAddress(source) {
  const input = source || {};
  const address = input.address || input;
  return {
    name: clean(input.name || input.recipient || input.fullName),
    phone: clean(input.phone || input.phoneNumber),
    line1: clean(address.line1 || address.addressLine?.[0] || address.address_line_1),
    line2: clean(address.line2 || address.addressLine?.[1] || address.address_line_2),
    city: clean(address.city || address.locality),
    state: clean(address.state || address.administrativeArea),
    postal_code: clean(address.postal_code || address.postalCode),
    country: clean(address.country || address.countryCode).toUpperCase()
  };
}

function appendShipping(params, address) {
  if (address.name) params.set("shipping[name]", address.name);
  if (address.phone) params.set("shipping[phone]", address.phone);
  if (address.line1) params.set("shipping[address][line1]", address.line1);
  if (address.line2) params.set("shipping[address][line2]", address.line2);
  if (address.city) params.set("shipping[address][city]", address.city);
  if (address.state) params.set("shipping[address][state]", address.state);
  if (address.postal_code) params.set("shipping[address][postal_code]", address.postal_code);
  if (address.country) params.set("shipping[address][country]", address.country);
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json().catch(() => ({}));
    const watch = await getAvailableWatch(env, body.id || body.watch);

    const shippingAddress = normaliseExpressAddress(body.shippingAddress || body.shipping_address || {});
    const shippingCountry = clean(body.shippingCountry || shippingAddress.country || "GB").toUpperCase();

    const allowed = new Set(allowedShippingCountries(env));
    if (!allowed.has(shippingCountry)) {
      return json({ error: "Delivery is not currently available to this country." }, 400);
    }

    const rate = shippingRateConfig(env, shippingCountry);
    const expectedRateIds = new Set([rate.id, `${rate.region}-${rate.amount}`].filter(Boolean));
    const suppliedRateId = clean(body.shippingRateId);
    if (suppliedRateId && !expectedRateIds.has(suppliedRateId) && !["uk-free", "europe-50", "world-80"].includes(suppliedRateId)) {
      return json({ error: "The selected delivery option is not valid." }, 400);
    }

    const amount = Math.round(watch.price * 100) + rate.amount;
    const params = new URLSearchParams();

    params.set("amount", String(amount));
    params.set("currency", "gbp");
    params.set("payment_method_types[0]", "card");
    params.set("description", watch.name);
    params.set("metadata[listing_ids]", watch.listingId);
    params.set("metadata[airtable_record_ids]", watch.airtableRecordId);
    params.set("metadata[source]", "express_checkout");
    params.set("metadata[delivery_region]", rate.region);
    params.set("metadata[shipping_country]", shippingCountry);
    params.set("metadata[shipping_amount]", String(rate.amount));
    params.set("metadata[watch_subtotal]", String(Math.round(watch.price * 100)));

    const email = clean(body.billingDetails?.email || body.email);
    if (email) params.set("receipt_email", email);

    if (shippingAddress.country || shippingAddress.line1 || shippingAddress.name) {
      appendShipping(params, { ...shippingAddress, country: shippingCountry });
    }

    const intent = await stripeFetch(env, "/payment_intents", params);

    return json({
      id: intent.id,
      clientSecret: intent.client_secret
    });
  } catch (error) {
    console.error(error);
    return json({ error: error.message || "Apple Pay checkout unavailable." }, 400);
  }
}
