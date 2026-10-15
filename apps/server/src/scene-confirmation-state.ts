import { digest } from "@openslate/core";
import type { ProjectRecord } from "@openslate/core";
/** Execution guard excludes the runner's derived cue/pending/plan fields. */
export function sceneConfirmationGuard(project: ProjectRecord, sceneId: string, lock: unknown): string {
  return digest({ scene: project.scenes.find(s => s.id === sceneId) ?? null, lock,
    shots: project.shots.filter(s => s.sceneId === sceneId).map(s => ({ id: s.id, purpose: s.purpose, action: s.action, framing: s.framing, motion: s.motion,
      desiredFrames: s.desiredFrames, references: s.referenceArtifactIds, imagePrompt: s.imagePrompt, videoPrompt: s.videoPrompt, narration: s.narration ?? null })) });
}

export interface ConfirmationFramePin { shotId: string; artifactId: string; sha256: string; nodeId: string | null }
/** Exact frame identities remain fenced even for same-spec regeneration between runner ticks. */
export function confirmationFramesCurrent(reader: { get<T>(kind: string, id: string): T | undefined }, project: ProjectRecord, pins: ConfirmationFramePin[]): boolean {
  const plan = project.activePlanId ? reader.get<{ compiled: import("@openslate/core").CompiledPlan }>("plan", project.activePlanId)?.compiled : null;
  return pins.every(pin => {
    const images = plan?.nodes.filter(n => n.kind === "image" && n.shotId === pin.shotId) ?? [];
    if (images.length > 1) return false;
    const nodeId = images[0]?.id ?? pin.nodeId;
    if (nodeId) {
      const binding = reader.get<{ state: string; planId: string; outputs: Record<string, { artifactId: string; sha256: string }> }>("node_binding", nodeId);
      return binding?.state === "active" && binding.planId === project.activePlanId && Object.values(binding.outputs).some(a => a.artifactId === pin.artifactId && a.sha256 === pin.sha256);
    }
    return plan?.nodes.some(n => n.kind === "video" && n.shotId === pin.shotId && n.inputs.some(i => i.destinationPort === "firstFrame" && i.source.kind === "artifact" && i.source.artifact.artifactId === pin.artifactId && i.source.artifact.sha256 === pin.sha256)) ?? false;
  });
}
