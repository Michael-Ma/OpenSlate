import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { MiniMaxH3Provider, MINIMAX_H3_LIMITS } from "../dist/minimax-h3.js";

const apiKey = "fixture-secret-never-log";
const taskId = "424010985738629";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const image = { url: "https://assets.example.test/reviewed.png?signature=private", sha256: "a".repeat(64),
  width: 1280, height: 720, byteLength: 1024, mediaType: "image/png" };
const request = { prompt: "The camera moves slowly across the reviewed scene.", durationSeconds: 5, resolution: "768P", firstFrame: image };
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const task = (status, extra = {}) => ({ task: { id: taskId, model: "MiniMax-H3", status, task_type: "generation", modality: "video", ...extra } });
function fixture(handler = () => json({ task_id: taskId }), options = {}) {
  const calls = [];
  const provider = new MiniMaxH3Provider({ apiKey, model: "MiniMax-H3", timeoutMs: 100,
    ...options, fetch: async (...args) => { calls.push(args); return handler(...args); } });
  return { provider, calls };
}
test("construction/discovery is offline and capabilities distinguish exact models", async () => {
  const standard = fixture(), fast = fixture(undefined, { model: "MiniMax-H3-Max" });
  const a = await standard.provider.capabilities(), b = await fast.provider.capabilities();
  assert.deepEqual(a.resolutions, ["768P", "2K"]); assert.equal(a.durationSeconds.min, 4);
  assert.deepEqual(b.resolutions, ["480P", "768P"]); assert.equal(b.durationSeconds.min, 5);
  assert.deepEqual(a.conditioningModes, ["first_frame", "first_last_frame"]);
  assert.equal(a.supportsCancellation, false); assert.equal(a.submissionIdempotency, "unverified");
  assert.equal(a.reconciliation, "task_id_only"); assert.equal(standard.calls.length + fast.calls.length, 0);
  assert.ok(!JSON.stringify(standard.provider).includes(apiKey));
});
test("one POST preserves prompt, exact frame URLs and explicit image-derived ratio", async () => {
  const { provider, calls } = fixture();
  const input = { ...request, lastFrame: { ...image, url: "https://assets.example.test/last.png" } };
  const result = await provider.submit(input);
  assert.deepEqual(result, { kind: "accepted", taskId, requestedModel: "MiniMax-H3" });
  assert.equal(calls.length, 1); const [url, options] = calls[0];
  assert.equal(url, "https://api.minimax.io/v2/video_generation"); assert.equal(options.method, "POST");
  assert.equal(options.redirect, "manual"); assert.equal(options.headers.Authorization, `Bearer ${apiKey}`);
  assert.deepEqual(JSON.parse(options.body), { model: "MiniMax-H3", content: [
    { type: "text", text: request.prompt }, { type: "image_url", image_url: { url: image.url }, role: "first_frame" },
    { type: "image_url", image_url: { url: input.lastFrame.url }, role: "last_frame" },
  ], duration: 5, resolution: "768P", ratio: "adaptive" });
  assert.ok(!Object.keys(options.headers).some(key => /idempotency/i.test(key)));
});
test("unsupported combinations are rejected before I/O rather than dropped", async () => {
  const { provider, calls } = fixture();
  for (const invalid of [
    { ...request, referenceImages: [image] }, { ...request, ratio: "16:9" }, { ...request, callback_url: "https://attacker.test" },
    { ...request, firstFrame: undefined }, { ...request, prompt: " " }, { ...request, durationSeconds: 4.5 },
    { ...request, durationSeconds: 16 }, { ...request, resolution: "480P" },
    { ...request, firstFrame: { ...image, width: 100 } }, { ...request, firstFrame: { ...image, height: 256, width: 5760 } },
    { ...request, firstFrame: { ...image, byteLength: 30_000_001 } }, { ...request, firstFrame: { ...image, sha256: "forged" } },
    { ...request, firstFrame: { ...image, url: "http://assets.example.test/a.png" } },
    { ...request, firstFrame: { ...image, url: "https://user:secret@assets.example.test/a.png" } },
    { ...request, firstFrame: { ...image, url: "file:///private/key" } },
    { ...request, prompt: "p".repeat(MINIMAX_H3_LIMITS.promptBytes + 1) },
  ]) {
    const result = await provider.submit(invalid); assert.equal(result.kind, "rejected"); assert.equal(result.certainty, "not_accepted");
  }
  assert.equal(calls.length, 0);
  const fast = fixture(undefined, { model: "MiniMax-H3-Max" });
  for (const invalid of [{ ...request, durationSeconds: 4 }, { ...request, resolution: "2K" }])
    assert.equal((await fast.provider.submit(invalid)).kind, "rejected");
  assert.equal(fast.calls.length, 0);
});
test("embedded bytes must match the approved image identity and MIME declaration", async () => {
  const { provider, calls } = fixture(); const bytes = Buffer.from("synthetic wire fixture; not decoded media");
  const embedded = { ...image, url: `data:image/png;base64,${bytes.toString("base64")}`, byteLength: bytes.length, sha256: hash(bytes) };
  assert.equal((await provider.submit({ ...request, firstFrame: embedded })).kind, "accepted");
  assert.equal(JSON.parse(calls[0][1].body).content[1].image_url.url, embedded.url);
  for (const change of [{ sha256: "b".repeat(64) }, { mediaType: "image/jpeg" }, { byteLength: 99 }, { url: embedded.url + "=" }])
    assert.equal((await provider.submit({ ...request, firstFrame: { ...embedded, ...change } })).kind, "rejected");
  assert.equal(calls.length, 1);
});
for (const [status, type, category] of [
  [400, "bad_request_error", "invalid_input"], [401, "authorized_error", "auth"], [402, "insufficient_balance_error", "quota"],
  [422, "unprocessable_entity_error", "policy"], [429, "rate_limit_error", "throttled"],
]) test(`intact documented ${status} rejection is known without exposing provider text`, async () => {
  const { provider, calls } = fixture(() => json({ type: "error", error: { type, message: `private ${apiKey}`, http_code: String(status) },
    request_id: "provider_request_1" }, status, { "retry-after": "42" }));
  const result = await provider.submit(request);
  assert.equal(result.kind, "rejected"); assert.equal(result.certainty, "not_accepted"); assert.equal(result.error.category, category);
  assert.equal(result.error.requestId, "provider_request_1"); assert.equal(result.error.retryAfterSeconds, 42);
  assert.ok(!JSON.stringify(result).includes(apiKey)); assert.equal(calls.length, 1);
});
for (const [name, response] of [
  ["server error", () => json({ type: "error", error: { type: "server_error", http_code: "500" } }, 500)],
  ["malformed successful JSON", () => new Response("{broken", { status: 200 })],
  ["legacy response", () => json({ base_resp: { status_code: 1004 } })],
  ["proxy denial", () => json({ error: "denied" }, 401)],
  ["inconsistent rejection", () => json({ type: "error", error: { type: "authorized_error", http_code: "400" } }, 401)],
  ["missing receipt", () => json({})],
  ["contradictory success", () => json({ task_id: taskId, error: { type: "server_error" } })],
  ["task inside a rejection", () => json({ type: "error", error: { type: "rate_limit_error", http_code: "429" }, task: { id: taskId } }, 429)],
  ["redirect", () => json({}, 307, { location: "https://other.example.test/collect" })],
  ["oversized response", () => new Response("x".repeat(MINIMAX_H3_LIMITS.responseBytes + 1))],
  ["declared oversized response", () => new Response("{}", { headers: { "content-length": "99999999" } })],
  ["invalid UTF-8", () => new Response(new Uint8Array([255]))],
]) test(`${name} preserves unknown acceptance and never retries`, async () => {
  const { provider, calls } = fixture(response); const result = await provider.submit(request);
  assert.equal(result.kind, "unknown"); assert.equal(calls.length, 1); assert.ok(!JSON.stringify(result).includes(apiKey));
});
test("lost response after acceptance and reconciliation without task ID never resubmit", async () => {
  let accepted = 0;
  const { provider, calls } = fixture(() => { accepted++; throw Error(`socket closed ${apiKey}`); });
  assert.equal((await provider.submit(request)).kind, "unknown");
  assert.deepEqual(await provider.reconcile({}), { kind: "unknown", error: { code: "H3_ACCEPTANCE_UNKNOWN_NO_TASK_ID", category: "protocol" } });
  assert.equal(accepted, 1); assert.equal(calls.length, 1);
});
test("abort before dispatch is known; abort or timeout after dispatch stays unknown", async () => {
  const before = fixture();
  assert.equal((await before.provider.submit(request, { signal: AbortSignal.abort() })).certainty, "not_accepted");
  assert.equal(before.calls.length, 0);
  for (const useAbort of [false, true]) {
    const controller = new AbortController(); const f = fixture(() => new Promise(() => {}), { timeoutMs: 20 });
    const pending = f.provider.submit(request, { signal: controller.signal });
    if (useAbort) controller.abort();
    const result = await pending;
    assert.equal(result.kind, "unknown"); assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0][1].signal.aborted, true);
    assert.equal(result.error.code, useAbort ? "H3_CALL_ABORTED" : "H3_CALL_TIMEOUT");
  }
});
test("a stalled response stream times out and is cancelled", async () => {
  let cancelled = false;
  const { provider } = fixture(() => new Response(new ReadableStream({ cancel() { cancelled = true; } })), { timeoutMs: 20 });
  assert.equal((await provider.submit(request)).kind, "unknown"); assert.equal(cancelled, true);
});
test("poll and known-receipt reconciliation only issue bounded GET requests", async () => {
  const { provider, calls } = fixture(() => json(task("running")));
  assert.deepEqual(await provider.poll(taskId), { kind: "pending", taskId, status: "running" });
  assert.deepEqual(await provider.reconcile({ taskId }), { kind: "pending", taskId, status: "running" });
  assert.equal(calls.length, 2); assert.ok(calls.every(([url, options]) => url.endsWith(`/v2/query/video_generation/${taskId}`) && options.method === "GET" && options.body === undefined));
  assert.equal((await provider.poll("../other")).kind, "unknown"); assert.equal(calls.length, 2);
});
test("successful output remains a protected locator with nullable usage, not an artifact", async () => {
  const { provider, calls } = fixture(() => json(task("succeeded", { content: { url: "https://cdn.example.test/take.mp4?signature=private" },
    duration: 5, resolution: "2K", ratio: "16:9", usage: { total_seconds: 5, total_tokens: 345, fabricated_price: 0 } })));
  const result = await provider.poll(taskId);
  assert.equal(result.kind, "completed"); assert.equal(result.output.expiresAt, null);
  assert.equal(result.output.url, "https://cdn.example.test/take.mp4?signature=private");
  assert.deepEqual(result.reported.usage, { total_seconds: 5, total_tokens: 345 }); assert.equal(result.reported.durationSeconds, 5);
  assert.equal(calls.length, 1); assert.ok(!("artifactId" in result));
  const missing = fixture(() => json(task("succeeded", { content: { url: "https://cdn.example.test/take.mp4" } })));
  assert.deepEqual((await missing.provider.poll(taskId)).reported, { durationSeconds: null, resolution: null, ratio: null, usage: null });
});
test("terminal failure/cancellation are observed without asserting technical retry authority", async () => {
  for (const status of ["failed", "cancelled", "queued"]) {
    const f = fixture(() => json(task(status, { error: { message: apiKey } }))), result = await f.provider.poll(taskId);
    assert.equal(result.kind, status === "queued" ? "pending" : status); assert.ok(!("technical" in result));
    assert.ok(!JSON.stringify(result).includes(apiKey)); assert.equal(f.calls.length, 1);
  }
});
test("contradictory poll envelopes preserve unknown state for every reported task status", async () => {
  for (const status of ["queued", "running", "succeeded", "failed", "cancelled"]) {
    for (const envelope of [{ type: "error" }, { error: { type: "server_error", message: apiKey } }, { error: null }]) {
      const { provider, calls } = fixture(() => json({ ...task(status, {
        content: { url: "https://cdn.example.test/take.mp4" },
      }), ...envelope }));
      const result = await provider.poll(taskId);
      assert.equal(result.kind, "unknown"); assert.equal(result.taskId, taskId);
      assert.equal(result.error.code, "H3_POLL_UNRESOLVED");
      assert.equal(calls.length, 1); assert.equal(calls[0][1].method, "GET");
      assert.ok(!JSON.stringify(result).includes(apiKey));
    }
  }
});
test("wrong identities/models, missing output and expired task responses cannot become completed or absent", async () => {
  for (const response of [
    () => json(task("succeeded", { id: "wrong", content: { url: "https://cdn.example.test/x" } })),
    () => json(task("succeeded", { model: "MiniMax-H3-Max", content: { url: "https://cdn.example.test/x" } })),
    () => json(task("succeeded", { task_type: "context_ir" })), () => json(task("succeeded")),
    () => json(task("unknown_future_status")), () => json({ type: "error", error: { type: "not_found_error" } }, 404),
    () => json(task("succeeded", { content: { url: "http://cdn.example.test/x" } })),
    () => json(task("succeeded", { content: { url: `https://cdn.example.test/${apiKey}` } })),
  ]) { const f = fixture(response); assert.equal((await f.provider.poll(taskId)).kind, "unknown"); assert.equal(f.calls.length, 1); }
});
test("credential-bearing provider IDs cannot escape in receipts or diagnostics", async () => {
  const accepted = fixture(() => json({ task_id: apiKey })); assert.equal((await accepted.provider.submit(request)).kind, "unknown");
  const rejected = fixture(() => json({ type: "error", error: { type: "authorized_error", http_code: "401", message: apiKey }, request_id: apiKey }, 401));
  assert.ok(!JSON.stringify(await rejected.provider.submit(request)).includes(apiKey));
});
