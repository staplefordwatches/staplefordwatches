import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../functions/_utils/airtable-watch.js", import.meta.url), "utf8");
const { findWatchByListingId } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

const env = {
  AIRTABLE_TOKEN: "test-token",
  AIRTABLE_BASE_ID: "app123",
  AIRTABLE_TABLE_NAME: "Watches",
  AIRTABLE_VIEW: "Website",
};

test("checkout asks Airtable for one matching SKU instead of the whole catalogue", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl;
  globalThis.fetch = async (request) => {
    requestedUrl = new URL(request.url || request);
    return Response.json({
      records: [{
        id: "rec123",
        fields: { SKU: "SW052", Brand: "Rolex", Title: "Submariner", Price: 9500, Status: "Available" },
      }],
    });
  };

  try {
    const watch = await findWatchByListingId(env, "SW052");
    assert.equal(requestedUrl.searchParams.get("maxRecords"), "1");
    assert.equal(requestedUrl.searchParams.get("pageSize"), "1");
    assert.match(requestedUrl.searchParams.get("filterByFormula"), /\{SKU\}/);
    assert.equal(requestedUrl.searchParams.get("view"), "Website");
    assert.equal(watch.listingId, "SW052");
    assert.equal(watch.pricePence, 950000);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("checkout reads an Airtable record directly when given a record ID", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl;
  globalThis.fetch = async (request) => {
    requestedUrl = new URL(request.url || request);
    return Response.json({
      id: "recABC123",
      fields: { SKU: "SW099", Brand: "Omega", Title: "Speedmaster", Price: 5000, Status: "Available" },
    });
  };

  try {
    const watch = await findWatchByListingId(env, "recABC123");
    assert.equal(requestedUrl.pathname.endsWith("/recABC123"), true);
    assert.equal(requestedUrl.search, "");
    assert.equal(watch.airtableId, "recABC123");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
