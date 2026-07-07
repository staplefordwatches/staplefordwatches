function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}

function clean(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

export async function onRequestGet({ env }) {
  const publishableKey = clean(env.STRIPE_PUBLISHABLE_KEY || env.PUBLIC_STRIPE_PUBLISHABLE_KEY);

  if (!publishableKey) {
    return json({ error: "Missing Stripe publishable key." }, 500);
  }

  return json({ publishableKey });
}
