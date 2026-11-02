import type { ArtifactRef } from "@openslate/core";
import type { ProductionService } from "./application/service.js";
import type { Attempt, NodeBinding, PlanRecord } from "./execution/engine.js";

/** Includes conditioning frames owned/shared by another image node, not just per-shot image jobs. */
export function keyframeTakeHistory(s: ProductionService, projectId: string, shotId: string, captured?: { attempts: Attempt[]; bindings: NodeBinding[]; plans: PlanRecord[] }): { artifact: ArtifactRef; createdAt: string }[] {
  const store = s.store, attempts = captured?.attempts ?? s.engine.attempts(projectId);
  const bindings = captured?.bindings ?? store.list<NodeBinding>("node_binding", projectId);
  const images = new Set(bindings.filter(b => b.node.kind === "image" && b.node.shotId === shotId).map(b => b.id));
  const videos = new Set(bindings.filter(b => b.node.kind === "video" && b.node.shotId === shotId).map(b => b.id));
  const nodes = (captured?.plans ?? store.list<PlanRecord>("plan", projectId)).flatMap(p => p.compiled.nodes);
  const history = new Map<string, { artifact: ArtifactRef; createdAt: string }>();
  const add = (artifact: ArtifactRef, createdAt: string) => {
    if (artifact.kind === "image" && !history.has(artifact.artifactId)) history.set(artifact.artifactId, { artifact, createdAt });
  };
  for (const attempt of attempts) {
    if (images.has(attempt.nodeId) && attempt.phase === "succeeded")
      for (const artifact of Object.values(attempt.outputs)) add(artifact, attempt.createdAt);
    if (videos.has(attempt.nodeId)) {
      const node = nodes.find(n => n.id === attempt.nodeId && n.specDigest === attempt.specDigest);
      const index = node?.inputs.findIndex(i => i.destinationPort === "firstFrame") ?? -1;
      const artifact = attempt.request.inputs[index];
      if (artifact) {
        const original = attempts.find(a => Object.values(a.outputs).some(o => o.artifactId === artifact.artifactId));
        add(artifact, original?.createdAt ?? attempt.createdAt);
      }
    }
  }
  // A retained external frame is already current even if no video has started yet.
  for (const binding of bindings.filter(b => images.has(b.id)))
    for (const artifact of Object.values(binding.retainedTake?.outputs ?? binding.outputs)) {
      const original = attempts.find(a => Object.values(a.outputs).some(o => o.artifactId === artifact.artifactId));
      if (original) add(artifact, original.createdAt);
    }
  return [...history.values()].reverse().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
