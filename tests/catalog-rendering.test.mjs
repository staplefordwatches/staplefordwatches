import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const regularFont = await readFile(new URL("../fonts/sweet-sans-pro-regular-v1.otf", import.meta.url));
const favicon = await readFile(new URL("../favicon.ico", import.meta.url));
const favicon32 = await readFile(new URL("../favicon-32x32.png", import.meta.url));
const appleTouchIcon = await readFile(new URL("../apple-touch-icon.png", import.meta.url));
const webmanifest = JSON.parse(await readFile(new URL("../site.webmanifest", import.meta.url), "utf8"));

test("the initial document avoids embedded images and oversized fonts", () => {
  assert.doesNotMatch(html, /data:image\//);
  assert.match(html, /img\{color:transparent;font-size:0;line-height:0\}/);
  assert.match(html, /src="\/assets\/stapleford-watches-logo@2x\.png\?v=1"/);
  assert.match(html, /\.site-header \.logo::before\{[^}]*background:var\(--sw-navy,#0a2342\)/);
  assert.match(html, /\.site-header \.logo-mark\{[^}]*opacity:0/);
  assert.match(html, /href="\/fonts\/sweet-sans-pro-regular-v1\.otf"/);
  assert.ok(regularFont.byteLength < 75_000);
});

test("the Stapleford logo is available in every favicon format", () => {
  assert.match(html, /href="\/favicon\.svg\?v=5" rel="icon" type="image\/svg\+xml"/);
  assert.match(html, /href="\/favicon\.ico\?v=5" rel="icon" sizes="any"/);
  assert.ok(favicon.byteLength > 0);
  assert.ok(favicon32.byteLength > 0);
  assert.ok(appleTouchIcon.byteLength > 0);
  assert.equal(webmanifest.name, "Stapleford Watches");
  assert.deepEqual(webmanifest.icons.map((icon) => icon.sizes), ["192x192", "512x512"]);
});

test("listing images stay sharp at every responsive grid width", () => {
  assert.match(html, /const GRID_IMAGE_WIDTHS = \[320, 480, 640, 800, 1040, 1280, 1600, 2000, 2400\];/);
  assert.match(html, /const GRID_IMAGE_SIZES = '\(max-width: 767px\) calc\(\(100vw - 3px\) \/ 2\), \(max-width: 1199px\) calc\(\(100vw - 6px\) \/ 3\), calc\(\(100vw - 9px\) \/ 4\)';/);
  assert.match(html, /f_auto,q_auto:good,fl_progressive,e_sharpen:40,c_fill,g_auto,ar_4:5,w_\$\{width\}/);
  assert.match(html, /sizes="\$\{GRID_IMAGE_SIZES\}"/);
  assert.match(html, /preload\.setAttribute\('imagesizes', GRID_IMAGE_SIZES\)/);
});

test("contact actions share the same bordered treatment", () => {
  assert.match(html, /\.info-hero \.curated-hero-action\{border:1px solid var\(--curated-line\)!important;border-radius:999px!important\}/);
  assert.match(html, /actions:\[\{ label:'Email us'.*\{ label:'Chat to us'/);
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
