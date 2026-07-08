import { shippingRateIdForCountry } from "../_utils/shipping.js";

function add(params, key, value) {
  if (value !== undefined && value !== null && value !== "") {
    params.append(key, String(value));
  }
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.STRIPE_SECRET_KEY) throw new Error("Missing Stripe secret key");

    const { checkout_session_id, shipping_details } = await request.json();
    const country = shipping_details?.address?.country;
    const shippingRateId = shippingRateIdForCountry(country, env);

    if (!shippingRateId) {
      return Response.json({
        type: "error",
        message: "We’re unable to offer insured delivery to this address. Please contact us.",
      }, { status: 400 });
    }

    const params = new URLSearchParams();

    add(params, "collected_information[shipping_details][name]", shipping_details?.name);
    add(params, "collected_information[shipping_details][address][country]", shipping_details?.address?.country);
    add(params, "collected_information[shipping_details][address][line1]", shipping_details?.address?.line1);
    add(params, "collected_information[shipping_details][address][line2]", shipping_details?.address?.line2);
    add(params, "collected_information[shipping_details][address][city]", shipping_details?.address?.city);
    add(params, "collected_information[shipping_details][address][state]", shipping_details?.address?.state);
    add(params, "collected_information[shipping_details][address][postal_code]", shipping_details?.address?.postal_code);

    add(params, "shipping_options[0][shipping_rate]", shippingRateId);

    const stripeResponse = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(checkout_session_id)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params,
      }
    );

    const updatedSession = await stripeResponse.json();

    if (!stripeResponse.ok) {
      return Response.json({
        type: "error",
        message: updatedSession.error?.message || "Unable to calculate insured delivery.",
      }, { status: 400 });
    }

    return Response.json({ type: "object", value: { succeeded: true } });
  } catch (error) {
    return Response.json({ type: "error", message: error.message || "Unable to calculate insured delivery." }, { status: 500 });
  }
}
