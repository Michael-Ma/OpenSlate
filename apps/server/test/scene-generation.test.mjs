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
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "openslate-scene-")),
    store = new Store(join(directory, "store.sqlite")),
    provider = new FakeProvider(join(directory, "provider.sqlite")),
    engine = new Engine(store, provider, {
      artifactDir: join(directory, "artifacts"),
      budgetMicros: "0",
    }),
    service = new ProductionService(store, engine);
  let project = service.createProject("Scene approval fixture");
  const shape = projectFixture(project.id);
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
