import { digest, invariant, newId, requiredStages, shotIntentDigest, stageInputDigest, STAGE_CONTRACTS, STAGE_CONTRACTS_DIGEST, RECIPE_DIGEST, validateStageRequirements } from "@openslate/core";
import type { ActorContext, CueRecord, ProjectRecord, StageRequirement } from "@openslate/core";
import type { NarrationService } from "./service.js";
import type { NarrationAcceptance, NarrationAudio, NarrationSnapshot } from "./types.js";
import type { CanonicalNarration, CanonicalNarrationArtifact, NarrationCommitReceipt, NarrationShotImpact, NarrationShotMapping, PreparedNarrationCommit, PrepareNarrationCommit } from "./canonical-types.js";
import { installNarrationAudio } from "./verified-audio.js";
import { assertGeneratedNarrationAudio, createGeneratedNarrationProvenance, isVerifiedGeneratedNarrationAudio, narrationAudioOrigin, resolveGeneratedNarrationAudio, verifyGeneratedNarrationAudio } from "./generated-audio.js";
import type { ResolvedGeneratedNarrationAudio } from "./generated-audio.js";
import { resolvePublishedTranscriptCandidate, transcriptCanonicalProvenance, transcriptSelectionRecord } from "./transcript-selection.js";
import type { TranscriptSelection } from "./transcript-selection.js";
import { verifyTranscriptSelectionEvidence } from "./transcript-selection-media.js";

interface StageBinding extends StageRequirement { id: string; projectId: string; inputDigest: string; outputDigest: string; bindingVersion: number; progressVersion: number; contractDigest: string }
const stageId = (projectId: string, stage: StageRequirement) => digest({ projectId, stageId: stage.stageId, scopeId: stage.scopeId });
const epochId = (actor: ActorContext) => actor.kind === "director" ? actor.epochId : null;
const canonicalHead = "narration_canonical_head";

/**
 * Trusted narrow commit adapter: creative patches cannot install accepted cues,
 * artifact provenance or cue mappings. This service derives all of them from
 * saved human-accepted narration. It never authors a plan or releases holds.
 */
export class NarrationCanonicalService {
  constructor(readonly narration: NarrationService) {}
  private get production() { return this.narration.production; }
  private get store() { return this.production.store; }

  current(projectId: string, actor: ActorContext): CanonicalNarration | null {
    this.production.assertActor(projectId, actor);
    return this.workspaceCurrent(projectId);
  }

  /** Trusted authenticated host view only; model access must supply an actor to current. */
  workspaceCurrent(projectId: string): CanonicalNarration | null {
    this.store.getProject(projectId);
    const head = this.store.get<{ canonicalId: string }>(canonicalHead, projectId);
    if (!head) return null;
    const record = this.store.get<CanonicalNarration>("narration_canonical", head.canonicalId);
    invariant(record?.projectId === projectId, "NARRATION_INTEGRITY_ERROR", "Canonical narration pointer is invalid");
    return record;
  }

  prepare(projectId: string, actor: ActorContext, input: PrepareNarrationCommit): PreparedNarrationCommit {
    actor = structuredClone(actor); input = structuredClone(input); this.validate(input); this.authority(projectId, actor);
    return this.store.command(`${actor.principalId}:${projectId}:${actor.requestId}:narration-prepare:${epochId(actor) ?? "human"}`, input.key, digest(input), () => {
      this.authority(projectId, actor);
      const before = this.store.getProject(projectId);
      invariant(before.headVersion === input.expectedHeadVersion, "REVISION_CONFLICT", "Project changed before narration preparation");
      const snapshot = this.narration.snapshot(projectId, actor);
      invariant(snapshot.state.version === input.expectedNarrationVersion, "REVISION_CONFLICT", "Narration changed before preparation");
      const projection = this.narration.exportProjection(projectId, actor, { requireAccepted: true });
      this.verifyAcceptances(projectId, snapshot);
      const lock = this.store.get<{ recipeDigest: string; stageContractsDigest: string }>("capability_lock", before.capabilityLockId);
      invariant(lock?.recipeDigest === RECIPE_DIGEST && lock.stageContractsDigest === STAGE_CONTRACTS_DIGEST, "CAPABILITY_MISMATCH", "Unsupported workflow lock");
      const previous = this.current(projectId, actor);
      const mappings = this.mappings(before, previous, input.shotMappings, new Set(projection.segments.map(segment => segment.segmentId)));
      const next = structuredClone(before), oldOwned = new Set(previous?.segments.map(segment => segment.cue.id) ?? []);
      const remainingCues = before.cues.filter(cue => !oldOwned.has(cue.id));
      for (const segment of projection.segments) {
        const existing = remainingCues.find(cue => cue.id === segment.cue.id);
        invariant(!existing || digest(existing) === digest(segment.cue), "NARRATION_INTEGRITY_ERROR", "Narration would replace an unrelated cue identity");
        if (!existing) remainingCues.push(structuredClone(segment.cue));
        const audio = segment.cue.audio, existingArtifact = next.artifacts.find(artifact => artifact.artifactId === audio.artifactId);
        invariant(!existingArtifact || digest(existingArtifact) === digest(audio), "NARRATION_INTEGRITY_ERROR", "Narration artifact identity conflicts with saved bytes");
        if (!existingArtifact) next.artifacts.push(structuredClone(audio));
      }
      next.cues = remainingCues;
      next.narration = { script: snapshot.segments.map(segment => segment.script.text).join("\n\n"), source: this.source(snapshot) };
      invariant(next.narration.script.length <= 16000, "NARRATION_INVALID_INPUT", "Canonical narration exceeds the current script limit");
      const shotImpact: NarrationShotImpact[] = [];
      for (const mapping of mappings) {
        const index = next.shots.findIndex(shot => shot.id === mapping.shotId), shot = next.shots[index]!;
        const oldCue = before.cues.find(cue => cue.id === shot.cueId);
        const cue = mapping.segmentId === null ? undefined : projection.segments.find(segment => segment.segmentId === mapping.segmentId)!.cue;
        const revised = { ...shot, cueId: cue?.id ?? null, desiredFrames: cue?.durationFrames ?? shot.desiredFrames };
        const visualChanged = shotIntentDigest(shot, "video", oldCue) !== shotIntentDigest(revised, "video", cue);
        // Preserve authored text and image intent. Changed consumed meaning/timing
        // must be explicitly reauthored/reconfirmed by the existing change service.
        if (visualChanged) revised.promptIntent = { ...shot.promptIntent, video: "" };
        const changed = digest(revised) !== digest(shot);
        if (changed) next.shots[index] = { ...revised, revisionId: newId() };
        shotImpact.push({ shotId: shot.id, cueId: revised.cueId, visual: visualChanged ? "replan" : "reuse", reason: visualChanged ? "meaning_or_duration" : changed ? "cue_rebound" : "unchanged" });
      }
      invariant(next.shots.every(shot => !shot.cueId || next.cues.some(cue => cue.id === shot.cueId)), "NARRATION_MAPPING_REQUIRED", "A removed cue still has an unmapped shot; detach or remap it explicitly");
      const stages = requiredStages(before, next, null);
      if (!stages.some(stage => stage.stageId === "narration")) stages.push({ stageId: "narration", scopeId: projectId });
      validateStageRequirements(next, stages);
      const prepared: PreparedNarrationCommit = {
        id: newId(), projectId, requestId: actor.requestId, principalId: actor.principalId, epochId: epochId(actor),
        expectedHeadVersion: before.headVersion, expectedNarrationVersion: snapshot.state.version,
        projectDigest: digest(before), snapshotDigest: digest(snapshot), capabilityDigest: digest(lock), previousCanonicalId: previous?.id ?? null,
        projection, snapshot, shotMappings: mappings, shotImpact, next, stages,
        stageVersions: Object.fromEntries(stages.map(stage => { const id = stageId(projectId, stage); return [id, this.store.get<StageBinding>("stage", id)?.bindingVersion ?? 0]; })),
      };
      this.ensureHolds(projectId, actor);
      this.store.insert("narration_prepared", prepared.id, projectId, prepared);
      this.store.appendEvent(projectId, "narration.canonical_prepared", { preparedId: prepared.id, narrationVersion: snapshot.state.version, headVersion: before.headVersion,
        shotImpact: shotImpact.map(impact => ({ ...impact })) });
      return prepared;
    });
  }

  async apply(projectId: string, actor: ActorContext, preparedId: string): Promise<NarrationCommitReceipt> {
    actor = structuredClone(actor); this.authority(projectId, actor);
    const prepared = this.owned(projectId, actor, preparedId);
    const replay = this.store.get<NarrationCommitReceipt>("narration_commit_receipt", preparedId);
    if (replay) return replay;
    this.checkCurrent(prepared, actor);
    invariant(!this.store.db.inTransaction, "ASYNC_TRANSACTION", "Narration artifact verification must run outside SQLite transactions");
    // Writing can retain evidence from an earlier take; timing must still match
    // the selected script/recording. Verify each linked historical selection once.
    const transcriptSelections = new Set<string>();
    for (const view of prepared.snapshot.segments) {
      const links = transcriptCanonicalProvenance(this.store, projectId, view.script, view.cue);
      for (const link of [links?.writing, links?.timing]) if (link) transcriptSelections.add(link.selectionId);
    }
    for (const selectionId of transcriptSelections) {
      const selection = transcriptSelectionRecord<TranscriptSelection>(this.store, "narration_transcript_selection", selectionId, projectId);
      const audio = transcriptSelectionRecord<NarrationAudio>(this.store, "narration_audio", selection.input.audioId, projectId);
      const published = resolvePublishedTranscriptCandidate(this.store, projectId, selection.candidateId);
      await verifyTranscriptSelectionEvidence(this.store, this.narration.media, { artifactDir: this.production.engine.artifactDir }, published, audio);
    }
    const sources = [...new Map(prepared.projection.segments.map(segment => [segment.audioPlacement.source.artifactId, segment.audioPlacement.source])).values()];
    const artifacts: CanonicalNarrationArtifact[] = [];
    const generated: ResolvedGeneratedNarrationAudio[] = [];
    for (const source of sources) {
      const audio = prepared.snapshot.segments.find(view => view.audio?.id === source.artifactId)?.audio;
      if (audio && isVerifiedGeneratedNarrationAudio(audio)) {
        assertGeneratedNarrationAudio(this.store, projectId, audio);
        const resolved = resolveGeneratedNarrationAudio(this.store, projectId, audio.id);
        generated.push(await verifyGeneratedNarrationAudio(this.store, this.narration.media, { artifactDir: this.production.engine.artifactDir }, resolved));
      } else artifacts.push(await installNarrationAudio(this.narration.media, this.production.engine.artifactDir, projectId, source));
    }
    return this.store.transaction(() => {
      this.authority(projectId, actor);
      const replay = this.store.get<NarrationCommitReceipt>("narration_commit_receipt", preparedId);
      if (replay) return replay;
      this.checkCurrent(prepared, actor);
      for (const selected of generated) {
        const current = resolveGeneratedNarrationAudio(this.store, projectId, selected.audio.id);
        invariant(digest(current.audio) === digest(selected.audio) && current.artifactDigest === selected.artifactDigest,
          "NARRATION_INTEGRITY_ERROR", "Generated narration provenance changed during canonical verification");
      }
      for (const artifact of artifacts) {
        const existing = this.store.get<CanonicalNarrationArtifact>("artifact", artifact.id);
        invariant(!existing || (existing.projectId === projectId && digest(existing.artifact) === digest(artifact.artifact) && existing.path === artifact.path && existing.mimeType === artifact.mimeType),
          "NARRATION_INTEGRITY_ERROR", "Audio metadata conflicts with an immutable artifact");
        if (!existing) this.store.insert("artifact", artifact.id, projectId, artifact);
      }
      this.ensureHolds(projectId, actor);
      const next = this.store.saveProject({ ...prepared.next, revisionId: newId() }, prepared.expectedHeadVersion);
      this.store.insert("project_revision", next.revisionId, projectId, { project: next });
      const record: CanonicalNarration = { id: newId(), projectId, projectRevisionId: next.revisionId, headVersion: next.headVersion,
        requestId: actor.requestId, epochId: epochId(actor), preparedId, narrationVersion: prepared.expectedNarrationVersion,
        narrationRevisionId: prepared.snapshot.state.revisionId, projectionDigest: digest(prepared.projection), script: next.narration.script, source: next.narration.source,
        shotMappings: prepared.shotMappings.filter(mapping => mapping.segmentId !== null),
        segments: prepared.projection.segments.map(segment => {
          const view = prepared.snapshot.segments.find(view => view.entry.segmentId === segment.segmentId)!;
          const audio = view.audio!;
          const transcriptProvenance = transcriptCanonicalProvenance(this.store, projectId, view.script, view.cue);
          const nextSegment = { ...segment, ...(transcriptProvenance ? { transcriptProvenance } : {}) };
          if (isVerifiedGeneratedNarrationAudio(audio)) return { ...nextSegment, provenance: createGeneratedNarrationProvenance(audio, {
            scriptAcceptanceId: view.entry.scriptAcceptanceId!, audioAcceptanceId: view.entry.audioAcceptanceId!, timingAcceptanceId: view.entry.timingAcceptanceId! }) };
          return { ...nextSegment, provenance: { audioId: audio.id, declaredOrigin: audio.declaredOrigin, originEvidence: "human_declared_supplied_recording",
            scriptAcceptanceId: view.entry.scriptAcceptanceId!, audioAcceptanceId: view.entry.audioAcceptanceId!, timingAcceptanceId: view.entry.timingAcceptanceId!,
            originalSha256: view.audio!.media.originalSha256, toolchainDigest: view.audio!.media.toolchainDigest } };
        }) };
      this.store.insert("narration_canonical", record.id, projectId, record);
      this.store.put(canonicalHead, projectId, projectId, { canonicalId: record.id });
      this.bindStages(prepared, next);
      for (const artifact of artifacts) this.store.appendEvent(projectId, "artifact.published", { artifactId: artifact.id, narrationCanonicalId: record.id, fixture: false });
      this.store.appendEvent(projectId, "narration.canonical_committed", { preparedId, canonicalId: record.id, revisionId: next.revisionId, headVersion: next.headVersion, narrationVersion: record.narrationVersion,
        shotImpact: prepared.shotImpact.map(impact => ({ ...impact })), matchingPlanInstalled: false });
      const receipt: NarrationCommitReceipt = { id: preparedId, canonicalId: record.id, preparedId, projectId, revisionId: next.revisionId, headVersion: next.headVersion,
        activePlanId: next.activePlanId, narrationVersion: record.narrationVersion, cursor: this.store.cursor(projectId), shotImpact: prepared.shotImpact, requiresMatchingPlan: next.activePlanId !== null };
      this.store.insert("narration_commit_receipt", preparedId, projectId, receipt);
      return receipt;
    });
  }

  private ensureHolds(projectId: string, actor: ActorContext): void {
    this.authority(projectId, actor);
    const request = this.store.get<{ scopeIds: string[] }>("message", actor.requestId)!;
    const held = new Set(this.store.list<{ ownerId: string; scopeId: string; active: boolean }>("hold", projectId)
      .filter(hold => hold.active && hold.ownerId === actor.requestId).map(hold => hold.scopeId));
    for (const scopeId of request.scopeIds) if (!held.has(scopeId)) this.production.engine.setHold(projectId, { scopeId, ownerId: actor.requestId });
  }

  private authority(projectId: string, actor: ActorContext): void {
    this.production.assertActor(projectId, actor, true);
    const request = this.store.get<{ projectId: string; scopeIds: string[] }>("message", actor.requestId);
    invariant(request?.projectId === projectId && request.scopeIds.includes(projectId), "SCOPE_DENIED", "Canonical narration collection changes require project scope");
  }
  private owned(projectId: string, actor: ActorContext, id: string): PreparedNarrationCommit {
    const prepared = this.store.get<PreparedNarrationCommit>("narration_prepared", id);
    invariant(prepared && prepared.projectId === projectId && prepared.principalId === actor.principalId && prepared.requestId === actor.requestId && prepared.epochId === epochId(actor), "ACTOR_DENIED", "Narration preparation belongs to a different request or epoch");
    return prepared;
  }
  private checkCurrent(prepared: PreparedNarrationCommit, actor: ActorContext): void {
    this.authority(prepared.projectId, actor);
    const project = this.store.getProject(prepared.projectId), snapshot = this.narration.snapshot(prepared.projectId, actor);
    invariant(project.headVersion === prepared.expectedHeadVersion && digest(project) === prepared.projectDigest, "REVISION_CONFLICT", "Project changed after narration review");
    invariant(snapshot.state.version === prepared.expectedNarrationVersion && digest(snapshot) === prepared.snapshotDigest, "REVISION_CONFLICT", "Narration changed after review");
    invariant(this.current(prepared.projectId, actor)?.id === (prepared.previousCanonicalId ?? undefined), "REVISION_CONFLICT", "Canonical narration selection changed");
    invariant(digest(this.store.get("capability_lock", project.capabilityLockId) ?? null) === prepared.capabilityDigest, "CAPABILITY_MISMATCH", "Workflow lock changed after preparation");
    this.narration.exportProjection(project.id, actor, { requireAccepted: true }); this.verifyAcceptances(project.id, snapshot);
    validateStageRequirements(prepared.next, prepared.stages);
    for (const [id, version] of Object.entries(prepared.stageVersions)) invariant((this.store.get<StageBinding>("stage", id)?.bindingVersion ?? 0) === version, "STAGE_BINDING_CONFLICT", "Stage binding changed after preparation");
  }
  private verifyAcceptances(projectId: string, snapshot: NarrationSnapshot): void {
    for (const view of snapshot.segments) transcriptCanonicalProvenance(this.store, projectId, view.script, view.cue);
    for (const view of snapshot.segments) if (view.audio && isVerifiedGeneratedNarrationAudio(view.audio)) assertGeneratedNarrationAudio(this.store, projectId, view.audio);
    for (const view of snapshot.segments) for (const kind of ["script", "audio", "timing"] as const) {
      const id = kind === "script" ? view.entry.scriptAcceptanceId : kind === "audio" ? view.entry.audioAcceptanceId : view.entry.timingAcceptanceId;
      const acceptance = id ? this.store.get<NarrationAcceptance>("narration_acceptance", id) : undefined;
      const request = acceptance ? this.store.get<{ projectId: string; principalId: string }>("message", acceptance.requestId) : undefined;
      invariant(view.accepted[kind] && acceptance?.projectId === projectId && request?.projectId === projectId && request.principalId === acceptance.principalId,
        "NARRATION_STALE_ACCEPTANCE", "Canonical narration requires saved human acceptance for each current subject");
    }
  }
  private mappings(project: ProjectRecord, previous: CanonicalNarration | null, updates: NarrationShotMapping[], segments: Set<string>): NarrationShotMapping[] {
    const mappings = new Map<string, string | null>();
    for (const mapping of previous?.shotMappings ?? []) {
      const shot = project.shots.find(shot => shot.id === mapping.shotId);
      if (!shot) continue;
      const expected = previous!.segments.find(segment => segment.segmentId === mapping.segmentId)?.cue.id;
      invariant(shot.cueId === expected || updates.some(update => update.shotId === shot.id), "NARRATION_MAPPING_REQUIRED", "A shot's narration binding changed; explicitly choose its mapping");
      mappings.set(mapping.shotId, mapping.segmentId);
    }
    for (const mapping of updates) { invariant(project.shots.some(shot => shot.id === mapping.shotId), "SCOPE_DENIED", "Narration mapping names an unknown shot"); mappings.set(mapping.shotId, mapping.segmentId); }
    for (const segmentId of mappings.values()) invariant(segmentId === null || segments.has(segmentId), "NARRATION_MAPPING_REQUIRED", "A removed segment needs explicit shot detachment or remapping");
    return [...mappings].map(([shotId, segmentId]) => ({ shotId, segmentId })).sort((a, b) => a.shotId.localeCompare(b.shotId));
  }
  private source(snapshot: NarrationSnapshot): ProjectRecord["narration"]["source"] {
    const origins = new Set(snapshot.segments.map(segment => narrationAudioOrigin(segment.audio!)));
    return origins.size > 1 ? "mixed" : origins.has("generated") ? "generated" : "uploaded";
  }
  private bindStages(prepared: PreparedNarrationCommit, project: ProjectRecord): void {
    for (const stage of prepared.stages) {
      const id = stageId(project.id, stage), previous = this.store.get<StageBinding>("stage", id), inputDigest = stageInputDigest(project, stage), outputDigest = digest([]);
      const bindingVersion = (previous?.bindingVersion ?? 0) + (previous?.inputDigest === inputDigest && previous?.outputDigest === outputDigest ? 0 : 1);
      const binding: StageBinding = { ...stage, id, projectId: project.id, inputDigest, outputDigest, bindingVersion, progressVersion: previous?.progressVersion ?? 0, contractDigest: digest(STAGE_CONTRACTS[stage.stageId]) };
      this.store.put("stage", id, project.id, binding);
      if (bindingVersion !== previous?.bindingVersion) this.store.insert("stage_revision", newId(), project.id, { binding, narrationPreparedId: prepared.id });
    }
  }
  private validate(input: PrepareNarrationCommit): void {
    invariant(input && typeof input === "object" && Object.keys(input).every(key => ["expectedHeadVersion", "expectedNarrationVersion", "shotMappings", "key"].includes(key)), "NARRATION_INVALID_INPUT", "Unknown canonical narration input");
    for (const version of [input.expectedHeadVersion, input.expectedNarrationVersion]) invariant(Number.isSafeInteger(version) && version >= 0, "NARRATION_INVALID_INPUT", "Invalid expected version");
    invariant(typeof input.key === "string" && input.key.length > 0 && input.key.length <= 160, "NARRATION_INVALID_INPUT", "A bounded command key is required");
    invariant(Array.isArray(input.shotMappings) && input.shotMappings.length <= 400, "NARRATION_INVALID_INPUT", "Provide unique bounded shot mappings");
    for (const mapping of input.shotMappings) invariant(mapping && typeof mapping === "object" && Object.keys(mapping).length === 2 && typeof mapping.shotId === "string" && mapping.shotId.length > 0 && mapping.shotId.length <= 160 && (mapping.segmentId === null || typeof mapping.segmentId === "string" && mapping.segmentId.length > 0 && mapping.segmentId.length <= 160), "NARRATION_INVALID_INPUT", "Invalid shot mapping");
    invariant(new Set(input.shotMappings.map(mapping => mapping.shotId)).size === input.shotMappings.length, "NARRATION_INVALID_INPUT", "Provide unique shot mappings");
  }
}
