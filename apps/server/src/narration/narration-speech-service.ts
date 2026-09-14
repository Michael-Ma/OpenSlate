import { canonical, composeSpeechPlanIsolated, digest, diffPlans, invariant, newId, providerProfileArguments, RECIPE_DIGEST,
  requiredStages, snapshotLocalExecution, STAGE_CONTRACTS_DIGEST, validateStageRequirements } from "@openslate/core";
import type { ActorContext, CompiledPlan, CompileContext, ProviderProfile, StageRequirement } from "@openslate/core";
import { OPENAI_SPEECH_BUDGET } from "@openslate/providers";
import { assertAudioOperationOptions, preflightAudioProfile } from "../execution/audio-preflight.js";
import { ownedTranscriptionCatalog, snapshotOwnedTranscriptionData } from "./owned-transcription-records.js";
import { assertNarrationSpeechProposal, resolveNarrationSpeechSection } from "./narration-speech-records.js";
import { captureNarrationSpeechReviewInput, currentNarrationSpeechReview, narrationSpeechPrepareScope, narrationSpeechReviewScope } from "./narration-speech-review-state.js";
import type { NarrationSpeechApplyReceipt, NarrationSpeechOperation, NarrationSpeechProposal, NarrationSpeechSection, PrepareNarrationSpeech, ReviewNarrationSpeech } from "./narration-speech-types.js";
import type { NarrationState, SegmentRevision } from "./types.js";
import type { NarrationService } from "./service.js";
export { narrationSpeechPrepareScope } from "./narration-speech-review-state.js";

interface Lock { projectId: string; profiles: ProviderProfile[]; recipeDigest: string; stageContractsDigest: string; localExecution?: unknown }
const stageId = (projectId: string, stage: StageRequirement) => digest({ projectId, stageId: stage.stageId, scopeId: stage.scopeId });
const id = (value: unknown): value is string => typeof value === "string" && value.length > 0 && Buffer.byteLength(value) <= 160;
const epoch = (actor: ActorContext): string | null => actor.kind === "director" ? actor.epochId : null;

/** Prepare exact saved writing; review is human-only and spending is always a separate service. */
export class NarrationSpeechService {
  constructor(readonly narration: NarrationService) {}
  private get production() { return this.narration.production; }
  private get store() { return this.production.store; }
  private authority(projectId: string, actor: ActorContext): void {
    invariant(actor.kind === "human" || actor.kind === "director", "ACTOR_DENIED", "An application request is required");
    this.production.assertActor(projectId, actor, true);
    const request = this.store.get<{ projectId: string; scopeIds: string[] }>("message", actor.requestId);
    invariant(request?.projectId === projectId && request.scopeIds.includes(projectId), "SCOPE_DENIED", "Narration preparation requires editable project scope");
  }
  private compose(base: CompiledPlan | null, operation: NarrationSpeechOperation, context: CompileContext, options: { signal?: AbortSignal }) {
    return composeSpeechPlanIsolated(base, operation, context, options);
  }
  private selected(projectId: string, section: NarrationSpeechSection): void {
    const entry = this.store.get<NarrationState>("narration_state", projectId)?.entries.find(item => item.segmentId === section.segmentId);
    invariant(entry?.segmentRevisionId === section.segmentRevisionId, "NARRATION_SPEECH_STALE", "The selected narration section changed");
    resolveNarrationSpeechSection(this.store, projectId, section);
  }
  async prepare(projectId: string, actor: ActorContext, input: PrepareNarrationSpeech, options: { signal?: AbortSignal } = {}): Promise<NarrationSpeechProposal> {
    const signal = options.signal, cancellation = signal ? { signal } : {};
    const stopped = (): void => invariant(!signal?.aborted, "NARRATION_SPEECH_CANCELLED", "Narration preparation was cancelled");
    try {
      stopped(); actor = snapshotOwnedTranscriptionData(actor, 16384); input = snapshotOwnedTranscriptionData(input, 16384); this.authority(projectId, actor);
      invariant(input && Object.keys(input).sort().join("\0") === ["key", "expectedHeadVersion", "segmentId", "segmentRevisionId", "profileId", "voice", "instructions"].sort().join("\0")
        && [input.key, input.segmentId, input.segmentRevisionId, input.profileId, input.voice].every(id)
        && typeof input.instructions === "string" && input.instructions.length <= 16000
        && Number.isSafeInteger(input.expectedHeadVersion) && input.expectedHeadVersion >= 0,
      "NARRATION_SPEECH_INVALID", "Choose an exact saved section, voice, profile and delivery instructions");
      const inputDigest = digest(input), scope = narrationSpeechPrepareScope(projectId, actor);
      const replay = this.store.commandReplay<NarrationSpeechProposal>(scope, input.key, inputDigest);
      if (replay) { this.production.recovery.assertFreshAuthority(projectId, "narration_speech_proposal", replay.result.id); return replay.result; }
      const captured = this.store.transaction(() => {
        this.authority(projectId, actor); const before = this.store.getProject(projectId);
        invariant(before.headVersion === input.expectedHeadVersion, "REVISION_CONFLICT", "Project changed before narration preparation");
        const lock = this.store.get<Lock>("capability_lock", before.capabilityLockId);
        invariant(lock?.projectId === projectId && lock.recipeDigest === RECIPE_DIGEST && lock.stageContractsDigest === STAGE_CONTRACTS_DIGEST,
          "CAPABILITY_MISMATCH", "Project workflow lock is unsupported");
        const profile = lock.profiles.find(item => item.id === input.profileId);
        invariant(profile?.kind === "speech", "NARRATION_SPEECH_INVALID", "Choose an installed narration speech profile"); preflightAudioProfile(profile);
        const state = this.narration.workspaceSnapshot(projectId).state, entry = state.entries.find(item => item.segmentId === input.segmentId);
        const script = this.store.get<SegmentRevision>("narration_segment", input.segmentRevisionId);
        invariant(state.revisionId && entry?.segmentRevisionId === input.segmentRevisionId && script?.projectId === projectId,
          "NARRATION_SPEECH_STALE", "The exact saved narration section is unavailable or changed");
        const section: NarrationSpeechSection = { narrationRevisionId: state.revisionId, segmentId: input.segmentId,
          segmentRevisionId: input.segmentRevisionId, segmentDigest: digest(script) };
        resolveNarrationSpeechSection(this.store, projectId, section);
        invariant(script.source.kind === "generated" && (script.source.voice === null || script.source.voice === input.voice)
          && (script.source.profileRevisionId === null || script.source.profileRevisionId === profile.revision),
        "NARRATION_SPEECH_SOURCE_MISMATCH", "Edit the saved section's voice or profile choice before preparing a different one");
        invariant(Buffer.byteLength(input.instructions) <= OPENAI_SPEECH_BUDGET.maxInstructionBytes,
          "NARRATION_SPEECH_DELIVERY_LIMIT", "Shorten the delivery instructions before preparing this section");
        const bytes = Buffer.byteLength(script.text) + Buffer.byteLength(input.instructions) + Buffer.byteLength(String(profile.configuration!.model)) + Buffer.byteLength(input.voice);
        invariant(script.text.length <= OPENAI_SPEECH_BUDGET.maxInputCodeUnits && bytes <= OPENAI_SPEECH_BUDGET.maxTotalBytes,
          "NARRATION_SPEECH_SPLIT_REQUIRED", "This saved section exceeds one speech request. Split it into explicit shorter sections and review their words before preparing them");
        assertAudioOperationOptions(profile, { ...providerProfileArguments(profile), text: script.text, voice: input.voice, instructions: input.instructions, settings: {} });
        const base = before.activePlanId ? this.store.get<{ id: string; projectId: string; compiled: CompiledPlan }>("plan", before.activePlanId) : null;
        invariant(!before.activePlanId || base?.projectId === projectId, "NARRATION_SPEECH_STALE", "Active plan is missing or changed");
        const logicalIds = { ...(this.store.get<{ aliases: Record<string, string> }>("logical_ids", projectId)?.aliases ?? {}) };
        const stages = new Map(this.store.list<{ id: string; bindingVersion: number }>("stage", projectId).map(stage => [stage.id, stage.bindingVersion]));
        return { before, lock, profile, section, script, base, logicalIds, stages, catalog: ownedTranscriptionCatalog(this.store, projectId, base?.compiled ?? null) };
      });
      const current = (): void => {
        stopped(); this.authority(projectId, actor);
        invariant(canonical(this.store.getProject(projectId)) === canonical(captured.before), "REVISION_CONFLICT", "Project changed during narration preparation");
        invariant(canonical(this.store.get("capability_lock", captured.before.capabilityLockId)) === canonical(captured.lock), "CAPABILITY_MISMATCH", "Project capability lock changed");
        this.selected(projectId, captured.section);
      };
      const operation = { alias: `narrate-${newId()}`, profileId: captured.profile.id, text: captured.script.text, voice: input.voice, instructions: input.instructions };
      const localExecution = Object.hasOwn(captured.lock, "localExecution") ? snapshotLocalExecution(captured.lock.localExecution) : undefined;
      const compiled = await this.compose(captured.base?.compiled ?? null, operation, { project: captured.before, profiles: captured.lock.profiles,
        logicalIds: captured.logicalIds, allocateId: newId, ...(captured.catalog.length ? { transcriptionInputs: captured.catalog } : {}),
        ...(localExecution ? { localExecution } : {}) }, cancellation); current();
      const stages = requiredStages(captured.before, captured.before, compiled); validateStageRequirements(captured.before, stages);
      const stageVersions = Object.fromEntries(stages.map(stage => { const id = stageId(projectId, stage); return [id, captured.stages.get(id) ?? 0]; }));
      const proposal: NarrationSpeechProposal = { id: newId(), version: 1, state: "ungranted", projectId, requestId: actor.requestId,
        principalId: actor.principalId, epochId: epoch(actor), inputDigest, baseProject: { revisionId: captured.before.revisionId, headVersion: captured.before.headVersion, digest: digest(captured.before) },
        basePlan: captured.base ? { id: captured.base.id, digest: digest(captured.base.compiled) } : null,
        capabilityLock: { id: captured.before.capabilityLockId, digest: digest(captured.lock) }, section: captured.section, profile: captured.profile,
        operation, compiled, logicalIds: captured.logicalIds, impact: diffPlans(captured.base?.compiled ?? null, compiled), stages, stageVersions };
      return this.store.transaction(() => {
        stopped(); this.authority(projectId, actor);
        return this.store.command(scope, input.key, inputDigest, () => {
          current(); for (const [id, version] of Object.entries(stageVersions)) invariant((this.store.get<{ bindingVersion: number }>("stage", id)?.bindingVersion ?? 0) === version,
            "STAGE_BINDING_CONFLICT", "Stage binding changed during narration preparation");
          assertNarrationSpeechProposal(this.store, projectId, proposal); this.store.insert("narration_speech_proposal", proposal.id, projectId, proposal);
          this.store.appendEvent(projectId, "narration.speech_proposed", { proposalId: proposal.id, segmentId: proposal.section.segmentId,
            segmentRevisionId: proposal.section.segmentRevisionId, profileId: proposal.profile.id, state: "ungranted" }); stopped(); return proposal;
        });
      });
    } finally { stopped(); }
  }
  async review(projectId: string, human: ActorContext, input: ReviewNarrationSpeech, options: { signal?: AbortSignal } = {}): Promise<NarrationSpeechApplyReceipt> {
    const signal = options.signal, cancellation = signal ? { signal } : {};
    const stopped = (): void => invariant(!signal?.aborted, "NARRATION_SPEECH_CANCELLED", "Narration review was cancelled");
    try {
      stopped(); human = snapshotOwnedTranscriptionData(human, 16384); input = captureNarrationSpeechReviewInput(input);
      const scope = narrationSpeechReviewScope(projectId, human), inputDigest = digest(input);
      const checkpoint = (): NarrationSpeechApplyReceipt | undefined => {
        stopped(); invariant(human.kind === "human", "ACTOR_DENIED", "Only a human can approve narration speech"); this.authority(projectId, human);
        this.production.recovery.assertFreshAuthority(projectId, "narration_speech_proposal", input.proposalId);
        const replay = this.store.commandReplay<NarrationSpeechApplyReceipt>(scope, input.key, inputDigest); if (replay) return replay.result;
        currentNarrationSpeechReview(this.store, projectId, input); return undefined;
      };
      let replay = checkpoint(); if (replay) return replay;
      const captured = currentNarrationSpeechReview(this.store, projectId, input), { proposal } = captured, logicalIds = { ...proposal.logicalIds };
      const localExecution = Object.hasOwn(captured.lock, "localExecution") ? snapshotLocalExecution(captured.lock.localExecution) : undefined;
      const catalog = ownedTranscriptionCatalog(this.store, projectId, captured.base?.compiled ?? null);
      const compiled = await this.compose(captured.base?.compiled ?? null, proposal.operation, { project: captured.before, profiles: captured.lock.profiles,
        logicalIds, allocateId: () => { throw Error("Human review cannot allocate another operation"); }, ...(catalog.length ? { transcriptionInputs: catalog } : {}),
        ...(localExecution ? { localExecution } : {}) }, cancellation);
      replay = checkpoint(); if (replay) return replay;
      invariant(canonical(compiled) === canonical(proposal.compiled) && canonical(logicalIds) === canonical(proposal.logicalIds),
        "NARRATION_SPEECH_STALE", "Saved speech code no longer reproduces the exact reviewed plan");
      return this.production.commitNarrationSpeechReview(projectId, human, input, cancellation);
    } finally { stopped(); }
  }
}
