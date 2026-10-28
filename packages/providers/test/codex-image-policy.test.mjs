import test from "node:test";
import assert from "node:assert/strict";
import { canonical, digest } from "@openslate/core";
import { codexImageCanvasValid, codexImageTurnText, describeCodexImageInput } from "../dist/index.js";

const input = (extra = {}) => ({ attemptId: "attempt-1", requestDigest: "a".repeat(64), prompt: "A cat eyeing toast", width: 1024, height: 1024,
  runtimeVersion: "0.153.4", model: "gpt-6-astra", images: [{ artifactId: "ref-1", sha256: "b".repeat(64), byteLength: 100 }], ...extra });

test("codex-image-turn-v1 stays byte-for-byte: same body, digest and turn text as before v2", () => {
  const value = input(), description = describeCodexImageInput(value);
  // The original v1 body, written out literally: saved receipts reconcile against exactly this digest.
  const body = { version: 1, policy: "codex-image-turn-v1", attemptId: value.attemptId, requestDigest: value.requestDigest, prompt: value.prompt,
    width: 1024, height: 1024, runtimeVersion: "0.153.4", model: "gpt-6-astra", images: value.images };
  assert.deepEqual(description, { ...body, turnInputDigest: digest(body) });
  assert.equal(Object.hasOwn(description, "aspect"), false);
  assert.equal(codexImageTurnText({ ...value, images: [] }), "Generate one image for this exact application request. Use the attached references in their supplied order. Do not run shell commands or other tools. Return the generated image. Requested dimensions are preferences.\n"
    + canonical(describeCodexImageInput({ ...value, images: [] })));
  for (const [width, height] of [[1024, 1536], [1536, 1024], [512, 512]])
    assert.throws(() => describeCodexImageInput(input({ width, height })), error => error.code === "CODEX_IMAGE_INPUT_INVALID", "v1 is square only");
});

test("codex-image-turn-v2 accepts exactly its aspect's canvas", () => {
  for (const [aspect, width, height] of [["9:16", 1024, 1536], ["16:9", 1536, 1024], ["1:1", 1024, 1024]]) {
    const description = describeCodexImageInput(input({ aspect, width, height }));
    assert.equal(description.version, 2); assert.equal(description.policy, "codex-image-turn-v2"); assert.equal(description.aspect, aspect);
    assert.deepEqual([description.width, description.height], [width, height]);
    const { turnInputDigest, ...body } = description; assert.equal(turnInputDigest, digest(body));
  }
  assert.notEqual(describeCodexImageInput(input({ aspect: "1:1" })).turnInputDigest, describeCodexImageInput(input()).turnInputDigest, "a v2 square turn is not a v1 turn");
  for (const [aspect, width, height] of [["9:16", 1024, 1024], ["9:16", 1536, 1024], ["16:9", 1024, 1536], ["4:5", 1024, 1280], ["9:16", 720, 1280]])
    assert.throws(() => describeCodexImageInput(input({ aspect, width, height })), error => error.code === "CODEX_IMAGE_INPUT_INVALID", `${aspect} ${width}x${height}`);
  assert.throws(() => describeCodexImageInput(input({ aspect: undefined })), error => error.code === "CODEX_IMAGE_INPUT_INVALID");
  assert.ok(codexImageCanvasValid(1024, 1024, undefined)); assert.ok(!codexImageCanvasValid(1024, 1536, undefined)); assert.ok(codexImageCanvasValid(1024, 1536, "9:16"));
  assert.match(codexImageTurnText({ ...input({ aspect: "16:9", width: 1536, height: 1024 }), images: [] }), /16:9 landscape frame and generate it at 1536x1024/);
});
