import { canonical, digest, invariant, projectExportSize, shotIntentDigest, shotVideoTiming } from "@openslate/core";
import type { ArtifactRef, CompiledPlan } from "@openslate/core";
import type { ExportReadiness, ExportRecord } from "@openslate/core/public";
import type { NodeBinding } from "../execution/engine.js";
import type { Store } from "../persistence/store.js";
import type { CanonicalNarration } from "../narration/canonical-types.js";
import type { NarrationAudio } from "../narration/types.js";
import { projectAudioPlacements, storyboardAudioCuts } from "../narration/audio-placement.js";
import { soundtrackPlacement } from "../narration/soundtrack-placement.js";
import type { OwnedMediaSource, RenderTarget } from "./application-types.js";
import type { RenderManifestInput } from "./types.js";

export interface FilmFingerprint { shots: string; order: string; music: string; narration: string }
export interface StoryboardRenderTarget extends Pick<RenderTarget, "revisionId" | "headVersion" | "inputs" | "dependencyNodeIds" | "scopeIds"> {
  kind: "storyboard";
  demo: boolean;
  film: FilmFingerprint;
}
interface Artifact { projectId: string; artifact: ArtifactRef; fixture: boolean; path: string }
interface FixtureClip { artifact: ArtifactRef; durationFrames: number }
interface FixtureAudio { artifact: ArtifactRef; startSample: number; durationSamples: number; atSample: number }
export interface StoryboardCapture {
  readiness: ExportReadiness;
  target: StoryboardRenderTarget;
  input: RenderManifestInput;
  fixtureClips: FixtureClip[];
  fixtureAudio: FixtureAudio[];
}

/** SQL-only capture, shared by readiness, freeze and final publication. No Director timeline is needed. */
export function captureStoryboard(store: Store, projectId: string): StoryboardCapture {
  return store.transaction(() => {
    const project = store.getProject(projectId), cuts = storyboardAudioCuts(project);
    const shots = cuts.map(cut => project.shots.find(shot => shot.id === cut.shotId)!);
    const plan = project.activePlanId ? store.get<{ projectId: string; compiled: CompiledPlan }>("plan", project.activePlanId) : undefined;
    const bindings = store.list<NodeBinding>("node_binding", projectId);
    const head = store.get<{ projectId: string; canonicalId: string }>("narration_canonical_head", projectId);
    const narration = head?.projectId === projectId ? store.get<CanonicalNarration>("narration_canonical", head.canonicalId) : undefined;
    const blockers: ExportReadiness["blockers"] = [], inputs: RenderTarget["inputs"] = [];
    const dependencyNodeIds = new Set<string>(), fixtureClips: FixtureClip[] = [], fixtureAudio: FixtureAudio[] = [];
    const clips: RenderManifestInput["clips"] = [], audio: NonNullable<RenderManifestInput["audio"]> = [];
    const selected: { shotId: string; fixture: boolean }[] = [];
    const placedAbsoluteCues = new Set<string>(), voices: { shotId: string; fixture: boolean }[] = [];
    let musicFixture: boolean | undefined;
    const shotFingerprints: unknown[] = [], voiceFingerprints: unknown[] = [];
    const ownedArtifact = (ref: ArtifactRef) => {
      const row = store.get<Artifact>("artifact", ref.artifactId);
      return row?.projectId === projectId && canonical(row.artifact) === canonical(ref) && typeof row.fixture === "boolean" ? row : undefined;
    };
    const currentDependency = (id: string, seen = new Set<string>()): boolean => {
      if (seen.has(id)) return true;
      seen.add(id); dependencyNodeIds.add(id);
      const node = plan?.compiled.nodes.find(n => n.id === id), binding = bindings.find(b => b.id === id);
      return !!node && binding?.projectId === projectId && binding.state === "active" && binding.planId === project.activePlanId &&
        canonical(binding.node) === canonical(node) && node.inputs.every(input => input.source.kind !== "output" || currentDependency(input.source.nodeId, seen));
    };
    for (const [index, shot] of shots.entries()) {
      const nodes = plan?.projectId === projectId ? plan.compiled.nodes.filter(n => n.kind === "video" && n.shotId === shot.id) : [];
      const node = nodes.length === 1 ? nodes[0] : undefined;
      const binding = node ? bindings.find(b => b.id === node.id) : undefined;
      const ref = binding?.outputs.video;
      const artifact = ref?.kind === "video" ? ownedArtifact(ref) : undefined;
      const cue = project.cues.find(c => c.id === shot.cueId);
      const source = ref ? store.get<OwnedMediaSource>("media_source", ref.artifactId) : undefined;
      const current = node && binding?.projectId === projectId && binding.state === "active" && binding.planId === project.activePlanId &&
        canonical(binding.node) === canonical(node) && node.shotRevisionId === shot.revisionId &&
        Number(node.args.durationFrames) >= shot.desiredFrames && node.intentDigest === shotIntentDigest(shot, "video", cue) &&
        shot.promptIntent.video === node.intentDigest && node.args.prompt === shot.videoPrompt && currentDependency(node.id);
      if (!ref || !artifact) blockers.push({ code: binding?.outdated || ref || nodes.length > 1 ? "clip_outdated" : "no_clip", shotId: shot.id });
      else if (!current || (!artifact.fixture && !(source?.projectId === projectId && source.source.kind === "video" &&
        source.source.artifactId === ref.artifactId && source.source.sha256 === ref.sha256 && (source.source.probe.video?.frames ?? 0) >= shot.desiredFrames)))
        blockers.push({ code: "clip_outdated", shotId: shot.id });
      if (ref && artifact) {
        selected.push({ shotId: shot.id, fixture: artifact.fixture });
        inputs.push({ nodeId: node?.id ?? null, port: "video", artifact: ref });
        if (node) dependencyNodeIds.add(node.id);
        if (artifact.fixture) fixtureClips.push({ artifact: ref, durationFrames: shot.desiredFrames });
        else if (source) clips.push({ source: source.source, startFrame: 0, durationFrames: shot.desiredFrames, fit: "contain" });
      }
      shotFingerprints.push({ id: shot.id, revisionId: shot.revisionId, frames: shot.desiredFrames, intent: shot.promptIntent.video, clip: ref ?? null });
      const timing = shotVideoTiming(project, shot);
      let settled = timing.ready;
      const segment = cue && narration?.projectId === projectId && narration.script === project.narration.script
        ? narration.segments.filter(s => canonical(s.cue) === canonical(cue)) : [];
      if (cue && settled) {
        const record = ownedArtifact(cue.audio), accepted = segment.length === 1 ? segment[0] : undefined;
        if (record) voices.push({ shotId: shot.id, fixture: record.fixture });
        if (accepted && record && accepted.audioPlacement.source.kind === "audio" && accepted.audioPlacement.source.artifactId === cue.audio.artifactId && accepted.audioPlacement.source.sha256 === cue.audio.sha256) {
          try {
            const placements = projectAudioPlacements(accepted, [cuts[index]!], { requireAbsoluteCutStart: true });
            if (!placements.length) settled = false;
            else if (accepted.placementMode === "shot" || !placedAbsoluteCues.has(cue.id)) {
              audio.push(...placements);
              placedAbsoluteCues.add(cue.id);
            }
          }
          catch { settled = false; }
          inputs.push({ nodeId: null, port: "audio", artifact: cue.audio });
        } else if (record?.fixture && artifact?.fixture && cue.accepted && cue.measured) {
          // The shipped demo predates canonical narration. Its accepted fixture range travels with the shot.
          fixtureAudio.push({ artifact: cue.audio, startSample: cue.placementFrames * 1600, durationSamples: cue.durationFrames * 1600, atSample: cuts[index]!.startFrame * 1600 });
          inputs.push({ nodeId: null, port: "audio", artifact: cue.audio });
        } else settled = false;
      }
      if (!settled) blockers.push({ code: "voice_unsettled", shotId: shot.id });
      voiceFingerprints.push({ id: shot.id, narration: shot.narration ?? null, pending: shot.narrationPending ?? null, timingMode: shot.narrationTimingMode ?? null, cue: cue ?? null, segment: segment[0]?.audioPlacement ?? null });
    }
    const totalFrames = shots.reduce((sum, shot) => sum + shot.desiredFrames, 0);
    if (!shots.length) blockers.push({ code: "empty_film" });
    if (totalFrames > Math.min(project.maxFrames, 10800) || shots.length > 64) blockers.push({ code: "too_long" });
    let music: unknown = project.soundtrack ?? null;
    if (project.soundtrack) {
      const recording = store.get<NarrationAudio>("narration_audio", project.soundtrack.audioId);
      invariant(recording?.projectId === projectId && recording.media.kind === "audio", "MEDIA_ARTIFACT_UNAVAILABLE", "Selected soundtrack is unavailable");
      musicFixture = store.get<Artifact>("artifact", recording.media.artifactId)?.fixture === true;
      const samples = recording.media.probe.audio?.samples;
      invariant(Number.isSafeInteger(samples) && samples! > 0, "MEDIA_SOURCE_UNAVAILABLE", "Soundtrack duration is not measured");
      inputs.push({ nodeId: null, port: "soundtrack", artifact: { artifactId: recording.id, sha256: recording.media.sha256, kind: "audio" } });
      const placement = totalFrames > 0 ? soundtrackPlacement(project.soundtrack, samples!, totalFrames) : null;
      if (placement) audio.push({ source: recording.media, ...placement });
      music = { settings: project.soundtrack, source: recording.media.id };
    }
    const mediaFlavors = [...selected.map(clip => clip.fixture), ...voices.map(voice => voice.fixture), ...(musicFixture === undefined ? [] : [musicFixture])];
    const demo = selected.length === shots.length && shots.length > 0 && mediaFlavors.every(fixture => fixture);
    const clipFlavors = new Set(selected.map(clip => clip.fixture));
    if (clipFlavors.size > 1) {
      for (const shot of shots) blockers.push({ code: "mixed_demo_media", medium: "clip", shotId: shot.id });
    } else if (clipFlavors.size === 1) {
      const clipFixture = selected[0]!.fixture;
      for (const voice of voices)
        if (voice.fixture !== clipFixture) blockers.push({ code: "mixed_demo_media", medium: "voice", shotId: voice.shotId });
      if (musicFixture !== undefined && musicFixture !== clipFixture) blockers.push({ code: "mixed_demo_media", medium: "music" });
    }
    const film: FilmFingerprint = {
      shots: digest(shotFingerprints.sort((a, b) => canonical(a).localeCompare(canonical(b)))),
      order: digest(shots.map(s => s.id)), music: digest(music),
      narration: digest({ script: project.narration.script, voices: voiceFingerprints.sort((a, b) => canonical(a).localeCompare(canonical(b))) }),
    };
    return { readiness: { ready: !blockers.length, demo, seconds: totalFrames / 30, blockers },
      target: { kind: "storyboard", revisionId: project.revisionId, headVersion: project.headVersion, demo, film, inputs,
        dependencyNodeIds: [...dependencyNodeIds].sort(), scopeIds: [projectId, ...project.scenes.map(s => s.id), ...shots.map(s => s.id)].sort() },
      input: { projectId, targetRevisionId: project.revisionId, ...projectExportSize(project), clips, audio, ...(demo ? { demo: true as const } : {}) }, fixtureClips, fixtureAudio };
  });
}
export function changedFilm(previous: FilmFingerprint, current: FilmFingerprint): ExportRecord["outdatedBy"] {
  return (["shots", "order", "music", "narration"] as const).filter(key => previous[key] !== current[key]);
}
