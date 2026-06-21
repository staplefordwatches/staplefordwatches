export async function onRequest(context) {
  try {
    const token = context.env.AIRTABLE_TOKEN;
    const baseId = context.env.AIRTABLE_BASE_ID;
    const table = context.env.AIRTABLE_TABLE_NAME || "Watches";
    const view = context.env.AIRTABLE_VIEW || "Grid view";

    const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`);
    url.searchParams.set("pageSize", "100");
    if (view) url.searchParams.set("view", view);

    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });

    const text = await r.text();

    if (!r.ok) {
      return Response.json(
        { error: "Could not load watches", detail: text },
        { status: r.status }
      );
    }

    const data = JSON.parse(text);

    const get = (f, names) => {
      for (const name of names) {
        if (f[name] !== undefined && f[name] !== null && String(f[name]).trim() !== "") return f[name];
      }
      return "";
    };

    const getImages = (value) => {
      if (!value) return [];
      if (Array.isArray(value)) return value.map(x => x?.url || x).filter(Boolean);
      return [String(value)];
    };

    const watches = (data.records || []).map((record, index) => {
      const f = record.fields || {};
      const images = getImages(get(f, ["Images", "Image", "Photos", "Photo", "Cloudinary", "Cloudinary URL", "Image URL"]));

      return {
        id: record.id,
        listingId: get(f, ["Listing ID", "ListingId", "ID"]) || record.id,
        brand: get(f, ["Brand", "brand"]),
        title: get(f, ["Title", "Model", "Watch", "Name", "model"]),
        price: get(f, ["Price", "price"]),
        status: get(f, ["Status", "status"]) || "Available",
        description: get(f, ["Description", "description"]),
        image: images[0] || "",
        images,
        specs: {
          reference: get(f, ["Reference", "Reference Number", "Ref", "Reference No"]),
          year: get(f, ["Year", "year"]),
          caseSize: get(f, ["Case Size", "CaseSize"]),
          condition: get(f, ["Condition", "condition"]),
          contents: get(f, ["Contents", "Box/Papers", "Set"])
        },
        _airtableEntryOrder: index
      };
    });

    return Response.json(watches);
  } catch (e) {
    return Response.json(
      { error: "Could not load watches", detail: e.message },
      { status: 500 }
    );
  }
}
