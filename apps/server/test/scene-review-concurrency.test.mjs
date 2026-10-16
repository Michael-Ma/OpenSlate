import { assertSceneRowParity } from "./helpers/scene-row-parity.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../dist/persistence/store.js";
import { Engine } from "../dist/execution/engine.js";
import { ProductionService } from "../dist/application/service.js";
import { NarrationService } from "../dist/narration/service.js";
import { NarrationCanonicalService } from "../dist/narration/canonical.js";
import { FakeProvider } from "@openslate/providers";
import { createApp } from "../dist/app.js";
import { projectFixture } from "./execution-fixture.mjs";

function fixture(t, { sharedScene = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "openslate-scene-fence-"));
  const store = new Store(join(directory, "state.sqlite")),
    provider = new FakeProvider(join(directory, "provider.sqlite"));
  const engine = new Engine(store, provider, {
      artifactDir: join(directory, "artifacts"),
      budgetMicros: "0",
    }),
    production = new ProductionService(store, engine);
  let project = production.createProject("Scene concurrency fixture");
  const shape = projectFixture(project.id, sharedScene ? 3 : 2);
  if (sharedScene) {
    shape.shots[1].sceneId = "scene-0";
    shape.scenes = shape.scenes.filter(scene => scene.id !== "scene-1");
  }
  project = {
    ...project,
    ...shape,
    capabilityLockId: project.capabilityLockId,
    headVersion: 0,
    shots: shape.shots.map((shot) => ({
      ...shot,
      narration: { mode: "none", text: "", voice: "stock" },
    })),
  };
  store.saveProject(project, 0);
  store.put("project_revision", project.revisionId, project.id, { project });
  const narration = new NarrationService(production),
    token = "synthetic_scene_concurrency_token";
  const app = createApp({
    service: production,
    localToken: token,
    narrationRoutes: {
      production,
      narration,
      canonical: new NarrationCanonicalService(narration),
      uploadDirectory: join(directory, "uploads"),
    },
  });
  const send = (path, body, key = randomUUID()) => {
    assertSceneRowParity(production, project.id);
    return app.inject({
      method: body ? "POST" : "GET",
      url: `/api/projects/${project.id}${path}`,
      headers: {
        host: "127.0.0.1",
        authorization: `Bearer ${token}`,
        "idempotency-key": key,
      },
      ...(body ? { payload: body } : {}),
    });
  };
  t.after(async () => {
    assertSceneRowParity(production, project.id);
    await app.close();
    store.close();
    provider.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { store, provider, engine, production, narration, project, send };
}

for (const concurrency of [undefined, "alongside"]) test(`scene generation catches a same-head newer ${concurrency ?? "ordinary"} request and creates no grant or candidate`, async (t) => {
  const f = fixture(t),
    prior = f.production.beginRequest(
      f.project.id,
      "local-user",
      "Original scene direction",
      { scopeIds: ["scene-0"] },
    );
  const view = (await f.send("/scenes/scene-0/generation")).json();
  f.production.beginRequest(
    f.project.id,
    "local-user",
    "Other scene direction",
    { scopeIds: ["scene-1"], ...(concurrency ? { concurrency } : {}) },
  );
  const before = f.store.db.prepare("SELECT total_changes() n").get().n;
  const result = await f.send("/scenes/scene-0/generate", {
    headVersion: view.headVersion,
    revisionId: view.revisionId,
    expectedRequestId: prior.requestId,
    kind: "image",
    reviewedFrames: [],
    reviewedControlAuthorityId: view.reviewedControlAuthorityId,
    reviewedHoldDigest: view.reviewedHoldDigest,
  });
  assert.equal(result.statusCode, 409, result.body);
  assert.equal(result.json().error.code, "SCENE_REVIEW_STALE");
  assert.equal(f.store.list("grant", f.project.id).length, 0);
  assert.equal(f.store.list("candidate", f.project.id).length, 0);
  assert.equal(f.store.db.prepare("SELECT total_changes() n").get().n, before);
});

async function directorPlanThenEditAndUndo(t) {
  const f = fixture(t, { sharedScene: true });
  const human = f.production.beginRequest(f.project.id, "local-user", "Write a two-scene fixture plan with no narration");
  const director = f.production.openEpoch(f.project.id, human).actor;
  const before = f.store.getProject(f.project.id);
  const prepared = await f.production.prepare(f.project.id, director, {
    variant: "project", expectedHeadVersion: before.headVersion,
    creative: { brief: "Synthetic scene freshness fixture", story: "A quiet product study.",
      updateShots: [{ id: "shot-0", purpose: "Show the product detail", reauthorPrompts: true,
        imagePrompt: "A quiet product detail on the bench", videoPrompt: "Slow push toward the product detail" }] },
  });
  f.production.apply(f.project.id, director, prepared.id);
  const saved = f.store.getProject(f.project.id);
  const edited = await f.send("/storyboard", { kind: "shot", id: "shot-0", field: "purpose", value: "Quietly show the product detail", expectedHeadVersion: saved.headVersion });
  assert.equal(edited.statusCode, 200, edited.body);
  const undone = await f.send("/storyboard", { kind: "undo", commandId: edited.json().commandId, expectedHeadVersion: edited.json().headVersion });
  assert.equal(undone.statusCode, 200, undone.body);
  assert.equal(undone.json().headVersion, saved.headVersion + 2);
  assert.equal(f.store.getProject(f.project.id).shots[0].purpose, saved.shots[0].purpose);
  for (const requestId of [human.requestId, edited.json().requestId, undone.json().requestId]) {
    assert.equal(f.store.get("message", requestId).state, "active");
  }
  assert.equal(f.store.get("message", undone.json().requestId).concurrency, "alongside");
  return { ...f, human, undone: undone.json() };
}

const keyframes = (view, targetShotIds) => ({
  headVersion: view.headVersion, revisionId: view.revisionId,
  expectedRequestId: view.currentRequestId, kind: "image", reviewedFrames: [],
  reviewedControlAuthorityId: view.reviewedControlAuthorityId,
  reviewedHoldDigest: view.reviewedHoldDigest,
  ...(targetShotIds ? { targetShotIds } : {}),
});

for (const targeted of [false, true]) test(`Director-saved plan, human Plan edit and Undo permit freshly read ${targeted ? "one-shot" : "whole-scene"} keyframes with exact replay`, async t => {
  const f = await directorPlanThenEditAndUndo(t);
  const view = (await f.send("/scenes/scene-0/generation")).json();
  const body = keyframes(view, targeted ? ["shot-0"] : undefined), key = randomUUID();
  const result = await f.send("/scenes/scene-0/generate", body, key);
  assert.equal(result.statusCode, 200, result.body);
  assert.equal(view.currentRequestId, f.undone.requestId);
  const expectedShots = targeted ? ["shot-0"] : ["shot-0", "shot-1"];
  assert.deepEqual(result.json().shotIds, expectedShots);
  assert.deepEqual(f.store.list("grant", f.project.id).map(grant => grant.scopeId).sort(), expectedShots);
  assert.equal(f.store.list("candidate", f.project.id).length, expectedShots.length);
  const grants = f.store.list("grant", f.project.id), candidates = f.store.list("candidate", f.project.id);
  // A later request cannot give this old command new authority; its exact key only reads the saved receipt.
  f.production.beginRequest(f.project.id, "local-user", "New alongside edit after the accepted press", { concurrency: "alongside", scopeIds: ["scene-2"], holdScopeIds: [] });
  const replay = await f.send("/scenes/scene-0/generate", body, key);
  assert.equal(replay.statusCode, 200, replay.body);
  assert.deepEqual(replay.json(), result.json());
  assert.deepEqual(f.store.list("grant", f.project.id), grants);
  assert.deepEqual(f.store.list("candidate", f.project.id), candidates);
  assert.equal(f.engine.attempts(f.project.id).length, 0);
  assert.equal(f.provider.acceptedCount(), 0);
});

test("Plan edit and Undo never allow a fresh press to buy an unknown keyframe again", async t => {
  const f = await directorPlanThenEditAndUndo(t);
  const view = (await f.send("/scenes/scene-0/generation")).json(), body = keyframes(view, ["shot-0"]), key = randomUUID();
  const accepted = await f.send("/scenes/scene-0/generate", body, key);
  assert.equal(accepted.statusCode, 200, accepted.body);
  const binding = f.store.list("node_binding", f.project.id).find(row => row.node.kind === "image" && row.node.shotId === "shot-0");
  f.provider.setMode(binding.id, "unknown_after_accept");
  await f.engine.runReady();
  assert.equal(f.engine.attempts(f.project.id)[0].phase, "submission_unknown");
  assert.equal(f.provider.acceptedCount(), 1);
  const grants = f.store.list("grant", f.project.id), candidates = f.store.list("candidate", f.project.id), attempts = f.engine.attempts(f.project.id);
  const fresh = (await f.send("/scenes/scene-0/generation")).json();
  const refused = await f.send("/scenes/scene-0/generate", keyframes(fresh, ["shot-0"]));
  assert.equal(refused.statusCode, 409, refused.body);
  assert.equal(refused.json().error.code, "ATTEMPT_EXISTS");
  const replay = await f.send("/scenes/scene-0/generate", body, key);
  assert.equal(replay.statusCode, 200, replay.body);
  assert.deepEqual(replay.json(), accepted.json());
  assert.deepEqual(f.store.list("grant", f.project.id), grants);
  assert.deepEqual(f.store.list("candidate", f.project.id), candidates);
  assert.deepEqual(f.engine.attempts(f.project.id), attempts);
  assert.equal(f.provider.acceptedCount(), 1);
});

test("scene review metadata is read-only and permits ordinary silent scene confirmation", async (t) => {
  const f = fixture(t),
    before = f.store.db.prepare("SELECT total_changes() n").get().n;
  const response = await f.send("/scenes/scene-0/generation");
  assert.equal(response.statusCode, 200, response.body);
  const view = response.json();
  assert.match(view.confirmationDigest, /^[a-f0-9]{64}$/);
  assert.match(view.sceneIntentDigest, /^[a-f0-9]{64}$/);
  assert.equal(view.currentRequestId, null);
  assert.equal(view.narrationVersion, 0);
  assert.equal(view.rows[0].narration.mode, "none");
  assert.equal(f.store.db.prepare("SELECT total_changes() n").get().n, before);
});
