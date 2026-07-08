import { ALLOWED_COUNTRIES } from "../_utils/shipping.js";
import { findWatchByListingId } from "../_utils/airtable-watch.js";

function add(params, key, value) {
  if (value !== undefined && value !== null && value !== "") {
    params.append(key, String(value));
  }
}

function siteUrlFromRequest(request, env) {
  return String(env.SITE_URL || new URL(request.url).origin).replace(/\/+$/, "");
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.STRIPE_SECRET_KEY) throw new Error("Missing Stripe secret key");
    if (!env.STRIPE_SHIPPING_RATE_UK) throw new Error("Missing UK Stripe shipping rate");
    if (!env.STRIPE_SHIPPING_RATE_EUROPE) throw new Error("Missing Europe Stripe shipping rate");
    if (!env.STRIPE_SHIPPING_RATE_INTERNATIONAL) throw new Error("Missing International Stripe shipping rate");

    const { watch } = await request.json();
    const item = await findWatchByListingId(env, watch);

    if (!item) {
      return Response.json({ error: "This watch could not be found." }, { status: 404 });
    }

    const normalizedStatus = String(item.status || "").toLowerCase();
    if (normalizedStatus.includes("sold") || normalizedStatus.includes("reserved")) {
      return Response.json({ error: "This watch is no longer available." }, { status: 409 });
    }

    if (!item.pricePence) {
      return Response.json({ error: "This watch is not currently available for online checkout." }, { status: 400 });
    }

    const siteUrl = siteUrlFromRequest(request, env);
    const params = new URLSearchParams();

    add(params, "mode", "payment");
    add(params, "ui_mode", "embedded_page");
    add(params, "return_url", `${siteUrl}/buy/?checkout=complete&session_id={CHECKOUT_SESSION_ID}`);
    add(params, "billing_address_collection", "required");
    add(params, "phone_number_collection[enabled]", "true");
    add(params, "permissions[update_shipping_details]", "server_only");

    ALLOWED_COUNTRIES.forEach((country, index) => {
      add(params, `shipping_address_collection[allowed_countries][${index}]`, country);
    });

    // Initial placeholder. It is replaced after the customer enters their delivery address.
    add(params, "shipping_options[0][shipping_rate]", env.STRIPE_SHIPPING_RATE_UK);

    add(params, "line_items[0][price_data][currency]", "gbp");
    add(params, "line_items[0][price_data][unit_amount]", item.pricePence);
    add(params, "line_items[0][price_data][product_data][name]", item.name);
    add(params, "line_items[0][quantity]", 1);

    add(params, "client_reference_id", item.listingId);
    add(params, "metadata[watch]", item.listingId);
    add(params, "metadata[airtableId]", item.airtableId);
    add(params, "payment_intent_data[metadata][watch]", item.listingId);
    add(params, "payment_intent_data[metadata][airtableId]", item.airtableId);

    const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    });

    const session = await stripeResponse.json();

    if (!stripeResponse.ok) {
      return Response.json(
        { error: session.error?.message || "Unable to create checkout session" },
        { status: 400 }
      );
    }

    return Response.json({ clientSecret: session.client_secret });
  } catch (error) {
    return Response.json({ error: error.message || "Unable to start checkout" }, { status: 500 });
  }
}
