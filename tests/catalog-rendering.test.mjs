import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

test("the first two desktop rows load immediately in every browser", () => {
  assert.match(
    html,
    /const priorityCount = window\.innerWidth <= 640 \? 4 : 6;/,
  );
  assert.doesNotMatch(html, /const priorityCount = IS_SAFARI_DESKTOP \? 3/);
});

test("an unchanged fresh catalogue does not replace already-painted cards", () => {
  assert.match(
    html,
    /if\(cached && sameWatchData\(cached, fresh\)\)\{ saveCache\(fresh\); return; \}/,
  );
});

test("the live catalogue bypasses browser and local-storage stale copies", () => {
  assert.match(html, /stapleford_watches_cache_v14_live_catalogue/);
  assert.match(html, /fetch\('\/api\/watches\?schema=3', \{/);
  assert.match(html, /'Cache-Control':'no-cache', Pragma:'no-cache'/);
  assert.match(html, /cache:'no-store'/);
  assert.match(html, /const CACHE_MAX_AGE = 1000 \* 60 \* 5;/);
});
