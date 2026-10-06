import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setup, refreshIntent } from "./execution-fixture.mjs";

test("trusted image publication can defer its changed video without granting it or touching another scene", async t => {
  const f = setup(t); await f.engine.runReady(); await f.engine.reconcile();
  const initialReview = f.engine.reviewSnapshot(f.projectId);
  f.engine.approve(f.projectId, initialReview.id, initialReview.members.map(row => row.videoNodeId), "human-video-review");
  await f.engine.runReady(); await f.engine.reconcile();
  const project = f.store.getProject(f.projectId), unrelated = f.store.list("node_binding", f.projectId).filter(row => row.node.shotId === "shot-1");
  project.shots[0].imagePrompt = "Revised first-scene keyframe"; refreshIntent(project.shots[0]);
  const next = f.store.saveProject(project, project.headVersion), compiled = f.compile(next);
  const image = compiled.nodes.find(row => row.kind === "image" && row.shotId === "shot-0"), video = compiled.nodes.find(row => row.kind === "video" && row.shotId === "shot-0");
  const grant = f.engine.createGrant(f.projectId, "shot-0", "image", "human-scene-image"), planId = randomUUID();
  f.store.transaction(() => {
    f.engine.installPlan(f.projectId, planId, compiled, { [image.id]: grant.id }, [video.id]);
    f.store.saveProject({ ...next, activePlanId: planId }, next.headVersion);
  });
  const deferred = f.store.get("node_binding", video.id);
  assert.equal(deferred.candidateId, null); assert.deepEqual(deferred.outputs, {});
  for (const previous of unrelated) {
    const current = f.store.get("node_binding", previous.id);
    assert.equal(current.candidateId, previous.candidateId); assert.deepEqual(current.outputs, previous.outputs);
  }
  const before = f.provider.acceptedCount(); await f.engine.runReady(); await f.engine.reconcile();
  assert.equal(f.provider.acceptedCount(), before + 1);
  const review = f.engine.reviewSnapshot(f.projectId);
  f.engine.approve(f.projectId, review.id, [video.id], "human-frame-review");
  const blocked = await f.engine.runReady();
  assert.ok(blocked.blocked.some(row => row.nodeId === video.id && row.code === "ORIGIN_NOT_AUTHORIZED"));
  assert.equal(f.provider.acceptedCount(), before + 1);
  const videoGrant = f.engine.createGrant(f.projectId, "shot-0", "video", "human-scene-video"), currentProject = f.store.getProject(f.projectId), videoPlanId = randomUUID();
  f.store.transaction(() => {
    f.engine.installPlan(f.projectId, videoPlanId, compiled, { [video.id]: videoGrant.id });
    f.store.saveProject({ ...currentProject, activePlanId: videoPlanId }, currentProject.headVersion);
  });
  await f.engine.runReady(); assert.equal(f.provider.acceptedCount(), before + 2);
});

test("deferred publication rejects image, unknown, duplicate and already granted nodes without writes", t => {
  const f = setup(t, { count: 1 }), image = f.plan.nodes.find(row => row.kind === "image"), video = f.plan.nodes.find(row => row.kind === "video");
  const grant = f.engine.createGrant(f.projectId, "shot-0", "video", "human-video"), before = f.store.db.prepare("SELECT kind,id,body FROM entities ORDER BY kind,id").all();
  for (const [deferred, grants] of [[[image.id], {}], [["missing"], {}], [[video.id, video.id], {}], [[video.id], { [video.id]: grant.id }]]) {
    assert.throws(() => f.engine.installPlan(f.projectId, randomUUID(), f.plan, grants, deferred), { code: "DEFERRED_VIDEO_INVALID" });
    assert.deepEqual(f.store.db.prepare("SELECT kind,id,body FROM entities ORDER BY kind,id").all(), before);
  }
});
