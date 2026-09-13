import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { getEventListeners } from "node:events";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digest } from "../../../packages/core/dist/index.js";
import { normalizeExecutionOutcome } from "../../../packages/providers/dist/index.js";
import { Store } from "../dist/persistence/store.js";
import { ExecutionOutputStore, OUTPUT_STORE_LIMITS } from "../dist/execution/output-store.js";
import { projectFixture } from "./execution-fixture.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const roles = {
  speech: { port: "audio", kind: "audio", mimeType: "audio/wav", extension: "wav", limit: 32 * 1024 * 1024 },
  transcription: { port: "cues", kind: "data", mimeType: "application/json", extension: "json", limit: 4 * 1024 * 1024 },
};
// Storage intentionally does not decode or interpret paid raw response bytes.
const payload = kind => Buffer.from(kind === "speech" ? "unparsed raw audio response" : '{ "text": "private transcript", "words": [] }\n');
const source = bytes => async function* () {
  for (let start = 0; start < bytes.length; start += OUTPUT_STORE_LIMITS.chunkBytes) yield bytes.subarray(start, start + OUTPUT_STORE_LIMITS.chunkBytes);
};
function fixture(t, kind) {
  const directory = mkdtempSync(join(tmpdir(), "openslate-audio-spool-")), dbPath = join(directory, "store.sqlite");
  const f = { directory, dbPath, rootDir: join(directory, "outputs"), store: new Store(dbPath), projectId: `project-${kind}` };
  f.store.createProject(projectFixture(f.projectId, 0));
  const id = `attempt-${kind}`, fingerprint = "c".repeat(64), request = {
    attemptId: id, nodeId: `node-${kind}`, kind, fingerprint, args: { text: "synthetic test" }, inputs: [],
    execution: { adapter: "offline-audio-test", version: "1" },
  };
  // An injected admitted ledger fixture; no provider registration or POST exists in this suite.
  const grant = f.store.insert("grant", "grant", f.projectId, { authorityId: "human-test", scopeId: f.projectId, kind, origin: "initial_slot" });
  f.store.insert("candidate", "candidate", f.projectId, { grantId: grant.id, nodeId: request.nodeId, origin: "initial_slot" });
  f.attempt = f.store.insert("attempt", id, f.projectId, { nodeId: request.nodeId, candidateId: "candidate", ordinal: 1,
    specDigest: fingerprint, fingerprint, request, workKey: null, phase: "submission_unknown", leaseOwner: "original", leaseEpoch: 1,
    leaseExpiresAt: 0, taskId: null, reservationId: "reservation", failure: null, outputs: {}, createdAt: "2026-09-12T00:00:00.000Z" });
  f.store.insert("reservation", "reservation", f.projectId, { attemptId: id, micros: "100", state: "reserved" });
  f.output = new ExecutionOutputStore(f.store, { rootDir: f.rootDir });
  const { port, kind: outputKind, mimeType } = roles[kind];
  f.input = bytes => ({ attemptId: id, expectedRequestDigest: digest(request), port, kind: outputKind, mimeType,
    vendorTaskId: null, diagnosticRequestId: "diagnostic-only", source: { kind: "returned_bytes", sha256: hash(bytes), byteLength: bytes.length } });
  f.reopen = () => { f.store.close(); f.store = new Store(dbPath); f.output = new ExecutionOutputStore(f.store, { rootDir: f.rootDir }); };
  t.after(() => { if (f.store.db.open) f.store.close(); rmSync(directory, { recursive: true, force: true }); });
  return f;
}

for (const kind of Object.keys(roles)) {
  test(`${kind} raw bytes round-trip through V1 storage and V2 completion without interpretation`, async t => {
    const f = fixture(t, kind), bytes = payload(kind), input = f.input(bytes), receipt = f.output.recordReceipt(f.projectId, input);
    const snapshot = structuredClone(receipt), events = f.store.readEvents(f.projectId); let opens = 0;
    input.source.sha256 = "0".repeat(64); input.port = "changed"; input.diagnosticRequestId = "changed";
    assert.deepEqual(receipt, snapshot);
    const spool = await f.output.spool(f.projectId, receipt.id, () => { opens++; return source(bytes)(); });
    f.reopen();
    const completion = await f.output.recoverCompletion(f.projectId, f.attempt.id);
    const { limit: _limit, ...role } = roles[kind];
    assert.deepEqual(completion, { type: "completed", version: 2, receiptId: receipt.id, vendorTaskId: null,
      outputs: [{ ...role, sha256: hash(bytes), byteLength: bytes.length, fixture: false, storage: { type: "spool", spoolId: receipt.id } }] });
    assert.deepEqual(normalizeExecutionOutcome(completion, f.attempt.request), completion);
    const owned = await f.output.resolveOutput(f.projectId, f.attempt.id, completion.outputs[0]);
    assert.deepEqual(readFileSync(owned.path), bytes); assert.deepEqual(owned.spool, spool);
    await f.output.spool(f.projectId, receipt.id, () => { throw Error("must reuse saved bytes"); });
    assert.equal(opens, 1); assert.equal(spool.version, 1); assert.equal(receipt.version, 1);
    assert.equal(f.store.get("attempt", f.attempt.id).phase, "submission_unknown");
    assert.equal(f.store.get("reservation", "reservation").state, "reserved");
    assert.equal(f.store.list("artifact", f.projectId).length, 0); assert.equal(f.store.list("narration_cue", f.projectId).length, 0);
    assert.deepEqual(f.store.readEvents(f.projectId), events);
    assert.equal(JSON.stringify(completion).includes("diagnostic-only"), false);
    assert.equal(JSON.stringify(completion).includes("private transcript"), false);
  });

  test(`${kind} rejects unsupported roles, locators, task IDs, foreign requests and over-limit receipt bounds`, async t => {
    const f = fixture(t, kind), input = f.input(payload(kind));
    for (const patch of [{ port: kind }, { kind }, { mimeType: "audio/mpeg" }, { vendorTaskId: "diagnostic-only" },
      { expectedRequestDigest: "0".repeat(64) }, { attemptId: "foreign" },
      { source: { kind: "returned_bytes", sha256: input.source.sha256, byteLength: roles[kind].limit + 1 } },
      { source: { kind: "protected_locator", locator: "https://untrusted.example/raw", expiresAt: null } },
      { port: "image", kind: "image", mimeType: "image/png" }]) {
      assert.throws(() => f.output.recordReceipt(f.projectId, { ...input, ...patch }));
    }
    f.store.createProject(projectFixture("foreign-project", 0));
    assert.throws(() => f.output.recordReceipt("foreign-project", input), { code: "OUTPUT_RECEIPT_CONFLICT" });
    assert.equal(f.store.list("execution_output_receipt", f.projectId).length, 0);
    const receipt = f.output.recordReceipt(f.projectId, input);
    await assert.rejects(f.output.recover("foreign-project", receipt.id), { code: "SCOPE_DENIED" });
    assert.equal(await f.output.recoverCompletion(f.projectId, f.attempt.id), null);
  });

  test(`${kind} forged stored role/execution cannot reach a byte source even with a valid receipt digest`, async t => {
    const f = fixture(t, kind), input = f.input(payload(kind)); let opens = 0;
    for (const patch of [{ port: "image", kind: "image", mimeType: "image/png" },
      { execution: { adapter: "foreign", version: "1" } },
      { vendorTaskId: "forged-task", source: { kind: "protected_locator", locator: "private-handle", expiresAt: null } }]) {
      const { expectedRequestDigest, ...observation } = input;
      const body = { ...observation, version: 1, projectId: f.projectId, requestDigest: expectedRequestDigest,
        execution: f.attempt.request.execution, ...patch }, id = digest(body);
      // Simulate corrupted historical SQL, bypassing Store's independent write validation.
      f.store.db.prepare("INSERT INTO entities(kind,id,project_id,body) VALUES(?,?,?,?)")
        .run("execution_output_receipt", id, f.projectId, JSON.stringify({ ...body, id }));
      await assert.rejects(f.output.spool(f.projectId, id, () => { opens++; return source(payload(kind))(); }));
      await assert.rejects(f.output.recover(f.projectId, id));
    }
    assert.equal(opens, 0); assert.equal(f.store.list("execution_output_spool", f.projectId).length, 0);
  });

  for (const interruptedKind of ["execution_output_spool", "execution_output_slot"]) {
    test(`${kind} reopens a completed filesystem slot after ${interruptedKind} SQL rollback`, async t => {
      const f = fixture(t, kind), bytes = payload(kind), receipt = f.output.recordReceipt(f.projectId, f.input(bytes)); let opens = 0;
      const put = f.store.put.bind(f.store);
      f.store.put = (...args) => { if (args[0] === interruptedKind) throw Error("injected SQL publication failure"); return put(...args); };
      await assert.rejects(f.output.spool(f.projectId, receipt.id, () => { opens++; return source(bytes)(); }), /SQL publication/);
      assert.equal(f.store.list("execution_output_spool", f.projectId).length, 0);
      assert.equal(f.store.list("execution_output_slot", f.projectId).length, 0);
      f.reopen();
      const completion = await f.output.recoverCompletion(f.projectId, f.attempt.id);
      assert.equal(completion.receiptId, receipt.id); assert.equal(completion.outputs[0].sha256, hash(bytes));
      await f.output.spool(f.projectId, receipt.id, () => { throw Error("no second source"); });
      assert.equal(opens, 1); assert.equal(f.store.get("reservation", "reservation").state, "reserved");
    });
  }

  test(`${kind} first winning slot survives matching and conflicting observations across restart`, async t => {
    const f = fixture(t, kind), bytes = payload(kind), receipt = f.output.recordReceipt(f.projectId, f.input(bytes));
    await f.output.spool(f.projectId, receipt.id, source(bytes));
    const matching = f.output.recordReceipt(f.projectId, { ...f.input(bytes), diagnosticRequestId: "later-observation" });
    await f.output.spool(f.projectId, matching.id, source(bytes));
    const wrong = Buffer.concat([bytes, Buffer.from("different")]), conflict = f.output.recordReceipt(f.projectId, f.input(wrong));
    await assert.rejects(f.output.spool(f.projectId, conflict.id, source(wrong)), { code: "OUTPUT_SLOT_CONFLICT" });
    f.reopen();
    const completion = await f.output.recoverCompletion(f.projectId, f.attempt.id);
    assert.equal(completion.receiptId, receipt.id); assert.equal(completion.outputs[0].sha256, hash(bytes));
    await assert.rejects(f.output.resolveOutput(f.projectId, f.attempt.id, { ...completion.outputs[0], storage: { type: "spool", spoolId: matching.id } }),
      { code: "OUTPUT_SLOT_CONFLICT" });
    const foreign = structuredClone(completion); foreign.outputs[0].port = "image";
    assert.throws(() => f.output.assertCompletion(f.projectId, f.attempt.id, foreign), { code: "OUTPUT_RECEIPT_CONFLICT" });
  });

  test(`${kind} original cancellation at durable commit preserves the winning bytes for recovery`, async t => {
    const f = fixture(t, kind), bytes = payload(kind), receipt = f.output.recordReceipt(f.projectId, f.input(bytes));
    const original = new AbortController(), replacement = new AbortController(), options = { signal: original.signal };
    const put = f.store.put.bind(f.store);
    f.store.put = (...args) => {
      const saved = put(...args);
      if (args[0] === "execution_output_spool") { options.signal = replacement.signal; original.abort(); }
      return saved;
    };
    await assert.rejects(f.output.spool(f.projectId, receipt.id, source(bytes), options), { code: "OUTPUT_STORE_CANCELLED" });
    assert.equal(getEventListeners(original.signal, "abort").length, 0); assert.equal(getEventListeners(replacement.signal, "abort").length, 0);
    assert.deepEqual(readdirSync(join(f.rootDir, "tmp")), []);
    f.reopen();
    assert.equal((await f.output.recoverCompletion(f.projectId, f.attempt.id)).outputs[0].sha256, hash(bytes));
  });

  test(`${kind} original signal remains authoritative during winning-slot recovery`, async t => {
    const f = fixture(t, kind), bytes = payload(kind), receipt = f.output.recordReceipt(f.projectId, f.input(bytes));
    await f.output.spool(f.projectId, receipt.id, source(bytes));
    const original = new AbortController(), options = { signal: original.signal }, put = f.store.put.bind(f.store);
    f.store.put = (...args) => {
      const saved = put(...args);
      if (args[0] === "execution_output_spool") { options.signal = new AbortController().signal; original.abort(); }
      return saved;
    };
    await assert.rejects(f.output.recoverCompletion(f.projectId, f.attempt.id, options), { code: "OUTPUT_STORE_CANCELLED" });
    f.store.put = put;
    assert.equal((await f.output.recoverCompletion(f.projectId, f.attempt.id)).receiptId, receipt.id);
  });

  test(`${kind} observed streaming cap rejects one excess byte without publishing a spool`, async t => {
    const f = fixture(t, kind), chunk = Buffer.alloc(OUTPUT_STORE_LIMITS.chunkBytes), limit = roles[kind].limit;
    const expected = createHash("sha256");
    for (let i = 0; i < limit / chunk.length; i++) expected.update(chunk);
    const receipt = f.output.recordReceipt(f.projectId, { ...f.input(payload(kind)),
      source: { kind: "returned_bytes", sha256: expected.digest("hex"), byteLength: limit } });
    await assert.rejects(f.output.spool(f.projectId, receipt.id, async function* () {
      for (let i = 0; i < limit / chunk.length; i++) yield chunk;
      yield Buffer.from([1]);
    }), { code: "OUTPUT_BYTES_INVALID" });
    assert.equal(f.store.list("execution_output_spool", f.projectId).length, 0);
    assert.equal(await f.output.recoverCompletion(f.projectId, f.attempt.id), null);
    assert.deepEqual(readdirSync(join(f.rootDir, "tmp")), []);
  });

  test(`${kind} original pre-abort and source cancellation cannot open or publish another response`, async t => {
    const f = fixture(t, kind), bytes = payload(kind), receipt = f.output.recordReceipt(f.projectId, f.input(bytes)); let opens = 0;
    await assert.rejects(f.output.spool(f.projectId, receipt.id, () => { opens++; return source(bytes)(); }, { signal: AbortSignal.abort() }),
      { code: "OUTPUT_STORE_CANCELLED" });
    assert.equal(opens, 0);
    const original = new AbortController(), options = { signal: original.signal };
    await assert.rejects(f.output.spool(f.projectId, receipt.id, () => {
      opens++; options.signal = new AbortController().signal; original.abort(); return source(bytes)();
    }, options), { code: "OUTPUT_STORE_CANCELLED" });
    assert.equal(opens, 1); assert.equal(getEventListeners(original.signal, "abort").length, 0);
    assert.equal(await f.output.recoverCompletion(f.projectId, f.attempt.id), null);
    assert.deepEqual(readdirSync(join(f.rootDir, "tmp")), []);
  });
}
