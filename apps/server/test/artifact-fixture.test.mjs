import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../dist/app.js";
import { ProductionService } from "../dist/application/service.js";
import { setup } from "./execution-fixture.mjs";

function savedArtifact(f, fixture, kind = "video") {
  const id = randomUUID(), artifact = { artifactId: id, kind, sha256: "d".repeat(64) };
  f.store.insert("artifact", id, f.projectId, { artifact, path: "/unused-test-only-metadata", mimeType: kind === "image" ? "image/png" : "video/mp4",
    ...(fixture === undefined ? {} : { fixture }), attemptId: null, physicalDurationSeconds: null });
  return artifact;
}

test("an image-only active plan has an empty current review without failing the workspace or creating authority", async t => {
  const f = setup(t, { imagesOnly: true }), service = new ProductionService(f.store, f.engine);
  const localToken = "offline_image_only_review_session_0123456789", app = createApp({ service, localToken }); t.after(() => app.close());
  const project = f.store.getProject(f.projectId), before = f.store.db.prepare("SELECT count(*) AS n FROM entities").get().n;
  const response = await app.inject({ method: "GET", url: `/api/projects/${f.projectId}/review`, headers: { host: "127.0.0.1", authorization: `Bearer ${localToken}` } });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), { id: null, projectId: f.projectId, planId: project.activePlanId, members: [], headVersion: project.headVersion, revisionId: project.revisionId });
  assert.equal(f.store.db.prepare("SELECT count(*) AS n FROM entities").get().n, before);
  assert.deepEqual(f.store.getProject(f.projectId), project); assert.equal(f.store.list("approval", f.projectId).length, 0);
});

test("artifact fixture projection requires exact project, content and kind and preserves unknown metadata", t => {
  const f = setup(t, { count: 1 }), service = new ProductionService(f.store, f.engine);
  for (const fixture of [true, false, undefined, "false"]) {
    const artifact = savedArtifact(f, fixture);
    assert.equal(service.artifactFixture(f.projectId, artifact), typeof fixture === "boolean" ? fixture : null);
    assert.equal(service.artifactFixture("another-project", artifact), null);
    assert.equal(service.artifactFixture(f.projectId, { ...artifact, sha256: "e".repeat(64) }), null);
    assert.equal(service.artifactFixture(f.projectId, { ...artifact, kind: "image" }), null);
    assert.equal(service.artifactFixture(f.projectId, { ...artifact, artifactId: "missing" }), null);
  }
});

test("previous preview metadata follows each exact saved render output without inferring a fixture", t => {
  const f = setup(t, { count: 1 }), service = new ProductionService(f.store, f.engine);
  for (const fixture of [true, false, undefined]) {
    const artifact = savedArtifact(f, fixture), id = randomUUID();
    f.store.insert("attempt", id, f.projectId, { candidateId: null, workKey: id, ordinal: 1, nodeId: `render-${id}`,
      request: { kind: "render" }, phase: "succeeded", outputs: { video: artifact } });
  }
  const rows = service.snapshot(f.projectId).previousPreviews;
  assert.equal(rows.length, 3); assert.deepEqual(rows.map(row => row.fixture), [null, false, true]);
  for (const row of rows) assert.equal(row.fixture, service.artifactFixture(f.projectId, row.artifact));
});

test("review HTTP projects saved frame fixture metadata without changing review or approval authority", async t => {
  const f = setup(t, { count: 3 }), service = new ProductionService(f.store, f.engine);
  await f.engine.runReady(); await f.engine.reconcile();
  await f.engine.runReady(); await f.engine.reconcile();
  const outputRefs = f.engine.outputs(f.projectId).map(output => output.artifact);
  assert.equal(outputRefs.length, 3);
  // Synthetic persisted metadata variants only: these files all remain fake test media.
  // Direct fixture setup represents imported/historical records without weakening immutable application writes.
  for (const [index, ref] of outputRefs.entries()) {
    const row = f.store.get("artifact", ref.artifactId);
    if (index === 1) row.fixture = false;
    if (index === 2) delete row.fixture;
    f.store.db.prepare("UPDATE entities SET body = ? WHERE kind = 'artifact' AND id = ?").run(JSON.stringify(row), row.id);
  }
  const localToken = "offline_fixture_metadata_session_0123456789";
  const app = createApp({ service, localToken }); t.after(() => app.close());
  const request = () => app.inject({ method: "GET", url: `/api/projects/${f.projectId}/review`, headers: { host: "127.0.0.1", authorization: `Bearer ${localToken}` } });
  const projectBefore = f.store.getProject(f.projectId), evidenceBefore = f.store.list("evidence", f.projectId);
  const response = await request(); assert.equal(response.statusCode, 200, response.body);
  const review = response.json(); assert.equal(review.members.length, 3);
  assert.deepEqual(review.members.map(member => member.keyframeFixture), [true, false, null]);
  const saved = f.store.get("review_snapshot", review.id);
  assert.ok(saved); assert.equal(saved.members.some(member => Object.hasOwn(member, "keyframeFixture")), false);
  for (const member of review.members) {
    const original = saved.members.find(value => value.videoNodeId === member.videoNodeId);
    assert.deepEqual(member.keyframe, original.keyframe); assert.equal(member.approvalDigest, original.approvalDigest);
    assert.equal(member.approved, false);
  }
  assert.deepEqual((await request()).json(), review); assert.deepEqual(f.store.get("review_snapshot", review.id), saved);
  assert.deepEqual(f.store.getProject(f.projectId), projectBefore); assert.deepEqual(f.store.list("evidence", f.projectId), evidenceBefore);
  for (const kind of ["approval", "message", "hold"]) assert.equal(f.store.list(kind, f.projectId).length, 0);
});
