export async function onRequest(context) {
  try {
    const token = context.env.AIRTABLE_TOKEN;
    const baseId = context.env.AIRTABLE_BASE_ID;
    const table = context.env.AIRTABLE_TABLE_NAME || "Watches";
    const view = context.env.AIRTABLE_VIEW || "Grid view";
    const cloudName = context.env.CLOUDINARY_CLOUD_NAME || "dvm4pgghh";

    if (!token || !baseId) {
      return Response.json({ ok: false, error: "Missing Airtable settings" }, { status: 500 });
    }

    const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`);
    url.searchParams.set("pageSize", "100");
    if (view) url.searchParams.set("view", view);

    const airtableResponse = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });

    const airtableText = await airtableResponse.text();

    if (!airtableResponse.ok) {
      return Response.json(
        { ok: false, error: "Could not load watches from Airtable", detail: airtableText },
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

    const clean = (value) => {
      if (value === undefined || value === null) return "";
      return String(value).trim();
    };

    const numberValue = (value) => {
      if (value === undefined || value === null || value === "") return "";
      const n = Number(value);
      return Number.isNaN(n) ? value : n;
    };

    const booleanValue = (value) => {
      if (value === true) return true;
      if (value === false || value === undefined || value === null || value === "") return false;
      if (Array.isArray(value)) return value.some(booleanValue);
      if (typeof value === "number") return value > 0;

      const normalized = String(value).trim().toLowerCase();
      return [
        "true",
        "yes",
        "y",
        "1",
        "checked",
        "tick",
        "ticked",
        "on",
        "included",
        "include",
        "show"
      ].includes(normalized);
    };

    const buildImages = (sku, imageCount) => {
      const count = Number(imageCount || 0);
      if (!sku || !count) return [];

      return Array.from({ length: count }, (_, index) => {
        const num = String(index + 1).padStart(2, "0");
        return `https://res.cloudinary.com/${cloudName}/image/upload/f_auto,q_auto/watches/${encodeURIComponent(sku)}/${num}`;
      });
    };

    const watches = (airtableData.records || [])
      .map((record, index) => {
        const fields = record.fields || {};

        const sku = clean(get(fields, [
          "SKU",
          "Sku",
          "sku",
          "Stock Number",
          "Stock No",
          "Stock ID",
          "Cloudinary Folder",
          "Folder",
          "Image Folder"
        ]));

        const brand = clean(get(fields, ["Brand", "brand"]));

        const title = clean(get(fields, [
          "Title",
          "Model",
          "Watch",
          "Name",
          "model",
          "name"
        ]));

        const price = numberValue(get(fields, ["Price", "price"]));
        const status = clean(get(fields, ["Status", "status"])) || "Available";

        const description = clean(get(fields, [
          "Watch Description",
          "Description",
          "description",
          "Details",
          "Notes"
        ]));

        const reference = clean(get(fields, [
          "Reference",
          "Reference Number",
          "Ref",
          "Reference No"
        ]));

        const year = clean(get(fields, ["Year", "year"]));

        const caseSize = clean(get(fields, [
          "Case Size",
          "CaseSize",
          "Size"
        ]));

        const movement = clean(get(fields, [
          "Movement",
          "Movement Type",
          "Calibre Type",
          "Watch Movement"
        ]));

        const caseMaterial = clean(get(fields, [
          "Case Material",
          "Material",
          "Watch Material"
        ]));

        const condition = clean(get(fields, [
          "Condition",
          "condition"
        ]));

        const contents = clean(get(fields, [
          "Contents",
          "Box/Papers",
          "Set"
        ]));

        const conditionNotes = clean(get(fields, [
          "Condition Notes",
          "Condition Description",
          "Condition Details",
          "Condition Information",
          "Condition Info"
        ]));

        const contentsNotes = clean(get(fields, [
          "Contents Notes",
          "Contents Description",
          "Contents Details",
          "Contents Information",
          "Contents Info",
          "Included Items"
        ]));

        const authenticityGuaranteed = booleanValue(get(fields, [
          "Authenticity Guaranteed",
          "Guaranteed Authenticity",
          "Authenticity",
          "Auth Guaranteed"
        ]));

        const warranty12Month = booleanValue(get(fields, [
          "12 Month Warranty",
          "Twelve Month Warranty",
          "Warranty",
          "Included Warranty"
        ]));

        const fastFreeShipping = booleanValue(get(fields, [
          "Fast & Free Shipping",
          "Fast and Free Shipping",
          "Fast Free Shipping",
          "Free Shipping",
          "Shipping Included",
          "Complimentary Shipping",
          "Free Delivery"
        ]));

        const fullyInsuredDelivery = booleanValue(get(fields, [
          "Fully Insured Delivery",
          "Insured Delivery",
          "Insured Shipping",
          "Fully Insured Shipping",
          "Worldwide Insured Shipping",
          "Insured Worldwide Shipping"
        ]));

        const imageCount = get(fields, [
          "Image Count",
          "ImageCount",
          "Images Count",
          "Photo Count",
          "PhotoCount"
        ]);

        const images = buildImages(sku, imageCount);
        const mainImage = images[0] || "";

        return {
          id: record.id,
          listingId: sku || record.id,
          airtableId: record.id,

          sku,
          brand,
          title,
          model: title,
          name: title,

          price,
          status,
          description,

          image: mainImage,
          imageUrl: mainImage,
          mainImage,
          mainImageUrl: mainImage,
          thumbnail: mainImage,
          images,
          gallery: images,

          specs: {
            reference,
            year,
            caseSize,
            movement,
            caseMaterial,
            condition,
            contents,
            conditionNotes,
            contentsNotes
          },

          reference,
          year,
          caseSize,
          movement,
          caseMaterial,
          condition,
          contents,
          conditionNotes,
          contentsNotes,

          authenticityGuaranteed,
          warranty12Month,
          fastFreeShipping,
          fullyInsuredDelivery,

          sold: status.toLowerCase().includes("sold"),
          reserved: status.toLowerCase().includes("reserved"),

          _airtableEntryOrder: index
        };
      })
      .filter((watch) => watch.brand || watch.title || watch.price || watch.sku);

    return Response.json({
      ok: true,
      count: watches.length,
      watches,
      items: watches,
      data: watches
    });
  } catch (error) {
    return Response.json(
      { ok: false, error: "Could not load watches", detail: error.message },
      { status: 500 }
    );
  }
}
