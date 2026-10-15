import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../dist/persistence/index.js";
import { Engine } from "../dist/execution/index.js";
import { ProductionService } from "../dist/application/service.js";
import { FakeProvider } from "../../../packages/providers/dist/index.js";
import { createApp } from "../dist/app.js";
import { projectFixture } from "./execution-fixture.mjs";
import { compilePlan } from "@openslate/core";
function fixture(t, { sharedScene = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "openslate-scene-")),
    store = new Store(join(directory, "store.sqlite")),
    provider = new FakeProvider(join(directory, "provider.sqlite")),
    engine = new Engine(store, provider, {
      artifactDir: join(directory, "artifacts"),
      budgetMicros: "0",
    }),
    service = new ProductionService(store, engine);
  let project = service.createProject("Scene approval fixture");
  const shape = projectFixture(project.id, sharedScene ? 3 : 2);
  if (sharedScene) {
    shape.shots[1].sceneId = "scene-0";
    shape.scenes = shape.scenes.filter((scene) => scene.id !== "scene-1");
  }
  project = {
    ...project,
    ...shape,
    capabilityLockId: project.capabilityLockId,
    headVersion: 0,
    shots: shape.shots.map((s) => ({
      ...s,
      narration: { mode: "none", text: "", voice: "stock" },
    })),
  };
  store.saveProject(project, 0);
  store.put("project_revision", project.revisionId, project.id, { project });
  const token = randomBytes(32).toString("base64url"),
    app = createApp({ service, localToken: token, logger: false });
  t.after(async () => {
    await app.close();
    store.close();
    provider.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const get = async (scene = "scene-0") => {
    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/scenes/${scene}/generation`,
      headers: { host: "127.0.0.1", authorization: `Bearer ${token}` },
    });
    assert.equal(response.statusCode, 200, response.body);
    return response.json();
  };
  const post = async (view, kind = "image", key = randomUUID(), extra = {}) =>
    app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/scenes/${view.sceneId}/generate`,
      headers: {
        host: "127.0.0.1",
        authorization: `Bearer ${token}`,
        "idempotency-key": key,
      },
      payload: {
        headVersion: view.headVersion,
        revisionId: view.revisionId,
        kind,
        reviewedFrames:
          kind === "video"
            ? view.rows
                .filter((r) => !r.videoComplete)
                .map((r) => ({
                  shotId: r.shotId,
                  artifactId: r.image?.artifactId,
                  sha256: r.image?.sha256,
                }))
            : [],
        reviewedHoldDigest: view.reviewedHoldDigest,
        reviewedControlAuthorityId: view.reviewedControlAuthorityId,
        ...extra,
      },
    });
  const finish = async () => {
    for (let i = 0; i < 6; i++) {
      await engine.runReady();
      await engine.reconcile();
    }
  };
  return { store, engine, service, app, project, get, post, finish, provider };
}
function replaceLock(f, p, change) {
  const lock = f.store.get("capability_lock", p.capabilityLockId);
  change(lock);
  lock.id = randomUUID();
  f.store.insert("capability_lock", lock.id, p.id, lock);
  p.capabilityLockId = lock.id;
  p.headVersion++;
  p.revisionId = randomUUID();
  f.store.saveProject(p, p.headVersion - 1);
  f.store.insert("project_revision", p.revisionId, p.id, { project: p });
  return p;
}
test("one scene check generates keyframes without any allowance, exact replay adds no work, then one video check approves the actual frame", async (t) => {
  const f = fixture(t),
    v = await f.get(),
    key = randomUUID();
  const a = await f.post(v, "image", key);
  assert.equal(a.statusCode, 200, a.body);
  assert.equal(f.store.list("candidate", f.project.id).length, 1);
  assert.deepEqual((await f.post(v, "image", key)).json(), a.json());
  assert.equal(f.store.list("candidate", f.project.id).length, 1);
  await f.finish();
  const frames = await f.get();
  assert.ok(frames.rows[0].image);
  assert.equal(f.engine.attempts(f.project.id).length, 1);
  assert.equal(f.store.list("external_allowance", f.project.id).length, 0);
  const videoKey = randomUUID(),
    video = await f.post(frames, "video", videoKey);
  assert.equal(video.statusCode, 200, video.body);
  assert.equal(f.store.list("approval", f.project.id).length, 1);
  assert.deepEqual(
    (await f.post(frames, "video", videoKey)).json(),
    video.json(),
  );
  await f.finish();
  assert.equal((await f.get()).rows[0].videoComplete, true);
  assert.equal(f.engine.attempts(f.project.id).length, 2);
  assert.equal((await f.get("scene-1")).rows[0].image, null);
});
test("scene approval resolves only its part of a whole-film planning hold", async (t) => {
  const f = fixture(t),
    human = f.service.beginRequest(
      f.project.id,
      "local-user",
      "Plan whole film",
      { scopeIds: [f.project.id] },
    );
  const v = await f.get(),
    a = await f.post(v);
  assert.equal(a.statusCode, 200, a.body);
  const active = f.store.list("hold", f.project.id).filter((h) => h.active);
  assert.deepEqual(
    active.map((h) => [h.scopeId, h.ownerId]),
    [["scene-1", human.requestId]],
  );
  await f.finish();
  assert.ok((await f.get()).rows[0].image);
  assert.equal((await f.get("scene-1")).rows[0].image, null);
});
test("stale frame, revised scene, busy turn and failed publication create no authority and never release holds", async (t) => {
  const f = fixture(t);
  let v = await f.get();
  assert.notEqual(
    (await f.post(v, "image", randomUUID(), { headVersion: 999 })).statusCode,
    200,
  );
  assert.equal(f.store.list("grant", f.project.id).length, 0);
  const first = await f.post(v);
  assert.equal(first.statusCode, 200, first.body);
  await f.finish();
  v = await f.get();
  const before = f.store.list("message", f.project.id).length;
  assert.notEqual(
    (
      await f.post(v, "video", randomUUID(), {
        reviewedFrames: [
          {
            shotId: "shot-0",
            artifactId: v.rows[0].image.artifactId,
            sha256: "a".repeat(64),
          },
        ],
      })
    ).statusCode,
    200,
  );
  assert.equal(f.store.list("message", f.project.id).length, before);
  const original = f.service.applyCompiledSceneGeneration.bind(f.service);
  f.service.applyCompiledSceneGeneration = () => {
    throw new Error("Injected publication failure");
  };
  const snapshot = f.store.getProject(f.project.id);
  const failedKey = randomUUID();
  assert.equal((await f.post(v, "video", failedKey)).statusCode, 500);
  assert.equal(
    f.store.getProject(f.project.id).headVersion,
    snapshot.headVersion,
  );
  assert.equal(f.store.list("message", f.project.id).length, before);
  assert.equal(f.store.list("approval", f.project.id).length, 0);
  f.service.applyCompiledSceneGeneration = original;
  assert.equal((await f.post(v, "video", failedKey)).statusCode, 200);
});

test("scene video preview and publication use the same supported covering duration", async (t) => {
  const f = fixture(t),
    p = f.store.getProject(f.project.id);
  p.shots[0].desiredFrames = 165;
  p.shots[0].promptIntent.video = (
    await import("@openslate/core")
  ).shotIntentDigest(p.shots[0], "video");
  replaceLock(f, p, (lock) => {
    lock.profiles.find((row) => row.kind === "video").minFrames = 180;
  });
  const first = await f.post(await f.get());
  assert.equal(first.statusCode, 200, first.body);
  await f.finish();
  const v = await f.get();
  assert.equal(v.rows[0].durationFrames, 180);
  assert.equal(v.rows[0].plannedFrames, 165);
  const a = await f.post(v, "video");
  assert.equal(a.statusCode, 200, a.body);
  const node = f.store
    .get("plan", a.json().activePlanId)
    .compiled.nodes.find((n) => n.kind === "video");
  assert.equal(node.args.durationFrames, 180);
});
test("new scene work follows preferred models rather than the first retained profile of that kind", async (t) => {
  const f = fixture(t),
    p = f.store.getProject(f.project.id);
  replaceLock(f, p, (lock) => {
    const image = lock.profiles.find((row) => row.kind === "image");
    lock.profiles.push({ ...image, id: "chosen-image" });
    lock.preferredProfileIds = {
      image: "chosen-image",
      video: lock.profiles.find((row) => row.kind === "video").id,
    };
  });
  const v = await f.get();
  assert.equal(v.imageProfileLabel, "chosen-image");
  const a = await f.post(v);
  assert.equal(a.statusCode, 200, a.body);
  assert.equal(
    f.store
      .get("plan", a.json().activePlanId)
      .compiled.nodes.find((n) => n.kind === "image").profileId,
    "chosen-image",
  );
});
test("busy conversation or unknown current job cannot be replaced by a scene click", async (t) => {
  const f = fixture(t),
    human = f.service.beginRequest(f.project.id, "local-user", "Working", {
      scopeIds: [f.project.id],
    }),
    epoch = f.service.openEpoch(f.project.id, human),
    turnId = randomUUID();
  f.store.insert("director_turn", turnId, f.project.id, {
    id: turnId,
    projectId: f.project.id,
    requestId: human.requestId,
    epochId: epoch.actor.epochId,
    runtimeId: "offline-fixture",
    state: "running",
    dispatched: false,
    nativeThreadId: null,
    nativeTurnId: null,
    owner: null,
    leaseExpiresAt: 0,
    errorCode: null,
    createdAt: "2026-10-05T00:00:00Z",
    updatedAt: "2026-10-05T00:00:00Z",
  });
  const v = await f.get();
  assert.equal(v.busy, true);
  assert.notEqual((await f.post(v)).statusCode, 200);
  assert.equal(f.store.list("candidate", f.project.id).length, 0);
  f.store.put("director_turn", turnId, f.project.id, {
    ...f.store.get("director_turn", turnId),
    state: "completed",
  });
  const a = await f.post(await f.get());
  assert.equal(a.statusCode, 200, a.body);
  await f.engine.runReady();
  const attempt = f.engine.attempts(f.project.id)[0];
  f.store.put("attempt", attempt.id, f.project.id, {
    ...attempt,
    phase: "submission_unknown",
  });
  const unknown = await f.get();
  assert.equal(unknown.rows[0].blockedCode, "SUBMISSION_UNKNOWN");
  assert.notEqual((await f.post(unknown)).statusCode, 200);
  assert.equal(f.engine.attempts(f.project.id).length, 1);
});

test("edited keyframes defer dependent video until the next scene video check and then follow the new default", async (t) => {
  const f = fixture(t);
  let a = await f.post(await f.get());
  assert.equal(a.statusCode, 200, a.body);
  await f.finish();
  a = await f.post(await f.get(), "video");
  assert.equal(a.statusCode, 200, a.body);
  await f.finish();
  let p = f.store.getProject(f.project.id);
  replaceLock(f, p, (lock) => {
    const video = lock.profiles.find((row) => row.kind === "video");
    lock.profiles.push({ ...video, id: "new-video-model" });
    lock.preferredProfileIds = {
      image: lock.profiles.find((row) => row.kind === "image").id,
      video: "new-video-model",
    };
  });
  p.shots[0].action = "Changed product position";
  p.shots[0].imagePrompt = "Changed frame";
  p.shots[0].videoPrompt = "Changed slow camera move";
  p.shots[0].revisionId = randomUUID();
  const { shotIntentDigest } = await import("@openslate/core");
  p.shots[0].promptIntent = {
    image: shotIntentDigest(p.shots[0], "image"),
    video: shotIntentDigest(p.shots[0], "video"),
  };
  p.revisionId = randomUUID();
  p.headVersion++;
  f.store.saveProject(p, p.headVersion - 1);
  f.store.insert("project_revision", p.revisionId, p.id, { project: p });
  const edit = f.service.beginRequest(
    p.id,
    "local-user",
    "Revise only this scene",
    { scopeIds: ["scene-0"] },
  );
  const v = await f.get();
  assert.equal(v.rows[0].image, null);
  assert.equal(v.rows[0].videoProfileLabel, "new-video-model");
  a = await f.post(v, "image");
  assert.equal(a.statusCode, 200, a.body);
  const plan = f.store.get("plan", a.json().activePlanId).compiled,
    binding = f.store.get(
      "node_binding",
      plan.nodes.find((n) => n.kind === "video").id,
    );
  assert.equal(binding.candidateId, null);
  assert.deepEqual(binding.outputs, {});
  await f.finish();
  assert.equal(
    f.engine.attempts(p.id).filter((x) => x.request.kind === "video").length,
    1,
  );
  const ready = await f.get();
  assert.equal(ready.rows[0].videoProfileLabel, "new-video-model");
  a = await f.post(ready, "video");
  assert.equal(a.statusCode, 200, a.body);
  assert.equal(
    f.store
      .get("plan", a.json().activePlanId)
      .compiled.nodes.find((n) => n.kind === "video").profileId,
    "new-video-model",
  );
  await f.finish();
  assert.equal(
    f.engine.attempts(p.id).filter((x) => x.request.kind === "video").length,
    2,
  );
});

test("an authored image prompt edit cannot be masked by the previous video conditioning frame", async (t) => {
  const f = fixture(t);
  let a = await f.post(await f.get());
  assert.equal(a.statusCode, 200, a.body);
  await f.finish();
  a = await f.post(await f.get(), "video");
  assert.equal(a.statusCode, 200, a.body);
  await f.finish();
  const p = f.store.getProject(f.project.id),
    actor = f.service.beginRequest(
      p.id,
      "local-user",
      "Change the image prompt",
      { scopeIds: ["scene-0"] },
    );
  const prepared = await f.service.prepare(p.id, actor, {
    variant: "project",
    expectedHeadVersion: p.headVersion,
    creative: {
      updateShots: [
        {
          id: "shot-0",
          imagePrompt: "A new closer product framing",
          reauthorPrompts: true,
        },
      ],
    },
  });
  f.service.apply(p.id, actor, prepared.id);
  const v = await f.get();
  assert.equal(v.rows[0].imageComplete, false);
  assert.equal(v.rows[0].image, null);
  assert.equal(v.rows[0].videoComplete, false);
  a = await f.post(v, "image");
  assert.equal(a.statusCode, 200, a.body);
  await f.finish();
  const fresh = await f.get();
  assert.equal(fresh.rows[0].imageComplete, true);
  assert.equal(fresh.rows[0].videoComplete, false);
  assert.equal(
    f.engine.attempts(p.id).filter((a) => a.request.kind === "video").length,
    1,
  );
});

test("a fresh scene check after known failures creates a new candidate and its exact replay cannot create another", async (t) => {
  const f = fixture(t);
  let a = await f.post(await f.get());
  assert.equal(a.statusCode, 200, a.body);
  const node = f.store.get("plan", a.json().activePlanId).compiled.nodes[0];
  f.provider.setMode(node.id, [
    "technical_failure",
    "technical_failure",
    "complete",
  ]);
  await f.finish();
  assert.equal(f.engine.attempts(f.project.id).length, 2);
  assert.ok(f.engine.attempts(f.project.id).every((a) => a.phase === "failed"));
  const v = await f.get(),
    key = randomUUID();
  a = await f.post(v, "image", key);
  assert.equal(a.statusCode, 200, a.body);
  assert.equal(f.store.list("candidate", f.project.id).length, 2);
  assert.deepEqual((await f.post(v, "image", key)).json(), a.json());
  await f.finish();
  assert.equal(f.engine.attempts(f.project.id).length, 3);
  assert.equal((await f.get()).rows[0].imageComplete, true);
});

test("one scene can generate while another scene keeps an unchanged deferred video", async (t) => {
  const f = fixture(t);
  for (const scene of ["scene-0", "scene-1"]) {
    let a = await f.post(await f.get(scene));
    assert.equal(a.statusCode, 200, a.body);
    await f.finish();
    a = await f.post(await f.get(scene), "video");
    assert.equal(a.statusCode, 200, a.body);
    await f.finish();
  }
  for (const [scene, shotId] of [
    ["scene-0", "shot-0"],
    ["scene-1", "shot-1"],
  ]) {
    const p = f.store.getProject(f.project.id),
      actor = f.service.beginRequest(
        p.id,
        "local-user",
        "Change this scene image",
        { scopeIds: [scene] },
      );
    const prepared = await f.service.prepare(p.id, actor, {
      variant: "project",
      expectedHeadVersion: p.headVersion,
      creative: {
        updateShots: [
          {
            id: shotId,
            imagePrompt: "Changed frame " + shotId,
            reauthorPrompts: true,
          },
        ],
      },
    });
    f.service.apply(p.id, actor, prepared.id);
    const a = await f.post(await f.get(scene), "image");
    assert.equal(a.statusCode, 200, a.body);
    await f.finish();
  }
  const p = f.store.getProject(f.project.id),
    plan = f.store.get("plan", p.activePlanId).compiled;
  for (const video of plan.nodes.filter((n) => n.kind === "video"))
    assert.equal(f.store.get("node_binding", video.id).candidateId, null);
  assert.equal(
    f.engine.attempts(p.id).filter((a) => a.request.kind === "video").length,
    2,
  );
  const a = await f.post(await f.get("scene-1"), "video");
  assert.equal(a.statusCode, 200, a.body);
  await f.finish();
  const current = f.store.get(
    "plan",
    f.store.getProject(p.id).activePlanId,
  ).compiled;
  assert.equal(
    f.store.get(
      "node_binding",
      current.nodes.find((n) => n.kind === "video" && n.shotId === "shot-0").id,
    ).candidateId,
    null,
  );
  assert.equal((await f.get("scene-1")).rows[0].videoComplete, true);
});

test("direct camera and framing edits reauthor their exact prompts and need only the scene generation check", async (t) => {
  const f = fixture(t);
  let a = await f.post(await f.get());
  assert.equal(a.statusCode, 200, a.body);
  await f.finish();
  a = await f.post(await f.get(), "video");
  assert.equal(a.statusCode, 200, a.body);
  await f.finish();
  const { editStoryboard } = await import("../dist/storyboard.js");
  let p = f.store.getProject(f.project.id);
  editStoryboard(
    f.service,
    p.id,
    {
      kind: "shot",
      id: "shot-0",
      field: "motion",
      value: "Slow arc around the product",
      expectedHeadVersion: p.headVersion,
    },
    randomUUID(),
  );
  let view = await f.get();
  assert.match(view.rows[0].motionPrompt, /Slow arc around the product/);
  assert.ok(view.rows[0].imageComplete);
  assert.equal(view.rows[0].videoComplete, false);
  a = await f.post(view, "video");
  assert.equal(a.statusCode, 200, a.body);
  await f.finish();
  p = f.store.getProject(p.id);
  editStoryboard(
    f.service,
    p.id,
    {
      kind: "shot",
      id: "shot-0",
      field: "framing",
      value: "Tight leather detail",
      expectedHeadVersion: p.headVersion,
    },
    randomUUID(),
  );
  p = f.store.getProject(p.id);
  assert.match(p.shots[0].imagePrompt, /Tight leather detail/);
  view = await f.get();
  assert.equal(view.rows[0].imageComplete, false);
  a = await f.post(view, "image");
  assert.equal(a.statusCode, 200, a.body);
  await f.finish();
  assert.equal((await f.get()).rows[0].imageComplete, true);
  assert.equal((await f.get()).rows[0].videoComplete, false);
});

test("prompt reauthoring preserves product words and does not accumulate obsolete directions", async (t) => {
  const f = fixture(t);
  let p = f.store.getProject(f.project.id);
  p.shots[0].motion = "pan";
  p.shots[0].videoPrompt =
    "A Japanese company logo on a stainless-steel pan; camera pan slowly";
  const { shotIntentDigest } = await import("@openslate/core");
  p.shots[0].promptIntent.video = shotIntentDigest(p.shots[0], "video");
  p = f.store.saveProject(p, p.headVersion);
  const { editStoryboard } = await import("../dist/storyboard.js");
  editStoryboard(
    f.service,
    p.id,
    {
      kind: "shot",
      id: "shot-0",
      field: "motion",
      value: "locked-off",
      expectedHeadVersion: p.headVersion,
    },
    randomUUID(),
  );
  p = f.store.getProject(p.id);
  assert.ok(
    p.shots[0].videoPrompt.endsWith(
      "A Japanese company logo on a stainless-steel pan; camera pan slowly",
    ),
  );
  assert.match(p.shots[0].videoPrompt, /Camera movement: locked-off/);
  assert.doesNotMatch(p.shots[0].videoPrompt, /Jalocked-off/);
  editStoryboard(
    f.service,
    p.id,
    {
      kind: "shot",
      id: "shot-0",
      field: "motion",
      value: "Slow dolly",
      expectedHeadVersion: p.headVersion,
    },
    randomUUID(),
  );
  p = f.store.getProject(p.id);
  assert.match(p.shots[0].videoPrompt, /Camera movement: Slow dolly/);
  assert.equal(
    p.shots[0].videoPrompt.split("OpenSlate current direction:").length,
    2,
  );
  assert.doesNotMatch(p.shots[0].videoPrompt, /locked-off/);
});
test("duration-only edits retain the exact completed keyframe and require only a fresh video check", async (t) => {
  const f = fixture(t);
  let a = await f.post(await f.get());
  assert.equal(a.statusCode, 200, a.body);
  await f.finish();
  const before = await f.get(),
    p = f.store.getProject(f.project.id),
    { editStoryboard } = await import("../dist/storyboard.js");
  editStoryboard(
    f.service,
    p.id,
    {
      kind: "shot",
      id: "shot-0",
      field: "desiredFrames",
      value: "210",
      expectedHeadVersion: p.headVersion,
    },
    randomUUID(),
  );
  const view = await f.get();
  assert.equal(view.rows[0].imageComplete, true);
  assert.deepEqual(view.rows[0].image, before.rows[0].image);
  assert.equal(view.rows[0].durationFrames, 210);
  a = await f.post(view, "video");
  assert.equal(a.statusCode, 200, a.body);
  await f.finish();
  assert.equal(
    f.engine.attempts(p.id).filter((a) => a.request.kind === "image").length,
    1,
  );
});

test("explicit shot regeneration retains siblings and old receipts, then needs the new exact scene video review", async (t) => {
  const f = fixture(t, { sharedScene: true });
  for (const scene of ["scene-0", "scene-2"]) {
    for (const kind of ["image", "video"]) {
      const result = await f.post(await f.get(scene), kind);
      assert.equal(result.statusCode, 200, result.body);
      await f.finish();
    }
  }
  const view = await f.get(),
    oldFrame = view.rows[0].image,
    oldAttempts = f.engine.attempts(f.project.id),
    oldCandidates = f.store.list("candidate", f.project.id).length,
    oldBindings = f.store.list("node_binding", f.project.id),
    key = randomUUID(),
    extra = { targetShotIds: ["shot-0"], regenerate: true };
  const generated = await f.post(view, "image", key, extra);
  assert.equal(generated.statusCode, 200, generated.body);
  assert.deepEqual(generated.json().shotIds, ["shot-0"]);
  assert.equal(
    f.store.list("candidate", f.project.id).length,
    oldCandidates + 1,
  );
  for (const binding of oldBindings) {
    const current = f.store.get("node_binding", binding.id);
    if (binding.node.shotId !== "shot-0") {
      assert.equal(current.candidateId, binding.candidateId);
      assert.deepEqual(current.outputs, binding.outputs);
    } else if (binding.node.kind === "video") {
      assert.equal(current.candidateId, null);
      assert.deepEqual(current.outputs, {});
    }
  }
  assert.deepEqual(f.engine.attempts(f.project.id), oldAttempts);
  assert.deepEqual(
    (await f.post(view, "image", key, extra)).json(),
    generated.json(),
  );
  assert.equal(
    f.store.list("candidate", f.project.id).length,
    oldCandidates + 1,
  );
  const conflict = await f.post(view, "image", key, {
    ...extra,
    targetShotIds: ["shot-1"],
  });
  assert.equal(conflict.json().error.code, "IDEMPOTENCY_CONFLICT");
  await f.finish();
  const ready = await f.get();
  assert.notEqual(ready.rows[0].image.artifactId, oldFrame.artifactId);
  assert.ok(ready.rows[1].videoComplete);
  assert.equal(ready.rows[0].videoComplete, false);
  assert.equal(f.engine.attempts(f.project.id).length, oldAttempts.length + 1);
  const stale = await f.post(ready, "video", randomUUID(), {
    reviewedFrames: [
      {
        shotId: "shot-0",
        artifactId: oldFrame.artifactId,
        sha256: oldFrame.sha256,
      },
    ],
  });
  assert.equal(stale.json().error.code, "SCENE_REVIEW_STALE");
  const video = await f.post(ready, "video");
  assert.equal(video.statusCode, 200, video.body);
  assert.deepEqual(video.json().shotIds, ["shot-0"]);
  await f.finish();
  assert.equal(f.engine.attempts(f.project.id).length, oldAttempts.length + 2);
  assert.ok((await f.get()).rows.every((row) => row.videoComplete));
  assert.ok(f.store.get("artifact", oldFrame.artifactId));
});

test("a shot keyframe action narrows a human film pause to untouched siblings without widening its generation scope", async (t) => {
  const f = fixture(t, { sharedScene: true }),
    human = f.service.beginRequest(
      f.project.id,
      "local-user",
      "Plan this film",
      { scopeIds: [f.project.id] },
    );
  const result = await f.post(await f.get(), "image", randomUUID(), {
    targetShotIds: ["shot-0"],
  });
  assert.equal(result.statusCode, 200, result.body);
  assert.deepEqual(result.json().shotIds, ["shot-0"]);
  const request = f.store.list("message", f.project.id).at(-1);
  assert.deepEqual(request.scopeIds, ["shot-0"]);
  const retained = f.store
    .list("hold", f.project.id)
    .filter((hold) => hold.active && hold.ownerId === human.requestId);
  assert.deepEqual(retained.map((hold) => hold.scopeId).sort(), [
    "scene-2",
    "shot-1",
  ]);
  await f.finish();
  const current = await f.get();
  assert.ok(current.rows[0].image);
  assert.equal(current.rows[1].image, null);
  assert.equal((await f.get("scene-2")).rows[0].image, null);
  assert.equal(f.store.list("grant", f.project.id).length, 1);
});

test("shot regeneration rejects ambiguous scope, video shortcuts, missing identity and unsupported hold ownership without writes", async (t) => {
  const f = fixture(t, { sharedScene: true }),
    view = await f.get(),
    cursor = f.store.cursor(f.project.id);
  for (const extra of [
    { regenerate: true },
    { targetShotIds: [] },
    { targetShotIds: ["shot-0", "shot-0"] },
    { targetShotIds: ["shot-2"] },
  ]) {
    const result = await f.post(view, "image", randomUUID(), extra);
    assert.notEqual(result.statusCode, 200, result.body);
  }
  for (const extra of [{ targetShotIds: ["shot-0"] }, { regenerate: false }]) {
    const result = await f.post(view, "video", randomUUID(), extra);
    assert.equal(result.json().error.code, "VALIDATION_ERROR");
  }
  const noKey = await f.app.inject({
    method: "POST",
    url: `/api/projects/${f.project.id}/scenes/scene-0/generate`,
    headers: { host: "127.0.0.1", authorization: `Bearer ${f.token}` },
    payload: {
      headVersion: view.headVersion,
      revisionId: view.revisionId,
      kind: "image",
      reviewedFrames: [],
      reviewedHoldDigest: view.reviewedHoldDigest,
      reviewedControlAuthorityId: view.reviewedControlAuthorityId,
      targetShotIds: ["shot-0"],
    },
  });
  assert.equal(noKey.json().error.code, "AUTH_REQUIRED");
  assert.equal(f.store.cursor(f.project.id), cursor);
  f.engine.setHold(f.project.id, {
    scopeId: "scene-0",
    ownerId: "unowned-fixture-pause",
  });
  const held = f.store.list("hold", f.project.id),
    before = f.store.cursor(f.project.id);
  const result = await f.post(await f.get(), "image", randomUUID(), {
    targetShotIds: ["shot-0"],
  });
  assert.equal(result.json().error.code, "SCOPE_DENIED");
  assert.equal(f.store.cursor(f.project.id), before);
  assert.deepEqual(f.store.list("hold", f.project.id), held);
});

test("shot regeneration cannot replace an uncertain provider job after a prompt edit detached its candidate", async (t) => {
  const f = fixture(t);
  const generated = await f.post(await f.get());
  assert.equal(generated.statusCode, 200, generated.body);
  const node = f.store.get("plan", generated.json().activePlanId).compiled
    .nodes[0];
  f.provider.setMode(node.id, "unknown_after_accept");
  await f.engine.runReady();
  const attempt = f.engine.attempts(f.project.id)[0];
  assert.equal(attempt.phase, "submission_unknown");
  const { editStoryboard } = await import("../dist/storyboard.js"),
    p = f.store.getProject(f.project.id);
  editStoryboard(
    f.service,
    p.id,
    {
      kind: "shot",
      id: "shot-0",
      field: "imagePrompt",
      value: "New human frame",
      expectedHeadVersion: p.headVersion,
    },
    randomUUID(),
  );
  const view = await f.get();
  assert.equal(view.rows[0].imagePending, false);
  const candidateCount = f.store.list("candidate", f.project.id).length;
  const result = await f.post(view, "image", randomUUID(), {
    targetShotIds: ["shot-0"],
    regenerate: true,
  });
  assert.equal(result.json().error.code, "ATTEMPT_EXISTS");
  assert.equal(f.store.list("candidate", f.project.id).length, candidateCount);
  assert.equal(f.provider.acceptedCount(), 1);
  assert.equal(f.engine.attempts(f.project.id)[0].id, attempt.id);
});

test("shot generation respects current unanswered direction and Stop, while superseded questions do not block", async (t) => {
  const f = fixture(t),
    human = f.service.beginRequest(f.project.id, "local-user", "Plan film");
  f.store.insert("director_question", "pending-direction", f.project.id, {
    id: "pending-direction",
    requestId: human.requestId,
    turnId: "fixture-turn",
    state: "pending",
    questions: ["Which direction?"],
  });
  const view = await f.get();
  assert.equal(view.busy, true);
  assert.equal(
    (
      await f.post(view, "image", randomUUID(), { targetShotIds: ["shot-0"] })
    ).json().error.code,
    "WAITING_USER",
  );
  f.service.beginRequest(f.project.id, "local-user", "New explicit direction", {
    scopeIds: ["shot-0"],
  });
  assert.equal((await f.get()).busy, false);
  f.engine.setPaused(f.project.id, true, "fixture-stop");
  assert.equal(
    (
      await f.post(await f.get(), "image", randomUUID(), {
        targetShotIds: ["shot-0"],
      })
    ).json().error.code,
    "EXECUTION_PAUSED",
  );
  assert.equal(f.store.list("grant", f.project.id).length, 0);
});

test("a selected frame can regenerate beside a pending sibling without replacing or dispatching that sibling twice", async (t) => {
  const f = fixture(t, { sharedScene: true }),
    first = await f.post(await f.get());
  assert.equal(first.statusCode, 200, first.body);
  const nodes = f.store.get("plan", first.json().activePlanId).compiled.nodes,
    sibling = nodes.find(
      (node) => node.shotId === "shot-1" && node.kind === "image",
    );
  f.provider.setMode(sibling.id, "pending");
  await f.finish();
  const view = await f.get();
  assert.ok(view.rows[0].imageComplete);
  assert.ok(view.rows[1].imagePending);
  const siblingBinding = f.store.get("node_binding", sibling.id),
    siblingAttempt = f.engine
      .attempts(f.project.id)
      .find((attempt) => attempt.nodeId === sibling.id);
  const response = await f.post(view, "image", randomUUID(), {
    targetShotIds: ["shot-0"],
    regenerate: true,
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(
    f.store.get("node_binding", sibling.id).candidateId,
    siblingBinding.candidateId,
  );
  await f.finish();
  assert.equal(f.provider.acceptedCount(siblingAttempt.id), 1);
  assert.equal(
    f.engine
      .attempts(f.project.id)
      .filter((attempt) => attempt.nodeId === sibling.id).length,
    1,
  );
});

test("failed same-spec regeneration publication rolls back the frame, candidate and narrowed holds", async (t) => {
  const f = fixture(t, { sharedScene: true });
  assert.equal((await f.post(await f.get())).statusCode, 200);
  await f.finish();
  f.service.beginRequest(f.project.id, "local-user", "Revise film", {
    scopeIds: [f.project.id],
  });
  const view = await f.get(),
    bindings = f.store.list("node_binding", f.project.id),
    holds = f.store.list("hold", f.project.id),
    messages = f.store.list("message", f.project.id),
    candidates = f.store.list("candidate", f.project.id),
    key = randomUUID(),
    original = f.service.applyCompiledSceneGeneration.bind(f.service),
    extra = { targetShotIds: ["shot-0"], regenerate: true };
  f.service.applyCompiledSceneGeneration = () => {
    throw new Error("Injected publication failure");
  };
  assert.equal((await f.post(view, "image", key, extra)).statusCode, 500);
  assert.deepEqual(f.store.list("node_binding", f.project.id), bindings);
  assert.deepEqual(f.store.list("hold", f.project.id), holds);
  assert.deepEqual(f.store.list("message", f.project.id), messages);
  assert.deepEqual(f.store.list("candidate", f.project.id), candidates);
  f.service.applyCompiledSceneGeneration = original;
  assert.equal((await f.post(view, "image", key, extra)).statusCode, 200);
});

test("renewing or reactivating the same pause identity invalidates a previously captured shot decision", async (t) => {
  const f = fixture(t),
    human = f.service.beginRequest(
      f.project.id,
      "local-user",
      "Prepare this shot",
      { scopeIds: ["shot-0"] },
    ),
    hold = f.store
      .list("hold", f.project.id)
      .find((row) => row.active && row.ownerId === human.requestId);
  const first = await f.get();
  f.engine.setHold(f.project.id, {
    id: hold.id,
    scopeId: hold.scopeId,
    ownerId: hold.ownerId,
  });
  const renewed = await f.get();
  assert.equal(renewed.headVersion, first.headVersion);
  assert.notEqual(renewed.reviewedHoldDigest, first.reviewedHoldDigest);
  const stale = await f.post(first, "image", randomUUID(), {
    targetShotIds: ["shot-0"],
  });
  assert.equal(stale.json().error.code, "SCENE_REVIEW_STALE");
  f.engine.releaseHold(f.project.id, hold.id, hold.ownerId);
  f.engine.setHold(f.project.id, {
    id: hold.id,
    scopeId: hold.scopeId,
    ownerId: hold.ownerId,
  });
  const reactivated = await f.get();
  assert.notEqual(reactivated.reviewedHoldDigest, renewed.reviewedHoldDigest);
  const outdated = await f.post(renewed, "image", randomUUID(), {
    targetShotIds: ["shot-0"],
  });
  assert.equal(outdated.json().error.code, "SCENE_REVIEW_STALE");
  assert.equal(f.store.list("grant", f.project.id).length, 0);
  assert.equal(f.store.list("candidate", f.project.id).length, 0);
  assert.equal(f.store.get("hold", hold.id).active, true);
});

for (const conditioning of ["owned", "shared"]) {
  test(`targeted regeneration replaces the exact ${conditioning} conditioning and defers only its video until new frame review`, async (t) => {
    const f = fixture(t, { sharedScene: true });
    let ownedFrame;
    if (conditioning === "owned") {
      assert.equal((await f.post(await f.get("scene-2"))).statusCode, 200);
      await f.finish();
      ownedFrame = (await f.get("scene-2")).rows[0].image;
    }
    const project = f.store.getProject(f.project.id),
      aliases = {};
    if (ownedFrame) {
      project.artifacts.push(ownedFrame);
      Object.assign(project, f.store.saveProject(project, project.headVersion));
    }
    const frameSource = ownedFrame
      ? `const frame=p.asset(${JSON.stringify(ownedFrame.artifactId)});`
      : 'const frame=p.image("shared-frame",{profile:"fake-image-v1",prompt:"One shared frame",width:256,height:256});';
    const source =
      `definePlan({baseRevision:${JSON.stringify(project.revisionId)}},p=>{` +
      frameSource +
      'const s0=p.shot("shot-0");const s1=p.shot("shot-1");' +
      'const gate=p.humanReview("shared-review",{shots:[' +
      '{intent:s0,keyframe:frame,videoProfile:"fake-video-v1",motionPrompt:"Slow push angle 0",seconds:6},' +
      '{intent:s1,keyframe:frame,videoProfile:"fake-video-v1",motionPrompt:"Slow push angle 1",seconds:6}]});' +
      'const v0=p.video("video-0",{intent:s0,profile:"fake-video-v1",firstFrame:p.approvedImage(frame,gate),prompt:"Slow push angle 0",seconds:6});' +
      'const v1=p.video("video-1",{intent:s1,profile:"fake-video-v1",firstFrame:p.approvedImage(frame,gate),prompt:"Slow push angle 1",seconds:6});return [v0,v1];});';
    const lock = f.store.get("capability_lock", project.capabilityLockId),
      base = compilePlan(source, {
        project,
        profiles: lock.profiles,
        logicalIds: aliases,
        allocateId: randomUUID,
      }),
      planId = randomUUID(),
      grants = {};
    for (const node of base.nodes)
      grants[node.id] = f.engine.createGrant(
        project.id,
        node.shotId ?? project.id,
        node.kind,
        "conditioning-fixture",
        "initial_slot",
      ).id;
    f.engine.installPlan(project.id, planId, base, grants);
    f.store.saveProject(
      { ...project, activePlanId: planId },
      project.headVersion,
    );
    f.store.put("logical_ids", project.id, project.id, { aliases });
    await f.finish();
    const review = f.engine.reviewSnapshot(project.id);
    f.engine.approve(
      project.id,
      review.id,
      review.members.map((member) => member.videoNodeId),
      "conditioning-fixture-review",
    );
    await f.finish();
    const prior = await f.get(),
      oldFrame = prior.rows[0].image,
      video0 = base.nodes.find((node) => node.alias === "video-0"),
      video1 = base.nodes.find((node) => node.alias === "video-1"),
      sibling = f.store.get("node_binding", video1.id),
      attempts = f.engine.attempts(project.id).length;
    assert.equal(prior.rows[0].imageNodeId, null);
    assert.ok(prior.rows.every((row) => row.videoComplete));
    const generated = await f.post(prior, "image", randomUUID(), {
      targetShotIds: ["shot-0"],
      regenerate: true,
    });
    assert.equal(generated.statusCode, 200, generated.body);
    const published = f.store.get(
        "plan",
        generated.json().activePlanId,
      ).compiled,
      newImage = published.nodes.find(
        (node) => node.kind === "image" && node.shotId === "shot-0",
      ),
      currentVideo = published.nodes.find((node) => node.id === video0.id),
      pending = f.store.get("node_binding", video0.id);
    assert.ok(newImage);
    assert.equal(
      currentVideo.inputs.find((input) => input.role === "first_frame").source
        .nodeId,
      newImage.id,
    );
    assert.equal(published.gates[0].members[0].frameSource.nodeId, newImage.id);
    assert.equal(pending.candidateId, null);
    assert.deepEqual(pending.outputs, {});
    assert.equal(
      f.store.get("node_binding", video1.id).candidateId,
      sibling.candidateId,
    );
    assert.deepEqual(
      f.store.get("node_binding", video1.id).outputs,
      sibling.outputs,
    );
    const waiting = await f.get();
    assert.equal(waiting.rows[0].image, null);
    assert.equal(waiting.rows[0].videoComplete, false);
    assert.ok(waiting.rows[1].videoComplete);
    await f.finish();
    const ready = await f.get();
    assert.notEqual(ready.rows[0].image.artifactId, oldFrame.artifactId);
    assert.deepEqual(ready.rows[1].image, oldFrame);
    assert.equal(f.engine.attempts(project.id).length, attempts + 1);
    const stale = await f.post(ready, "video", randomUUID(), {
      reviewedFrames: [
        {
          shotId: "shot-0",
          artifactId: oldFrame.artifactId,
          sha256: oldFrame.sha256,
        },
      ],
    });
    assert.equal(stale.json().error.code, "SCENE_REVIEW_STALE");
    assert.equal((await f.post(ready, "video")).statusCode, 200);
    await f.finish();
    const last = f.engine
      .attempts(project.id)
      .filter((attempt) => attempt.nodeId === video0.id)
      .at(-1);
    assert.equal(
      last.request.inputs[0].artifactId,
      ready.rows[0].image.artifactId,
    );
    assert.equal(f.engine.attempts(project.id).length, attempts + 2);
  });
}

test("prompt writing after partial film generation retains inherited scene pauses and saves without widening generation", async (t) => {
  const f = fixture(t),
    { editStoryboard } = await import("../dist/storyboard.js");
  const first = f.store.getProject(f.project.id);
  const treatment = editStoryboard(
    f.service,
    first.id,
    {
      kind: "treatment",
      field: "brief",
      value: "A revised whole-film direction",
      expectedHeadVersion: first.headVersion,
    },
    randomUUID(),
  );
  assert.equal((await f.post(await f.get())).statusCode, 200);
  await f.finish();
  const pending = f.store
    .list("hold", first.id)
    .filter((hold) => hold.active && hold.ownerId === treatment.requestId);
  assert.deepEqual(
    pending.map((hold) => hold.scopeId),
    ["scene-1"],
  );
  const before = f.store.getProject(first.id),
    other = structuredClone(before.shots[1]),
    grants = f.store.list("grant", first.id).length,
    attempts = f.engine.attempts(first.id).length;
  const writing = editStoryboard(
    f.service,
    first.id,
    {
      kind: "shot",
      id: "shot-0",
      field: "imagePrompt",
      value: "A new explicit leather close-up",
      expectedHeadVersion: before.headVersion,
    },
    randomUUID(),
  );
  const saved = f.store.getProject(first.id);
  assert.equal(saved.shots[0].imagePrompt, "A new explicit leather close-up");
  assert.deepEqual(saved.shots[1], other);
  const request = f.store.get("message", writing.requestId);
  assert.deepEqual(request.scopeIds.sort(), ["scene-1", "shot-0"]);
  const retained = f.store.list("hold", first.id).filter((hold) => hold.active);
  assert.ok(
    retained.some(
      (hold) =>
        hold.scopeId === "scene-1" && hold.ownerId === writing.requestId,
    ),
  );
  assert.ok(
    retained.some(
      (hold) => hold.scopeId === "shot-0" && hold.ownerId === writing.requestId,
    ),
  );
  assert.equal(f.store.list("grant", first.id).length, grants);
  assert.equal(f.engine.attempts(first.id).length, attempts);
  assert.equal((await f.get("scene-1")).rows[0].image, null);
  const generated = await f.post(await f.get(), "image", randomUUID(), {
    targetShotIds: ["shot-0"],
  });
  assert.equal(generated.statusCode, 200, generated.body);
  await f.finish();
  assert.equal(f.engine.attempts(first.id).length, attempts + 1);
  assert.equal((await f.get("scene-1")).rows[0].image, null);
  assert.ok(
    f.store
      .list("hold", first.id)
      .some(
        (hold) =>
          hold.active &&
          hold.scopeId === "scene-1" &&
          hold.ownerId === writing.requestId,
      ),
  );
});
