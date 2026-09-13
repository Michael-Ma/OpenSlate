import { digest, invariant, newId } from "@openslate/core";
import type { ActorContext } from "@openslate/core";
import type { ProductionService } from "../application/service.js";
import type { LocalMediaService } from "../media/index.js";
import type { NarrationAcceptance, NarrationAudio, NarrationCue, NarrationEntry, NarrationGap, NarrationImpact, NarrationProjection, NarrationReadiness, NarrationSegmentView, NarrationSnapshot, NarrationState, ReviseSegments, SegmentDraft, SegmentRevision } from "./types.js";
import { isVerifiedGeneratedNarrationAudio, narrationAudioOrigin, resolveGeneratedNarrationAudio, verifyGeneratedNarrationAudio } from "./generated-audio.js";
import type { ResolvedGeneratedNarrationAudio } from "./generated-audio.js";

export interface AttachGeneratedNarrationAudio {
  expectedVersion: number; segmentId: string; segmentRevisionId: string;
  artifactId: string; artifactDigest: string; generationEvidenceDigest: string; key: string;
}

const MAX_SAMPLES = 48000 * 360;
function integer(value: number, min: number, max: number): void { invariant(Number.isSafeInteger(value) && value >= min && value <= max, "NARRATION_INVALID_INPUT", "Invalid sample coordinate or version"); }
function text(value: unknown, max: number, allowEmpty = false): asserts value is string { invariant(typeof value === "string" && value.length <= max && (allowEmpty || value.trim().length > 0), "NARRATION_INVALID_INPUT", "Invalid narration text"); }
function gap(segmentId: string | null, category: string, blocks: NarrationGap["blocks"]): NarrationGap { return { key: digest({ segmentId, category }), segmentId, category, blocks }; }

/** Round absolute boundaries once; at 30 fps one frame is exactly 1600 samples. */
export function sampleIntervalToFrames(atSample: number, durationSamples: number): { placementFrames: number; durationFrames: number } {
  integer(atSample, 0, MAX_SAMPLES); integer(durationSamples, 1, MAX_SAMPLES);
  const rounded = (sample: number) => Number((BigInt(sample) + 800n) / 1600n);
  const placementFrames = rounded(atSample);
  return { placementFrames, durationFrames: rounded(atSample + durationSamples) - placementFrames };
}

/**
 * Offline narration domain service. It persists a separate narration projection;
 * it never rewrites canonical project shots/cues, changes holds, or buys media.
 * All writes require a current project-scoped application request. Human-only
 * methods are called by trusted host code, never by an agent-supplied actor tag.
 */
export class NarrationService {
  constructor(readonly production: ProductionService, private readonly mediaService?: LocalMediaService) {}
  get mediaAvailable(): boolean { return this.mediaService !== undefined; }
  /** Draft work has no media-tool dependency; physical operations require a configured service. */
  get media(): LocalMediaService {
    invariant(this.mediaService, "MEDIA_NOT_CONFIGURED", "Local media tools must be configured for recording operations");
    return this.mediaService;
  }
  private get store() { return this.production.store; }

  /** Trusted authenticated host view only; model tools must use snapshot with an actor. */
  workspaceSnapshot(projectId: string): NarrationSnapshot {
    return this.store.transaction(() => { this.store.getProject(projectId); return this.read(projectId); });
  }

  snapshot(projectId: string, actor: ActorContext): NarrationSnapshot {
    this.production.assertActor(projectId, actor);
    return this.store.transaction(() => this.read(projectId));
  }

  reviseSegments(projectId: string, actor: ActorContext, expectedVersion: number, key: string, patch: ReviseSegments): NarrationSnapshot {
    const input = structuredClone(patch);
    return this.mutate(projectId, actor, expectedVersion, key, "revise", input, state => {
      const updates = input.update ?? [], removals = input.remove ?? [], additions = input.add ?? [];
      invariant(updates.length + removals.length + additions.length > 0 || input.order, "NARRATION_INVALID_INPUT", "An edit must change segments or their order");
      invariant(updates.length <= 400 && additions.length <= 400 && removals.length <= 400, "NARRATION_INVALID_INPUT", "Too many segment changes");
      const changed = new Set<string>();
      for (const update of updates) {
        invariant(!changed.has(update.segmentId), "NARRATION_INVALID_INPUT", "Duplicate segment change"); changed.add(update.segmentId);
        const entry = this.entry(state, update.segmentId), old = this.record<SegmentRevision>("narration_segment", entry.segmentRevisionId, projectId);
        const draft = this.validateDraft(update.draft);
        if (digest(this.draft(old)) === digest(draft)) continue;
        const script = this.store.insert("narration_segment", newId(), projectId, { ...draft, segmentId: entry.segmentId }) as SegmentRevision;
        entry.segmentRevisionId = script.id;
        // Preserve the existing recording as a candidate/history. It no longer
        // asserts that the changed text matches or was accepted against its cues.
        if (digest(old.source) !== digest(draft.source)) entry.audioId = null;
        entry.cueId = null;
        entry.scriptAcceptanceId = entry.audioAcceptanceId = entry.timingAcceptanceId = null;
      }
      for (const id of removals) { invariant(!changed.has(id), "NARRATION_INVALID_INPUT", "Conflicting segment changes"); changed.add(id); this.entry(state, id); state.entries = state.entries.filter(entry => entry.segmentId !== id); }
      for (const value of additions) {
        const segmentId = newId();
        const script = this.store.insert("narration_segment", newId(), projectId, { ...this.validateDraft(value), segmentId }) as SegmentRevision;
        state.entries.push({ segmentId, segmentRevisionId: script.id, audioId: null, cueId: null, atSample: 0, scriptAcceptanceId: null, audioAcceptanceId: null, timingAcceptanceId: null });
      }
      invariant(state.entries.length <= 400, "NARRATION_INVALID_INPUT", "Narration exceeds 400 segments");
      if (input.order) {
        invariant(!additions.length && input.order.length === state.entries.length && new Set(input.order).size === state.entries.length, "NARRATION_INVALID_INPUT", "Order must name each saved segment exactly once");
        state.entries = input.order.map(id => this.entry(state, id));
      }
    });
  }

  async importAudio(projectId: string, human: ActorContext, input: { path: string; declaredOrigin: "uploaded" | "generated"; key: string }, options: { signal?: AbortSignal } = {}): Promise<NarrationAudio> {
    human = structuredClone(human); input = structuredClone(input);
    this.authority(projectId, human, true);
    invariant(input.declaredOrigin === "uploaded" || input.declaredOrigin === "generated", "NARRATION_INVALID_INPUT", "Choose the supplied recording origin"); text(input.key, 160);
    const scope = `${human.principalId}:${projectId}:${human.requestId}:narration-import`;
    const request = this.store.command(scope, input.key, digest({ path: input.path, origin: input.declaredOrigin }), () => { this.authority(projectId, human, true); return { id: newId() }; });
    const existing = this.store.get<NarrationAudio>("narration_audio", request.id);
    if (existing) { invariant(existing.projectId === projectId, "SCOPE_DENIED", "Audio belongs to another project"); return existing; }
    // A interrupted local import can be repeated under the same allocated ID;
    // normalization is local and immutable installation is content addressed.
    const imported = await this.media.importMedia({ artifactId: request.id, path: input.path, kind: "audio" }, options);
    return this.store.transaction(() => {
      this.authority(projectId, human, true);
      return this.store.command(`${scope}:finish`, request.id, digest(imported), () => {
        const audio = this.store.insert("narration_audio", request.id, projectId, { media: imported, declaredOrigin: input.declaredOrigin, requestId: human.requestId }) as NarrationAudio;
        this.store.appendEvent(projectId, "narration.audio_imported", { audioId: audio.id, sha256: imported.sha256 });
        return audio;
      });
    });
  }

  bindAudio(projectId: string, actor: ActorContext, expectedVersion: number, key: string, segmentId: string, audioId: string): NarrationSnapshot {
    return this.mutate(projectId, actor, expectedVersion, key, "bind", { segmentId, audioId }, state => {
      const entry = this.entry(state, segmentId), script = this.record<SegmentRevision>("narration_segment", entry.segmentRevisionId, projectId);
      const audio = this.record<NarrationAudio>("narration_audio", audioId, projectId);
      invariant(!isVerifiedGeneratedNarrationAudio(audio), "NARRATION_GENERATED_ATTACHMENT_REQUIRED", "Use the exact human generated-recording selection action");
      invariant(script.source.kind === narrationAudioOrigin(audio), "NARRATION_SOURCE_UNDECIDED", "Select the recording source before binding its audio");
      if (entry.audioId === audioId) return;
      entry.audioId = audioId; entry.cueId = null; entry.audioAcceptanceId = entry.timingAcceptanceId = null;
    });
  }

  /** Select an existing generated take. Generation evidence does not accept its words or timing. */
  async attachGeneratedAudio(projectId: string, human: ActorContext, input: AttachGeneratedNarrationAudio, options: { signal?: AbortSignal } = {}): Promise<NarrationSnapshot> {
    const signal = options.signal; human = structuredClone(human); input = structuredClone(input);
    const stopped = () => invariant(!signal?.aborted, "NARRATION_CANCELLED", "Generated recording selection was cancelled");
    this.authority(projectId, human, true); stopped();
    invariant(input && Object.keys(input).sort().join("\0") === ["expectedVersion", "segmentId", "segmentRevisionId", "artifactId", "artifactDigest", "generationEvidenceDigest", "key"].sort().join("\0"),
      "NARRATION_INVALID_INPUT", "Choose one exact generated recording for a saved section");
    integer(input.expectedVersion, 0, Number.MAX_SAFE_INTEGER);
    for (const value of [input.segmentId, input.segmentRevisionId, input.artifactId, input.key]) text(value, 160);
    for (const value of [input.artifactDigest, input.generationEvidenceDigest]) invariant(typeof value === "string" && /^[a-f0-9]{64}$/.test(value), "NARRATION_INVALID_INPUT", "Generated recording identity is invalid");
    const { expectedVersion, key, ...selection } = input, action = "attach_generated_audio";
    const replay = this.store.commandReplay<NarrationSnapshot>(`${human.principalId}:${projectId}:${human.requestId}:narration`, key,
      digest({ action, expectedVersion, arguments: selection }));
    if (replay) return replay.result;
    const section = (state: NarrationState) => {
      invariant(state.version === expectedVersion, "REVISION_CONFLICT", "Narration changed before this recording was selected");
      const entry = this.entry(state, selection.segmentId);
      invariant(entry.segmentRevisionId === selection.segmentRevisionId, "REVISION_CONFLICT", "This narration section changed before recording selection");
      const script = this.record<SegmentRevision>("narration_segment", entry.segmentRevisionId, projectId);
      invariant(script.source.kind === "generated", "NARRATION_SOURCE_UNDECIDED", "Choose generated audio for this section before attaching the recording");
      return entry;
    };
    section(this.read(projectId).state);
    const resolve = () => {
      const value = resolveGeneratedNarrationAudio(this.store, projectId, selection.artifactId);
      invariant(value.artifactDigest === selection.artifactDigest && value.generationEvidenceDigest === selection.generationEvidenceDigest,
        "NARRATION_GENERATED_IDENTITY_CHANGED", "The selected generated recording evidence changed");
      return value;
    };
    const selected = resolve();
    await this.verifyGeneratedAudio(selected, signal);
    stopped(); this.authority(projectId, human, true);
    // mutate fences authority, then resolves concurrent successful replay before current-version checks.
    return this.mutate(projectId, human, expectedVersion, key, action, selection, state => {
      stopped(); this.authority(projectId, human, true);
      const entry = section(state), current = resolve();
      invariant(digest(current.audio) === digest(selected.audio), "NARRATION_GENERATED_IDENTITY_CHANGED", "Generated recording changed during verification");
      const existing = this.store.get<NarrationAudio>("narration_audio", selection.artifactId);
      invariant(!existing || digest(existing) === digest(current.audio), "NARRATION_INTEGRITY_ERROR", "This recording identity already has different provenance");
      if (!existing) this.store.insert("narration_audio", current.audio.id, projectId, current.audio);
      if (entry.audioId !== current.audio.id) {
        entry.audioId = current.audio.id; entry.cueId = null; entry.audioAcceptanceId = entry.timingAcceptanceId = null;
      }
      this.store.appendEvent(projectId, "narration.generated_audio_attached", { ...selection, requestId: human.requestId });
    });
  }

  private verifyGeneratedAudio(selected: ResolvedGeneratedNarrationAudio, signal?: AbortSignal): Promise<ResolvedGeneratedNarrationAudio> {
    return verifyGeneratedNarrationAudio(this.store, this.media, { artifactDir: this.production.engine.artifactDir }, selected, signal ? { signal } : {});
  }

  recordHumanCue(projectId: string, human: ActorContext, expectedVersion: number, key: string, input: { segmentId: string; startSample: number; endSample: number }): NarrationSnapshot {
    this.authority(projectId, human, true);
    return this.mutate(projectId, human, expectedVersion, key, "cue", input, state => {
      const entry = this.entry(state, input.segmentId);
      invariant(entry.audioId, "NARRATION_AUDIO_REQUIRED", "Attach a recording before marking cue timing");
      const audio = this.record<NarrationAudio>("narration_audio", entry.audioId, projectId);
      integer(input.startSample, 0, MAX_SAMPLES); integer(input.endSample, input.startSample + 1, MAX_SAMPLES);
      invariant(input.endSample <= audio.media.probe.audio!.samples!, "NARRATION_CUE_OUT_OF_RANGE", "Cue extends beyond measured normalized audio");
      const cue = this.store.insert("narration_cue", newId(), projectId, { segmentRevisionId: entry.segmentRevisionId, audioId: entry.audioId, startSample: input.startSample, endSample: input.endSample, method: "human", confidence: null }) as NarrationCue;
      entry.cueId = cue.id; entry.timingAcceptanceId = null;
    });
  }

  accept(projectId: string, human: ActorContext, expectedVersion: number, key: string, kind: "script" | "timing", targets: string[]): NarrationSnapshot {
    this.authority(projectId, human, true);
    invariant(["script", "timing"].includes(kind) && targets.length > 0 && targets.length <= 400 && new Set(targets).size === targets.length, "NARRATION_INVALID_INPUT", "Accept an exact nonempty set of current targets");
    return this.mutate(projectId, human, expectedVersion, key, "accept", { kind, targets }, state => {
      for (const target of targets) {
        const entry = state.entries.find(e => (kind === "script" ? e.segmentRevisionId : e.cueId) === target);
        invariant(entry, "NARRATION_STALE_ACCEPTANCE", "Acceptance target is no longer selected");
        this.acceptEntry(projectId, human, entry, kind);
      }
    });
  }

  /** Audio files may cover several segments; accept exact current segment+audio bindings. */
  acceptAudio(projectId: string, human: ActorContext, expectedVersion: number, key: string, targets: Array<{ segmentRevisionId: string; audioId: string }>): NarrationSnapshot {
    this.authority(projectId, human, true);
    invariant(targets.length > 0 && targets.length <= 400 && new Set(targets.map(t => t.segmentRevisionId)).size === targets.length, "NARRATION_INVALID_INPUT", "Accept exact audio bindings");
    return this.mutate(projectId, human, expectedVersion, key, "accept_audio", targets, state => {
      for (const target of targets) { const entry = state.entries.find(e => e.segmentRevisionId === target.segmentRevisionId && e.audioId === target.audioId); invariant(entry, "NARRATION_STALE_ACCEPTANCE", "Audio acceptance is stale"); this.acceptEntry(projectId, human, entry, "audio"); }
    });
  }

  placeSegments(projectId: string, actor: ActorContext, expectedVersion: number, key: string, placements: Array<{ segmentId: string; atSample: number }>): NarrationSnapshot {
    invariant(placements.length > 0 && placements.length <= 400 && new Set(placements.map(p => p.segmentId)).size === placements.length, "NARRATION_INVALID_INPUT", "Provide unique bounded placements");
    return this.mutate(projectId, actor, expectedVersion, key, "place", placements, state => {
      for (const placement of placements) { integer(placement.atSample, 0, MAX_SAMPLES); this.entry(state, placement.segmentId).atSample = placement.atSample; }
    });
  }

  exportProjection(projectId: string, actor: ActorContext, options: { requireAccepted?: boolean } = {}): NarrationProjection {
    const view = this.snapshot(projectId, actor);
    const segments: NarrationProjection["segments"] = [], gaps = [...view.readiness.gaps];
    let end = 0;
    for (const segment of view.segments) {
      if (!segment.cue || !segment.audio) continue;
      const cue = segment.cue, samples = cue.endSample - cue.startSample, timing = sampleIntervalToFrames(segment.entry.atSample, samples);
      const relativeDurationFrames = sampleIntervalToFrames(0, samples).durationFrames;
      if (segment.entry.atSample < end) gaps.push(gap(segment.entry.segmentId, "overlapping_or_unordered_narration", "export"));
      end = segment.entry.atSample + samples;
      if (end > MAX_SAMPLES || relativeDurationFrames < 1) gaps.push(gap(segment.entry.segmentId, "export_duration", "export"));
      segments.push({ segmentId: segment.entry.segmentId, segmentRevisionId: segment.script.id, cue: { id: cue.id, meaning: segment.script.meaning, placementFrames: timing.placementFrames, durationFrames: relativeDurationFrames, audio: { artifactId: segment.audio.id, sha256: segment.audio.media.sha256, kind: "audio" }, accepted: segment.accepted.script && segment.accepted.audio && segment.accepted.timing, measured: true }, frameCoverage: { startFrame: timing.placementFrames, endFrame: timing.placementFrames + timing.durationFrames }, audioPlacement: { source: segment.audio.media, startSample: cue.startSample, durationSamples: samples, atSample: segment.entry.atSample, gainMilliDb: 0 } });
    }
    const accepted = view.segments.length > 0 && segments.length === view.segments.length && gaps.length === 0 && segments.every(s => s.cue.accepted);
    invariant(!options.requireAccepted || accepted, "NARRATION_NOT_READY", "Narration still requires current human acceptance or timing choices");
    return { projectId, version: view.state.version, revisionId: view.state.revisionId, readyForCanonicalCommit: accepted, canonicalApplied: false, segments, gaps };
  }

  private acceptEntry(projectId: string, human: ActorContext, entry: NarrationEntry, kind: NarrationAcceptance["kind"]): void {
    const view = this.segmentView(projectId, entry);
    if (kind === "script") invariant(view.script.text.trim() && view.script.meaning.trim() && view.script.textKind === "draft", "NARRATION_NOT_READY", "Only a finished segment draft can be approved");
    if (kind === "audio") invariant(view.audio, "NARRATION_AUDIO_REQUIRED", "No selected recording");
    if (kind === "timing") invariant(view.cue && view.accepted.script && view.accepted.audio, "NARRATION_NOT_READY", "Accept the current script and recording before its timing");
    const acceptance = this.store.insert("narration_acceptance", newId(), projectId, { kind, subjectDigest: this.subject(entry, kind), requestId: human.requestId, principalId: human.principalId }) as NarrationAcceptance;
    if (kind === "script") entry.scriptAcceptanceId = acceptance.id;
    else if (kind === "audio") entry.audioAcceptanceId = acceptance.id;
    else entry.timingAcceptanceId = acceptance.id;
  }
  private subject(entry: NarrationEntry, kind: NarrationAcceptance["kind"]): string {
    return digest({ kind, segmentRevisionId: entry.segmentRevisionId, ...(kind !== "script" ? { audioId: entry.audioId } : {}), ...(kind === "timing" ? { cueId: entry.cueId } : {}) });
  }
  private accepted(projectId: string, entry: NarrationEntry, kind: NarrationAcceptance["kind"], id: string | null): boolean {
    const decision = id ? this.store.get<NarrationAcceptance>("narration_acceptance", id) : undefined;
    return !!decision && decision.projectId === projectId && decision.kind === kind && decision.subjectDigest === this.subject(entry, kind);
  }
  private segmentView(projectId: string, entry: NarrationEntry): NarrationSegmentView {
    const script = this.record<SegmentRevision>("narration_segment", entry.segmentRevisionId, projectId);
    const audio = entry.audioId ? this.record<NarrationAudio>("narration_audio", entry.audioId, projectId) : null;
    const cue = entry.cueId ? this.record<NarrationCue>("narration_cue", entry.cueId, projectId) : null;
    invariant(!cue || (cue.segmentRevisionId === script.id && cue.audioId === audio?.id), "NARRATION_INTEGRITY_ERROR", "Selected cue does not describe the current script/audio");
    return { entry, script, audio, cue, accepted: { script: this.accepted(projectId, entry, "script", entry.scriptAcceptanceId), audio: !!audio && this.accepted(projectId, entry, "audio", entry.audioAcceptanceId), timing: !!cue && this.accepted(projectId, entry, "timing", entry.timingAcceptanceId) } };
  }
  private read(projectId: string): NarrationSnapshot {
    const state = this.store.get<NarrationState>("narration_state", projectId) ?? { id: projectId, projectId, version: 0, revisionId: null, entries: [] };
    const segments = state.entries.map(entry => this.segmentView(projectId, entry)), gaps: NarrationGap[] = [];
    if (!segments.length) gaps.push(gap(null, "missing_segments", "writing"));
    for (const segment of segments) {
      const id = segment.entry.segmentId;
      if (!segment.script.text.trim()) gaps.push(gap(id, "missing_text", "writing"));
      if (!segment.accepted.script) gaps.push(gap(id, "script_unapproved", "export"));
      if (segment.script.source.kind === "undecided") gaps.push(gap(id, "source_undecided", "synthesis"));
      if (!segment.audio) {
        gaps.push(gap(id, "missing_audio", segment.script.source.kind === "generated" ? "synthesis" : "timing"));
        if (segment.script.source.kind === "generated" && (!segment.script.source.voice || !segment.script.source.profileRevisionId)) gaps.push(gap(id, "missing_voice_or_profile", "synthesis"));
      } else if (!segment.accepted.audio) gaps.push(gap(id, "audio_unapproved", "export"));
      if (!segment.cue) gaps.push(gap(id, "missing_cue", "timing"));
      else if (!segment.accepted.timing) gaps.push(gap(id, "timing_unapproved", "export"));
    }
    const n = segments.length, withAudio = segments.filter(s => s.audio).length, withCue = segments.filter(s => s.cue).length;
    const readiness: NarrationReadiness = {
      text: !segments.some(s => s.script.text.trim()) ? "none" : n > 0 && segments.every(s => s.accepted.script) ? "approved" : segments.some(s => s.script.textKind === "draft") ? "draft" : segments.some(s => s.script.textKind === "outline") ? "outline" : "notes",
      audio: !withAudio ? "none" : withAudio < n ? "partial" : segments.every(s => s.accepted.audio) ? "accepted" : "complete",
      timing: !withCue ? "absent" : withCue < n ? "partial" : segments.every(s => s.accepted.timing && s.accepted.audio && s.accepted.script) ? "accepted" : "measured", gaps,
    };
    return { state, segments, readiness, canonicalApplied: false };
  }
  private mutate(projectId: string, actor: ActorContext, expectedVersion: number, key: string, action: string, argumentsValue: unknown, fn: (state: NarrationState) => void): NarrationSnapshot {
    this.authority(projectId, actor); integer(expectedVersion, 0, Number.MAX_SAFE_INTEGER); text(key, 160);
    return this.store.transaction(() => {
      this.authority(projectId, actor);
      return this.store.command(`${actor.principalId}:${projectId}:${actor.requestId}:narration`, key, digest({ action, expectedVersion, arguments: argumentsValue }), () => {
        const state = this.read(projectId).state;
        invariant(state.version === expectedVersion, "REVISION_CONFLICT", "Narration changed before this edit");
        fn(state);
        const revisionId = newId();
        const next = { ...state, version: state.version + 1, revisionId };
        this.store.insert("narration_revision", revisionId, projectId, { state: next, requestId: actor.requestId });
        this.store.put("narration_state", projectId, projectId, next);
        this.store.appendEvent(projectId, "narration.changed", { revisionId, version: next.version, action });
        return this.read(projectId);
      });
    });
  }
  private authority(projectId: string, actor: ActorContext, humanOnly = false): void {
    this.production.assertActor(projectId, actor, true);
    invariant(!humanOnly || actor.kind === "human", "ACTOR_DENIED", "This narration decision requires an authenticated human");
    const request = this.store.get<{ scopeIds: string[]; projectId: string }>("message", actor.requestId);
    invariant(request?.projectId === projectId && request.scopeIds.includes(projectId), "SCOPE_DENIED", "Narration collection changes require project scope");
  }
  private entry(state: NarrationState, id: string): NarrationEntry { const entry = state.entries.find(e => e.segmentId === id); invariant(entry, "SCOPE_DENIED", "Unknown narration segment"); return entry; }
  private record<T extends { projectId: string }>(kind: string, id: string, projectId: string): T { const record = this.store.get<T>(kind, id); invariant(record?.projectId === projectId, "SCOPE_DENIED", "Narration reference belongs to another project or is absent"); return record; }
  private draft(revision: SegmentRevision): SegmentDraft { return { text: revision.text, textKind: revision.textKind, language: revision.language, meaning: revision.meaning, source: revision.source }; }
  private validateDraft(draft: SegmentDraft): SegmentDraft {
    text(draft.text, 16000, true); text(draft.language, 64); text(draft.meaning, 4000, true);
    invariant(["notes", "outline", "draft"].includes(draft.textKind), "NARRATION_INVALID_INPUT", "Invalid text maturity");
    invariant(draft.source && ["undecided", "uploaded", "generated"].includes(draft.source.kind), "NARRATION_INVALID_INPUT", "Invalid source choice");
    if (draft.source.kind === "generated") { if (draft.source.voice !== null) text(draft.source.voice, 160); if (draft.source.profileRevisionId !== null) text(draft.source.profileRevisionId, 160); }
    return { text: draft.text, textKind: draft.textKind, language: draft.language, meaning: draft.meaning, source: draft.source.kind === "generated" ? { kind: "generated", voice: draft.source.voice, profileRevisionId: draft.source.profileRevisionId } : { kind: draft.source.kind } };
  }
}

/** Visual fingerprints consume meaning/duration; rendering also consumes audio and placement. */
export function compareNarrationProjections(before: NarrationProjection, after: NarrationProjection): NarrationImpact[] {
  invariant(before.projectId === after.projectId, "SCOPE_DENIED", "Cannot compare narration across projects");
  const ids = new Set([...before.segments.map(s => s.segmentId), ...after.segments.map(s => s.segmentId)]);
  return [...ids].map(segmentId => {
    const old = before.segments.find(s => s.segmentId === segmentId), next = after.segments.find(s => s.segmentId === segmentId);
    if (!old || !next) return { segmentId, visual: "replan", render: "replace", reason: "added_or_removed", readinessChanged: true };
    const visualChanged = digest({ meaning: old.cue.meaning, duration: old.cue.durationFrames }) !== digest({ meaning: next.cue.meaning, duration: next.cue.durationFrames });
    const renderInputs = (value: typeof old) => ({ sha256: value.audioPlacement.source.sha256, startSample: value.audioPlacement.startSample, durationSamples: value.audioPlacement.durationSamples, atSample: value.audioPlacement.atSample, gainMilliDb: value.audioPlacement.gainMilliDb });
    const renderChanged = digest(renderInputs(old)) !== digest(renderInputs(next)) || old.cue.meaning !== next.cue.meaning;
    return { segmentId, visual: visualChanged ? "replan" : "reuse", render: renderChanged ? "replace" : "reuse", reason: visualChanged ? "meaning_or_duration" : renderChanged ? "audio_or_placement" : "unchanged", readinessChanged: old.cue.accepted !== next.cue.accepted };
  });
}
