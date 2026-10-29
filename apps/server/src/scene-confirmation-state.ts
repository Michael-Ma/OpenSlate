import { digest, shotIntentDigest } from "@openslate/core";
import type { ProjectRecord } from "@openslate/core";
/** Pins this shot's creative inputs and frame; derived voice-overlay and plan metadata are excluded. */
export function sceneConfirmationGuard(project: ProjectRecord, shotId: string, lock: unknown, framePin?: ConfirmationFramePin): string {
  const shot = project.shots.find(s => s.id === shotId);
  const cue = shot?.cueId ? project.cues.find(c => c.id === shot.cueId) : undefined;
  return digest({ lock, framePin: framePin ?? null, shot: shot ? { id: shot.id, sceneId: shot.sceneId,
    intent: { image: shotIntentDigest(shot, "image", cue), video: shotIntentDigest(shot, "video", cue) }, purpose: shot.purpose, action: shot.action,
    framing: shot.framing, motion: shot.motion, desiredFrames: shot.desiredFrames, references: shot.referenceArtifactIds,
    imagePrompt: shot.imagePrompt, videoPrompt: shot.videoPrompt, narration: shot.narration ?? null } : null });
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
