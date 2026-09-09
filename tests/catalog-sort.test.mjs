import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

test("the catalogue defaults to one clear most-recent date option", () => {
  assert.match(html, /<span>Most recent<\/span><input type="radio" name="catalog-sort" value="new-old" checked>/);
  assert.doesNotMatch(html, /<span>Featured<\/span>/);
  assert.doesNotMatch(html, /<span>Newest first<\/span>/);
  assert.match(html, /let currentSort = 'new-old';/);
});

test("most recent and oldest use Date Added rather than the watch year", () => {
  assert.match(html, /Date\.parse\(String\(watch\?\.dateAdded \|\| ''\)\)/);
  assert.match(html, /compareListingDates\(a, b, true\)/);
  assert.match(html, /compareListingDates\(a, b, false\)/);
  assert.doesNotMatch(html, /currentSort === 'new-old'\) return Number\(b\.specs\?\.year/);
});
