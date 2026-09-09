import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../functions/api/journal.js", import.meta.url), "utf8");
const cacheStub = "data:text/javascript;base64," + Buffer.from(
  "export async function withDataCache(){}"
).toString("base64");
const webhookStub = "data:text/javascript;base64," + Buffer.from(
  "export const AIRTABLE_CATALOGS=[{},{}];export function ensureAirtableWebhook(){}"
).toString("base64");
const moduleSource = source
  .replace('"../_utils/data-cache.js"', `"${cacheStub}"`)
  .replace('"../_utils/airtable-webhooks.js"', `"${webhookStub}"`);
const journal = await import(
  `data:text/javascript;base64,${Buffer.from(moduleSource).toString("base64")}`
);

test("journal body supports headings, paragraphs, lists and positioned images safely", () => {
  const images = journal.attachmentImages([
    { url: "https://example.com/one.jpg", filename: "movement-detail.jpg", width: 1200, height: 800 },
    { url: "https://example.com/two.jpg", filename: "case-back.jpg", width: 1200, height: 800 },
  ]);
  const html = journal.renderJournalBody(
    "## A closer look\nFirst paragraph.\n\n- Point one\n- Point two\n[[image:1|Movement detail]]\n<script>alert(1)</script>",
    images
  );

  assert.match(html, /<h2>A closer look<\/h2>/);
  assert.match(html, /<p>First paragraph\.<\/p>/);
  assert.match(html, /<ul><li>Point one<\/li><li>Point two<\/li><\/ul>/);
  assert.match(html, /<figcaption>Movement detail<\/figcaption>/);
  assert.match(html, /https:\/\/example\.com\/two\.jpg/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test("Airtable Body and attachment fields become a complete published article", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    records: [{
      id: "recJournal",
      fields: {
        Title: "The Perfect Daily Watch",
        Category: "Guides",
        Author: "Ben",
        Date: "2026-09-09",
        Body: "## Why it works\nA useful opening paragraph.",
        Excerpt: "A concise introduction.",
        "Cover Image": [{
          url: "https://example.com/cover.jpg",
          filename: "daily-watch.jpg",
          width: 1600,
          height: 1000,
        }],
        Images: [{
          url: "https://example.com/detail.jpg",
          filename: "dial-detail.jpg",
          width: 1200,
          height: 800,
        }],
        Status: "Published",
      },
    }],
  });

  try {
    const response = await journal.loadJournal({
      env: { AIRTABLE_TOKEN: "test-token", AIRTABLE_BASE_ID: "appTest" },
    });
    const payload = await response.json();
    assert.equal(payload.count, 1);
    assert.equal(payload.posts[0].image, "https://example.com/cover.jpg");
    assert.equal(payload.posts[0].cardImage, "https://example.com/cover.jpg");
    assert.equal(payload.posts[0].excerpt, "A concise introduction.");
    assert.equal(payload.posts[0].dateDisplay, "9 September 2026");
    assert.match(payload.posts[0].bodyHtml, /<h2>Why it works<\/h2>/);
    assert.match(payload.posts[0].bodyHtml, /detail\.jpg/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
