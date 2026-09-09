import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

test("the initial page paint cannot expose a separate grey header strip", () => {
  assert.match(html, /<html class="sw-booting" lang="en">/);
  assert.match(
    html,
    /html\.sw-booting body\{background:var\(--curated-shell,#f2f2f0\)!important\}/,
  );
});

test("the temporary first-paint background is removed after the page is assembled", () => {
  const bootStart = html.indexOf("function boot(){");
  const routeReady = html.indexOf("else showRoute(key);", bootStart);
  const loadingStarts = html.indexOf("loadWatches();", routeReady);
  const paintGuardEnds = html.indexOf(
    "document.documentElement.classList.remove('sw-booting');",
    loadingStarts,
  );

  assert.ok(bootStart >= 0);
  assert.ok(routeReady > bootStart);
  assert.ok(loadingStarts > routeReady);
  assert.ok(paintGuardEnds > loadingStarts);
});
