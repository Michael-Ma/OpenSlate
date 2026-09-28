import type { NarrationAudio } from '../narration/types.js';
import { canonical, invariant, shotIntentDigest } from "@openslate/core";
import type { ArtifactRef, CompiledPlan, CueRecord, InputSource, PlanNode } from "@openslate/core";
import type { NodeBinding } from "../execution/engine.js";
import type { Store } from "../persistence/store.js";
import type { OwnedMediaSource, RenderTarget } from "./application-types.js";
import type { RenderManifestInput, SuppliedMedia } from "./types.js";

export interface CapturedTimeline {
  target: Omit<RenderTarget, "renderNodeId">;
  input: Omit<RenderManifestInput, "width" | "height">;
}
export interface CapturedRender { target: RenderTarget; input: RenderManifestInput }
interface Plan { id: string; projectId: string; compiled: CompiledPlan }
interface Artifact { projectId: string; artifact: ArtifactRef; fixture: boolean }
interface Narration {
  id: string; projectId: string; script: string;
  segments: Array<{ cue: CueRecord; audioPlacement: { source: SuppliedMedia; startSample: number; durationSamples: number; atSample: number; gainMilliDb: number } }>;
}

function currentPlan(store: Store, projectId: string) {
  const project = store.getProject(projectId);
  const plan = project.activePlanId ? store.get<Plan>("plan", project.activePlanId) : undefined;
  invariant(plan?.projectId === projectId, "MEDIA_PLAN_REQUIRED", "Install a plan before rendering");
  const node = (id: string, kind?: string): PlanNode => {
    const found = plan.compiled.nodes.find(n => n.id === id), binding = store.get<NodeBinding>("node_binding", id);
    invariant(found && binding?.projectId === projectId && binding.state === "active" && binding.planId === plan.id && canonical(binding.node) === canonical(found), "MEDIA_STALE_BINDING", "Plan binding is not current");
    invariant(!kind || found.kind === kind, "MEDIA_PLAN_UNSUPPORTED", "Unexpected operation in render plan"); return found;
  };
  return { store, project, plan, node };
}

function timelineCapture(context: ReturnType<typeof currentPlan>, timeline: PlanNode, renderNodeId?: string): CapturedTimeline {
  const { store, project, plan, node } = context, projectId = project.id;
  invariant(timeline.args.transition === "cut", "MEDIA_PLAN_UNSUPPORTED", "Only cut-based MP4 output is supported");
  const takes = timeline.inputs.filter(i => i.destinationPort === "takes" && i.role === "video").sort((a, b) => a.order - b.order);
  const narrationInputs = timeline.inputs.filter(i => i.destinationPort === "narration" && i.role === "audio");
  invariant(takes.length > 0 && takes.every((take, index) => take.order === index) && narrationInputs.length <= 1 && takes.length + narrationInputs.length === timeline.inputs.length, "MEDIA_PLAN_UNSUPPORTED", "Timeline ports or ordering are unsupported");
  const inputs: RenderTarget["inputs"] = [], dependencyNodeIds = new Set(renderNodeId ? [renderNodeId, timeline.id] : [timeline.id]), scopeIds = new Set([projectId]);
  const addDependencies = (id: string): void => {
    if (dependencyNodeIds.has(id)) return; dependencyNodeIds.add(id);
    const value = node(id); if (value.shotId) { scopeIds.add(value.shotId); const shot = project.shots.find(s => s.id === value.shotId); if (shot) scopeIds.add(shot.sceneId); }
    for (const input of value.inputs) if (input.source.kind === "output") addDependencies(input.source.nodeId);
  };
  const resolve = (source: InputSource, kind: "video" | "audio"): ArtifactRef => {
    if (source.kind === "output") addDependencies(source.nodeId);
    const ref = source.kind === "artifact" ? source.artifact : store.get<NodeBinding>("node_binding", source.nodeId)?.outputs[source.port];
    invariant(ref?.kind === kind, "MEDIA_INPUT_PENDING", "A selected timeline input is not available");
    const artifact = store.get<Artifact>("artifact", ref.artifactId);
    invariant(artifact?.projectId === projectId && canonical(artifact.artifact) === canonical(ref), "MEDIA_ARTIFACT_UNAVAILABLE", "Selected artifact is not owned by the project");
    invariant(artifact.fixture === false, "MEDIA_FIXTURE_UNSUPPORTED", "Fixture outputs cannot stand in for real planned media");
    if (source.kind === "artifact") invariant(project.artifacts.some(a => canonical(a) === canonical(ref)), "MEDIA_ARTIFACT_UNAVAILABLE", "Imported artifact is not in the current project");
    inputs.push({ nodeId: source.kind === "output" ? source.nodeId : null, port: source.kind === "output" ? source.port : kind, artifact: ref }); return ref;
  };
  const selectedCueIds = new Set<string>();
  const clips = takes.map(take => {
    const ref = resolve(take.source, "video"), owned = store.get<OwnedMediaSource>("media_source", ref.artifactId);
    invariant(owned?.projectId === projectId && owned.source.kind === "video" && owned.source.artifactId === ref.artifactId && owned.source.sha256 === ref.sha256, "MEDIA_SOURCE_UNAVAILABLE", "Video has no measured supplied-media descriptor");
    let frames = owned.source.probe.video?.frames;
    if (take.source.kind === "output") {
      const video = node(take.source.nodeId, "video"), shot = project.shots.find(s => s.id === video.shotId);
      invariant(shot && video.args.durationFrames === shot.desiredFrames && video.shotRevisionId === shot.revisionId, "MEDIA_STALE_BINDING", "Video timing no longer matches its shot");
      const cue = shot.cueId ? project.cues.find(c => c.id === shot.cueId) : undefined;
      invariant(!shot.cueId || (cue?.accepted && cue.measured && cue.durationFrames === shot.desiredFrames), "MEDIA_NARRATION_REQUIRED", "Current shot timing is not accepted");
      invariant(video.intentDigest === shotIntentDigest(shot, "video", cue) && shot.promptIntent.video === video.intentDigest && video.args.prompt === shot.videoPrompt, "MEDIA_STALE_BINDING", "Selected take intent is stale");
      if (cue) selectedCueIds.add(cue.id); frames = shot.desiredFrames;
    }
    invariant(Number.isSafeInteger(frames) && frames! > 0, "MEDIA_SOURCE_UNAVAILABLE", "Video duration has not been measured");
    return { source: owned.source, startFrame: 0, durationFrames: frames!, fit: "contain" as const };
  });
  const totalFrames = clips.reduce((sum, clip) => sum + clip.durationFrames, 0);
  invariant(totalFrames <= project.maxFrames && (timeline.args.durationFrames === null || timeline.args.durationFrames === totalFrames), "MEDIA_DURATION_MISMATCH", "Timeline duration does not match its measured/planned takes");
  const canonicalHead = store.get<{ projectId: string; canonicalId: string }>("narration_canonical_head", projectId);
  const narration = canonicalHead?.projectId === projectId ? store.get<Narration>("narration_canonical", canonicalHead.canonicalId) : undefined;
  const fingerprints = timeline.args.cues;
  invariant(Array.isArray(fingerprints), "MEDIA_PLAN_UNSUPPORTED", "Timeline cue identities are absent");
  const cueFingerprint = (cue: CueRecord) => ({ meaning: cue.meaning, placementFrames: cue.placementFrames, durationFrames: cue.durationFrames, audioHash: cue.audio.sha256 });
  const selected = fingerprints.map(fingerprint => {
    const matches = narration?.segments.filter(segment => canonical(cueFingerprint(segment.cue)) === canonical(fingerprint)) ?? [];
    invariant(matches.length === 1, "MEDIA_NARRATION_REQUIRED", "Timeline cue has no unique committed narration placement");
    const segment = matches[0]!;
    const current = project.cues.find(cue => cue.id === segment.cue.id);
    invariant(current?.accepted && current.measured && canonical(current) === canonical(segment.cue), "MEDIA_NARRATION_REQUIRED", "Narration acceptance or timing changed");
    const source = segment.audioPlacement.source;
    invariant(source.artifactId === current.audio.artifactId && source.sha256 === current.audio.sha256 && source.kind === "audio", "MEDIA_NARRATION_REQUIRED", "Narration bytes do not match the committed cue");
    resolve({ kind: "artifact", artifact: current.audio }, "audio"); return segment;
  });
  invariant(new Set(selected.map(s => s.cue.id)).size === selected.length && [...selectedCueIds].every(id => selected.some(s => s.cue.id === id)), "MEDIA_NARRATION_REQUIRED", "Timeline does not cover its shot cues exactly");
  if (selected.length) invariant(narration?.projectId === projectId && narration.script === project.narration.script, "MEDIA_NARRATION_REQUIRED", "Narration script changed after acceptance");
  else invariant(!project.narration.script.trim() && project.cues.length === 0 && narrationInputs.length === 0, "MEDIA_NARRATION_REQUIRED", "A narrated project requires committed timeline cue placements");
  for (const input of narrationInputs) {
    const audio = resolve(input.source, "audio");
    invariant(selected.some(segment => canonical(segment.cue.audio) === canonical(audio)), "MEDIA_NARRATION_REQUIRED", "Narration input is not part of the frozen cue placements");
  }
  const audio = selected.map(segment => segment.audioPlacement);
  if (project.soundtrack) {
    const recording = store.get<NarrationAudio>('narration_audio', project.soundtrack.audioId);
    invariant(recording?.projectId === projectId && recording.media.kind === 'audio', 'MEDIA_ARTIFACT_UNAVAILABLE', 'Selected soundtrack is unavailable.');
    const samples = recording.media.probe.audio?.samples;
    invariant(Number.isSafeInteger(samples) && samples! > 0, 'MEDIA_SOURCE_UNAVAILABLE', 'Soundtrack duration is not measured.');
    inputs.push({ nodeId: null, port: 'soundtrack', artifact: { artifactId: recording.id, sha256: recording.media.sha256, kind: 'audio' } });
    audio.push({ source: recording.media, startSample: 0, durationSamples: Math.min(samples!, totalFrames * 1600), atSample: 0, gainMilliDb: project.soundtrack.gainMilliDb });
  }
  return { target: { revisionId: project.revisionId, headVersion: project.headVersion, planId: plan.id, graphDigest: plan.compiled.graphDigest,
    timelineNodeId: timeline.id, canonicalNarrationId: selected.length ? narration!.id : null, inputs,
    dependencyNodeIds: [...dependencyNodeIds].sort(), scopeIds: [...scopeIds].sort() },
    input: { projectId, targetRevisionId: project.revisionId, clips, audio } };
}

/** Trusted SQL-only snapshot. Caller still owns authority/holds and subsequent descriptor/byte validation. */
export function captureTimeline(store: Store, projectId: string, timelineNodeId: string): CapturedTimeline {
  return store.transaction(() => {
    const context = currentPlan(store, projectId);
    return timelineCapture(context, context.node(timelineNodeId, "timeline"));
  });
}

/** Preserve the human render capture shape; no media I/O, job creation, geometry validation or publication. */
export function captureRender(store: Store, projectId: string, renderNodeId: string): CapturedRender {
  return store.transaction(() => {
    const context = currentPlan(store, projectId), render = context.node(renderNodeId, "render");
    invariant(render.inputs.length === 1 && render.inputs[0]?.source.kind === "output", "MEDIA_PLAN_UNSUPPORTED", "Render requires one timeline operation");
    const timeline = context.node(render.inputs[0].source.nodeId, "timeline");
    invariant(timeline.args.transition === "cut" && render.args.format === "mp4", "MEDIA_PLAN_UNSUPPORTED", "Only cut-based MP4 output is supported");
    const captured = timelineCapture(context, timeline, render.id), target = captured.target;
    return { target: { revisionId: target.revisionId, headVersion: target.headVersion, planId: target.planId, graphDigest: target.graphDigest,
      renderNodeId: render.id, timelineNodeId: target.timelineNodeId, canonicalNarrationId: target.canonicalNarrationId, inputs: target.inputs,
      dependencyNodeIds: target.dependencyNodeIds, scopeIds: target.scopeIds },
      input: { projectId, targetRevisionId: captured.input.targetRevisionId, width: Number(render.args.width), height: Number(render.args.height), clips: captured.input.clips, audio: captured.input.audio! } };
  });
}
