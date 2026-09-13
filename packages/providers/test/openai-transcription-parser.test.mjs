import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { OPENAI_TRANSCRIPTION_PROJECTION_VERSION, OpenAITranscriptionAdapter,
  parseOpenAITranscriptionResponse } from "../dist/index.js";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const maximum = 4 * 1024 * 1024;
const payload = (extra = {}) => ({ text: "Hello world.", language: "english", duration: 1,
  words: [{ word: "Hello", start: 0, end: 0.4 }, { word: "world.", start: 0.5, end: 1 }],
  model: "whisper-1", usage: { type: "duration", seconds: 1 }, ...extra });
const input = (bytes = Buffer.from(JSON.stringify(payload())), sourceDurationSeconds = 1) => ({ bytes, mimeType: "application/json", sourceDurationSeconds });
const parse = (value, sourceDurationSeconds = 1, options) => parseOpenAITranscriptionResponse(input(Buffer.from(JSON.stringify(value)), sourceDurationSeconds), options);
function wave(samples = 16000) {
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write("data", 36); bytes.writeUInt32LE(samples * 2, 40);
  return bytes;
}
async function transport(bytes, sourceDurationSeconds = 1, options = {}) {
  let calls = 0;
  const adapter = new OpenAITranscriptionAdapter({ apiKey: "offline-parser-fixture", ...options,
    fetch: async () => { calls++; return new Response(bytes, { headers: { "content-type": "application/json; charset=utf-8" } }); } });
  const audio = wave(sourceDurationSeconds * 16000), request = { model: "whisper-1", language: null, timing: "word",
    input: { artifactId: "derivative-fixture", sha256: hash(audio), mimeType: "audio/wav", bytes: audio } };
  const description = adapter.describe(request), result = await adapter.submit(request, { attemptId: "attempt-fixture",
    expectedRequestDigest: description.requestDigest, expectedBodySha256: description.bodySha256 });
  assert.equal(calls, 1); return result;
}

test("public parser preserves frozen projection version and existing raw/result identities", () => {
  assert.equal(OPENAI_TRANSCRIPTION_PROJECTION_VERSION, 1);
  const parsed = parseOpenAITranscriptionResponse(input());
  assert.equal(parsed.result.resultDigest, "79699ee3f09977b13ffd5f8eab9958559cd7a6901668843d037f9096b1a83564");
  assert.equal(parsed.result.rawResponseSha256, "7292ba9e07fbadb7b7070d2b5b82727bd608fe07ec47c86d630bcc9d4c93ce0a");
  assert.equal(parsed.reportedModel, "whisper-1");
  assert.deepEqual(parsed.result.timingIssues, []);
});

test("saved JSON and single-POST transport use the identical projection for valid, empty and problematic timing", async () => {
  for (const value of [payload(), payload({ text: "", words: [], duration: 0, model: undefined, usage: undefined }),
    payload({ text: "Different", duration: 2, model: "unknown-future-model", usage: { type: "other" }, words: [
      { word: "One", start: 0, end: 1.5 }, { word: "two", start: 0.1, end: 0.2 }, { word: "three", start: 0.3, end: 0.4 },
    ] }), payload({ text: "  你好\n世界。 ", language: "chinese", words: [
      { word: "你好", start: 0, end: 0.5 }, { word: "世界。", start: 0.5, end: 1 },
    ] })]) {
    for (const space of [undefined, 2]) {
      const bytes = Buffer.from(JSON.stringify(value, null, space)), parsed = parseOpenAITranscriptionResponse(input(bytes));
      const completed = await transport(bytes);
      assert.equal(completed.kind, "completed");
      assert.deepEqual(parsed, { reportedModel: completed.reportedModel, result: completed.result });
    }
  }
});

test("JSON whitespace changes exact raw identity but never semantic projection identity", () => {
  const a = parseOpenAITranscriptionResponse(input(Buffer.from(JSON.stringify(payload()))));
  const b = parseOpenAITranscriptionResponse(input(Buffer.from(JSON.stringify(payload(), null, 2) + "\n")));
  assert.notEqual(a.result.rawResponseSha256, b.result.rawResponseSha256);
  assert.equal(a.result.resultDigest, b.result.resultDigest);
  assert.deepEqual(a.result.words, b.result.words);
});

test("parser snapshots the exact byte view and results remain independent from input and each other", () => {
  const raw = Buffer.from(JSON.stringify(payload())), backing = Buffer.concat([Buffer.from("prefix"), raw, Buffer.from("suffix")]);
  const value = input(backing.subarray(6, backing.length - 6));
  const first = parseOpenAITranscriptionResponse(value), second = parseOpenAITranscriptionResponse(value);
  backing.fill(0); value.bytes = Buffer.from("changed"); value.sourceDurationSeconds = 360;
  assert.deepEqual(first.result.rawResponseBytes, raw); assert.equal(first.result.rawResponseSha256, hash(raw));
  first.result.rawResponseBytes.fill(1); first.result.words[0].word = "changed";
  assert.deepEqual(second.result.rawResponseBytes, raw); assert.equal(second.result.words[0].word, "Hello");
});

test("plain own-data input and options reject getters, unknown fields and inherited data without invoking them", () => {
  let reads = 0;
  const accessor = input(); Object.defineProperty(accessor, "bytes", { get() { reads++; return Buffer.from("unsafe"); } });
  const duration = input(); Object.defineProperty(duration, "sourceDurationSeconds", { get() { reads++; return 1; } });
  const option = {}; Object.defineProperty(option, "maxWords", { get() { reads++; return 2; } });
  for (const value of [null, [], new Date(), Object.create(input()), accessor, duration,
    { ...input(), path: "/untrusted/path" }, { ...input(), toJSON() { reads++; } }, { ...input(), [Symbol("extra")]: 1 }])
    assert.throws(() => parseOpenAITranscriptionResponse(value), /INVALID_TRANSCRIPTION_PARSE_INPUT/);
  for (const options of [null, [], Object.create({ maxWords: 2 }), option, { maxResponseBytes: maximum + 1 },
    { [Symbol("extra")]: 1 }, { toJSON() { reads++; } }])
    assert.throws(() => parseOpenAITranscriptionResponse(input(), options), /INVALID_ADAPTER_OPTION/);
  assert.equal(reads, 0);
  assert.equal(parseOpenAITranscriptionResponse(Object.assign(Object.create(null), input()), Object.create(null)).result.text, "Hello world.");
});

test("intrinsic byte geometry ignores custom getters and rejects fake, shared or detached buffers", () => {
  let reads = 0; const raw = Buffer.from(JSON.stringify(payload()));
  const value = new Uint8Array(raw);
  for (const name of ["buffer", "byteOffset", "byteLength"]) Object.defineProperty(value, name, { get() { reads++; throw Error("unsafe getter"); } });
  Object.defineProperty(value, Symbol.iterator, { get() { reads++; throw Error("unsafe iterator"); } });
  assert.deepEqual(parseOpenAITranscriptionResponse(input(value)).result.rawResponseBytes, raw); assert.equal(reads, 0);
  const detached = new Uint8Array(raw); structuredClone(detached.buffer, { transfer: [detached.buffer] });
  for (const bytes of [Object.create(Uint8Array.prototype), new Uint16Array(5), new Uint8Array(new SharedArrayBuffer(raw.length)), detached, []])
    assert.throws(() => parseOpenAITranscriptionResponse(input(bytes)), error => error.name === "Error" && /^INVALID_TRANSCRIPTION_RESPONSE_BYTES|RESPONSE_TOO_LARGE$/.test(error.message));
});

test("actual response bytes are bounded at four MiB even with misleading byteLength", () => {
  const raw = Buffer.from(JSON.stringify(payload())), full = Buffer.concat([raw, Buffer.alloc(maximum - raw.length, 32)]);
  const parsed = parseOpenAITranscriptionResponse(input(full));
  assert.equal(parsed.result.rawResponseBytes.length, maximum); assert.equal(parsed.result.rawResponseSha256, hash(full));
  const oversized = new Uint8Array(maximum + 1); let reads = 0;
  Object.defineProperty(oversized, "byteLength", { get() { reads++; return 1; } });
  assert.throws(() => parseOpenAITranscriptionResponse(input(oversized)), /RESPONSE_TOO_LARGE/); assert.equal(reads, 0);
  assert.throws(() => parseOpenAITranscriptionResponse(input(Buffer.alloc(0))), /RESPONSE_TOO_LARGE/);
});

test("measured source duration is required, bounded and influences issues without rewriting timings", () => {
  for (const sourceDurationSeconds of [undefined, null, "1", 0, -1, NaN, Infinity, 360.000001])
    assert.throws(() => parseOpenAITranscriptionResponse({ ...input(), sourceDurationSeconds }), /INVALID_SOURCE_DURATION/);
  const body = payload({ duration: 2, words: [{ word: "Hello world.", start: 0, end: 2 }] });
  const short = parse(body), long = parse(body, 360);
  assert.deepEqual(short.result.words, long.result.words); assert.notEqual(short.result.resultDigest, long.result.resultDigest);
  assert.deepEqual(short.result.timingIssues, [{ code: "word_outside_source", wordIndex: 0 }, { code: "reported_duration_outside_source", wordIndex: null }]);
  assert.deepEqual(long.result.timingIssues, []);
});

test("existing huge finite seconds remain raw evidence for later explicit unmappable handling", async () => {
  const value = payload({ text: "Huge", duration: Number.MAX_VALUE, words: [{ word: "Huge", start: 0, end: Number.MAX_VALUE }] });
  const bytes = Buffer.from(JSON.stringify(value)), parsed = parseOpenAITranscriptionResponse(input(bytes));
  assert.equal(parsed.result.words[0].endSeconds, Number.MAX_VALUE);
  assert.deepEqual(parsed.result.timingIssues, [{ code: "word_outside_source", wordIndex: 0 }, { code: "reported_duration_outside_source", wordIndex: null }]);
  const completed = await transport(bytes); assert.equal(completed.kind, "completed"); assert.deepEqual(parsed.result, completed.result);
});

test("malformed UTF-8/JSON, contradictory envelopes and malformed words fail through the same decoder", async () => {
  const rawCases = [Buffer.from([255]), Buffer.from("{"), Buffer.from("null"), Buffer.from("[]")];
  for (const value of [payload({ error: null }), payload({ words: undefined }), payload({ words: [] }), payload({ text: "\ud800" }),
    payload({ language: null }), payload({ duration: -1 }), payload({ words: [{ word: "Hello", start: 1, end: 0 }] })])
    rawCases.push(Buffer.from(JSON.stringify(value)));
  for (const bytes of rawCases) {
    let code;
    assert.throws(() => parseOpenAITranscriptionResponse(input(bytes)), error => { code = error.code; return typeof code === "string"; });
    const observed = await transport(bytes); assert.equal(observed.kind, "unknown"); assert.equal(observed.code, code);
  }
  for (const mimeType of [undefined, null, "text/plain", "application/json; charset=utf-8", "APPLICATION/JSON"])
    assert.throws(() => parseOpenAITranscriptionResponse({ ...input(), mimeType }), /INVALID_TRANSCRIPTION_MIME/);
});

test("parser limits only lower exact UTF-8 text/word and entry bounds, matching transport limits", async () => {
  const body = payload({ text: "é", words: [{ word: "é", start: 0, end: 1 }] }), bytes = Buffer.from(JSON.stringify(body));
  const options = { maxTextBytes: 2, maxWordBytes: 2, maxWords: 1 };
  const parsed = parseOpenAITranscriptionResponse(input(bytes), options), completed = await transport(bytes, 1, options);
  assert.equal(completed.kind, "completed"); assert.deepEqual(parsed.result, completed.result);
  for (const lower of [{ maxTextBytes: 1 }, { maxWordBytes: 1 }]) {
    assert.throws(() => parseOpenAITranscriptionResponse(input(bytes), lower), /INVALID_TRANSCRIPT/);
    assert.equal((await transport(bytes, 1, lower)).kind, "unknown");
  }
  assert.throws(() => parseOpenAITranscriptionResponse(input(), { maxWords: 1 }), /INVALID_TRANSCRIPT_WORDS/);
  for (const options of [{ maxTextBytes: 262145 }, { maxWords: 8193 }, { maxWordBytes: 1025 },
    { maxWords: 0 }, { maxWords: 1.1 }, { maxWords: NaN }, { maxWords: Infinity }, { maxWords: null }])
    assert.throws(() => parseOpenAITranscriptionResponse(input(), options), /INVALID_ADAPTER_OPTION/);
  assert.deepEqual(parse(payload({ text: "", words: [] }), 1, { maxWords: 1 }).result.words, []);
});
