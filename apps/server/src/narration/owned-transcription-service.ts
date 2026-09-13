import { canonical, composeTranscriptionPlanIsolated, digest, diffPlans, invariant, newId, providerProfileArguments, RECIPE_DIGEST,
  requiredStages, snapshotLocalExecution, STAGE_CONTRACTS_DIGEST, validateStageRequirements } from "@openslate/core";
import type { ActorContext, CompiledPlan, ProviderProfile, StageRequirement } from "@openslate/core";
import type { ArtifactRecord } from "../execution/engine.js";
import { assertAudioOperationOptions, preflightAudioProfile } from "../execution/audio-preflight.js";
import { assertTranscriptionAudioSource } from "../execution/transcription-audio.js";
import { isVerifiedGeneratedNarrationAudio, resolveGeneratedNarrationAudio, verifyGeneratedNarrationAudio } from "./generated-audio.js";
import { assertOwnedTranscriptionSource, assertOwnedTranscriptionProposal, ownedTranscriptionCatalog,
  snapshotOwnedTranscriptionData } from "./owned-transcription-records.js";
import type { OwnedTranscriptionProposal, OwnedTranscriptionSource, OwnedTranscriptionTarget, PrepareOwnedTranscription } from "./owned-transcription-types.js";
import type { NarrationAudio, NarrationState } from "./types.js";
import type { NarrationService } from "./service.js";
import { installNarrationAudio } from "./verified-audio.js";

interface Lock { projectId: string; profiles: ProviderProfile[]; recipeDigest: string; stageContractsDigest: string; localExecution?: unknown }
const stageId = (projectId: string, stage: StageRequirement) => digest({ projectId, stageId: stage.stageId, scopeId: stage.scopeId });
const epoch = (actor: ActorContext): string | null => actor.kind === "director" ? actor.epochId : null;
const exact = (value: object, fields: string[]): boolean => Object.keys(value).sort().join("\0") === [...fields].sort().join("\0");
const id = (value: unknown): value is string => typeof value === "string" && value.length > 0 && Buffer.byteLength(value) <= 160;
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

/** Prepares one recording operation. No generation authority, canonical state or active plan is created. */
export class OwnedTranscriptionService {
  constructor(readonly narration: NarrationService, readonly artifactDir: string) {}
  private get production() { return this.narration.production; }
  private get store() { return this.production.store; }

  private authority(projectId: string, actor: ActorContext): void {
    invariant(actor.kind === "human" || actor.kind === "director", "ACTOR_DENIED", "An application request is required");
    this.production.assertActor(projectId, actor, true);
    const request = this.store.get<{ projectId: string; scopeIds: string[] }>("message", actor.requestId);
    invariant(request?.projectId === projectId && request.scopeIds.includes(projectId), "SCOPE_DENIED", "Recording preparation requires editable project scope");
  }

  private target(projectId: string, input: PrepareOwnedTranscription): OwnedTranscriptionTarget {
    if (input.target.kind === "recording") return { kind: "recording" };
    const state = this.narration.workspaceSnapshot(projectId).state;
    // Read the exact selected entry. A different section using the same audio is unrelated.
    const selected = state.entries.find(item => input.target.kind === "section" && item.segmentId === input.target.segmentId);
    invariant(state.revisionId && selected && selected.segmentRevisionId === input.target.segmentRevisionId
      && selected.audioId === input.audioId && input.target.audioId === input.audioId,
    "OWNED_TRANSCRIPTION_STALE", "The selected narration section or recording changed");
    return { kind: "section", narrationRevisionId: state.revisionId, segmentId: selected.segmentId,
      segmentRevisionId: selected.segmentRevisionId, audioId: input.audioId };
  }

  private currentTarget(projectId: string, target: OwnedTranscriptionTarget): void {
    if (target.kind === "recording") return;
    const state = this.store.get<NarrationState>("narration_state", projectId);
    const entry = state?.entries.find(item => item.segmentId === target.segmentId);
    invariant(entry?.segmentRevisionId === target.segmentRevisionId && entry.audioId === target.audioId,
      "OWNED_TRANSCRIPTION_STALE", "The selected narration section or recording changed");
  }

  async prepare(projectId: string, actor: ActorContext, input: PrepareOwnedTranscription,
    options: { signal?: AbortSignal } = {}): Promise<OwnedTranscriptionProposal> {
    const signal = options.signal, artifactDir = this.artifactDir, cancellation = signal ? { signal } : {};
    const stopped = () => invariant(!signal?.aborted, "OWNED_TRANSCRIPTION_CANCELLED", "Recording preparation was cancelled");
    try {
      stopped(); actor = snapshotOwnedTranscriptionData(actor, 16384); input = snapshotOwnedTranscriptionData(input, 16384);
      this.authority(projectId, actor);
      invariant(input && exact(input, ["key", "expectedHeadVersion", "audioId", "sourceRecordDigest", "profileId", "language", "target"])
        && id(input.key) && id(input.audioId) && hash(input.sourceRecordDigest) && id(input.profileId)
        && typeof input.language === "string" && input.language.length > 0 && Buffer.byteLength(input.language) <= 64
        && Number.isSafeInteger(input.expectedHeadVersion) && input.expectedHeadVersion >= 0 && input.target
        && (input.target.kind === "recording" && exact(input.target, ["kind"])
          || input.target.kind === "section" && exact(input.target, ["kind", "segmentId", "segmentRevisionId", "audioId"])
          && id(input.target.segmentId) && id(input.target.segmentRevisionId) && input.target.audioId === input.audioId),
      "OWNED_TRANSCRIPTION_INVALID", "Choose one exact owned recording, target, profile and language");
      const inputDigest = digest(input), scope = `${actor.principalId}:${projectId}:${actor.requestId}:owned-transcription:${epoch(actor) ?? "human"}`;
      const replay = this.store.commandReplay<OwnedTranscriptionProposal>(scope, input.key, inputDigest);
      if (replay) { this.production.recovery.assertFreshAuthority(projectId, "owned_transcription_proposal", replay.result.id); return replay.result; }
      const captured = this.store.transaction(() => {
        this.authority(projectId, actor);
        const before = this.store.getProject(projectId);
        invariant(before.headVersion === input.expectedHeadVersion, "REVISION_CONFLICT", "Project changed before recording preparation");
        const lock = this.store.get<Lock>("capability_lock", before.capabilityLockId);
        invariant(lock?.projectId === projectId && lock.recipeDigest === RECIPE_DIGEST && lock.stageContractsDigest === STAGE_CONTRACTS_DIGEST,
          "CAPABILITY_MISMATCH", "Project workflow lock is unsupported");
        const profile = lock.profiles.find(item => item.id === input.profileId);
        invariant(profile?.kind === "transcription", "OWNED_TRANSCRIPTION_INVALID", "Choose an installed transcription profile");
        preflightAudioProfile(profile);
        assertAudioOperationOptions(profile, { ...providerProfileArguments(profile), language: input.language, timing: "word", settings: {} });
        const audio = this.store.get<NarrationAudio>("narration_audio", input.audioId);
        invariant(audio?.projectId === projectId && digest(audio) === input.sourceRecordDigest,
          "OWNED_TRANSCRIPTION_STALE", "The exact owned recording is unavailable or changed");
        assertTranscriptionAudioSource(audio.media);
        const generated = isVerifiedGeneratedNarrationAudio(audio) ? resolveGeneratedNarrationAudio(this.store, projectId, audio.id) : null;
        const target = this.target(projectId, input);
        const base = before.activePlanId ? this.store.get<{ id: string; projectId: string; compiled: CompiledPlan }>("plan", before.activePlanId) : null;
        invariant(!before.activePlanId || base?.projectId === projectId, "OWNED_TRANSCRIPTION_STALE", "Active plan is missing or changed");
        const logicalIds = { ...(this.store.get<{ aliases: Record<string, string> }>("logical_ids", projectId)?.aliases ?? {}) };
        const stages = new Map(this.store.list<{ id: string; bindingVersion: number }>("stage", projectId).map(stage => [stage.id, stage.bindingVersion]));
        const artifact = this.store.get<ArtifactRecord>("artifact", input.audioId);
        return { before, lock, profile, audio, generated, target, base, logicalIds, stages, artifact,
          catalog: ownedTranscriptionCatalog(this.store, projectId, base?.compiled ?? null) };
      });
      const current = (): void => {
        stopped(); this.authority(projectId, actor);
        invariant(canonical(this.store.getProject(projectId)) === canonical(captured.before), "REVISION_CONFLICT", "Project changed during recording preparation");
        invariant(canonical(this.store.get("capability_lock", captured.before.capabilityLockId)) === canonical(captured.lock),
          "CAPABILITY_MISMATCH", "Project capability lock changed");
        invariant(digest(this.store.get("narration_audio", input.audioId) ?? null) === input.sourceRecordDigest,
          "OWNED_TRANSCRIPTION_STALE", "The selected recording changed");
        this.currentTarget(projectId, captured.target);
      };
      const media = this.narration.media;
      if (captured.generated) {
        await verifyGeneratedNarrationAudio(this.store, media, { artifactDir }, captured.generated, cancellation); current();
      }
      const installed = await installNarrationAudio(media, artifactDir, projectId, captured.audio.media, cancellation); current();
      const artifact = captured.artifact ?? installed;
      invariant(captured.generated ? canonical(artifact) === canonical(captured.generated.artifact) : canonical(artifact) === canonical(installed),
        "OWNED_TRANSCRIPTION_STALE", "Existing recording artifact differs from its verified source provenance");
      const sourceId = newId(), consumerAlias = `transcribe-${sourceId}`;
      const binding: OwnedTranscriptionSource = { id: sourceId, version: 1, projectId, requestId: actor.requestId,
        principalId: actor.principalId, epochId: epoch(actor), consumerAlias,
        sourceRecord: { kind: "narration_audio", id: captured.audio.id, digest: input.sourceRecordDigest }, source: captured.audio.media,
        sourceStartSample: 0, sourceEndSample: captured.audio.media.probe.audio!.samples!, artifact: installed.artifact,
        artifactRecordDigest: digest(artifact), target: captured.target };
      const operation = { alias: consumerAlias, profileId: captured.profile.id, inputBindingId: binding.id, language: input.language };
      const localExecution = Object.hasOwn(captured.lock, "localExecution") ? snapshotLocalExecution(captured.lock.localExecution) : undefined;
      const compiled = await composeTranscriptionPlanIsolated(captured.base?.compiled ?? null, operation,
        { project: captured.before, profiles: captured.lock.profiles, logicalIds: captured.logicalIds, allocateId: newId,
          transcriptionInputs: [...captured.catalog, { id: binding.id, digest: digest(binding), consumerAlias, artifact: binding.artifact }],
          ...(localExecution ? { localExecution } : {}) }, cancellation); current();
      assertAudioOperationOptions(captured.profile, compiled.nodes.find(node => node.alias === consumerAlias)!.args);
      const stages = requiredStages(captured.before, captured.before, compiled); validateStageRequirements(captured.before, stages);
      const stageVersions = Object.fromEntries(stages.map(stage => { const id = stageId(projectId, stage); return [id, captured.stages.get(id) ?? 0]; }));
      const proposal: OwnedTranscriptionProposal = { id: newId(), version: 1, state: "ungranted", projectId,
        requestId: actor.requestId, principalId: actor.principalId, epochId: epoch(actor), inputDigest,
        baseProject: { revisionId: captured.before.revisionId, headVersion: captured.before.headVersion, digest: digest(captured.before) },
        basePlan: captured.base ? { id: captured.base.id, digest: digest(captured.base.compiled) } : null,
        capabilityLock: { id: captured.before.capabilityLockId, digest: digest(captured.lock) }, sourceBinding: { id: binding.id, digest: digest(binding) },
        profile: captured.profile, operation, compiled, logicalIds: captured.logicalIds, impact: diffPlans(captured.base?.compiled ?? null, compiled), stages, stageVersions };
      return this.store.transaction(() => {
        stopped(); this.authority(projectId, actor);
        return this.store.command(scope, input.key, inputDigest, () => {
          current();
          for (const [id, version] of Object.entries(stageVersions)) invariant((this.store.get<{ bindingVersion: number }>("stage", id)?.bindingVersion ?? 0) === version,
            "STAGE_BINDING_CONFLICT", "Stage binding changed during recording preparation");
          const existing = this.store.get<ArtifactRecord>("artifact", input.audioId);
          invariant(!existing || canonical(existing) === canonical(artifact), "OWNED_TRANSCRIPTION_STALE", "Recording artifact changed during preparation");
          if (!existing) this.store.insert("artifact", artifact.id, projectId, artifact);
          assertOwnedTranscriptionSource(this.store, projectId, binding); this.store.insert("owned_transcription_source", binding.id, projectId, binding);
          assertOwnedTranscriptionProposal(this.store, projectId, proposal); this.store.insert("owned_transcription_proposal", proposal.id, projectId, proposal);
          this.store.appendEvent(projectId, "narration.transcription_proposed", { proposalId: proposal.id, sourceBindingId: binding.id,
            audioId: input.audioId, profileId: captured.profile.id, state: "ungranted" });
          stopped();
          return proposal;
        });
      });
    } finally { stopped(); }
  }
}
