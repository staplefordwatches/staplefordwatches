export default async function handler(req, res) {
  try {
    const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
    const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
    const AIRTABLE_TABLE_NAME = process.env.AIRTABLE_TABLE_NAME || "Watches";
    const AIRTABLE_VIEW = process.env.AIRTABLE_VIEW || "Grid view";

    if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) {
      return res.status(500).json({
        error: "Missing Airtable environment variables"
      });
    }

    const url = new URL(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE_NAME)}`
    );

    url.searchParams.set("pageSize", "100");
    if (AIRTABLE_VIEW) url.searchParams.set("view", AIRTABLE_VIEW);

    const airtableRes = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${AIRTABLE_TOKEN}`
      }
    });

    const text = await airtableRes.text();

    if (!airtableRes.ok) {
      return res.status(airtableRes.status).json({
        error: "Could not load watches",
        detail: `Airtable error ${airtableRes.status}: ${text}`
      });
    }

    const data = JSON.parse(text);

    const watches = (data.records || [])
      .map((record) => {
        const f = record.fields || {};

        return {
          id: record.id,
          brand: f.Brand || f.brand || "",
          model: f.Model || f.model || "",
          reference: f.Reference || f.reference || "",
          year: f.Year || f.year || "",
          price: f.Price || f.price || "",
          status: f.Status || f.status || "Available",
          description: f.Description || f.description || "",
          images:
            f.Images ||
            f.images ||
            f.Image ||
            f.image ||
            []
        };
      })
      .filter((watch) => {
        const status = String(watch.status || "").toLowerCase();
        return status !== "hidden" && status !== "draft";
      });

    return res.status(200).json({ watches });
  } catch (err) {
    return res.status(500).json({
      error: "Could not load watches",
      detail: err.message
    });
  }
}
