import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { createHash } from "node:crypto";
import { canonical, clipAudioSegments, DomainError, invariant, projectShotClipAudio } from "@openslate/core";
import type { ArtifactRef, ClipAudioSpan, CompiledPlan, ProjectRecord } from "@openslate/core";
import type { FastifyInstance } from "fastify";
import type { NodeBinding } from "../execution/engine.js";
import type { Store } from "../persistence/store.js";
import { storyboardAudioCuts } from "../narration/audio-placement.js";
import type { OwnedMediaSource } from "./application-types.js";
import { resolveClipAudio } from "./clip-audio.js";
import type { LocalMediaService } from "./local-media.js";
import type { SuppliedMedia } from "./types.js";
import { setTimeout as delay } from "node:timers/promises";

/** Wait out a busy media worker (an export or another derivation) for a few seconds, then give up. */
async function untilFree<T>(operation: () => Promise<T>, attempts = 80): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try { return await operation(); }
    catch (error) { if (!(error instanceof DomainError) || error.code !== "MEDIA_BUSY" || attempt >= attempts) throw error; }
    await delay(50);
  }
}

/** A kept shot whose current clip is a real (non-fixture) owned video. */
export interface PlaybackClip { shotId: string; artifact: ArtifactRef; source: SuppliedMedia; atSample: number; durationSamples: number; gainMilliDb: number }

/** The shot's clip as the film shows it: the active plan's one video node output, owned by the project. */
function currentClip(store: Store, project: ProjectRecord, shotId: string, plan: { projectId: string; compiled: CompiledPlan } | undefined, bindings: NodeBinding[]) {
  const nodes = plan?.projectId === project.id ? plan.compiled.nodes.filter(n => n.kind === "video" && n.shotId === shotId) : [];
  const binding = nodes.length === 1 ? bindings.find(b => b.id === nodes[0]!.id && b.projectId === project.id) : undefined;
  const ref = binding?.outputs.video;
  if (ref?.kind !== "video") return null;
  const row = store.get<{ projectId: string; artifact: ArtifactRef; fixture: boolean }>("artifact", ref.artifactId);
  const source = store.get<OwnedMediaSource>("media_source", ref.artifactId);
  if (row?.projectId !== project.id || row.fixture || canonical(row.artifact) !== canonical(ref) || source?.projectId !== project.id || source.source.sha256 !== ref.sha256) return null;
  return { artifact: ref, source: source.source };
}

/** SQL only: the kept shots with a real clip, in film order. */
export function playbackClips(store: Store, project: ProjectRecord): PlaybackClip[] {
  const plan = project.activePlanId ? store.get<{ projectId: string; compiled: CompiledPlan }>("plan", project.activePlanId) : undefined;
  const bindings = store.list<NodeBinding>("node_binding", project.id).filter(b => b.state === "active" && b.planId === project.activePlanId);
  const clips: PlaybackClip[] = [];
  for (const cut of storyboardAudioCuts(project)) {
    const shot = project.shots.find(row => row.id === cut.shotId);
    if (!shot) continue;
    const effective = projectShotClipAudio(project, shot);
    if (!effective.keep) continue;
    const clip = currentClip(store, project, shot.id, plan, bindings);
    if (clip) clips.push({ shotId: shot.id, ...clip, atSample: cut.startFrame * 1600, durationSamples: cut.durationFrames * 1600, gainMilliDb: effective.gainMilliDb });
  }
  return clips;
}

/** The Film preview's placement for one kept clip; the web plays it with the same gain steps the export mixes. */
export interface ClipPlaybackPlacement {
  id: string; kind: "clip"; audioId: string; sha256: string; startSample: number; durationSamples: number; atSample: number; gainMilliDb: number;
  gainSteps: Array<{ atSample: number; gainMilliDb: number }>; shotIds: string[];
}

/**
 * Derive (once, cached by the media worker) and place each kept clip's sound. A busy worker, a silent clip or a clip
 * that cannot be read is left out: the preview's narration and music never fail because of clip sound.
 */
export async function clipPlaybackPlacements(media: Pick<LocalMediaService, "deriveClipAudio"> | undefined, clips: readonly PlaybackClip[], voices: readonly ClipAudioSpan[]): Promise<ClipPlaybackPlacement[]> {
  if (!media) return [];
  const placements: ClipPlaybackPlacement[] = [];
  for (const clip of clips) {
    let derived;
    try { derived = await resolveClipAudio(media, clip.source, untilFree); }
    catch { continue; }
    if (!("media" in derived)) continue;
    const pieces = clipAudioSegments({ startSample: 0, atSample: clip.atSample, durationSamples: Math.min(derived.media.probe.audio?.samples ?? 0, clip.durationSamples), gainMilliDb: clip.gainMilliDb }, voices);
    if (!pieces.length) continue;
    placements.push({ id: `clip:${clip.shotId}`, kind: "clip", audioId: clip.artifact.artifactId, sha256: derived.media.sha256, startSample: 0,
      durationSamples: pieces.reduce((sum, piece) => sum + piece.durationSamples, 0), atSample: clip.atSample, gainMilliDb: clip.gainMilliDb,
      gainSteps: pieces.map(piece => ({ atSample: piece.atSample, gainMilliDb: piece.gainMilliDb })), shotIds: [clip.shotId] });
  }
  return placements;
}

/** GET the derived sound of one of this project's clips, verified like a recording preview. */
export function registerClipAudioContent(app: FastifyInstance, options: { store: Store; media(): LocalMediaService | undefined }): void {
  app.get<{ Params: { projectId: string; artifactId: string } }>("/api/projects/:projectId/clip-audio/:artifactId/content", async (request, reply) => {
    const { projectId, artifactId } = request.params, media = options.media();
    invariant(media, "NARRATION_MEDIA_UNAVAILABLE", "Clip sound needs local media tools");
    const row = options.store.get<{ projectId: string; artifact: ArtifactRef; fixture: boolean }>("artifact", artifactId);
    const source = options.store.get<OwnedMediaSource>("media_source", artifactId);
    invariant(row?.projectId === projectId && !row.fixture && source?.projectId === projectId && source.source.kind === "video", "NOT_FOUND", "Clip does not belong to this project");
    const derived = await resolveClipAudio(media, source.source, untilFree);
    invariant("media" in derived, "NOT_FOUND", "This clip has no sound");
    const verified = await media.verifiedSource(derived.media);
    const file = await open(verified.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat(); invariant(stat.isFile() && stat.size <= 80 * 1024 * 1024, "ARTIFACT_TOO_LARGE", "Clip sound preview exceeds its limit");
      const bytes = await file.readFile();
      invariant(bytes.length === stat.size && createHash("sha256").update(bytes).digest("hex") === derived.media.sha256, "ARTIFACT_CORRUPT", "Clip sound bytes changed");
      return reply.header("X-Content-Type-Options", "nosniff").header("Cache-Control", "private, no-store").header("X-Content-SHA256", derived.media.sha256).type("audio/wav").send(bytes);
    } finally { await file.close(); }
  });
}
