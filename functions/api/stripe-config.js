export async function onRequestGet({ env }) {
  if (!env.STRIPE_PUBLISHABLE_KEY) {
    return Response.json({ error: "Missing Stripe publishable key" }, { status: 500 });
  }

  return Response.json({ publishableKey: env.STRIPE_PUBLISHABLE_KEY });
}
