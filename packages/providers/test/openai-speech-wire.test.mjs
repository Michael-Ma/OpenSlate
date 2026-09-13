import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describeOpenAISpeechRequest, describeOpenAISpeechWireRequest, OpenAISpeechAdapter } from "../dist/index.js";

const request = { model: "gpt-4o-mini-tts-2025-12-15", voice: "coral", text: "Leather boots.\n手工缝制 👞", instructions: "Warm, measured delivery." };
const expected = { adapter: "openai-speech-v1", model: request.model, voice: "coral", responseFormat: "wav", streamFormat: "audio", speed: 1,
  textSha256: "6140c50d83243fac4b22b204aa813effd7edc8af762d88ca6d1fce078e38747a", instructionSha256: "48b1a453d801a03439a3be814113457f6c83b3c7b677ca4aab07c939a450e0b5",
  textBytes: 32, instructionBytes: 24, totalTextBytes: 87, budgetPolicy: "utf8-cap-v1", requestDigest: "bd627837084ad156dd3d66eba3b31da1ee2289157e2b03cf5d0281c64729ed9b",
  bodySha256: "442aa7220548fe706ddb82e016e195aa00f4fe5a6a6deacd5380c15d7b580d60" };

test("additive speech wire description preserves the historical golden description and actual JSON bytes", async () => {
  const wire = describeOpenAISpeechWireRequest(request);
  assert.deepEqual(wire.description, expected); assert.deepEqual(describeOpenAISpeechRequest(request), expected);
  assert.deepEqual(Object.keys(wire).sort(), ["bodyByteLength", "description"]);
  let calls = 0;
  const adapter = new OpenAISpeechAdapter({ apiKey: "offline-wire-fixture", fetch: async (_url, init) => {
    calls++; const body = Buffer.from(init.body);
    assert.equal(body.length, wire.bodyByteLength); assert.equal(createHash("sha256").update(body).digest("hex"), expected.bodySha256);
    assert.deepEqual(JSON.parse(body.toString("utf8")), { model: request.model, input: request.text, voice: request.voice,
      instructions: request.instructions, response_format: "wav", stream_format: "audio", speed: 1 });
    return new Response(Buffer.from("RIFF\x04\x00\x00\x00WAVE", "latin1"), { headers: { "content-type": "audio/wav" } });
  } });
  assert.equal((await adapter.submit(request, { attemptId: "wire-1", expectedRequestDigest: expected.requestDigest,
    expectedBodySha256: expected.bodySha256 })).kind, "completed"); assert.equal(calls, 1);
  wire.description.model = "caller-mutated"; assert.deepEqual(describeOpenAISpeechWireRequest(request).description, expected);
});

test("wire helper uses the same strict request validator without invoking accessors", () => {
  let reads = 0; const accessor = { ...request }; Object.defineProperty(accessor, "text", { get() { reads++; return request.text; }, enumerable: true });
  assert.throws(() => describeOpenAISpeechWireRequest(accessor), { code: "INVALID_REQUEST" });
  assert.throws(() => describeOpenAISpeechWireRequest({ ...request, speed: 2 }), { code: "INVALID_REQUEST" });
  assert.throws(() => describeOpenAISpeechWireRequest({ ...request, text: "x".repeat(1792) }), { code: "TEXT_BUDGET_EXCEEDED" });
  assert.equal(reads, 0);
});
