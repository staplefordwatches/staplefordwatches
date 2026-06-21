export async function onRequest(context) {
  try {
    const token = context.env.AIRTABLE_TOKEN;
    const baseId = context.env.AIRTABLE_BASE_ID;
    const table = context.env.AIRTABLE_TABLE_NAME || "Watches";
    const view = context.env.AIRTABLE_VIEW || "Grid view";
    const cloudName = context.env.CLOUDINARY_CLOUD_NAME || "dvm4pgghh";

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
        if (f[name] !== undefined && f[name] !== null && String(f[name]).trim() !== "") {
          return f[name];
        }
      }
      return "";
    };

    const watches = (data.records || [])
      .map((record, index) => {
        const f = record.fields || {};

        const sku = get(f, ["SKU", "Sku", "sku", "Cloudinary Folder", "Folder"]);
        const imageCount = Number(get(f, ["Image Count", "ImageCount", "Images Count"]) || 0);

        const images = sku && imageCount
          ? Array.from({ length: imageCount }, (_, i) => {
              const num = String(i + 1).padStart(2, "0");
              return `https://res.cloudinary.com/${cloudName}/image/upload/watches/${sku}/${num}`;
            })
          : [];

        return {
          id: record.id,
          listingId: sku || record.id,
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
      })
      .filter(watch => watch.brand || watch.title || watch.price);

    return Response.json(watches);
  } catch (e) {
    return Response.json(
      { error: "Could not load watches", detail: e.message },
      { status: 500 }
    );
  }
}
