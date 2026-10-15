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

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "openslate-scene-fence-"));
  const store = new Store(join(directory, "state.sqlite")),
    provider = new FakeProvider(join(directory, "provider.sqlite"));
  const engine = new Engine(store, provider, {
      artifactDir: join(directory, "artifacts"),
      budgetMicros: "0",
    }),
    production = new ProductionService(store, engine);
  let project = production.createProject("Scene concurrency fixture");
  const shape = projectFixture(project.id, 2);
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
  return { store, production, narration, project, send };
}

test("a newer editing request at the same project head rejects narration initialization before any new session or writing", async (t) => {
  const f = fixture(t),
    prior = f.production.beginRequest(
      f.project.id,
      "local-user",
      "First direction",
      { scopeIds: ["shot-0"] },
    );
  const head = f.store.getProject(f.project.id).headVersion;
  f.production.beginRequest(f.project.id, "local-user", "New other-shot edit", {
    scopeIds: ["shot-1"],
  });
  const before = f.store.db.prepare("SELECT total_changes() n").get().n;
  const response = await f.send("/narration/shots/shot-0/initialize", {
    expectedHeadVersion: head,
    expectedRequestId: prior.requestId,
    mode: "uploaded",
    text: "Recording words",
  });
  assert.equal(response.statusCode, 409, response.body);
  assert.equal(response.json().error.code, "SCENE_REVIEW_STALE");
  assert.equal(f.store.db.prepare("SELECT total_changes() n").get().n, before);
  assert.equal(f.store.list("narration_session", f.project.id).length, 0);
});

test("exact narration initialization replay after a newer edit returns saved facts without renewing authority", async (t) => {
  const f = fixture(t),
    body = {
      expectedHeadVersion: f.store.getProject(f.project.id).headVersion,
      expectedRequestId: null,
      mode: "uploaded",
      text: "Recording words",
    };
  const first = await f.send(
    "/narration/shots/shot-0/initialize",
    body,
    "same-initialize",
  );
  assert.equal(first.statusCode, 200, first.body);
  f.production.beginRequest(
    f.project.id,
    "local-user",
    "A newer explicit edit",
    { scopeIds: ["shot-1"] },
  );
  const before = f.store.db.prepare("SELECT total_changes() n").get().n;
  const replay = await f.send(
    "/narration/shots/shot-0/initialize",
    body,
    "same-initialize",
  );
  assert.equal(replay.statusCode, 200, replay.body);
  assert.deepEqual(replay.json(), first.json());
  assert.equal(f.store.db.prepare("SELECT total_changes() n").get().n, before);
});

test("scene generation catches a same-head newer request and creates no grant or candidate", async (t) => {
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
    { scopeIds: ["scene-1"] },
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
