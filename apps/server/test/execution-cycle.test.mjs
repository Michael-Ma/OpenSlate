import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import { Engine } from "../dist/execution/engine.js";
import { fixtureOutputs } from "../../../packages/providers/dist/index.js";
import { setup } from "./execution-fixture.mjs";

for (const mode of ["runReady", "reconcile"]) test(`${mode} waits for started sibling ingestion before rejecting a cycle`, async t => {
  const f = setup(t, { count: 2, imagesOnly: true }), slowNode = f.plan.nodes[0].id;
  const entered = Promise.withResolvers(), release = Promise.withResolvers(), failed = Promise.withResolvers();
  let settled = false;
  f.provider.submit = async request => mode === "runReady"
    ? { type: "completed", taskId: request.nodeId, outputs: fixtureOutputs(request) }
    : { type: "accepted", taskId: request.nodeId };
  f.provider.poll = async (_taskId, request) => ({ type: "completed", taskId: request.nodeId, outputs: fixtureOutputs(request) });
  const engine = new Engine(f.store, f.provider, { artifactDir: f.artifactDir, outputIngestor: {
    async ingest({ attempt, output, artifactDir }) {
      if (attempt.nodeId !== slowNode) { await entered.promise; failed.resolve(); throw Error("synthetic sibling ingestion failure"); }
      entered.resolve(); await release.promise;
      const id = randomUUID(), path = join(artifactDir, `${output.sha256}.${output.extension}`);
      writeFileSync(path, Buffer.from(output.bytesBase64, "base64"));
      return { id, projectId: attempt.projectId, attemptId: attempt.id, artifact: { artifactId: id, sha256: output.sha256, kind: output.kind },
        path, mimeType: output.mimeType, fixture: output.fixture, physicalDurationSeconds: null };
    },
  } });
  if (mode === "reconcile") await engine.runReady();
  const running = engine[mode]().then(() => { settled = true; return null; }, error => { settled = true; return error; });
  try {
    await failed.promise; await nextTurn();
    assert.equal(settled, false, "a started sibling still owns output work");
    assert.equal(engine.outputs(f.projectId).length, 0);
  } finally { release.resolve(); await running; }
  assert.match((await running).message, /synthetic sibling ingestion failure/);
  assert.equal(engine.attempts(f.projectId).find(value => value.nodeId === slowNode).phase, "succeeded");
  assert.equal(engine.outputs(f.projectId).length, 1);
});
