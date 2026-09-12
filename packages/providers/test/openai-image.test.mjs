import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { OpenAIImageAdapter, OPENAI_IMAGE_MODEL, describeOpenAIImageRequest } from "../dist/openai-image.js";

const key = "offline-placeholder-credential";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const request = { mode: "generate", model: OPENAI_IMAGE_MODEL, prompt: "Exact keyframe prompt.\nKeep this line.",
  width: 1024, height: 1024, quality: "medium" };
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function png(width = 1024, height = 1024, value = 128) {
  function chunk(kind, data) {
    const prefix = Buffer.alloc(4); prefix.writeUInt32BE(data.length);
    const content = Buffer.concat([Buffer.from(kind), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(content));
    return Buffer.concat([prefix, content, crc]);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const pixels = Buffer.alloc((width * 3 + 1) * height, value);
  for (let y = 0; y < height; y += 1) pixels[y * (width * 3 + 1)] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}
const output = png();
const image = (id, bytes = output) => ({ artifactId: id, sha256: hash(bytes), mimeType: "image/png", bytes });
const payload = (overrides = {}) => ({ created: 1789200000, data: [{ b64_json: output.toString("base64") }],
  size: "1024x1024", quality: "medium", output_format: "png", background: "opaque", ...overrides });
const response = (body = payload(), status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json", "x-request-id": "req-offline", ...headers },
});
function adapter(fetch, options = {}) { return new OpenAIImageAdapter({ apiKey: key, fetch, ...options }); }
function context(value = request, extra = {}) {
  return { attemptId: "offline-attempt-1", expectedRequestDigest: describeOpenAIImageRequest(value).requestDigest, ...extra };
}

test("generation pins the documented snapshot and exact explicit contract, with decoded output provenance", async () => {
  let count = 0;
  const transport = adapter(async (url, init) => {
    count += 1;
    assert.equal(url, "https://api.openai.com/v1/images/generations");
    assert.equal(init.redirect, "error");
    assert.equal(init.method, "POST");
    assert.equal(init.headers.Authorization, `Bearer ${key}`);
    assert.deepEqual(JSON.parse(init.body), { model: OPENAI_IMAGE_MODEL, prompt: request.prompt, n: 1,
      size: "1024x1024", quality: "medium", output_format: "png", background: "opaque", moderation: "auto", stream: false });
    assert.equal(init.headers["Idempotency-Key"], undefined);
    return response(payload({ usage: { input_tokens: 9, output_tokens: 10, total_tokens: 19,
      input_tokens_details: { image_tokens: 3, text_tokens: 6 } } }));
  });
  const result = await transport.submit(request, context());
  assert.equal(count, 1); assert.equal(result.kind, "completed");
  assert.deepEqual(Buffer.from(result.output.bytes), output); assert.equal(result.output.sha256, hash(output));
  assert.equal(result.output.fixture, false); assert.equal(result.reportedModel, null);
  assert.deepEqual(result.usage, { inputTokens: 9, outputTokens: 10, totalTokens: 19, inputImageTokens: 3, inputTextTokens: 6 });
  assert.equal(result.receipt.requestId, "req-offline"); assert.equal(result.receipt.requestDigest, context().expectedRequestDigest);
  assert.equal(JSON.stringify(transport).includes(key), false);
});

test("edit JSON preserves ordered exact verified references without extra image fields", async () => {
  const other = png(1024, 1024, 51);
  const value = { ...request, mode: "edit", images: [image("a", output), image("b", other)] };
  const transport = adapter(async (url, init) => {
    assert.equal(url, "https://api.openai.com/v1/images/edits");
    const body = JSON.parse(init.body);
    assert.deepEqual(body.images, [{ image_url: `data:image/png;base64,${output.toString("base64")}` },
      { image_url: `data:image/png;base64,${other.toString("base64")}` }]);
    for (const field of ["input_fidelity", "response_format", "mask", "image", "partial_images"]) assert.equal(body[field], undefined);
    return response();
  });
  assert.equal((await transport.submit(value, context(value))).kind, "completed");
  assert.notEqual(context(value).expectedRequestDigest,
    context({ ...value, images: [...value.images].reverse() }).expectedRequestDigest);
});

test("reference bytes are frozen before async fetch and rehashed before admission", async () => {
  const mutable = Buffer.from(output);
  const value = { ...request, mode: "edit", images: [image("a", mutable)] };
  const bound = context(value);
  let transmitted;
  const transport = adapter(async (_url, init) => {
    await Promise.resolve();
    transmitted = JSON.parse(init.body).images[0].image_url;
    return response();
  });
  const promise = transport.submit(value, bound);
  mutable.fill(0);
  assert.equal((await promise).kind, "completed");
  assert.equal(transmitted, `data:image/png;base64,${output.toString("base64")}`);
  const second = await transport.submit(value, bound);
  assert.equal(second.kind, "rejected"); assert.equal(second.code, "INPUT_HASH_MISMATCH");
});

test("same-family alias is explicit and does not pretend to resolve to the snapshot", async () => {
  const value = { ...request, model: "gpt-image-2" };
  const result = await adapter(async () => response()).submit(value, context(value));
  assert.equal(result.kind, "completed"); assert.equal(result.receipt.requestedModel, "gpt-image-2");
  assert.equal(result.reportedModel, null);
  assert.notEqual(context(value).expectedRequestDigest, context().expectedRequestDigest);
});

test("custom landscape and portrait sizes obey GPT Image 2 pixel, edge, and ratio constraints", () => {
  for (const [width, height] of [[1536, 864], [3840, 2160], [2160, 3840], [1024, 640]]) {
    assert.equal(describeOpenAIImageRequest({ ...request, width, height }).width, width);
  }
  for (const [width, height] of [[1280, 721], [512, 512], [3840, 3840], [3840, 1024], [4096, 1024], [0, 1024]]) {
    assert.throws(() => describeOpenAIImageRequest({ ...request, width, height }), /INVALID_IMAGE_SIZE/);
  }
});

test("request changes, unsupported fields, model, quality, empty and oversized prompts reject before network", async () => {
  let calls = 0;
  const transport = adapter(async () => { calls += 1; throw new Error("should not call"); });
  const bad = [ { ...request, prompt: "Changed" }, { ...request, n: 2 }, { ...request, model: "gpt-image-2.5-sunburst" },
    { ...request, quality: "max" }, { ...request, prompt: " " }, { ...request, prompt: "x".repeat(32001) },
    { ...request, response_format: "url" }, { ...request, input_fidelity: "high" } ];
  for (const value of bad) {
    const result = await transport.submit(value, context());
    assert.equal(result.kind, "rejected"); assert.equal(result.source, "local"); assert.equal(result.receipt.httpStatus, null);
  }
  assert.equal(calls, 0);
});

test("edit limits, URLs and digest/format mismatches fail offline", () => {
  for (const images of [[], Array.from({ length: 9 }, (_, i) => image(`a${i}`)),
    [{ ...image("a"), bytes: Buffer.alloc(4 * 1024 * 1024 + 1) }],
    [{ ...image("a"), sha256: "0".repeat(64) }], [{ ...image("a"), mimeType: "image/jpeg" }],
    [{ ...image("a"), image_url: "https://example.invalid/a.png" }]]) {
    assert.throws(() => describeOpenAIImageRequest({ ...request, mode: "edit", images }));
  }
  const large = Buffer.alloc(4 * 1024 * 1024); output.copy(large);
  assert.throws(() => describeOpenAIImageRequest({ ...request, mode: "edit",
    images: Array.from({ length: 7 }, (_, i) => image(`a${i}`, large)) }), /INPUTS_TOO_LARGE/);
});

test("pre-abort proves no dispatch; abort after dispatch stays unknown", async () => {
  let calls = 0;
  const pre = new AbortController(); pre.abort();
  const transport = adapter(async () => { calls += 1; return new Promise(() => {}); });
  const before = await transport.submit(request, context(request, { signal: pre.signal }));
  assert.equal(before.kind, "rejected"); assert.equal(before.code, "ABORTED_BEFORE_SUBMISSION");
  assert.equal(calls, 0);
  const post = new AbortController();
  const active = transport.submit(request, context(request, { signal: post.signal }));
  post.abort();
  const after = await active;
  assert.equal(after.kind, "unknown"); assert.equal(after.code, "SUBMISSION_ABORTED"); assert.equal(calls, 1);
});

test("timeout is bounded even when injected fetch ignores abort; no retries", async () => {
  let calls = 0;
  const transport = adapter(async () => { calls += 1; return new Promise(() => {}); }, { timeoutMs: 15 });
  const result = await transport.submit(request, context());
  assert.equal(result.kind, "unknown"); assert.equal(result.code, "SUBMISSION_TIMEOUT"); assert.equal(calls, 1);
});

test("network exceptions and response body loss remain unknown with no secret echo or repeat", async () => {
  let count = 0;
  const result = await adapter(async () => { count += 1; throw new Error(`${key} ${request.prompt}`); }).submit(request, context());
  assert.equal(result.kind, "unknown"); assert.equal(count, 1);
  assert.equal(JSON.stringify(result).includes(key), false); assert.equal(JSON.stringify(result).includes(request.prompt), false);
  const broken = await adapter(async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('{"data":')); controller.error(new Error(key)); },
  }), { headers: { "x-request-id": "req-accepted-then-lost" } })).submit(request, context());
  assert.equal(broken.kind, "unknown"); assert.equal(broken.receipt.requestId, "req-accepted-then-lost");
});

test("only recognized client-error envelopes are definite provider rejections", async () => {
  for (const status of [400, 401, 403, 404, 413, 415, 422, 429]) {
    let calls = 0;
    const result = await adapter(async () => { calls += 1; return response({ error: { message: key,
      type: status === 429 ? "rate_limit_error" : "invalid_request_error" } }, status); })
      .submit(request, context());
    assert.equal(result.kind, "rejected"); assert.equal(result.source, "provider"); assert.equal(result.code, `HTTP_${status}`);
    assert.equal(calls, 1); assert.equal(JSON.stringify(result).includes(key), false);
  }
});

test("server failures, timeout/conflict and malformed rejection responses retain uncertainty", async () => {
  for (const [status, body] of [[500, { error: { message: "failed", type: "server_error" } }],
    [502, {}], [408, {}], [409, {}], [429, {}], [400, { message: "bad" }]]) {
    assert.equal((await adapter(async () => response(body, status)).submit(request, context())).kind, "unknown");
  }
  const html = await adapter(async () => new Response("<html>proxy failure</html>", { status: 400 })).submit(request, context());
  assert.equal(html.kind, "unknown"); assert.equal(html.code, "INVALID_JSON_RESPONSE");
});

test("recognized rejection envelopes mixed with output or usage evidence remain unknown", async () => {
  for (const status of [400, 401, 403, 404, 413, 415, 422, 429]) {
    for (const evidence of [{ data: payload().data }, { data: [] }, { created: payload().created },
      { usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }]) {
      let calls = 0;
      const result = await adapter(async () => { calls += 1; return response({ ...evidence,
        error: { message: key, type: status === 429 ? "rate_limit_error" : "invalid_request_error" } }, status); })
        .submit(request, context());
      assert.equal(result.kind, "unknown"); assert.equal(result.code, "UNCONFIRMED_HTTP_FAILURE");
      assert.equal(result.receipt.httpStatus, status); assert.equal(result.receipt.requestId, "req-offline");
      assert.equal(calls, 1); assert.equal(JSON.stringify(result).includes(key), false);
    }
  }
});

test("successful image bytes mixed with top-level or per-image errors remain unknown", async () => {
  for (const body of [payload({ error: { message: key, type: "invalid_request_error" } }),
    payload({ error: null }), payload({ type: "error" }),
    payload({ data: [{ ...payload().data[0], error: { message: key } }] }),
    payload({ data: [{ ...payload().data[0], type: "error" }] })]) {
    let calls = 0;
    const result = await adapter(async () => { calls += 1; return response(body); }).submit(request, context());
    assert.equal(result.kind, "unknown"); assert.equal(result.code, "INVALID_IMAGE_RESPONSE");
    assert.equal(result.receipt.httpStatus, 200); assert.equal(result.receipt.requestId, "req-offline");
    assert.equal(calls, 1); assert.equal(JSON.stringify(result).includes(key), false);
  }
});

test("4xx output moderation and image generation failures never imply generation was not accepted", async () => {
  for (const error of [
    { type: "image_generation_user_error", code: "moderation_blocked", moderation_details: { moderation_stage: "output" } },
    { type: "image_generation_user_error", code: "image_generation_failed" },
    { type: "invalid_request_error", code: "content_policy_violation" },
    { type: "server_error" },
  ]) {
    const result = await adapter(async () => response({ error: { message: "filtered", ...error } }, 400)).submit(request, context());
    assert.equal(result.kind, "unknown"); assert.equal(result.code, "UNCONFIRMED_HTTP_FAILURE");
  }
});

test("successful HTTP with missing, multiple, remote or malformed image data does not become a free retry", async () => {
  const variants = [{}, payload({ data: [] }), payload({ data: [{}, {}] }),
    payload({ data: [{ url: "https://example.invalid/image.png" }] }),
    payload({ data: [{ b64_json: "%%%=" }] }), payload({ data: [{ b64_json: "abcd====" }] }),
    payload({ data: [{ b64_json: Buffer.from("not PNG").toString("base64") }] }),
    payload({ data: [{ b64_json: output.toString("base64"), url: "https://example.invalid/extra" }] })];
  for (const body of variants) {
    let calls = 0;
    const result = await adapter(async () => { calls += 1; return response(body); }).submit(request, context());
    assert.equal(result.kind, "unknown"); assert.equal(result.receipt.httpStatus, 200); assert.equal(calls, 1);
  }
});

test("dimension and reported setting mismatches are retained as uncertain evidence", async () => {
  for (const body of [payload({ data: [{ b64_json: png(16, 16).toString("base64") }] }),
    payload({ size: "auto" }), payload({ quality: "high" }), payload({ output_format: "jpeg" }),
    payload({ background: "transparent" }), payload({ model: "some-other-model" })]) {
    const result = await adapter(async () => response(body)).submit(request, context());
    assert.equal(result.kind, "unknown"); assert.equal(result.receipt.requestId, "req-offline");
  }
});

test("response and decoded-byte limits apply independently, including missing Content-Length", async () => {
  const sized = await adapter(async () => response(payload(), 200, { "content-length": "999999" }), { maxResponseBytes: 1024 })
    .submit(request, context());
  assert.equal(sized.kind, "unknown"); assert.equal(sized.code, "RESPONSE_TOO_LARGE");
  const streamed = await adapter(async () => response(), { maxResponseBytes: 1024 }).submit(request, context());
  assert.equal(streamed.kind, "unknown"); assert.equal(streamed.code, "RESPONSE_TOO_LARGE");
  const decoded = await adapter(async () => response(), { maxOutputBytes: 64 }).submit(request, context());
  assert.equal(decoded.kind, "unknown"); assert.equal(decoded.code, "OUTPUT_TOO_LARGE");
});

test("a stalled success body respects timeout and keeps request receipt", async () => {
  let cancelled = false;
  const result = await adapter(async () => new Response(new ReadableStream({ start() {}, cancel() { cancelled = true; } }),
    { headers: { "x-request-id": "req-stalled" } }), { timeoutMs: 15 }).submit(request, context());
  assert.equal(result.kind, "unknown"); assert.equal(result.code, "SUBMISSION_TIMEOUT");
  assert.equal(result.receipt.requestId, "req-stalled"); assert.equal(result.receipt.httpStatus, 200);
  assert.equal(cancelled, true);
});

test("unknown receipt snapshot cannot mutate after a late fetch completion", async () => {
  let finish;
  const transport = adapter(() => new Promise((resolve) => { finish = resolve; }), { timeoutMs: 15 });
  const result = await transport.submit(request, context());
  assert.equal(result.kind, "unknown"); assert.equal(result.receipt.requestId, null);
  finish(response()); await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(result.receipt.requestId, null); assert.equal(result.receipt.httpStatus, null);
});

test("calling submit twice is two requests, never a fabricated vendor idempotency guarantee", async () => {
  let calls = 0;
  const transport = adapter(async () => { calls += 1; return response(); });
  await transport.submit(request, context()); await transport.submit(request, context());
  assert.equal(calls, 2);
});

test("credential-like request IDs are dropped and usage is bounded structured metadata", async () => {
  const result = await adapter(async () => response(payload({ usage: { input_tokens: key, output_tokens: 1, total_tokens: 2 } }),
    200, { "x-request-id": key })).submit(request, context());
  assert.equal(result.kind, "completed"); assert.equal(result.receipt.requestId, null); assert.equal(result.usage, null);
  assert.equal(JSON.stringify({ ...result, output: undefined }).includes(key), false);
});

test("invalid constructor bounds fail with sanitized messages", () => {
  for (const config of [{ apiKey: `bad\n${key}` }, { timeoutMs: 600001 }, { maxResponseBytes: 49 * 1024 * 1024 },
    { maxOutputBytes: 33 * 1024 * 1024 }]) {
    assert.throws(() => adapter(async () => response(), config), (error) => !error.message.includes(key));
  }
});
