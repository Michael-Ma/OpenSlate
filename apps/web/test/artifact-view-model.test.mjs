import test from "node:test";
import assert from "node:assert/strict";
import { artifactIdentity, artifactView } from "../src/artifact-view-model.ts";
const a = { artifactId: "a", sha256: "a".repeat(64), kind: "image" };
test("same node receiving a different hash cannot display old bytes under the new review", () => {
  const api = {},
    signal = new AbortController().signal,
    result = {
      api,
      identity: artifactIdentity("p", a),
      signal,
      url: "blob:old-frame",
      error: "",
    };
  assert.equal(
    artifactView(result, api, result.identity).url,
    "blob:old-frame",
  );
  assert.equal(
    artifactView(
      result,
      api,
      artifactIdentity("p", { ...a, sha256: "b".repeat(64) }),
    ).url,
    null,
  );
});
test("project, media kind, API session, missing artifact and aborted ownership all fence visible bytes", () => {
  const api = {},
    controller = new AbortController(),
    result = {
      api,
      identity: artifactIdentity("p", a),
      signal: controller.signal,
      url: "blob:old",
      error: "old error",
    };
  for (const identity of [
    artifactIdentity("q", a),
    artifactIdentity("p", { ...a, kind: "video" }),
    artifactIdentity("p", null),
  ])
    assert.deepEqual(artifactView(result, api, identity), {
      url: null,
      error: "",
    });
  assert.equal(artifactView(result, {}, result.identity).url, null);
  controller.abort();
  assert.deepEqual(artifactView(result, api, result.identity), {
    url: null,
    error: "",
  });
});

test("retry immediately fences an old URL or error until the new exact fetch returns", () => {
  const api = {},
    identity = artifactIdentity("p", a),
    controller = new AbortController();
  const previous = {
    api,
    identity,
    signal: controller.signal,
    version: 0,
    url: "blob:old",
    error: "",
  };
  assert.deepEqual(artifactView(previous, api, identity, 1), {
    url: null,
    error: "",
  });
  assert.deepEqual(
    artifactView(
      { ...previous, url: null, error: "Previous fetch failed" },
      api,
      identity,
      1,
    ),
    { url: null, error: "" },
  );
  const current = { ...previous, version: 1, url: "blob:new" };
  assert.equal(artifactView(current, api, identity, 1).url, "blob:new");
  assert.equal(
    artifactView(
      current,
      api,
      artifactIdentity("p", { ...a, sha256: "b".repeat(64) }),
      1,
    ).url,
    null,
    "retry never substitutes a different artifact hash",
  );
  controller.abort();
  assert.equal(artifactView(current, api, identity, 1).url, null);
});
