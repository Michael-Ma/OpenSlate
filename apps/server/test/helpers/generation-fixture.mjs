
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../../dist/persistence/index.js";
import { Engine } from "../../dist/execution/index.js";
import { ProductionService } from "../../dist/application/service.js";
import { FakeProvider } from "../../../../packages/providers/dist/index.js";
import { createApp } from "../../dist/app.js";
import { projectFixture } from "../execution-fixture.mjs";
import { DEFAULT_PROFILES } from "@openslate/core";
export function fixture(t, { sharedScene = false, profiles = DEFAULT_PROFILES } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "openslate-scene-")),
    store = new Store(join(directory, "store.sqlite")),
    provider = new FakeProvider(join(directory, "provider.sqlite")),
    engine = new Engine(store, provider, {
      artifactDir: join(directory, "artifacts"),
      budgetMicros: "0",
      profiles,
    }),
    service = new ProductionService(store, engine, profiles);
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
  const headers = { host: "127.0.0.1", authorization: `Bearer ${token}` };
  const call = (method, path, payload, key = randomUUID()) => app.inject({ method, url: `/api/projects/${project.id}${path}`, headers: { ...headers, ...(key === null ? {} : { "idempotency-key": key }) }, ...(payload === undefined ? {} : { payload }) });
  const overview = async () => { const response = await call("GET", "/generation"); assert.equal(response.statusCode, 200, response.body); return response.json(); };
  return { store, engine, service, app, project, get, post, finish, provider, call, overview };
}
