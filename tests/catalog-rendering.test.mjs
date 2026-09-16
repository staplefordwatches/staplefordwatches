import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const regularFont = await readFile(new URL("../fonts/sweet-sans-pro-regular-v1.otf", import.meta.url));

test("the initial document avoids embedded images and oversized fonts", () => {
  assert.doesNotMatch(html, /data:image\//);
  assert.match(html, /src="\/assets\/stapleford-watches-logo@2x\.png\?v=1"/);
  assert.match(html, /\.site-header \.logo::before\{[^}]*background:var\(--sw-navy,#0a2342\)/);
  assert.match(html, /\.site-header \.logo-mark\{[^}]*opacity:0/);
  assert.match(html, /href="\/fonts\/sweet-sans-pro-regular-v1\.otf"/);
  assert.ok(regularFont.byteLength < 75_000);
});

test("only the LCP candidate gets high network priority", () => {
  assert.match(html, /const eager = index < listingColumns\(\);/);
  assert.match(html, /const priority = index === 0;/);
  assert.match(html, /loading="\$\{eager \? 'eager' : 'lazy'\}"/);
  assert.match(html, /fetchpriority="\$\{priority \? 'high' : 'auto'\}"/);
});

test("an unchanged fresh catalogue does not replace already-painted cards", () => {
  assert.match(
    html,
    /if\(cached && sameWatchData\(cached, fresh\)\)\{ saveCache\(fresh\); return; \}/,
  );
});

test("the catalogue reuses browser and local snapshots while refreshing in the background", () => {
  assert.match(html, /stapleford_watches_cache_v15_fast_catalogue/);
  assert.match(html, /fetch\('\/api\/watches\?schema=4', \{/);
  assert.match(html, /cache:'default'/);
  assert.match(html, /credentials:'omit'/);
  assert.match(html, /const CACHE_MAX_AGE = 1000 \* 60 \* 60 \* 24;/);
  assert.match(html, /requestIdleCallback\(resolve, \{ timeout:1200 \}\)/);
});

test("catalogue data is preloaded and checkout code is loaded only on demand", () => {
  assert.match(html, /'\/api\/watches\?schema=4'/);
  assert.match(html, /l\.href=href/);
  assert.doesNotMatch(html, /<script async src="https:\/\/js\.stripe\.com\/v3\/">/);
  assert.match(html, /script\.src = 'https:\/\/js\.stripe\.com\/v3\/';/);
});
