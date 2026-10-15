import { keyframeTakeHistory } from "./keyframe-take-history.js";
import { sceneView } from "./scene-generation.js";
import type { FastifyInstance } from "fastify";
import { digest, invariant, newId } from "@openslate/core";
import type { ShotTakes, UseTakeReceipt } from "@openslate/core";
import type { ProductionService } from "./application/service.js";
import type { NodeBinding, PlanRecord } from "./execution/engine.js";
import { requiredCommandKey } from "./application/command-key.js";
import { captureMediaUndo } from "./storyboard-history.js";

export function shotTakes(s: ProductionService, projectId: string, shotId: string): ShotTakes {
  const project = s.store.getProject(projectId);
  invariant(project.shots.some(shot => shot.id === shotId), "NOT_FOUND", "Choose a shot in this film");
  const shot = project.shots.find(s => s.id === shotId)!;
  const row = sceneView(s, projectId, shot.sceneId).view.rows.find(r => r.shotId === shotId)!;
  return { shotId, keyframes: keyframeTakeHistory(s, projectId, shotId).map(({ artifact, createdAt }) => ({
    artifact: { artifactId: artifact.artifactId, sha256: artifact.sha256, kind: "image" },
    current: row.imageComplete && row.image?.artifactId === artifact.artifactId, createdAt,
  })) };
}
export function useShotTake(s: ProductionService, projectId: string, shotId: string, artifactId: string, key: string): UseTakeReceipt {
  s.recovery.assertWritable(projectId);
  return s.store.command(`local-user:${projectId}:use-take`, key, digest({ shotId, artifactId }), () => {
    const project = s.store.getProject(projectId), take = shotTakes(s, projectId, shotId).keyframes.find(t => t.artifact.artifactId === artifactId);
    invariant(take, "NOT_FOUND", "Choose an earlier keyframe of this shot");
    const bindings = s.store.list<NodeBinding>("node_binding", projectId).filter(b => b.state === "active" && b.planId === project.activePlanId);
    const images = bindings.filter(b => b.node.kind === "image" && b.node.shotId === shotId);
    invariant(images.length === 1, "SCENE_SELECTION_REQUIRED", "Choose one active keyframe operation for this shot");
    const image = images[0]!;
    const attempts = s.engine.attempts(projectId).filter(a => a.nodeId === image.id);
    const queuedReplacement = image.retainedTake && image.candidateId && !attempts.some(a => a.candidateId === image.candidateId);
    invariant(!queuedReplacement && !attempts.some(a => !a.released && !["failed", "succeeded"].includes(a.phase)),
      "ATTEMPT_EXISTS", "Resolve the current keyframe job before switching takes");
    invariant(!take.current, "ALREADY_COMPLETE", "This keyframe is already current");
    s.engine.verifyArtifact(projectId, take.artifact);
    const undo = captureMediaUndo(s, projectId);
    const actor = s.beginRequest(projectId, "local-user", "Use the selected earlier keyframe. Its clip needs generating again.",
      { source: "app", directEdit: true, editing: true, scopeIds: [shotId], key: `use-take:${key}` });
    const base = s.store.get<PlanRecord>("plan", project.activePlanId!);
    invariant(base?.projectId === projectId, "STALE_BINDING", "The active keyframe plan is unavailable");
    const planId = newId();
    s.engine.installPlan(projectId, planId, base.compiled);
    const installedImage = s.store.get<NodeBinding>("node_binding", image.id)!;
    // Capture only changed bindings, including transitive local assembly dependencies.
    s.engine.outdateImageDependents(installedImage);
    undo.bindings = bindings.filter(b => b.id === image.id || digest(s.store.get<NodeBinding>("node_binding", b.id)?.outputs) !== digest(b.outputs));
    const { outdated: _outdated, retainedTake: _retained, ...rest } = image;
    s.store.put("node_binding", image.id, projectId, { ...rest, planId, candidateId: null, outputs: { image: take.artifact } });
    const saved = s.store.saveProject({ ...project, activePlanId: planId, revisionId: newId() }, project.headVersion);
    s.store.insert("project_revision", saved.revisionId, projectId, { project: saved });
    const commandId = newId();
    s.store.insert("storyboard_edit", commandId, projectId, { id: commandId, before: project, headVersion: saved.headVersion, requestId: actor.requestId, undo });
    s.store.appendEvent(projectId, "storyboard.edited", { commandId, kind: "use-take", shotId, artifactId });
    return { shotId, artifactId, commandId };
  });
}
export function registerShotTakes(app: FastifyInstance, service: () => ProductionService): void {
  app.get<{ Params: { projectId: string; shotId: string } }>("/api/projects/:projectId/shots/:shotId/takes",
    request => shotTakes(service(), request.params.projectId, request.params.shotId));
  app.post<{ Params: { projectId: string; shotId: string; artifactId: string } }>("/api/projects/:projectId/shots/:shotId/takes/:artifactId/use",
    request => useShotTake(service(), request.params.projectId, request.params.shotId, request.params.artifactId, requiredCommandKey(request)));
}
