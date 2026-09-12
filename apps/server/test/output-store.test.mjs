import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { getEventListeners } from "node:events";
import { chmodSync, mkdirSync, readFileSync, readdirSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ExecutionOutputStore, OUTPUT_STORE_LIMITS } from "../dist/execution/output-store.js";
import { digest } from "../../../packages/core/dist/index.js";
import { setup, projectFixture } from "./execution-fixture.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const bytes = Buffer.from("synthetic storage fixture; not a decoded image");
const source = value => async function* () { for (let i = 0; i < value.length; i += OUTPUT_STORE_LIMITS.chunkBytes) yield value.subarray(i, i + OUTPUT_STORE_LIMITS.chunkBytes); };
async function fixture(t, { kind = "image", timeoutMs } = {}) {
  const f = setup(t, { count: 1, imagesOnly: kind === "image" });
  if (kind === "video") {
    await f.engine.runReady(); await f.engine.reconcile();
    const review = f.engine.reviewSnapshot(f.projectId); f.engine.approve(f.projectId, review.id, [review.members[0].videoNodeId], "human-review");
  }
  const node = f.plan.nodes.find(node => node.kind === kind); f.provider.setMode(node.id, "unknown_after_accept"); await f.engine.runReady();
  const attempt = f.engine.attempts(f.projectId).find(attempt => attempt.nodeId === node.id);
  const rootDir = join(f.directory, "outputs"), output = new ExecutionOutputStore(f.store, { rootDir, ...(timeoutMs ? { timeoutMs } : {}) });
  const input = value => ({ attemptId: attempt.id, expectedRequestDigest: digest(attempt.request), port: kind, kind,
    mimeType: kind === "image" ? "image/png" : "video/mp4", vendorTaskId: null, diagnosticRequestId: "request-fixture",
    source: { kind: "returned_bytes", sha256: hash(value), byteLength: value.length } });
  return { ...f, attempt, rootDir, output, input };
}
function locator(f, suffix = "one") {
  return { ...f.input(bytes), vendorTaskId: "known-task", source: { kind: "protected_locator", locator: `opaque-provider-handle:${suffix}?signature=private`, expiresAt: null } };
}

test("receipts pin immutable admitted request identity and replay without exposing locators in events", async t => {
  const f = await fixture(t), input = locator(f), before = f.store.readEvents(f.projectId);
  const receipt = f.output.recordReceipt(f.projectId, input);
  assert.deepEqual(f.output.recordReceipt(f.projectId, input), receipt);
  input.source.locator = "changed-after-record";
  assert.equal(receipt.source.locator, "opaque-provider-handle:one?signature=private");
  assert.equal(receipt.vendorTaskId, "known-task"); assert.equal(receipt.requestDigest, digest(f.attempt.request));
  assert.deepEqual(f.store.readEvents(f.projectId), before); assert.equal(await f.output.recover(f.projectId, receipt.id), null);
  assert.equal(f.store.list("execution_output_receipt", f.projectId).length, 1);
  assert.throws(() => f.store.put("execution_output_receipt", receipt.id, f.projectId, { ...receipt, diagnosticRequestId: "different" }), { code: "IMMUTABLE_RECORD" });
});

test("receipt validation rejects unadmitted identities, mismatches and unsupported metadata", async t => {
  const f = await fixture(t), input = f.input(bytes), other = projectFixture(); f.store.createProject(other);
  for (const patch of [{ attemptId: "missing" }, { expectedRequestDigest: "0".repeat(64) }, { path: "/arbitrary/path" },
    { kind: "video", port: "video", mimeType: "video/mp4" }, { source: { kind: "returned_bytes", sha256: hash(bytes), byteLength: 0 } },
    { source: { kind: "protected_locator", locator: "x", expiresAt: null } },
    { ...locator(f), source: { ...locator(f).source, locator: "x".repeat(8193) } }])
    assert.throws(() => f.output.recordReceipt(f.projectId, { ...input, ...patch }));
  assert.throws(() => f.output.recordReceipt(other.id, input), { code: "OUTPUT_RECEIPT_CONFLICT" });
  const receipt = f.output.recordReceipt(f.projectId, input);
  await assert.rejects(f.output.recover(other.id, receipt.id), { code: "SCOPE_DENIED" });
  assert.throws(() => f.store.insert("execution_output_receipt", randomUUID(), other.id, { ...input, projectId: other.id, requestDigest: input.expectedRequestDigest }), { code: "SCOPE_DENIED" });
});

test("owned bytes publish immutable manifests and idempotent replay does not reopen the stream", async t => {
  const f = await fixture(t), receipt = f.output.recordReceipt(f.projectId, f.input(bytes)); let opens = 0;
  const open = signal => { opens++; assert.equal(signal.aborted, false); return source(bytes)(); };
  const spool = await f.output.spool(f.projectId, receipt.id, open);
  assert.equal(opens, 1); assert.equal(spool.sha256, hash(bytes)); assert.equal(spool.byteLength, bytes.length);
  assert.deepEqual(await f.output.spool(f.projectId, receipt.id, open), spool); assert.equal(opens, 1);
  const owned = await f.output.resolveOwned(f.projectId, receipt.id); assert.deepEqual(readFileSync(owned.path), bytes);
  assert.equal(f.store.list("execution_output_slot", f.projectId).length, 1);
  assert.equal(f.store.list("artifact", f.projectId).length, 0); assert.equal(f.engine.attempts(f.projectId)[0].phase, "submission_unknown");
  assert.ok(!JSON.stringify(spool).includes(f.rootDir)); assert.equal(readdirSync(join(f.rootDir, "tmp")).length, 0);
  for (const kind of ["execution_output_spool", "execution_output_slot"]) {
    const record = f.store.list(kind, f.projectId)[0];
    assert.throws(() => f.store.put(kind, record.id, f.projectId, { ...record, unexpected: true }), { code: "IMMUTABLE_RECORD" });
  }
});

test("opaque locators are only evidence and require an explicit trusted byte source", async t => {
  const f = await fixture(t), receipt = f.output.recordReceipt(f.projectId, locator(f)); let streams = 0;
  assert.equal(await f.output.recover(f.projectId, receipt.id), null);
  const spool = await f.output.spool(f.projectId, receipt.id, () => { streams++; return source(bytes)(); });
  assert.equal(streams, 1); assert.equal(spool.sha256, hash(bytes)); assert.equal(spool.byteLength, bytes.length);
  assert.equal(f.provider.acceptedCount(), 1); assert.ok(!JSON.stringify(spool).includes("signature"));
});

test("byte, hash, chunk and total-stream limits fail without completion or liability release", async t => {
  const f = await fixture(t), receipt = f.output.recordReceipt(f.projectId, f.input(bytes));
  for (const value of [Buffer.alloc(bytes.length, 1), bytes.subarray(1), Buffer.concat([bytes, Buffer.from("extra")]), Buffer.alloc(0)]) {
    await assert.rejects(f.output.spool(f.projectId, receipt.id, source(value)), { code: "OUTPUT_BYTES_INVALID" });
  }
  const remote = f.output.recordReceipt(f.projectId, locator(f));
  await assert.rejects(f.output.spool(f.projectId, remote.id, async function* () { yield Buffer.alloc(OUTPUT_STORE_LIMITS.chunkBytes + 1); }), { code: "OUTPUT_BYTES_INVALID" });
  await assert.rejects(f.output.spool(f.projectId, remote.id, async function* () {
    const chunk = Buffer.alloc(OUTPUT_STORE_LIMITS.chunkBytes); for (let i = 0; i < 33; i++) yield chunk;
  }), { code: "OUTPUT_BYTES_INVALID" });
  assert.equal(f.store.list("execution_output_spool", f.projectId).length, 0);
  assert.equal(readdirSync(join(f.rootDir, "tmp")).length, 0); assert.equal(f.engine.budget(f.projectId).committedMicros, "100");
});

test("pre-abort and stalled streams cancel within the deadline and free writer capacity", async t => {
  const f = await fixture(t, { timeoutMs: 200 }), receipt = f.output.recordReceipt(f.projectId, f.input(bytes)); let opened = 0, returned = 0;
  const stalled = () => { opened++; return { [Symbol.asyncIterator]() { return { next: () => new Promise(() => {}), return: () => { returned++; return new Promise(() => {}); } }; } }; };
  await assert.rejects(f.output.spool(f.projectId, receipt.id, stalled, { signal: AbortSignal.abort() }), { code: "OUTPUT_STORE_CANCELLED" });
  assert.equal(opened, 0);
  const started = Date.now(); await assert.rejects(f.output.spool(f.projectId, receipt.id, stalled), { code: "OUTPUT_STORE_CANCELLED" });
  assert.ok(Date.now() - started < 1000); assert.equal(opened, 1); assert.equal(returned, 1);
  const normal = new ExecutionOutputStore(f.store, { rootDir: f.rootDir });
  assert.equal((await normal.spool(f.projectId, receipt.id, source(bytes))).sha256, hash(bytes));
});

test("two concurrent writers are shared across store instances without opening a third stream", async t => {
  const f = await fixture(t), receipt = f.output.recordReceipt(f.projectId, f.input(bytes));
  const second = new ExecutionOutputStore(f.store, { rootDir: f.rootDir }), controllers = [new AbortController(), new AbortController()];
  let started = 0, allStarted; const ready = new Promise(resolve => { allStarted = resolve; });
  const blocked = () => { started++; if (started === 2) allStarted(); return { [Symbol.asyncIterator]() { return { next: () => new Promise(() => {}), return: async () => ({ done: true }) }; } }; };
  const first = f.output.spool(f.projectId, receipt.id, blocked, { signal: controllers[0].signal });
  const next = second.spool(f.projectId, receipt.id, blocked, { signal: controllers[1].signal });
  const settled = Promise.allSettled([first, next]); await ready;
  await assert.rejects(f.output.spool(f.projectId, receipt.id, blocked), { code: "OUTPUT_STORE_BUSY" });
  assert.equal(started, 2); controllers.forEach(controller => controller.abort());
  assert.ok((await settled).every(result => result.status === "rejected"));
  assert.equal((await second.spool(f.projectId, receipt.id, source(bytes))).sha256, hash(bytes));
});

test("a byte-source factory that resolves after cancellation is closed without writing its bytes", async t => {
  const f = await fixture(t, { timeoutMs: 200 }), receipt = f.output.recordReceipt(f.projectId, f.input(bytes));
  let finish, closed = 0;
  const run = f.output.spool(f.projectId, receipt.id, () => new Promise(resolve => { finish = resolve; }));
  await assert.rejects(run, { code: "OUTPUT_STORE_CANCELLED" });
  finish({ [Symbol.asyncIterator]() { return { next: async () => ({ done: false, value: bytes }), return: async () => { closed++; return { done: true }; } }; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(closed, 1); assert.equal(f.store.list("execution_output_spool", f.projectId).length, 0);
  assert.equal(readdirSync(join(f.rootDir, "tmp")).length, 0);
});

test("cancellation during durable completion rejects after cleanup and preserves recoverable evidence", async t => {
  const f = await fixture(t), receipt = f.output.recordReceipt(f.projectId, f.input(bytes));
  const controller = new AbortController(), replacement = new AbortController(), options = { signal: controller.signal };
  const put = f.store.put.bind(f.store);
  f.store.put = (...args) => {
    const saved = put(...args);
    if (args[0] === "execution_output_spool") { options.signal = replacement.signal; controller.abort(); }
    return saved;
  };
  try { await assert.rejects(f.output.spool(f.projectId, receipt.id, source(bytes), options), { code: "OUTPUT_STORE_CANCELLED" }); }
  finally { f.store.put = put; }
  assert.equal(f.store.list("execution_output_spool", f.projectId).length, 1);
  assert.equal(f.store.list("execution_output_slot", f.projectId).length, 1);
  assert.equal(readdirSync(join(f.rootDir, "tmp")).length, 0);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  const recovered = await f.output.spool(f.projectId, receipt.id, () => { throw Error("must recover without opening another stream"); });
  assert.equal(recovered.sha256, hash(bytes));
});

test("mutating caller options cannot leave the original cancellation listener installed", async t => {
  const f = await fixture(t), receipt = f.output.recordReceipt(f.projectId, f.input(bytes));
  const controller = new AbortController(), replacement = new AbortController(), options = { signal: controller.signal };
  await f.output.spool(f.projectId, receipt.id, () => { options.signal = replacement.signal; return source(bytes)(); }, options);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  assert.equal(getEventListeners(replacement.signal, "abort").length, 0);
});

test("direct recovery observes the original cancellation signal through database completion", async t => {
  const f = await fixture(t), receipt = f.output.recordReceipt(f.projectId, f.input(bytes));
  await f.output.spool(f.projectId, receipt.id, source(bytes));
  const controller = new AbortController(), options = { signal: controller.signal }, put = f.store.put.bind(f.store);
  f.store.put = (...args) => {
    const saved = put(...args);
    if (args[0] === "execution_output_spool") { options.signal = new AbortController().signal; controller.abort(); }
    return saved;
  };
  try { await assert.rejects(f.output.recover(f.projectId, receipt.id, options), { code: "OUTPUT_STORE_CANCELLED" }); }
  finally { f.store.put = put; }
  assert.equal((await f.output.recover(f.projectId, receipt.id)).sha256, hash(bytes));
});

test("cancellation retains both writer slots until owned recovery work settles", async t => {
  const f = await fixture(t, { timeoutMs: 50 }), receipt = f.output.recordReceipt(f.projectId, f.input(bytes));
  const recover = f.output.recoverInternal.bind(f.output); let entered = 0, started;
  const ready = new Promise(resolve => { started = resolve; });
  f.output.recoverInternal = async (...args) => {
    entered++; if (entered === 2) started();
    await new Promise(resolve => setTimeout(resolve, 150));
    return recover(...args);
  };
  const runs = Promise.allSettled([f.output.spool(f.projectId, receipt.id, source(bytes)), f.output.spool(f.projectId, receipt.id, source(bytes))]);
  await ready; await new Promise(resolve => setTimeout(resolve, 80));
  await assert.rejects(f.output.spool(f.projectId, receipt.id, source(bytes)), { code: "OUTPUT_STORE_BUSY" });
  const results = await runs;
  assert.ok(results.every(result => result.status === "rejected" && result.reason.code === "OUTPUT_STORE_CANCELLED"));
  const normal = new ExecutionOutputStore(f.store, { rootDir: f.rootDir });
  assert.equal((await normal.spool(f.projectId, receipt.id, source(bytes))).sha256, hash(bytes));
});

test("durable manifests recover after a database publication failure without another byte source", async t => {
  const f = await fixture(t), receipt = f.output.recordReceipt(f.projectId, f.input(bytes)); let opens = 0;
  const put = f.store.put.bind(f.store); f.store.put = (...args) => { if (args[0] === "execution_output_spool") throw Error("injected database interruption"); return put(...args); };
  await assert.rejects(f.output.spool(f.projectId, receipt.id, () => { opens++; return source(bytes)(); }), /database interruption/); f.store.put = put;
  assert.equal(f.store.list("execution_output_spool", f.projectId).length, 0);
  const restarted = new ExecutionOutputStore(f.store, { rootDir: f.rootDir });
  const recovered = await restarted.recover(f.projectId, receipt.id);
  assert.equal(recovered.sha256, hash(bytes)); assert.equal(opens, 1);
  assert.equal(f.store.list("execution_output_slot", f.projectId).length, 1); assert.equal(f.provider.acceptedCount(), 1);
});

test("known response hashes recover a durable blob even if its manifest was not published", async t => {
  const f = await fixture(t), receipt = f.output.recordReceipt(f.projectId, f.input(bytes));
  const directory = join(f.rootDir, "manifests"), backup = join(f.rootDir, "saved-manifests");
  try { await assert.rejects(f.output.spool(f.projectId, receipt.id, async function* () {
    // Interruption after preflight lets the real writer flush the blob but prevents manifest publication.
    renameSync(directory, backup); writeFileSync(directory, "injected publication interruption"); yield bytes;
  })); }
  finally { unlinkSync(directory); renameSync(backup, directory); }
  const blob = join(f.rootDir, "blobs", `${hash(bytes)}.blob`); assert.deepEqual(readFileSync(blob), bytes);
  assert.equal(readdirSync(directory).length, 0);
  const restarted = new ExecutionOutputStore(f.store, { rootDir: f.rootDir });
  assert.equal((await restarted.recover(f.projectId, receipt.id)).sha256, hash(bytes));
});

test("a locator with no completed manifest cannot guess which orphaned bytes belong to it", async t => {
  const f = await fixture(t), receipt = f.output.recordReceipt(f.projectId, locator(f));
  const directory = join(f.rootDir, "manifests"), backup = join(f.rootDir, "saved-manifests");
  try { await assert.rejects(f.output.spool(f.projectId, receipt.id, async function* () {
    renameSync(directory, backup); writeFileSync(directory, "interrupted manifest"); yield bytes;
  })); }
  finally { unlinkSync(directory); renameSync(backup, directory); }
  assert.equal(await f.output.recover(f.projectId, receipt.id), null);
  assert.equal(f.store.list("execution_output_spool", f.projectId).length, 0);
  assert.equal(f.provider.acceptedCount(), 1);
  assert.equal((await f.output.spool(f.projectId, receipt.id, source(bytes))).sha256, hash(bytes));
});

test("different byte identities cannot replace an attempt output; matching refreshed receipts can share it", async t => {
  const f = await fixture(t), first = f.output.recordReceipt(f.projectId, locator(f, "one"));
  const initial = await f.output.spool(f.projectId, first.id, source(bytes));
  const refreshed = f.output.recordReceipt(f.projectId, locator(f, "refreshed"));
  assert.equal((await f.output.spool(f.projectId, refreshed.id, source(bytes))).sha256, initial.sha256);
  const conflicting = f.output.recordReceipt(f.projectId, locator(f, "different-content"));
  await assert.rejects(f.output.spool(f.projectId, conflicting.id, source(Buffer.from("different bytes"))), { code: "OUTPUT_SLOT_CONFLICT" });
  await assert.rejects(f.output.recover(f.projectId, conflicting.id), { code: "OUTPUT_SLOT_CONFLICT" });
  assert.equal(f.store.list("execution_output_slot", f.projectId)[0].spoolId, initial.id);
  assert.equal(f.store.list("execution_output_spool", f.projectId).length, 2);
});

test("concurrent conflicting receipts choose one immutable output identity", async t => {
  const f = await fixture(t), one = f.output.recordReceipt(f.projectId, locator(f, "one")), two = f.output.recordReceipt(f.projectId, locator(f, "two"));
  const results = await Promise.allSettled([f.output.spool(f.projectId, one.id, source(bytes)),
    f.output.spool(f.projectId, two.id, source(Buffer.from("other bytes")))]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.find(result => result.status === "rejected").reason.code, "OUTPUT_SLOT_CONFLICT");
  assert.equal(f.store.list("execution_output_slot", f.projectId).length, 1);
});

test("corrupt files and symlinks fail recovery without generation or publication", async t => {
  const f = await fixture(t), receipt = f.output.recordReceipt(f.projectId, f.input(bytes));
  const spool = await f.output.spool(f.projectId, receipt.id, source(bytes)), path = join(f.rootDir, "blobs", spool.blobKey);
  chmodSync(path, 0o600); writeFileSync(path, Buffer.alloc(bytes.length, 0));
  await assert.rejects(f.output.recover(f.projectId, receipt.id), { code: "OUTPUT_STORE_CORRUPT" });
  unlinkSync(path); const other = join(f.directory, "other"); writeFileSync(other, bytes); symlinkSync(other, path);
  await assert.rejects(f.output.recover(f.projectId, receipt.id), { code: "OUTPUT_STORE_CORRUPT" });
  assert.equal(f.provider.acceptedCount(), 1); assert.equal(f.store.list("artifact", f.projectId).length, 0);
});

test("a 65-MiB synthetic video spool uses bounded chunks and small SQLite evidence", async t => {
  const f = await fixture(t, { kind: "video" }), chunk = Buffer.alloc(1024 * 1024, 0x5a), hasher = createHash("sha256");
  for (let i = 0; i < 65; i++) hasher.update(chunk);
  const expected = hasher.digest("hex"), input = { ...f.input(bytes), source: { kind: "returned_bytes", sha256: expected, byteLength: 65 * chunk.length } };
  const receipt = f.output.recordReceipt(f.projectId, input);
  const spool = await f.output.spool(f.projectId, receipt.id, async function* () { for (let i = 0; i < 65; i++) yield chunk; });
  assert.equal(spool.byteLength, 65 * chunk.length); assert.equal(spool.sha256, expected);
  const rows = f.store.db.prepare("SELECT length(body) AS size FROM entities WHERE kind IN ('execution_output_receipt','execution_output_spool','execution_output_slot')").all();
  assert.equal(rows.length, 3); assert.ok(rows.every(row => row.size < 2048));
  assert.ok(!JSON.stringify(f.store.list("execution_output_spool", f.projectId)).includes("bytesBase64"));
  assert.equal(f.engine.attempts(f.projectId).find(attempt => attempt.id === f.attempt.id).phase, "submission_unknown");
});

test("preexisting storage-directory symlinks cannot redirect owned output publication", async t => {
  const f = await fixture(t), rootDir = join(f.directory, "unsafe-output"), elsewhere = join(f.directory, "elsewhere");
  mkdirSync(rootDir); mkdirSync(elsewhere); symlinkSync(elsewhere, join(rootDir, "blobs"));
  assert.throws(() => new ExecutionOutputStore(f.store, { rootDir }), { code: "OUTPUT_STORE_CONFIGURATION" });
});
