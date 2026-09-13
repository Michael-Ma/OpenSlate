import test from "node:test";
import assert from "node:assert/strict";
import { AudioHttpClient, audioSha256 } from "../dist/audio-http.js";

const key = "offline-audio-credential";
const body = Buffer.from('{"model":"offline-model"}');
const prepared = { model: "offline-model", requestDigest: audioSha256("semantic"), bodySha256: audioSha256(body), body, contentType: "application/json" };
const context = () => ({ attemptId: "audio-attempt-1", expectedRequestDigest: prepared.requestDigest, expectedBodySha256: prepared.bodySha256 });
const decoder = bytes => ({ reportedModel: null, result: { sha256: audioSha256(bytes), size: bytes.byteLength } });
const json = (payload, status, headers = {}) => new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json", ...headers } });
function client(fetch, options = {}) { return new AudioHttpClient("openai-speech-v1", { apiKey: key, fetch, ...options }, { timeoutMs: 120000, maxResponseBytes: 32 * 1024 ** 2 }); }
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test("recognized rejection envelopes remain distinct from contradictory or uncertain failures", async () => {
  const cases = [
    [400, { error: { type: "invalid_request_error", message: key } }, "rejected"],
    [401, { error: { type: "authentication_error", message: key } }, "rejected"],
    [403, { error: { type: "permission_error", message: key } }, "rejected"],
    [429, { error: { type: "rate_limit_error", message: key } }, "rejected"],
    [429, { error: { type: "insufficient_quota", message: key } }, "rejected"],
    [400, { error: { type: "invalid_request_error", message: key }, text: "received output" }, "unknown"],
    [401, { error: { type: "authentication_error", message: key }, usage: {} }, "unknown"],
    [400, { error: { type: "invalid_request_error", code: "content_policy_violation", message: key } }, "unknown"],
    [408, { error: { type: "invalid_request_error", message: key } }, "unknown"],
    [409, { error: { type: "invalid_request_error", message: key } }, "unknown"],
    [500, { error: { type: "invalid_request_error", message: key } }, "unknown"],
    [400, { message: key }, "unknown"],
  ];
  for (const [status, payload, expected] of cases) {
    let calls = 0;
    const adapter = client(async () => { calls++; return json(payload, status, { "x-request-id": key, "retry-after": "2" }); });
    const result = await adapter.post(context(), () => prepared, decoder);
    assert.equal(result.kind, expected); assert.equal(calls, 1); assert.equal(result.receipt.requestId, null);
    assert.equal(result.retryAfterMs, 2000); assert.equal(JSON.stringify(result).includes(key), false);
  }
});

test("pre-abort and changed wire identity reject before fetch; a thrown transport remains unknown", async () => {
  let calls = 0; const adapter = client(async () => { calls++; throw Error(`https://private.invalid/?key=${key}`); });
  const controller = new AbortController(); controller.abort();
  assert.equal((await adapter.post({ ...context(), signal: controller.signal }, () => prepared, decoder)).code, "ABORTED_BEFORE_SUBMISSION");
  assert.equal((await adapter.post(context(), () => ({ ...prepared, body: Buffer.from("changed") }), decoder)).code, "REQUEST_BODY_MISMATCH");
  assert.equal(calls, 0);
  const result = await adapter.post(context(), () => prepared, decoder);
  assert.equal(result.kind, "unknown"); assert.equal(calls, 1); assert.equal(JSON.stringify(result).includes(key), false);
});

test("observed byte limit defeats missing or false Content-Length, including one-byte chunks", async () => {
  for (const length of [null, "1", "wrong"]) {
    let produced = 0;
    const stream = new ReadableStream({ pull(controller) { if (produced++ < 129) controller.enqueue(Uint8Array.of(42)); else controller.close(); } });
    const response = new Response(stream, { headers: length === null ? {} : { "content-length": length } });
    const result = await client(async () => response, { maxResponseBytes: 128 }).post(context(), () => prepared, decoder);
    assert.equal(result.kind, "unknown"); assert.equal(result.code, "RESPONSE_TOO_LARGE");
  }
  const exact = await client(async () => new Response(Buffer.alloc(128)), { maxResponseBytes: 128 }).post(context(), () => prepared, decoder);
  assert.equal(exact.kind, "completed"); assert.equal(exact.result.size, 128);
});

test("oversized declared body is cancelled without reading and error bodies have their own cap", async () => {
  let cancelled = 0;
  const response = new Response(new ReadableStream({ cancel() { cancelled++; } }), { headers: { "content-length": "999999" } });
  const result = await client(async () => response, { maxResponseBytes: 128 }).post(context(), () => prepared, decoder);
  assert.equal(result.kind, "unknown"); assert.equal(result.code, "RESPONSE_TOO_LARGE"); assert.equal(cancelled, 1);
  const error = await client(async () => new Response("x".repeat(65537), { status: 401 })).post(context(), () => prepared, decoder);
  assert.equal(error.code, "RESPONSE_TOO_LARGE"); assert.equal(error.kind, "unknown");
});

test("immediately resolving empty chunks yield so external cancellation can interrupt them", async () => {
  const controller = new AbortController(); let chunks = 0;
  const stream = new ReadableStream({ pull(c) { if (chunks++ < 4096) c.enqueue(new Uint8Array()); else c.close(); } });
  const running = client(async () => { setImmediate(() => controller.abort()); return new Response(stream); })
    .post({ ...context(), signal: controller.signal }, () => prepared, decoder);
  const result = await running; assert.equal(result.kind, "unknown"); assert.equal(result.code, "SUBMISSION_ABORTED"); assert.ok(chunks < 4096);
});

test("timeout settles an abort-ignoring fetch once and cancels a late response", async () => {
  const arrived = deferred(); let calls = 0, cancelled = 0;
  const adapter = client(async () => { calls++; return arrived.promise; }, { timeoutMs: 30 });
  const outcome = await adapter.post(context(), () => prepared, decoder);
  assert.equal(outcome.kind, "unknown"); assert.equal(outcome.code, "SUBMISSION_TIMEOUT"); assert.equal(calls, 1);
  arrived.resolve(new Response(new ReadableStream({ cancel() { cancelled++; } })));
  await new Promise(resolve => setImmediate(resolve)); assert.equal(cancelled, 1);
  assert.equal(outcome.receipt.httpStatus, null);
});

test("abort during body cancels the reader and never returns a partial completion", async () => {
  const entered = deferred(); const controller = new AbortController(); let cancelled = 0;
  const stream = new ReadableStream({ start(c) { c.enqueue(Uint8Array.of(1)); entered.resolve(); }, cancel() { cancelled++; } });
  const running = client(async () => new Response(stream)).post({ ...context(), signal: controller.signal }, () => prepared, decoder);
  await entered.promise; controller.abort();
  const result = await running; assert.equal(result.kind, "unknown"); assert.equal(result.code, "SUBMISSION_ABORTED");
  await new Promise(resolve => setImmediate(resolve)); assert.equal(cancelled, 1);
});

test("original signal and deadline remain active through awaited successful reader cleanup", async () => {
  for (const mode of ["abort", "deadline"]) {
    const cleanup = deferred(), reached = deferred(); const original = new AbortController(); let reads = 0, released = false;
    const response = { ok: true, status: 200, headers: new Headers(), body: { getReader() { return {
      async read() { return reads++ === 0 ? { done: false, value: Uint8Array.of(1) } : { done: true }; },
      cancel() { reached.resolve(); return cleanup.promise; }, releaseLock() { released = true; },
    }; } } };
    const args = { ...context(), signal: original.signal };
    const running = client(async () => response, mode === "deadline" ? { timeoutMs: 100 } : {}).post(args, () => prepared, decoder);
    args.signal = new AbortController().signal;
    await reached.promise; if (mode === "abort") original.abort();
    const outcome = await running; assert.equal(outcome.kind, "unknown");
    assert.equal(outcome.code, mode === "abort" ? "SUBMISSION_ABORTED" : "SUBMISSION_TIMEOUT");
    assert.equal(released, false); cleanup.resolve(); await new Promise(resolve => setImmediate(resolve)); assert.equal(released, true);
  }
});

test("never-settling reader cleanup cannot prevent the deadline from returning unknown", async () => {
  let reads = 0, decoded = false;
  const response = { ok: true, status: 200, headers: new Headers(), body: { getReader() { return {
    async read() { return reads++ === 0 ? { done: false, value: Uint8Array.of(1) } : { done: true }; },
    cancel() { return new Promise(() => {}); }, releaseLock() {},
  }; } } };
  const result = await client(async () => response, { timeoutMs: 30 }).post(context(), () => prepared, bytes => { decoded = true; return decoder(bytes); });
  assert.equal(result.kind, "unknown"); assert.equal(result.code, "SUBMISSION_TIMEOUT"); assert.equal(decoded, false);
});

test("original cancellation during final decoder handoff cannot escape as completed", async () => {
  const original = new AbortController(); const options = { ...context(), signal: original.signal };
  const running = client(async () => new Response(Uint8Array.of(7))).post(options, () => prepared, bytes => {
    queueMicrotask(() => original.abort()); return decoder(bytes);
  });
  options.signal = new AbortController().signal;
  const result = await running; assert.equal(result.kind, "unknown"); assert.equal(result.code, "SUBMISSION_ABORTED");
  assert.equal(result.receipt.httpStatus, 200);
});

test("a pending decoder success is withheld until cleanup settles and does not mutate returned unknown receipt", async () => {
  const cleanup = deferred(), reached = deferred(); let reads = 0, decoded = 0;
  const response = { ok: true, status: 200, headers: new Headers({ "x-request-id": "safe-request" }), body: { getReader() { return {
    async read() { return reads++ === 0 ? { done: false, value: Uint8Array.of(7) } : { done: true }; },
    cancel() { reached.resolve(); return cleanup.promise; }, releaseLock() {},
  }; } } };
  let settled = false; const running = client(async () => response).post(context(), () => prepared, bytes => { decoded++; return decoder(bytes); }).then(result => { settled = true; return result; });
  await reached.promise; assert.equal(decoded, 0); assert.equal(settled, false); cleanup.resolve();
  const result = await running; assert.equal(result.kind, "completed"); assert.equal(decoded, 1); assert.equal(result.receipt.requestId, "safe-request");
});

test("Retry-After and diagnostic headers remain bounded and unknown failure text stays private", async () => {
  for (const [retry, expected] of [["99999999999999", 600000], ["bad", null], ["-1", null]]) {
    const result = await client(async () => json({ error: { type: "rate_limit_error", message: key } }, 429,
      { "retry-after": retry, "x-request-id": "https://private.invalid/" })).post(context(), () => prepared, decoder);
    assert.equal(result.retryAfterMs, expected); assert.equal(result.receipt.requestId, null);
  }
});
