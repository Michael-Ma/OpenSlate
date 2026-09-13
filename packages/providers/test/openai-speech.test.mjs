import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { OPENAI_SPEECH_MODEL, OPENAI_SPEECH_BUDGET, OPENAI_SPEECH_VOICES, OpenAISpeechAdapter, describeOpenAISpeechRequest } from "../dist/openai-speech.js";

const key = "offline-speech-key";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const request = { model: OPENAI_SPEECH_MODEL, voice: "coral", text: "Leather boots.\n手工缝制 👞", instructions: "Warm, measured delivery." };
function wav() { const bytes = Buffer.alloc(364); bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write("data", 36); bytes.writeUInt32LE(bytes.length - 44, 40); return bytes; }
const output = wav();
const context = (value = request) => { const d = describeOpenAISpeechRequest(value); return { attemptId: "speech-1", expectedRequestDigest: d.requestDigest, expectedBodySha256: d.bodySha256 }; };
const response = (bytes = output, mime = "audio/wav") => new Response(bytes, { headers: { "content-type": mime, "x-request-id": "req-speech" } });
const adapter = (fetch, options = {}) => new OpenAISpeechAdapter({ apiKey: key, fetch, ...options });

test("speech sends exact pinned text/settings once and retains raw waveform identity without invented measurements", async () => {
  let calls = 0;
  const transport = adapter(async (url, init) => {
    calls++; assert.equal(url, "https://api.openai.com/v1/audio/speech"); assert.equal(init.method, "POST"); assert.equal(init.redirect, "error");
    assert.equal(init.headers.Authorization, `Bearer ${key}`); assert.equal(init.headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(Buffer.from(init.body).toString("utf8")), { model: OPENAI_SPEECH_MODEL, input: request.text, voice: "coral", instructions: request.instructions,
      response_format: "wav", stream_format: "audio", speed: 1 });
    assert.equal(sha(init.body), context().expectedBodySha256); assert.equal(init.headers["Idempotency-Key"], undefined); return response();
  });
  const result = await transport.submit(request, context());
  assert.equal(calls, 1); assert.equal(result.kind, "completed"); assert.equal(result.reportedModel, null); assert.equal(result.result.usage, null);
  assert.deepEqual(Buffer.from(result.result.bytes), output); assert.equal(result.result.sha256, sha(output)); assert.equal(result.result.byteLength, output.length);
  assert.equal(result.result.fixture, false); assert.equal(result.result.duration, undefined); assert.equal(result.result.samples, undefined);
  assert.equal(result.receipt.requestId, "req-speech"); assert.equal(result.receipt.taskId, undefined); assert.equal(JSON.stringify(transport).includes(key), false);
});

test("descriptions preserve alias and Unicode identity without leaking text; property order is irrelevant", () => {
  const original = describeOpenAISpeechRequest(request);
  assert.deepEqual(describeOpenAISpeechRequest({ instructions: request.instructions, text: request.text, voice: request.voice, model: request.model }), original);
  assert.equal(original.textSha256, sha(request.text)); assert.equal(original.textBytes, Buffer.byteLength(request.text)); assert.equal(original.budgetPolicy, "utf8-cap-v1");
  assert.equal(JSON.stringify(original).includes(request.text), false);
  for (const changed of [{ text: request.text + " " }, { instructions: "Calm." }, { voice: "cedar" }, { model: "gpt-4o-mini-tts" }]) {
    const d = describeOpenAISpeechRequest({ ...request, ...changed }); assert.notEqual(d.requestDigest, original.requestDigest); assert.notEqual(d.bodySha256, original.bodySha256);
  }
  assert.equal(describeOpenAISpeechRequest({ ...request, model: "gpt-4o-mini-tts" }).model, "gpt-4o-mini-tts");
  assert.equal(Object.isFrozen(OPENAI_SPEECH_VOICES), true); assert.equal(Object.isFrozen(OPENAI_SPEECH_BUDGET), true);
});

test("UTF-8 host cap includes voice/model/instructions and multilingual bytes at the exact boundary", () => {
  const fixed = { model: OPENAI_SPEECH_MODEL, voice: "coral", instructions: "i".repeat(256) };
  const available = 1792 - Buffer.byteLength(fixed.model + fixed.voice + fixed.instructions);
  const text = "👞".repeat(Math.floor(available / 4)) + "x".repeat(available % 4);
  assert.equal(describeOpenAISpeechRequest({ ...fixed, text }).totalTextBytes, 1792);
  assert.throws(() => describeOpenAISpeechRequest({ ...fixed, text: text + "x" }), { code: "TEXT_BUDGET_EXCEEDED" });
  assert.throws(() => describeOpenAISpeechRequest({ ...fixed, text: "x", instructions: "界".repeat(86) }), { code: "INVALID_INSTRUCTIONS" });
  assert.throws(() => describeOpenAISpeechRequest({ ...fixed, text: "x".repeat(4097) }), { code: "INVALID_TEXT" });
  assert.equal(describeOpenAISpeechRequest({ ...fixed, text: "x", instructions: "" }).instructionBytes, 0);
});

test("invalid text/model/voice/fields and both mismatched digests cause no HTTP call", async () => {
  let calls = 0; const transport = adapter(async () => { calls++; return response(); });
  for (const value of [null, [], Object.create({ ...request }), { ...request, model: "tts-1" }, { ...request, voice: { id: "voice_custom" } },
    { ...request, voice: "other" }, { ...request, text: " " }, { ...request, text: "\ud800" }, { ...request, text: "\udc00" },
    { ...request, instructions: undefined }, { ...request, speed: 2 }, { ...request, url: "https://private.invalid" }]) {
    const result = await transport.submit(value, context()); assert.equal(result.kind, "rejected"); assert.equal(result.source, "local");
  }
  for (const field of ["expectedRequestDigest", "expectedBodySha256"]) {
    const result = await transport.submit(request, { ...context(), [field]: "0".repeat(64) }); assert.equal(result.code, "REQUEST_DIGEST_MISMATCH");
  }
  assert.equal(calls, 0);
});

test("accessors, toJSON and malformed context/options are rejected without invoking caller getters", async () => {
  let getters = 0, calls = 0;
  const transport = adapter(async () => { calls++; return response(); });
  const value = { ...request }; Object.defineProperty(value, "text", { get() { getters++; return "changed"; }, enumerable: true });
  assert.equal((await transport.submit(value, context())).kind, "rejected");
  const ctx = context(); Object.defineProperty(ctx, "signal", { get() { getters++; return undefined; }, enumerable: true });
  assert.equal((await transport.submit(request, ctx)).kind, "rejected");
  const options = { apiKey: key }; Object.defineProperty(options, "fetch", { get() { getters++; return globalThis.fetch; } });
  assert.throws(() => new OpenAISpeechAdapter(options), { code: "INVALID_ADAPTER_OPTION" });
  assert.equal((await transport.submit({ ...request, toJSON() { getters++; return request; } }, context())).kind, "rejected");
  for (const ctx of [null, [], {}, { ...context(), signal: {} }]) assert.equal((await transport.submit(request, ctx)).kind, "rejected");
  assert.equal(getters, 0); assert.equal(calls, 0);
});

test("request, context and constructor option mutations after dispatch do not change transmitted identity", async () => {
  let release; const ready = new Promise(resolve => { release = resolve; }); let sent;
  const own = { ...request }, ctx = context(), options = { apiKey: key, fetch: async (_url, init) => { await ready; sent = init; return response(); } };
  const transport = new OpenAISpeechAdapter(options), running = transport.submit(own, ctx);
  own.text = "changed"; own.voice = "echo"; ctx.attemptId = "different"; ctx.expectedRequestDigest = "0".repeat(64); options.apiKey = "replacement";
  release(); const result = await running;
  assert.equal(result.kind, "completed"); assert.equal(result.receipt.attemptId, "speech-1"); assert.equal(result.receipt.requestDigest, context().expectedRequestDigest);
  assert.equal(JSON.parse(Buffer.from(sent.body).toString()).input, request.text); assert.equal(sent.headers.Authorization, `Bearer ${key}`);
});

test("response MIME and RIFF identity are required; binary success makes no claims about full decode", async () => {
  for (const [bytes, mime] of [[output, "application/json"], [Buffer.from('{"error":{"message":"private"}}'), "audio/wav"], [Buffer.alloc(11), "audio/wav"], [Buffer.alloc(40), "audio/wav"]]) {
    const result = await adapter(async () => response(bytes, mime)).submit(request, context()); assert.equal(result.kind, "unknown"); assert.equal(result.code, "OUTPUT_FORMAT_MISMATCH");
  }
  for (const mime of ["audio/wav", "audio/x-wav", "audio/wave", "application/octet-stream", "audio/wav; charset=binary"]) {
    const result = await adapter(async () => response(output, mime)).submit(request, context()); assert.equal(result.kind, "completed");
  }
  const headerOnly = Buffer.from(output.subarray(0, 12));
  const raw = await adapter(async () => response(headerOnly)).submit(request, context());
  assert.equal(raw.kind, "completed"); assert.equal(raw.result.byteLength, 12); assert.equal(raw.result.sha256, sha(headerOnly));
  // Raw transport completion is not playable media: there are no samples or
  // duration, and later application ingestion must reject this incomplete WAV.
  for (const field of ["samples", "duration", "sampleRate", "playable", "artifactId"]) assert.equal(raw.result[field], undefined);
});

test("constructor limits can only be lowered and credential diagnostics remain sanitized", () => {
  for (const options of [null, { apiKey: "" }, { apiKey: "bad key" }, { apiKey: key, timeoutMs: 120001 }, { apiKey: key, maxResponseBytes: 32 * 1024 ** 2 + 1 },
    { apiKey: key, timeoutMs: 0 }, { apiKey: key, maxResponseBytes: NaN }, { apiKey: key, baseUrl: "https://other.invalid" }]) {
    assert.throws(() => new OpenAISpeechAdapter(options), error => !error.message.includes(key));
  }
});
