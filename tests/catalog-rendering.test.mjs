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
