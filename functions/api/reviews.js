function formatDateDisplay(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(date);
}

// Reviews are shown publicly as initials only — the full name entered on
// the submission form is only ever used internally (e.g. in Airtable) and
// is never included in this public response.
function toInitials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "Anonymous";
  return parts.map((part) => `${part.charAt(0).toUpperCase()}.`).join("");
}

export async function onRequest(context) {
  try {
    const token = context.env.AIRTABLE_TOKEN || context.env.AIRTABLE_API_KEY;
    const baseId = context.env.AIRTABLE_BASE_ID;
    const table = context.env.AIRTABLE_REVIEWS_TABLE_NAME || "Reviews";

    if (!token || !baseId) {
      return Response.json({ ok: false, error: "Missing Airtable settings" }, { status: 500 });
    }

    const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`);
    url.searchParams.set("pageSize", "100");
    url.searchParams.set("filterByFormula", "{Status}='Approved'");
    url.searchParams.set("sort[0][field]", "Submitted");
    url.searchParams.set("sort[0][direction]", "desc");

    const airtableResponse = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });

    const airtableText = await airtableResponse.text();

    if (!airtableResponse.ok) {
      return Response.json(
        { ok: false, error: "Could not load reviews from Airtable", detail: airtableText },
        { status: airtableResponse.status }
      );
    }

    const airtableData = JSON.parse(airtableText);

    const get = (fields, names) => {
      for (const name of names) {
        const value = fields[name];
        if (value !== undefined && value !== null && String(value).trim() !== "") return value;
      }
      return "";
    };

    const clean = (value) => (value === undefined || value === null ? "" : String(value).trim());

    const reviews = (airtableData.records || [])
      .map((record) => {
        const fields = record.fields || {};
        const name = clean(get(fields, ["Name", "name"]));
        const rating = Number(get(fields, ["Rating", "rating"])) || 0;
        const watch = clean(get(fields, ["Watch", "Watch Purchased", "watch"]));
        const review = clean(get(fields, ["Review", "Review Text", "review"]));
        const dateValue = get(fields, ["Submitted", "Date Submitted", "Created", "date"]) || record.createdTime;
        const photoAttachments = fields["Photos"] || fields["Images"];
        const photos = Array.isArray(photoAttachments) ? photoAttachments.map((att) => att.url).filter(Boolean) : [];

        return {
          id: record.id,
          name: toInitials(name),
          rating,
          watch,
          review,
          photos,
          dateDisplay: formatDateDisplay(dateValue)
        };
      })
      .filter((review) => review.review);

    return Response.json({ ok: true, count: reviews.length, reviews });
  } catch (error) {
    return Response.json(
      { ok: false, error: "Could not load reviews", detail: error.message },
      { status: 500 }
    );
  }
}
