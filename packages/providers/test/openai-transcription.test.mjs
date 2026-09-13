import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { getEventListeners } from "node:events";
import {
  OPENAI_TRANSCRIPTION_MODEL, OpenAITranscriptionAdapter, describeOpenAITranscriptionRequest,
} from "../dist/openai-transcription.js";

const key = "offline-transcription-placeholder";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
function wave(samples = 16000, ancillary = []) {
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(1); fmt.writeUInt16LE(1, 2); fmt.writeUInt32LE(16000, 4);
  fmt.writeUInt32LE(32000, 8); fmt.writeUInt16LE(2, 12); fmt.writeUInt16LE(16, 14);
  function chunk(id, bytes) {
    const header = Buffer.alloc(8); header.write(id); header.writeUInt32LE(bytes.length, 4);
    return Buffer.concat([header, bytes, ...(bytes.length % 2 ? [Buffer.alloc(1)] : [])]);
  }
  const content = Buffer.concat([Buffer.from("WAVE"), chunk("fmt ", fmt),
    ...ancillary.map(([id, bytes]) => chunk(id, bytes)), chunk("data", Buffer.alloc(samples * 2))]);
  const header = Buffer.alloc(8); header.write("RIFF"); header.writeUInt32LE(content.length, 4);
  return Buffer.concat([header, content]);
}
function request(bytes = wave(), extra = {}) {
  return { model: OPENAI_TRANSCRIPTION_MODEL, language: null, timing: "word",
    input: { artifactId: "derivative-1", sha256: hash(bytes), mimeType: "audio/wav", bytes }, ...extra };
}
const payload = (extra = {}) => ({ text: "Hello world.", language: "english", duration: 1,
  words: [{ word: "Hello", start: 0, end: 0.4 }, { word: "world.", start: 0.5, end: 1 }], ...extra });
const response = (value = payload(), status = 200, headers = {}) => new Response(JSON.stringify(value), {
  status, headers: { "content-type": "application/json", "x-request-id": "req-transcription-1", ...headers },
});
const adapter = (fetch, extra = {}) => new OpenAITranscriptionAdapter({ apiKey: key, fetch, ...extra });
function context(value, extra = {}) {
  const description = describeOpenAITranscriptionRequest(value);
  return { attemptId: "attempt-transcription-1", expectedRequestDigest: description.requestDigest,
    expectedBodySha256: description.bodySha256, ...extra };
}
function deferred() {
  let resolve;
  return { promise: new Promise(done => { resolve = done; }), resolve: value => resolve(value) };
}

test("word transcription sends deterministic fixed multipart and preserves exact raw/projection hashes", async () => {
  const value = request(wave(), { language: "en" });
  const description = describeOpenAITranscriptionRequest(value);
  // Recorded v1 wire identity for this synthetic one-second source; catches accidental serializer drift.
  assert.equal(description.requestDigest, "ef563005b96671268bdb0764c44a91e6a5e3413c02c17b7e73d3198b321bd60a");
  assert.equal(description.bodySha256, "d73c601189680bc5ed2c9a6fa041d5300076dda4c592453b8af0d6ea0e2a5a27");
  assert.equal(description.bodyByteLength, 32786);
  const raw = JSON.stringify(payload({ model: "whisper-1", usage: { type: "duration", seconds: 1 } }));
  let count = 0;
  const transport = adapter(async (url, init) => {
    count++;
    assert.equal(url, "https://api.openai.com/v1/audio/transcriptions");
    assert.equal(init.method, "POST"); assert.equal(init.redirect, "error");
    assert.equal(init.headers.Authorization, `Bearer ${key}`);
    assert.equal(init.headers["Content-Type"], description.contentType);
    assert.equal(init.headers["Idempotency-Key"], undefined);
    const boundary = description.contentType.split("boundary=")[1];
    assert.ok(boundary.length <= 70);
    const field = (name, text) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${text}\r\n`);
    const expected = Buffer.concat([field("model", "whisper-1"), field("response_format", "verbose_json"),
      field("timestamp_granularities[]", "word"), field("language", "en"),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.wav"\r\nContent-Type: audio/wav\r\n\r\n`),
      value.input.bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    assert.deepEqual(Buffer.from(init.body), expected);
    assert.equal(hash(init.body), description.bodySha256); assert.equal(init.body.byteLength, description.bodyByteLength);
    assert.ok(description.bodyByteLength - value.input.bytes.length <= 16 * 1024);
    return new Response(raw, { headers: { "content-type": "application/json; charset=utf-8", "x-request-id": "req-known" } });
  });
  assert.deepEqual(transport.describe(value), description);
  assert.deepEqual(description.input.waveform, { format: "pcm-s16le", sampleRate: 16000, channels: 1, bitsPerSample: 16,
    sampleCount: 16000, dataByteLength: 32000, durationSeconds: 1 });
  const result = await transport.submit(value, context(value));
  assert.equal(count, 1); assert.equal(result.kind, "completed"); assert.equal(result.reportedModel, "whisper-1");
  assert.equal(result.receipt.requestId, "req-known"); assert.equal(result.receipt.bodySha256, description.bodySha256);
  assert.equal(result.receipt.requestedModel, "whisper-1");
  assert.equal(Buffer.from(result.result.rawResponseBytes).toString(), raw);
  assert.equal(result.result.rawResponseSha256, hash(raw));
  assert.deepEqual(result.result.timingIssues, []);
  assert.deepEqual(result.result.usage, { type: "duration", seconds: 1 });
  assert.match(result.result.resultDigest, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(description).includes(key), false); assert.equal(JSON.stringify(transport).includes(key), false);
});

test("semantic/property ordering is stable and every supported input choice changes request identity", async () => {
  const value = request(); const baseline = describeOpenAITranscriptionRequest(value);
  const reordered = { input: { bytes: value.input.bytes, mimeType: "audio/wav", sha256: value.input.sha256, artifactId: "derivative-1" },
    timing: "word", language: null, model: "whisper-1" };
  assert.deepEqual(describeOpenAITranscriptionRequest(reordered), baseline);
  const differentAudio = wave(); differentAudio[44] = 1;
  for (const changed of [request(differentAudio), request(wave(15999)), { ...value, language: "zh" },
    { ...value, input: { ...value.input, artifactId: "another-derivative" } }]) {
    const next = describeOpenAITranscriptionRequest(changed);
    assert.notEqual(next.requestDigest, baseline.requestDigest); assert.notEqual(next.bodySha256, baseline.bodySha256);
  }
  let body;
  assert.equal((await adapter(async (_url, init) => { body = Buffer.from(init.body); return response(); })
    .submit(value, context(value))).kind, "completed");
  assert.equal(body.includes(Buffer.from('name="language"')), false);
});

test("a changed artifact ID changes multipart boundary but never adds application identity to form fields", async () => {
  const bytes = wave(), value = request(bytes, { language: "ja" });
  value.input.artifactId = "private-ledger-reference";
  const result = await adapter(async (_url, init) => {
    assert.equal(Buffer.from(init.body).includes(Buffer.from(value.input.artifactId)), false);
    assert.equal(Buffer.from(init.body).includes(bytes), true);
    return response();
  }).submit(value, context(value));
  assert.equal(result.kind, "completed");
});

test("deterministic multipart is interoperable with the standard FormData parser", async () => {
  const value = request(wave(16000, [["JUNK", Buffer.from([13, 10, 255])]]), { language: "en" });
  let count = 0;
  const result = await adapter(async (url, init) => {
    count++;
    const parsed = await new Request(url, init).formData();
    assert.deepEqual([...parsed.keys()], ["model", "response_format", "timestamp_granularities[]", "language", "file"]);
    assert.equal(parsed.get("model"), "whisper-1"); assert.equal(parsed.get("response_format"), "verbose_json");
    assert.deepEqual(parsed.getAll("timestamp_granularities[]"), ["word"]); assert.equal(parsed.get("language"), "en");
    const file = parsed.get("file");
    assert.equal(file.name, "audio.wav"); assert.equal(file.type, "audio/wav");
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), value.input.bytes);
    return response();
  }).submit(value, context(value));
  assert.equal(result.kind, "completed"); assert.equal(count, 1);
});

test("request, byte buffer, context and constructor choices are captured before any await", async () => {
  const bytes = wave(), value = request(bytes), controller = new AbortController(), replacement = new AbortController();
  const bound = context(value, { signal: controller.signal }), description = describeOpenAITranscriptionRequest(value);
  const wait = deferred(); let sent;
  const options = { apiKey: key, maxTextBytes: 100, fetch: async (_url, init) => {
    await wait.promise; sent = Buffer.from(init.body); return response();
  } };
  const transport = new OpenAITranscriptionAdapter(options);
  const pending = transport.submit(value, bound);
  bytes.fill(255); value.language = "zh"; value.input.artifactId = "changed";
  bound.attemptId = "changed"; bound.expectedBodySha256 = "0".repeat(64); bound.signal = replacement.signal;
  options.apiKey = "changed"; options.maxTextBytes = 1; options.fetch = () => { throw new Error("wrong fetch"); };
  wait.resolve();
  const result = await pending;
  assert.equal(result.kind, "completed"); assert.equal(hash(sent), description.bodySha256);
  assert.equal(result.receipt.attemptId, "attempt-transcription-1");
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("wrong semantic/body digests and corrupted audio reject locally without HTTP", async () => {
  const value = request(); let calls = 0;
  const transport = adapter(async () => { calls++; return response(); });
  for (const bound of [context(value, { expectedRequestDigest: "0".repeat(64) }), context(value, { expectedBodySha256: "0".repeat(64) })]) {
    const result = await transport.submit(value, bound);
    assert.equal(result.kind, "rejected"); assert.equal(result.source, "local");
    assert.equal(result.code, "REQUEST_DIGEST_MISMATCH");
  }
  const bound = context(value); value.input.bytes[44] = 1;
  assert.equal((await transport.submit(value, bound)).code, "INPUT_HASH_MISMATCH"); assert.equal(calls, 0);
});

test("nonplain/accessor/extra request and context data never invokes caller getters or serialization", async () => {
  const value = request(), bound = context(value); let calls = 0, accessorCalls = 0;
  const transport = adapter(async () => { calls++; return response(); });
  const accessor = { ...value };
  Object.defineProperty(accessor, "model", { enumerable: true, get() { accessorCalls++; return "whisper-1"; } });
  const badInput = { ...value.input };
  Object.defineProperty(badInput, "bytes", { enumerable: true, get() { accessorCalls++; return value.input.bytes; } });
  for (const bad of [null, [], new Date(), Object.create(value), accessor, { ...value, input: badInput },
    { ...value, prompt: "unsupported" }, { ...value, endpoint: "https://invalid.example" }, { ...value, toJSON() { accessorCalls++; return value; } },
    { ...value, input: { ...value.input, path: "/unread" } }, { ...value, input: { ...value.input, bytes: new Uint16Array(8) } },
    { ...value, input: { ...value.input, bytes: new Uint8Array(new SharedArrayBuffer(44)) } }]) {
    const result = await transport.submit(bad, bound);
    assert.equal(result.kind, "rejected"); assert.equal(result.source, "local");
  }
  const badContext = { ...bound };
  Object.defineProperty(badContext, "signal", { get() { accessorCalls++; return undefined; } });
  for (const bad of [null, Object.create(bound), badContext, { ...bound, signal: null }, { ...bound, extra: true }]) {
    assert.equal((await transport.submit(value, bad)).code, "INVALID_SUBMIT_CONTEXT");
  }
  assert.equal(calls, 0); assert.equal(accessorCalls, 0);
});

test("forged typed-array prototypes fail with a controlled local validation error", async () => {
  const value = request(), bound = context(value); let calls = 0;
  value.input.bytes = Object.create(Uint8Array.prototype);
  assert.throws(() => describeOpenAITranscriptionRequest(value), /INVALID_AUDIO_BYTES/);
  const result = await adapter(async () => { calls++; return response(); }).submit(value, bound);
  assert.equal(result.kind, "rejected"); assert.equal(result.source, "local"); assert.equal(result.code, "INVALID_AUDIO_BYTES");
  assert.equal(calls, 0);
});

test("unsupported models, language variants, timing and identity fields fail before fetch", async () => {
  const value = request(), bound = context(value); let calls = 0;
  const transport = adapter(async () => { calls++; return response(); });
  for (const bad of [{ ...value, model: "gpt-4o-transcribe" }, { ...value, language: "EN" }, { ...value, language: "en-US" },
    { ...value, language: "zz" }, { ...value, language: undefined }, { ...value, timing: "segment" },
    { ...value, input: { ...value.input, mimeType: "audio/mpeg" } },
    { ...value, input: { ...value.input, artifactId: "../../private" } },
    { ...value, input: { ...value.input, sha256: "not-a-hash" } }]) {
    assert.equal((await transport.submit(bad, bound)).kind, "rejected");
  }
  assert.equal(calls, 0);
});

test("strict WAV structure rejects malformed/ambiguous headers and mismatched sample geometry", async () => {
  const value = request(), bound = context(value); let calls = 0;
  const transport = adapter(async () => { calls++; return response(); });
  const changed = (offset, value, width = 2) => { const bytes = wave(); bytes[`writeUInt${width * 8}LE`](value, offset); return bytes; };
  const truncated = wave().subarray(0, 45);
  const malformed = [Buffer.alloc(44), truncated, changed(4, 1, 4), changed(20, 3), changed(22, 2), changed(24, 48000, 4),
    changed(28, 64000, 4), changed(32, 4), changed(34, 24), changed(40, 1, 4), wave(0), wave(360 * 16000 + 1),
    wave(1, [["fmt ", Buffer.alloc(16)]]), wave(1, [["data", Buffer.alloc(2)]]),
    wave(1, [["JUNK", Buffer.alloc(64 * 1024)]]), wave(1, Array.from({ length: 127 }, () => ["JUNK", Buffer.alloc(0)]))];
  const highBitSignature = wave(); highBitSignature[0] |= 128; malformed.push(highBitSignature);
  const noPad = wave(1, [["JUNK", Buffer.from([1])]]);
  noPad.writeUInt32LE(noPad.length - 9, 4); malformed.push(noPad.subarray(0, noPad.length - 1));
  for (const bytes of malformed) {
    const result = await transport.submit(request(bytes), bound);
    assert.equal(result.kind, "rejected"); assert.equal(result.source, "local");
    assert.notEqual(result.code, "REQUEST_DIGEST_MISMATCH", "input should fail validation before identity comparison");
  }
  assert.equal(calls, 0);
});

test("360-second exact waveform and bounded odd ancillary chunks are valid without resampling", () => {
  const bytes = wave(360 * 16000, [["JUNK", Buffer.from([1, 2, 3])]]);
  const description = describeOpenAITranscriptionRequest(request(bytes));
  assert.equal(description.input.waveform.sampleCount, 5_760_000);
  assert.equal(description.input.waveform.durationSeconds, 360);
  assert.equal(description.input.byteLength, bytes.length);
  assert.equal(description.input.sha256, hash(bytes));
});

test("input and constructor limits can only lower the hard ceilings", async () => {
  const value = request(), bound = context(value); let calls = 0;
  const fetch = async () => { calls++; return response(); };
  assert.equal((await adapter(fetch, { maxInputBytes: value.input.bytes.length }).submit(value, bound)).kind, "completed");
  assert.equal((await adapter(fetch, { maxInputBytes: value.input.bytes.length - 1 }).submit(value, bound)).code, "INPUT_TOO_LARGE");
  assert.equal((await adapter(fetch).submit(request(Buffer.alloc(25_000_001)), bound)).code, "INPUT_TOO_LARGE");
  assert.equal(calls, 1);
  for (const option of [{ maxInputBytes: 25_000_001 }, { maxWords: 8193 }, { maxWordBytes: 1025 }, { maxTextBytes: 262145 },
    { maxResponseBytes: 4194305 }, { timeoutMs: 180001 }, { maxWords: 0 }, { maxInputBytes: null }, { url: "https://invalid.example" }]) {
    assert.throws(() => adapter(fetch, option), /INVALID_ADAPTER_OPTION/);
  }
  assert.throws(() => new OpenAITranscriptionAdapter(null), /INVALID_ADAPTER_OPTION/);
});

test("empty no-speech result is completed and missing usage or resolved model remains unknown", async () => {
  const value = request();
  const result = await adapter(async () => response(payload({ text: "", words: [], duration: 0 }))).submit(value, context(value));
  assert.equal(result.kind, "completed"); assert.equal(result.reportedModel, null);
  assert.equal(result.result.usage, null); assert.deepEqual(result.result.words, []); assert.deepEqual(result.result.timingIssues, []);
});

test("provider timing quality problems remain complete, ordered and unchanged with explicit issues", async () => {
  const value = request();
  const words = [{ word: "Third", start: 0.4, end: 1.2 }, { word: "first", start: 0.2, end: 0.3 }, { word: "last.", start: 0.25, end: 0.8 }];
  const result = await adapter(async () => response(payload({ words, duration: 1.5, text: "Different transcript." })))
    .submit(value, context(value));
  assert.equal(result.kind, "completed");
  assert.deepEqual(result.result.words, words.map(word => ({ word: word.word, startSeconds: word.start, endSeconds: word.end })));
  assert.deepEqual(result.result.timingIssues, [
    { code: "word_outside_source", wordIndex: 0 }, { code: "word_overlap", wordIndex: 1 },
    { code: "word_nonmonotone", wordIndex: 1 }, { code: "word_overlap", wordIndex: 2 },
    { code: "reported_duration_outside_source", wordIndex: null }, { code: "text_word_mismatch", wordIndex: null },
  ]);
  assert.equal(result.result.text, "Different transcript.");
  assert.equal(JSON.stringify(result).includes("confidence"), false);
});

test("non-Latin text is preserved and provider whitespace is only compared, not rewritten", async () => {
  const value = request(wave(), { language: "zh" });
  const result = await adapter(async () => response(payload({ text: "  你好\n世界。 ", language: "chinese",
    words: [{ word: "你好", start: 0, end: 0.5 }, { word: "世界。", start: 0.5, end: 1 }] })))
    .submit(value, context(value));
  assert.equal(result.kind, "completed"); assert.equal(result.result.text, "  你好\n世界。 ");
  assert.deepEqual(result.result.timingIssues, []);
});

test("nested timing overlap is reported against every prior interval without reordering or clamping", async () => {
  const value = request(wave(160000));
  const words = [{ word: "One", start: 0, end: 10 }, { word: "two", start: 1, end: 2 }, { word: "three.", start: 3, end: 4 }];
  const result = await adapter(async () => response(payload({ text: "One two three.", duration: 10, words })))
    .submit(value, context(value));
  assert.equal(result.kind, "completed");
  assert.deepEqual(result.result.timingIssues, [{ code: "word_overlap", wordIndex: 1 },
    { code: "word_nonmonotone", wordIndex: 1 }, { code: "word_overlap", wordIndex: 2 }]);
  assert.deepEqual(result.result.words, words.map(word => ({ word: word.word, startSeconds: word.start, endSeconds: word.end })));
});

test("unknown reported models are retained honestly, unsupported usage is omitted and raw/result hashes differ", async () => {
  const value = request(); const base = payload({ model: "future-transcription-revision", usage: { undocumented_cost: 0 } });
  const firstRaw = JSON.stringify(base), secondRaw = JSON.stringify(base, null, 2);
  const run = raw => adapter(async () => new Response(raw, { headers: { "content-type": "application/json" } })).submit(value, context(value));
  const first = await run(firstRaw), second = await run(secondRaw);
  assert.equal(first.kind, "completed"); assert.equal(first.reportedModel, "future-transcription-revision");
  assert.equal(first.result.usage, null);
  assert.notEqual(first.result.rawResponseSha256, second.result.rawResponseSha256);
  assert.equal(first.result.resultDigest, second.result.resultDigest);
  const changed = await adapter(async () => response({ ...base, text: "Altered." })).submit(value, context(value));
  assert.notEqual(first.result.resultDigest, changed.result.resultDigest);
});

test("malformed transcript structure and missing timing remain unknown after one POST", async () => {
  const value = request(); let calls = 0;
  for (const body of [null, [], { ...payload(), error: null }, payload({ words: undefined }), payload({ words: [] }),
    payload({ text: 1 }), payload({ text: "\ud800" }), payload({ language: null }), payload({ duration: -1 }), payload({ duration: "1" }),
    payload({ duration: 1e400 }), payload({ words: [{ word: "Hello", start: -1, end: 1 }] }),
    payload({ words: [{ word: "Hello", start: 1, end: 0 }] }), payload({ words: [{ word: "", start: 0, end: 1 }] }),
    payload({ words: [{ word: "Hello", start: null, end: 1 }] }), payload({ model: "\ud800" })]) {
    const result = await adapter(async () => { calls++; return response(body); }).submit(value, context(value));
    assert.equal(result.kind, "unknown");
  }
  assert.equal(calls, 16);
});

test("UTF-8 text/word and entry counts use exact lowerable bounds", async () => {
  const value = request(), bound = context(value);
  const body = payload({ text: "é", words: [{ word: "é", start: 0, end: 1 }] });
  assert.equal((await adapter(async () => response(body), { maxTextBytes: 2, maxWordBytes: 2, maxWords: 1 }).submit(value, bound)).kind, "completed");
  for (const options of [{ maxTextBytes: 1 }, { maxWordBytes: 1 }]) {
    assert.equal((await adapter(async () => response(body), options).submit(value, bound)).kind, "unknown");
  }
  assert.equal((await adapter(async () => response(), { maxWords: 1 }).submit(value, bound)).code, "INVALID_TRANSCRIPT_WORDS");
  const tooMany = payload({ words: Array.from({ length: 8193 }, () => ({ word: "a", start: 0, end: 0 })) });
  assert.equal((await adapter(async () => response(tooMany)).submit(value, bound)).code, "INVALID_TRANSCRIPT_WORDS");
  assert.equal((await adapter(async () => response(payload({ text: "x".repeat(262145) }))).submit(value, bound)).code, "INVALID_TRANSCRIPT_TEXT");
});

test("recognized provider rejections are distinct from contradictory or uncertain responses", async () => {
  const value = request(); let calls = 0;
  for (const [status, type] of [[400, "invalid_request_error"], [401, "authentication_error"], [403, "permission_error"], [429, "rate_limit_error"]]) {
    const result = await adapter(async () => { calls++; return response({ error: { type, message: `secret ${key}` } }, status,
      { "x-request-id": key, "retry-after": "2" }); }).submit(value, context(value));
    assert.equal(result.kind, "rejected"); assert.equal(result.source, "provider"); assert.equal(result.retryAfterMs, 2000);
    assert.equal(result.receipt.requestId, null); assert.equal(JSON.stringify(result).includes(key), false);
  }
  for (const [status, extra] of [[429, { usage: null }], [400, { text: "" }], [500, {}], [409, {}], [408, {}], [200, {}]]) {
    const result = await adapter(async () => { calls++; return response({ error: { type: "invalid_request_error", message: key }, ...extra }, status); })
      .submit(value, context(value));
    assert.equal(result.kind, "unknown"); assert.equal(JSON.stringify(result).includes(key), false);
  }
  assert.equal(calls, 10);
});

test("invalid MIME/JSON, body loss and declared or observed oversize remain unknown without retry", async () => {
  const value = request(); let calls = 0;
  const factories = [
    () => new Response(JSON.stringify(payload()), { headers: { "content-type": "text/plain" } }),
    () => new Response("{", { headers: { "content-type": "application/json" } }),
    () => new Response(Buffer.from([255]), { headers: { "content-type": "application/json" } }),
    () => new Response(JSON.stringify(payload()), { headers: { "content-type": "application/json", "content-length": "999" } }),
    () => new Response("x".repeat(501), { headers: { "content-type": "application/json", "content-length": "1" } }),
    () => { throw new Error(`private request ${key}`); },
    () => new Response(new ReadableStream({ start(controller) { controller.error(new Error(key)); } })),
  ];
  for (const factory of factories) {
    const result = await adapter(async () => { calls++; return factory(); }, { maxResponseBytes: 500 }).submit(value, context(value));
    assert.equal(result.kind, "unknown"); assert.equal(JSON.stringify(result).includes(key), false);
  }
  assert.equal(calls, factories.length);
});

test("pre-abort performs zero POST and original signal survives replacement while awaiting headers", async () => {
  const value = request(); let calls = 0;
  const controller = new AbortController(); controller.abort();
  const transport = adapter(async () => { calls++; return response(); });
  const result = await transport.submit(value, context(value, { signal: controller.signal }));
  assert.equal(result.kind, "rejected"); assert.equal(result.code, "ABORTED_BEFORE_SUBMISSION"); assert.equal(calls, 0);
  const original = new AbortController(), replacement = new AbortController(), late = deferred();
  const bound = context(value, { signal: original.signal });
  const pending = adapter(async () => { calls++; return late.promise; }).submit(value, bound);
  bound.signal = replacement.signal; original.abort();
  const cancelled = await pending;
  assert.equal(cancelled.kind, "unknown"); assert.equal(cancelled.code, "SUBMISSION_ABORTED");
  assert.equal(getEventListeners(original.signal, "abort").length, 0);
  late.resolve(response()); await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
});

test("abort during response body and delayed cleanup cannot return completion", async () => {
  const value = request(); const controller = new AbortController(), entered = deferred(), cleanup = deferred();
  let calls = 0, cancelled = 0;
  const transport = adapter(async () => {
    calls++;
    return new Response(new ReadableStream({
      start(stream) { stream.enqueue(Buffer.from(JSON.stringify(payload()))); entered.resolve(); },
      cancel() { cancelled++; return cleanup.promise; },
    }), { headers: { "content-type": "application/json" } });
  });
  const pending = transport.submit(value, context(value, { signal: controller.signal }));
  await entered.promise; await new Promise(resolve => setImmediate(resolve)); controller.abort();
  const result = await pending;
  assert.equal(result.kind, "unknown"); assert.equal(result.code, "SUBMISSION_ABORTED");
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  cleanup.resolve(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(cancelled, 1); assert.equal(calls, 1);
});

test("deadline bounds an ignoring fetch and cancels a late response without resubmitting", async () => {
  const value = request(), late = deferred(); let calls = 0, cancelled = 0;
  const started = Date.now();
  const result = await adapter(async () => { calls++; return late.promise; }, { timeoutMs: 15 }).submit(value, context(value));
  assert.equal(result.kind, "unknown"); assert.equal(result.code, "SUBMISSION_TIMEOUT"); assert.ok(Date.now() - started < 1000);
  late.resolve(new Response(new ReadableStream({ cancel() { cancelled++; } })));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1); assert.equal(cancelled, 1);
});

test("original abort after the complete body but during awaited reader cleanup still reports unknown", async () => {
  const value = request(), controller = new AbortController(), inCleanup = deferred(), cleanup = deferred();
  const bytes = Buffer.from(JSON.stringify(payload())); let reads = 0, releases = 0, calls = 0;
  const transport = adapter(async () => {
    calls++;
    // A controlled reader makes cleanup suspension observable after all valid body bytes were read.
    return { status: 200, ok: true, headers: new Headers({ "content-type": "application/json" }),
      body: { getReader() { return {
        read: async () => reads++ === 0 ? { done: false, value: bytes } : { done: true },
        cancel() { inCleanup.resolve(); return cleanup.promise; }, releaseLock() { releases++; },
      }; } } };
  });
  const pending = transport.submit(value, context(value, { signal: controller.signal }));
  await inCleanup.promise; controller.abort();
  const result = await pending;
  assert.equal(result.kind, "unknown"); assert.equal(result.code, "SUBMISSION_ABORTED");
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  cleanup.resolve(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1); assert.equal(reads, 2); assert.equal(releases, 1);
});
