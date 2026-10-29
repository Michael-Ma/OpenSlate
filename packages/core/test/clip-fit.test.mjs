import test from "node:test";
import assert from "node:assert/strict";
import { CLIP_COVER_TOLERANCE, clipFit } from "../dist/clip-fit.js";
import * as browser from "../dist/public.js";

test("clipFit crops clips near the film shape to fill it and keeps other shapes whole", () => {
  assert.equal(CLIP_COVER_TOLERANCE, 1.25);
  // The Viggle H3 sizes seen for one 9:16 film (2:3 first frames): every one fills the 720 x 1280 frame.
  for (const [width, height] of [[768, 1152], [768, 1216], [768, 1344], [1024, 1536]]) assert.equal(clipFit(width, height, 720, 1280, true), "cover", `${width}x${height}`);
  // Another orientation or a square clip stays whole with bars.
  assert.equal(clipFit(1280, 720, 720, 1280, true), "contain");
  assert.equal(clipFit(1024, 1024, 720, 1280, true), "contain");
  assert.equal(clipFit(1024, 1024, 1280, 720, true), "contain", "square in 16:9 is 1.78x off");
  assert.equal(clipFit(1536, 1024, 1280, 720, true), "cover", "3:2 in 16:9");
  // An exact match needs no crop; the recipe stays "contain".
  assert.equal(clipFit(720, 1280, 720, 1280, true), "contain");
  // A film without a chosen format keeps contain for every clip, so its frozen manifests are byte-identical.
  assert.equal(clipFit(768, 1152, 1280, 720, false), "contain");
  assert.equal(clipFit(1536, 1024, 1280, 720, false), "contain");
  // Unknown sizes never crop.
  for (const bad of [[0, 1280], [NaN, 1], [720, -1]]) assert.equal(clipFit(bad[0], bad[1], 720, 1280, true), "contain");
  assert.equal(browser.clipFit, clipFit, "the Film preview uses the same rule");
});
