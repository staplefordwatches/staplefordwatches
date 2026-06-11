const CATALOG = {
  "SW001": {
    name: "PANERAI Radiomir Base PAM00210",
    priceGbp: 3395,
    status: "available",
    productId: "panerai-radiomir-210",
    image: "Images/Watches/PR1/1.webp"
  },
  "SW002": {
    name: "OMEGA Seamaster Aqua Terra 41MM Green",
    priceGbp: 3350,
    status: "available",
    productId: "omega-aqua-terra-green-2",
    image: "Images/Watches/OAT1/1.webp"
  },
  "SW003": {
    name: "ZENITH Elite Port Royal V",
    priceGbp: 1350,
    status: "available",
    productId: "zenith-elite-port-royal",
    image: "Images/Watches/Z3/1.webp"
  },
  "SW004": {
    name: "OMEGA Speedmaster Professional Moonphase",
    priceGbp: 4295,
    status: "available",
    productId: "omega-speedmaster-moonphase",
    image: "Images/Watches/OSP1/1.webp"
  },
  "SW005": {
    name: "PANERAI Radiomir PAM01384",
    priceGbp: 3295,
    status: "available",
    productId: "panerai-radiomir-green",
    image: "Images/Watches/P2/1.webp"
  },
  "SW006": {
    name: "ZENITH Tank Art Deco c. 1939",
    priceGbp: 995,
    status: "available",
    productId: "zenith-tank",
    image: "Images/Watches/Z2/1.webp"
  },
  "SW009": {
    name: "Heuer Carrera First Execution Chronograph",
    priceGbp: 2395,
    status: "available",
    productId: "heuer-carrera-first-execution",
    image: "Images/Watches/H1/1.webp"
  },
  "SW013": {
    name: "OMEGA Seamaster Blue Jedi ST 176.005",
    priceGbp: 2295,
    status: "available",
    productId: "omega-seamaster",
    image: "Images/Watches/OS1/cover.webp"
  },
  "SW017": {
    name: "ZENITH Moonphase Quartz",
    priceGbp: 390,
    status: "available",
    productId: "zenith-moonphase-quartz",
    image: "Images/Watches/Z1/cover.webp"
  },
  "SW020": {
    name: "NOAH x TIMEX Waterbury Ghost Nets Suck",
    priceGbp: 420,
    status: "available",
    productId: "noah-timex",
    image: "Images/Watches/TX1/cover.webp"
  }
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}

function getSiteUrl(request, env) {
  const configured = env.SITE_URL || env.PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/$/, "");
  return new URL(request.url).origin;
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.STRIPE_SECRET_KEY) {
      return jsonResponse({ error: "Stripe is not configured yet." }, 500);
    }

    const body = await request.json().catch(() => ({}));
    const rawItems = Array.isArray(body.items) ? body.items : [];

    const listingIds = [...new Set(
      rawItems
        .map(item => String(item?.id || "").trim())
        .filter(Boolean)
    )];

    if (!listingIds.length) {
      return jsonResponse({ error: "Your cart is empty." }, 400);
    }

    if (listingIds.length > 10) {
      return jsonResponse({ error: "Too many items in one checkout." }, 400);
    }

    const selected = listingIds.map(listingId => {
      const watch = CATALOG[listingId];
      if (!watch || watch.status !== "available") {
        throw new Error("One or more watches are no longer available.");
      }
      return { listingId, ...watch };
    });

    const siteUrl = getSiteUrl(request, env);
    const params = new URLSearchParams();

    params.set("mode", "payment");
    params.set("success_url", `${siteUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`);
    params.set("cancel_url", `${siteUrl}/`);
    params.set("billing_address_collection", "required");
    params.set("shipping_address_collection[allowed_countries][0]", "GB");
    params.set("phone_number_collection[enabled]", "true");
    params.set("metadata[listing_ids]", selected.map(item => item.listingId).join(","));

    selected.forEach((watch, index) => {
      params.set(`line_items[${index}][quantity]`, "1");
      params.set(`line_items[${index}][price_data][currency]`, "gbp");
      params.set(`line_items[${index}][price_data][unit_amount]`, String(watch.priceGbp * 100));
      params.set(`line_items[${index}][price_data][product_data][name]`, watch.name);
      params.set(`line_items[${index}][price_data][product_data][metadata][listing_id]`, watch.listingId);
      params.set(`line_items[${index}][price_data][product_data][metadata][product_id]`, watch.productId);
    });

    const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params
    });

    const session = await stripeResponse.json();

    if (!stripeResponse.ok || !session.url) {
      console.error("Stripe Checkout error", session);
      return jsonResponse({ error: "Checkout unavailable. Please enquire directly." }, 500);
    }

    return jsonResponse({ checkoutUrl: session.url });
  } catch (error) {
    return jsonResponse({ error: error.message || "Checkout unavailable. Please enquire directly." }, 400);
  }
}

export async function onRequestGet() {
  return jsonResponse({ error: "Method not allowed" }, 405);
}
