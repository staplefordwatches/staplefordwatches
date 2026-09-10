import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const robots = await readFile(new URL("../robots.txt", import.meta.url), "utf8");
const sitemap = await readFile(new URL("../sitemap.xml", import.meta.url), "utf8");

test("business identity and customer-service details remain on the contact and legal pages", () => {
  assert.match(html, /124 City Road/);
  assert.match(html, /EC1V 2NX/);
  assert.match(html, /VAT registration number: GB 520 4679 02/);
  assert.match(html, /ben@staplefordwatches\.co\.uk/);
  assert.match(html, /\+44 7438 196047/);
});

test("customers and crawlers can reach dedicated trust pages", () => {
  for (const path of ["/contact/", "/delivery/", "/returns/", "/terms-and-conditions/", "/privacy-policy/"]) {
    assert.match(html, new RegExp(`href=["']${path.replaceAll("/", "\\/")}["']`));
    assert.match(sitemap, new RegExp(`<loc>https:\\/\\/staplefordwatches\\.co\\.uk${path.replaceAll("/", "\\/")}<\\/loc>`));
  }
  assert.match(robots, /Sitemap: https:\/\/staplefordwatches\.co\.uk\/sitemap\.xml/);
});

test("merchant structured data publishes real contact and policy details", () => {
  assert.match(html, /"vatID":"GB520467902"/);
  assert.match(html, /"telephone":"\+447438196047"/);
  assert.match(html, /"merchantReturnLink":"https:\/\/staplefordwatches\.co\.uk\/returns\/"/);
});

test("product pages link directly to full delivery and returns policies", () => {
  assert.match(html, /Read our full delivery policy/);
  assert.match(html, /Read our full returns policy/);
});

test("the simplified contact experience keeps only the requested actions", () => {
  assert.doesNotMatch(html, /href=["']\/about\/["']/);
  assert.doesNotMatch(html, />Call<\/a>/);
  assert.doesNotMatch(html, /class="sw-footer-business"/);
  assert.match(html, /actions:\[\{ label:'Email us'.*\{ label:'Chat to us'/);
});
