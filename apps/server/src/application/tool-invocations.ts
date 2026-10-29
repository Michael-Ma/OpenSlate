import type { DirectorGenerationEffectRecord } from "./director-generation-effects.js";
import { hasDirectorAudioAttachment, startDirectorAttachmentTranscription, readDirectorAttachmentTranscription, type DirectorAttachmentTranscriptionRecord } from "./director-attachment-transcription.js";
import { makeDirectorKeyframes, type DirectorKeyframesReceipt } from "./director-keyframes.js";
import { assertDirectorGenerationAuthority } from "./director-generation-authority.js";
import { SceneConfirmationRunner } from "../scene-confirmations.js";
import { NarrationCanonicalService } from "../narration/canonical.js";
import type { EnqueueSceneVoice } from "../scene-generation.js";
import { assertDirectorProposalDecisionAuthority, decideProposal, proposeChange } from "./director-proposals.js";
import type { ProposalPatch } from "@openslate/core";
import { recordNotes, recordStyleProposal, type NoteInput, type StyleProposalInput } from "./director-notes.js";
import { isShippedDirectorRelease, SHIPPED_DIRECTOR_GUIDANCE } from "./director-shipped-guidance.js";
import { readGuidance, type ReadGuidanceInput } from "./director-guidance-reads.js";
import { SUPPORTED_TOOL_CONTRACTS } from "@openslate/core";
import { canonical, digest, DomainError, invariant, parseToolArguments, toolCatalog, toolHandlerId } from "@openslate/core";
import type { ActorContext, JsonValue, ToolName, ToolContractVersion, ReviewNotesFailure } from "@openslate/core";
import type { SkillCapabilityLock } from "@openslate/director";
import type { ProductionService } from "./service.js";
import { NarrationService } from "../narration/service.js";
import type { NarrationSnapshot, ReviseSegments } from "../narration/types.js";
import type { OwnedTranscriptionService } from "../narration/owned-transcription-service.js";
import type { PrepareOwnedTranscription } from "../narration/owned-transcription-types.js";
import type { NarrationSpeechService } from "../narration/narration-speech-service.js";
import type { PrepareNarrationSpeech } from "../narration/narration-speech-types.js";
import { resolveNarrationSpeechApplication } from '../narration/narration-speech-authorization.js';
import { resolveOwnedTranscriptionApplication } from '../narration/owned-transcription-authorization.js';
import type { Store } from '../persistence/store.js';
import { toolContractAtLeast, hasCharacterPatchFields } from "@openslate/core";
import type { ChangeProposal } from "@openslate/core";
import { moveScene, moveShot, requestDeleteScene, requestDeleteShots, requestResume, requestUseTake, setSoundtrack, startExport, stopFilm, undoEdit,
  type SetSoundtrackInput } from './director-edits.js';
import { applyCharacterChange, makeCharacterSheets, readCharacters, type CharacterChangeInput } from './character-tools.js';
import { analyzeMusic, LocalMusicAnalyzer, type MusicAnalyzers } from '../media/music-analyzer.js';
import type { ExportLauncher } from '../media/export-launcher.js';

export const TOOL_RESULT_MAX_BYTES = 1024 * 1024;
export interface ToolInvocation {
  id: string;
  projectId: string;
  requestId: string;
  epochId: string;
  callId: string;
  tool: ToolName;
  /** Absent on legacy V1 receipts only. An epoch's selection can never change. */
  toolContractVersion?: ToolContractVersion;
  catalogDigest?: string;
  skillLockId?: string | null;
  argumentsDigest: string;
  state: "started" | "succeeded" | "failed" | "unresolved";
  result: JsonValue | null;
  resultDigest: string | null;
  error: { code: string; message: string; reason?: ReviewNotesFailure['reason'] } | null;
  /** Minimal domain correlation; credentials and full context never belong here. */
  recovery?: { preparedId?: string; proposalDigest?: string; narrationCommand?: { key: string; digest: string };
    audioProposalCommand?: { kind: "recording_transcription" | "narration_speech"; key: string; digest: string; requested?: boolean; suggested?: boolean } };
}

/** Full text and media descriptors stay in domain storage and paged context, never this receipt. */
function narrationReceipt(snapshot: NarrationSnapshot) {
  const { state, readiness } = snapshot;
  return { version: state.version, revisionId: state.revisionId, canonicalApplied: false,
    segments: state.entries.map(entry => ({ segmentId: entry.segmentId, segmentRevisionId: entry.segmentRevisionId })),
    readiness: { text: readiness.text, audio: readiness.audio, timing: readiness.timing,
      gapCounts: Object.fromEntries([...new Set(readiness.gaps.map(gap => gap.category))].map(category => [category, readiness.gaps.filter(gap => gap.category === category).length])) },
    next: "Read narration context; human review accepts exact script, recording and timing. No canonical state, grants or holds changed." };
}

const audioTool = (name: string): name is "prepare_recording_transcription" | "prepare_narration_speech" =>
  name === "prepare_recording_transcription" || name === "prepare_narration_speech";
const audioKind = (name: string): "recording_transcription" | "narration_speech" => name === "prepare_recording_transcription" ? "recording_transcription" : "narration_speech";
const AUDIO_PROPOSAL_MAX_BYTES = 16 * 1024 ** 2;
/** A proposal identity directs human review; it is never an apply_change identity or spending authority. */
function audioProposalReceipt(value: unknown, kind: "recording_transcription" | "narration_speech", projectId: string, actor: Pick<ActorContext, "principalId" | "requestId">, epochId: string, inputDigest: string) {
  invariant(value && typeof value === "object" && !Array.isArray(value), "TOOL_CALL_UNRESOLVED", "Audio proposal receipt is unavailable");
  const proposal = value as Record<string, unknown>;
  invariant(typeof proposal.id === "string" && proposal.id.length > 0 && proposal.id.length <= 160 && proposal.projectId === projectId
    && proposal.principalId === actor.principalId && proposal.requestId === actor.requestId && proposal.epochId === epochId
    && proposal.inputDigest === inputDigest && proposal.state === "ungranted" && Buffer.byteLength(canonical(proposal)) <= AUDIO_PROPOSAL_MAX_BYTES,
    "TOOL_CALL_UNRESOLVED", "Audio proposal differs from its exact originating request");
  return { id: proposal.id, proposalId: proposal.id, proposalDigest: digest(proposal), kind, state: "ungranted",
    next: "Read audio_operations for the saved proposal. A human must press the existing audio request action to generate this suggestion. No job, grant, reservation, attachment, adoption or acceptance was created." };
}

/** A durable suggestion is displayable and replayable, but carries no execution authority. */
function pendingAudioReceipt(store: Store, value: unknown, kind: 'recording_transcription' | 'narration_speech', projectId: string,
  actor: Pick<ActorContext, 'principalId' | 'requestId'>, epochId: string, inputDigest: string, commandKey: string) {
  let preparedDigest = inputDigest;
  if (kind === 'narration_speech') {
    const normalized = store.db.prepare('SELECT result FROM commands WHERE actor_scope=? AND key=? AND digest=?')
      .get(`${actor.principalId}:${projectId}:${actor.requestId}:narration-speech-request:${epochId}-input`, commandKey, inputDigest) as { result: string } | undefined;
    if (normalized) preparedDigest = digest(JSON.parse(normalized.result));
  }
  const receipt = audioProposalReceipt(value, kind, projectId, actor, epochId, preparedDigest);
  const id = digest({ purpose: 'director_audio_suggestion', projectId, proposalId: receipt.proposalId });
  return store.transaction(() => {
    const suggestion = store.get<{ id: string; action: { kind: string; proposalId: string; proposalDigest: string } }>('director_audio_request', id)
      ?? store.insert('director_audio_request', id, projectId, { id, projectId, requestId: actor.requestId, epochId,
        source: 'director', state: 'pending', title: kind === 'narration_speech' ? 'The Director suggests making this voice line.' : 'The Director suggests transcribing this recording.', proposalId: receipt.proposalId, proposalDigest: receipt.proposalDigest,
        action: { kind: kind === 'narration_speech' ? 'request_speech' : 'request_transcription', proposalId: receipt.proposalId, proposalDigest: receipt.proposalDigest } });
    return { ...receipt, pendingRequestId: suggestion.id, action: suggestion.action };
  });
}

/** The transport describes already-published application evidence, never an inferred provider result. */
function audioRequestReceipt(store: Store, value: unknown, applied: unknown, kind: 'recording_transcription' | 'narration_speech', projectId: string,
  actor: Pick<ActorContext, 'principalId' | 'requestId'>, epochId: string, inputDigest: string, commandKey: string) {
  let preparedDigest = inputDigest;
  if (kind === 'narration_speech') {
    const normalized = store.db.prepare('SELECT result FROM commands WHERE actor_scope=? AND key=? AND digest=?')
      .get(`${actor.principalId}:${projectId}:${actor.requestId}:narration-speech-request:${epochId}-input`, commandKey, inputDigest) as { result: string } | undefined;
    if (normalized) preparedDigest = digest(JSON.parse(normalized.result));
  }
  const proposal = audioProposalReceipt(value, kind, projectId, actor, epochId, preparedDigest), receipt = applied as { proposalId?: unknown; proposalDigest?: unknown; candidateId?: unknown; reviewId?: unknown };
  invariant(receipt?.proposalId === proposal.proposalId && receipt.proposalDigest === proposal.proposalDigest && typeof receipt.candidateId === 'string',
    'TOOL_CALL_UNRESOLVED', 'Audio request publication differs from its saved input.');
  const resolved = kind === 'narration_speech' ? resolveNarrationSpeechApplication(store, projectId, receipt.candidateId)
    : resolveOwnedTranscriptionApplication(store, projectId, receipt.candidateId);
  invariant(resolved.proposal.id === proposal.proposalId && digest(resolved.proposal) === proposal.proposalDigest && resolved.review.id === receipt.reviewId,
    'TOOL_CALL_UNRESOLVED', 'Audio request lost its exact application evidence.');
  return { ...proposal, state: 'requested', applicationId: resolved.application.id, candidateId: resolved.application.id,
    operationId: resolved.review.nodeId, activePlanId: resolved.application.receipt.activePlanId,
    next: 'The requested audio operation is saved for execution. Follow its original job identity. Listening, transcript adoption and timing acceptance remain content decisions.' };
}

/** Transport receipts supplement, but never replace, domain command/grant deduplication. */
export class ToolInvocationService {
  readonly narration: NarrationService;
  readonly #ownedTranscription: OwnedTranscriptionService | undefined;
  readonly #narrationSpeech: NarrationSpeechService | undefined;
  readonly #enqueueVoice: EnqueueSceneVoice;
  readonly #exports: ExportLauncher | undefined;
  readonly #music: MusicAnalyzers;
  constructor(readonly service: ProductionService, options: { ownedTranscription?: OwnedTranscriptionService; narrationSpeech?: NarrationSpeechService; enqueueVoice?: EnqueueSceneVoice;
    /** Media-capable narration for local song analysis. */ mediaNarration?: NarrationService; exports?: ExportLauncher;
    /** Override the analyzer slots; the default is the local timing analyzer with no enrichment. */ musicAnalyzers?: MusicAnalyzers } = {}) {
    this.narration = new NarrationService(service);
    this.#exports = options.exports;
    this.#music = options.musicAnalyzers ?? { local: new LocalMusicAnalyzer(service, options.mediaNarration) };
    this.#ownedTranscription = options.ownedTranscription; this.#narrationSpeech = options.narrationSpeech;
    this.#enqueueVoice = options.enqueueVoice ?? new SceneConfirmationRunner(service, options.narrationSpeech ? {
      narration: this.narration, canonical: new NarrationCanonicalService(this.narration), narrationSpeech: options.narrationSpeech,
    } : undefined).enqueueKeyframes;
    invariant([this.#ownedTranscription, this.#narrationSpeech].every(port => !port || port.narration.production === service),
      "TOOL_CONFIGURATION_INVALID", "Audio proposal tools must use this application's production service");
  }

  private catalog(projectId: string, actor: ActorContext) {
    invariant(actor.kind === "director", "ACTOR_DENIED", "A director epoch is required");
    const binding = this.service.store.get<{ projectId: string; requestId: string; lockId: string }>("director_epoch_lock", actor.epochId);
    // Earlier tool integrations did not persist a skill activation. They retain V1 only.
    if (!binding) return { catalog: toolCatalog("1.0.0"), lockId: null, audioRequests: false };
    invariant(binding.projectId === projectId && binding.requestId === actor.requestId, "CAPABILITY_MISMATCH", "Tool epoch lock belongs to different work");
    const record = this.service.store.get<{ projectId: string; lock: SkillCapabilityLock }>("director_skill_lock", binding.lockId);
    invariant(record?.projectId === projectId && record.lock.id === binding.lockId, "CAPABILITY_MISMATCH", "Tool skill lock is missing or belongs to another project");
    const { lockDigest, ...body } = record.lock;
    invariant(digest(body) === lockDigest, "CAPABILITY_MISMATCH", "Tool skill lock content changed");
    const catalog = toolCatalog(record.lock.compatibility.toolContract);
    invariant(record.lock.bindings.some(handler => handler.kind === "handler" && handler.id === toolHandlerId(catalog.version) && handler.digest === catalog.digest),
      "CAPABILITY_MISMATCH", "Tool implementation differs from its immutable lock");
    const audioRequests = record.lock.skills.length > 0 && record.lock.skills.every(skill => Number(skill.version.split('.')[0]) >= 5);
    return { catalog, lockId: binding.lockId, audioRequests };
  }

  /** Recognize historical receipt identity only; this never verifies or enables a runtime or new invocation. */
  private reconciliationCatalogMatches(projectId: string, call: ToolInvocation, epoch: { requestId: string; principalId: string }): boolean {
    try {
      if (!call.toolContractVersion || !(SUPPORTED_TOOL_CONTRACTS as readonly string[]).includes(call.toolContractVersion)) return false;
      if (call.catalogDigest === toolCatalog(call.toolContractVersion).digest) return true;
      if (!call.skillLockId || call.projectId !== projectId || call.requestId !== epoch.requestId) return false;
      const store = this.service.store;
      const request = store.get<{ projectId: string; principalId: string }>('message', call.requestId);
      const binding = store.get<{ projectId: string; requestId: string; lockId: string }>('director_epoch_lock', call.epochId);
      if (request?.projectId !== projectId || request.principalId !== epoch.principalId || binding?.projectId !== projectId
        || binding.requestId !== call.requestId || binding.lockId !== call.skillLockId) return false;
      const record = store.get<{ projectId: string; lock: SkillCapabilityLock }>('director_skill_lock', call.skillLockId);
      if (record?.projectId !== projectId || record.lock.id !== call.skillLockId) return false;
      const { lockDigest, ...body } = record.lock;
      const handlers = record.lock.bindings.filter(handler => handler.kind === 'handler');
      if (record.lock.schemaVersion === 2) return digest(body) === lockDigest && record.lock.compatibility.toolContract === call.toolContractVersion
        && handlers.length === 1 && handlers[0]!.digest === call.catalogDigest && isShippedDirectorRelease(record.lock);
      return digest(body) === lockDigest && record.lock.compatibility.toolContract === call.toolContractVersion
        && SHIPPED_DIRECTOR_GUIDANCE.some(pin => pin.toolContract === call.toolContractVersion && pin.handlerDigest === call.catalogDigest
          && record.lock.skills.length === 2
          && record.lock.skills.some(skill => skill.id === 'plan-authoring' && skill.version === pin.guidanceVersion && skill.packageDigest === pin.planAuthoringDigest)
          && record.lock.skills.some(skill => skill.id === 'production' && skill.version === pin.guidanceVersion && skill.packageDigest === pin.productionDigest)
          && handlers.length === 1 && handlers[0]!.id === toolHandlerId(pin.toolContract) && handlers[0]!.digest === pin.handlerDigest);
    } catch { return false; } // Damaged history stays unresolved without aborting other calls' reconciliation.
  }

  async invoke(projectId: string, actor: ActorContext, callId: string, tool: string, input: unknown,
    options: { signal?: AbortSignal } = {}): Promise<JsonValue> {
    const signal = options.signal;
    invariant(signal === undefined || signal instanceof AbortSignal, "VALIDATION_ERROR", "Use an original tool invocation cancellation signal");
    const stopped = (): void => invariant(!signal?.aborted, "TOOL_CALL_CANCELLED", "Tool invocation was cancelled");
    stopped(); actor = structuredClone(actor);
    this.service.recovery.assertWritable(projectId, actor.requestId);
    invariant(actor.kind === "director", "ACTOR_DENIED", "Tool transport requires a director epoch");
    this.service.assertActor(projectId, actor);
    invariant(/^[A-Za-z0-9_-]{1,160}$/.test(callId), "VALIDATION_ERROR", "Invalid tool call identity");
    if (tool === "make_keyframes") assertDirectorGenerationAuthority(this.service, projectId, actor);
    if (tool === 'accept_proposal' || tool === 'reject_proposal') assertDirectorProposalDecisionAuthority(this.service, projectId, actor);
    invariant(!this.service.store.get("keyframe_review_request", actor.requestId) || ["read_context", "record_notes", "propose_change", "read_skill", "read_guidance"].includes(tool),
      "ACTOR_DENIED", "Keyframe reviews may only read context, record notes and propose changes");
    const selected = this.catalog(projectId, actor);
    const id = digest({ projectId, epochId: actor.epochId, callId });
    const store = this.service.store;
    let parsed: ReturnType<typeof parseToolArguments>;
    try { parsed = parseToolArguments(tool, input, selected.catalog.version); }
    catch (error) {
      // Preserve the same safe, correctable schema refusal on exact retries (the bridge forwards compatible notes to
      // this authoritative validator). Never retain supplied argument values or create domain work on this path.
      if ((tool !== 'record_notes' && tool !== 'propose_change' && tool !== 'prepare_change') || !toolContractAtLeast(selected.catalog.version, '5.0.0') || !(error instanceof DomainError) || error.code !== 'VALIDATION_ERROR') throw error;
      const argumentsDigest = digest(input);
      store.transaction(() => {
        this.service.assertActor(projectId, actor);
        invariant(canonical(this.catalog(projectId, actor)) === canonical(selected), 'CAPABILITY_MISMATCH', 'Tool catalog changed before invocation');
        const previous = store.get<ToolInvocation>('tool_invocation', id);
        if (previous) {
          invariant(previous.argumentsDigest === argumentsDigest && previous.tool === tool && previous.requestId === actor.requestId,
            'IDEMPOTENCY_CONFLICT', 'Tool call identity was already used for different work');
          invariant(previous.toolContractVersion === selected.catalog.version && previous.catalogDigest === selected.catalog.digest && previous.skillLockId === selected.lockId,
            'CAPABILITY_MISMATCH', 'Receipt belongs to another tool contract');
          return;
        }
        const reason = (error.details as { reason?: string } | undefined)?.reason === 'invalid_anchor' ? 'invalid_anchor' : 'invalid_arguments';
        const record: ToolInvocation = { id, projectId, requestId: actor.requestId, epochId: actor.epochId, callId,
          tool, toolContractVersion: selected.catalog.version, catalogDigest: selected.catalog.digest, skillLockId: selected.lockId,
          argumentsDigest, state: 'failed', result: null, resultDigest: null, error: { code: error.code, message: error.message, ...(tool === 'record_notes' ? { reason } : {}) } };
        store.insert('tool_invocation', id, projectId, record);
        store.appendEvent(projectId, 'tool.finished', { invocationId: id, callId, requestId: actor.requestId, tool, state: 'failed' });
      });
      throw error;
    }
    const argumentHash = digest(parsed.arguments);
    const commandKey = `director-tool:${id}`, proposalInput = audioTool(parsed.name) ? { ...parsed.arguments, key: commandKey } : null;
    const existing = store.transaction(() => {
      this.service.assertActor(projectId, actor);
      invariant(canonical(this.catalog(projectId, actor)) === canonical(selected), "CAPABILITY_MISMATCH", "Tool catalog changed before invocation");
      const previous = store.get<ToolInvocation>("tool_invocation", id);
      if (previous) {
        invariant(previous.argumentsDigest === argumentHash && previous.tool === parsed.name && previous.requestId === actor.requestId,
          "IDEMPOTENCY_CONFLICT", "Tool call identity was already used for different work");
        invariant((previous.toolContractVersion ?? "1.0.0") === selected.catalog.version &&
          (!previous.catalogDigest || previous.catalogDigest === selected.catalog.digest) &&
          (previous.skillLockId === undefined || previous.skillLockId === selected.lockId), "CAPABILITY_MISMATCH", "Receipt belongs to another tool contract");
        return previous;
      }
      const record: ToolInvocation = { id, projectId, requestId: actor.requestId, epochId: actor.epochId, callId,
        tool: parsed.name, toolContractVersion: selected.catalog.version, catalogDigest: selected.catalog.digest, skillLockId: selected.lockId,
        argumentsDigest: argumentHash, state: "started", result: null, resultDigest: null, error: null,
        recovery: audioTool(parsed.name) ? { audioProposalCommand: { kind: audioKind(parsed.name), key: commandKey, digest: digest(proposalInput), suggested: true } }
          : parsed.name === "apply_change" ? { preparedId: parsed.arguments.preparedId as string }
          : parsed.name === "prepare_change" ? { proposalDigest: digest(parsed.arguments) }
          : parsed.name === "revise_narration_draft" ? { narrationCommand: { key: `director-tool:${id}`,
            digest: digest({ action: "revise", expectedVersion: parsed.arguments.expectedVersion, arguments: parsed.arguments.patch }) } } : {} };
      store.insert("tool_invocation", id, projectId, record);
      store.appendEvent(projectId, "tool.started", { invocationId: id, callId, requestId: actor.requestId, tool: parsed.name });
      return null;
    });
    if (existing) {
      if (existing.state === "succeeded") return existing.result;
      if (existing.state === "failed" && existing.error) throw new DomainError(existing.error.code, existing.error.message);
      throw new DomainError("TOOL_CALL_UNRESOLVED", "Earlier tool work may have taken effect; reconcile application receipts before continuing");
    }

    let value: unknown;
    try {
      stopped();
      if (store.get("plan_import", actor.requestId)) invariant(["read_context", "prepare_change", "inspect_artifact", "control_execution", "read_guidance"].includes(parsed.name),
        "IMPORT_REVIEW_REQUIRED", "Interpret supplied material with prepare_change, then wait for human confirmation in Film plan. Other mutations and generation proposals are unavailable for this request.");
      switch (parsed.name) {
        case "make_keyframes": value = await makeDirectorKeyframes(this.service, projectId, actor, id, parsed.arguments,
          this.narration, this.#enqueueVoice, signal); break;
        case 'accept_proposal': case 'reject_proposal': value = decideProposal(this.service, projectId, actor, id,
          parsed.arguments as unknown as { proposalId: string }, parsed.name === 'accept_proposal' ? 'accept' : 'reject'); break;
        case "propose_change": value = proposeChange(this.service, projectId, actor, id, parsed.arguments as unknown as { patch: ProposalPatch }); break;
        case "record_notes": value = recordNotes(this.service, projectId, actor, id, parsed.arguments as unknown as { notes: NoteInput[] }, selected.catalog.version); break;
        // A free card like record_notes: allowed in discuss-only turns; only the person's choice saves a look.
        case "propose_visual_style": value = recordStyleProposal(this.service, projectId, actor, id, parsed.arguments as unknown as StyleProposalInput); break;
        case "read_context": value = parsed.arguments.section === "characters"
          ? readCharacters({ service: this.service, projectId, actor, invocationId: id, ...(signal ? { signal } : {}) })
          : this.service.readContext(projectId, actor, parsed.arguments); break;
        case "prepare_change": {
          const creative = (parsed.arguments as unknown as ChangeProposal).creative;
          if (toolContractAtLeast(selected.catalog.version, "7.0.0") && hasCharacterPatchFields(creative)) {
            value = applyCharacterChange({ service: this.service, projectId, actor, invocationId: id, ...(signal ? { signal } : {}) }, characterChange(parsed.arguments as unknown as ChangeProposal));
            break;
          }
          let prepared: Awaited<ReturnType<ProductionService["prepare"]>>;
          try { prepared = await this.service.prepare(projectId, actor, parsed.arguments); }
          catch (error) {
            // The domain guard remains mandatory. A missing human generation press is
            // an expected next action, rather than a failure of earlier writing saves.
            // Only this exact preparation refusal is translated; stale/invalid/unknown
            // outcomes retain their ordinary failure and reconciliation boundaries.
            if (!(error instanceof DomainError) || error.code !== "ORIGIN_NOT_AUTHORIZED" || !parsed.arguments.source) throw error;
            stopped(); this.service.assertActor(projectId, actor, true);
            const saved = store.getProject(projectId);
            value = { state: "awaiting_human_generation", preparedId: null, applied: false, generationStarted: false,
              savedProject: { revisionId: saved.revisionId, headVersion: saved.headVersion, activePlanId: saved.activePlanId,
                sceneCount: saved.scenes.length, shotCount: saved.shots.length },
              next: toolContractAtLeast(selected.catalog.version, "6.0.0")
                ? "Previously saved writing is retained. Save any remaining writing with a creative patch without source. For requested keyframes, use make_keyframes within the current human request's scope; for requested video, offer the scene's confirm_video choice after frame review. Only a returned prepared-change ID can be applied; preserve this result's state and use the existing generation actions."
                : "A human generation press is the expected next step. This call saved no writing or generation plan and returned no prepared-change ID; previously saved writing is retained. Save any remaining writing with a creative patch without source. For visual work, the person uses the scene action to create keyframes, then reviews the returned frames and actual video recipe before the video action. For audio, the person presses the existing audio request action. Do not call apply_change with this result or retry preparation to obtain authorization." };
            break;
          }
          // Full source, next project and compiled graph stay in the durable proposal.
          // A usable prepared ID must not be lost because these repeat megabytes of input.
          value = { id: prepared.id, preparedId: prepared.id, proposalDigest: prepared.proposalDigest,
            baseVersion: prepared.baseVersion, semanticChange: prepared.semanticChange,
            graphDigest: prepared.compiled?.graphDigest ?? null,
            impactCounts: Object.fromEntries(["reuse", "replace", "new", "retire"].map(kind => [kind, prepared.impact.filter(item => item.kind === kind).length])),
            stageCount: prepared.stages.length };
          break;
        }
        case "apply_change": value = this.service.apply(projectId, actor, parsed.arguments.preparedId as string); break;
        case "inspect_artifact": value = this.service.inspectArtifact(projectId, actor, parsed.arguments.artifactId as string); break;
        case "control_execution": {
          const action = parsed.arguments.action;
          value = action === "stop" ? stopFilm(this.service, projectId, actor, id)
            : action === "resume" ? requestResume(this.service, projectId, actor, id)
            : this.service.holdRequest(projectId, actor, true);
          break;
        }
        case "set_soundtrack": value = setSoundtrack(this.service, projectId, actor, id, parsed.arguments as SetSoundtrackInput); break;
        case "move_shot": value = moveShot(this.service, projectId, actor, id, parsed.arguments as unknown as { shotId: string; sceneId: string; beforeId?: string }); break;
        case "move_scene": value = moveScene(this.service, projectId, actor, id, parsed.arguments as unknown as { sceneId: string; beforeId?: string }); break;
        case "start_export": value = await startExport(this.service, this.#exports, projectId, actor, id); break;
        case "undo_edit": value = undoEdit(this.service, projectId, actor, id, parsed.arguments as unknown as { commandId: string }); break;
        case "delete_shots": value = requestDeleteShots(this.service, projectId, actor, id, parsed.arguments as unknown as { shotIds: string[] }); break;
        case "delete_scene": value = requestDeleteScene(this.service, projectId, actor, id, parsed.arguments as unknown as { sceneId: string; withShots?: boolean }); break;
        case "use_take": value = requestUseTake(this.service, projectId, actor, id, parsed.arguments as unknown as { shotId: string; artifactId: string }); break;
        case "analyze_music": {
          // Read-only: any turn that may read context may analyze, including discuss-only and review turns' scope rules.
          this.service.assertActor(projectId, actor);
          value = await analyzeMusic(store, this.#music, projectId, parsed.arguments.audioId as string, signal);
          break;
        }
        // Free and read-only in every turn, like read_context: it reads this conversation's own locked guidance.
        case "read_guidance": value = readGuidance(this.service, projectId, actor, parsed.arguments as unknown as ReadGuidanceInput); break;
        case "make_character_sheets": value = makeCharacterSheets({ service: this.service, projectId, actor, invocationId: id, ...(signal ? { signal } : {}) },
          parsed.arguments as unknown as { characterIds: string[]; regenerate?: boolean }); break;
        case "prepare_recording_transcription": {
          const port = this.#ownedTranscription;
          invariant(port, "TOOL_CAPABILITY_UNAVAILABLE", "Recording proposal preparation is not configured on this server");
          if (toolContractAtLeast(selected.catalog.version, '6.0.0') && hasDirectorAudioAttachment(this.service, projectId, actor, parsed.arguments.audioId as string)) {
            const result = await startDirectorAttachmentTranscription({ service: this.service, transcriptions: port, projectId, actor,
              key: commandKey, input: proposalInput as unknown as PrepareOwnedTranscription, ...(signal ? { signal } : {}) });
            const resolved = resolveOwnedTranscriptionApplication(store, projectId, result.receipt.candidateId);
            value = { state: 'requested', proposalId: result.proposal.id, proposalDigest: digest(result.proposal),
              candidateId: result.receipt.candidateId, operationId: resolved.review.nodeId, activePlanId: result.receipt.applied.activePlanId,
              generation: result.effect, next: 'Follow this exact transcription job. Its words never attach, adopt or accept themselves.' };
            break;
          }
          const proposal = await port.prepare(projectId, actor, proposalInput as unknown as PrepareOwnedTranscription, signal ? { signal } : {});
          stopped(); value = pendingAudioReceipt(store, proposal, "recording_transcription", projectId, actor, actor.epochId, digest(proposalInput), commandKey);
          break;
        }
        case "prepare_narration_speech": {
          const port = this.#narrationSpeech;
          invariant(port, "TOOL_CAPABILITY_UNAVAILABLE", "Speech proposal preparation is not configured on this server");
          const proposal = selected.audioRequests
            ? await port.prepareRequest(projectId, actor, proposalInput as unknown as PrepareNarrationSpeech, signal ? { signal } : {})
            : await port.prepare(projectId, actor, proposalInput as unknown as PrepareNarrationSpeech, signal ? { signal } : {});
          stopped(); value = pendingAudioReceipt(store, proposal, "narration_speech", projectId, actor, actor.epochId, digest(proposalInput), commandKey);
          break;
        }
        case "revise_narration_draft": value = narrationReceipt(this.narration.reviseSegments(projectId, actor,
          parsed.arguments.expectedVersion as number, `director-tool:${id}`, parsed.arguments.patch as unknown as ReviseSegments)); break;
      }
    } catch (error) {
      // A rejected proposal can still have created a hold. "failed" means a known error,
      // not proof that the application had no effects. Unexpected failures stay unresolved.
      // A late cancellation can follow a committed domain command. Keep new
      // proposal calls reconcilable instead of inferring that no effect occurred.
      const known = error instanceof DomainError && !((audioTool(parsed.name) || parsed.name === "make_keyframes") && (error.code.endsWith("CANCELLED") || error.code === "TOOL_CALL_UNRESOLVED"));
      this.finish(id, projectId, known ? "failed" : "unresolved", null,
        known ? { code: error.code, message: error.message.slice(0, 2000), ...(parsed.name === 'record_notes' ? {
          reason: (error.details as { reason?: ReviewNotesFailure['reason'] } | undefined)?.reason ?? (error.code === 'SCOPE_DENIED' ? 'outside_scope' : error.code === 'VALIDATION_ERROR' ? 'invalid_arguments' : 'unavailable'),
        } : {}) } : { code: "TOOL_CALL_UNRESOLVED", message: "Tool outcome needs application reconciliation" });
      if (known) throw error;
      throw new DomainError("TOOL_CALL_UNRESOLVED", "Tool outcome needs application reconciliation");
    }
    try {
      const encoded = canonical(value);
      invariant(Buffer.byteLength(encoded) <= TOOL_RESULT_MAX_BYTES, "TOOL_RESULT_TOO_LARGE", "Tool result exceeds the transport receipt limit");
      const result = JSON.parse(encoded) as JsonValue;
      this.finish(id, projectId, "succeeded", result, null);
      return result;
    } catch {
      // The domain command may already have committed. Never automatically replay it.
      this.finish(id, projectId, "unresolved", null, { code: "TOOL_CALL_UNRESOLVED", message: "Result could not be recorded; reconcile domain receipts" });
      throw new DomainError("TOOL_CALL_UNRESOLVED", "Result could not be recorded; reconcile domain receipts");
    }
  }

  /** Recover only from authoritative application receipts. This never calls a tool again. */
  reconcileEpoch(projectId: string, epochId: string): void {
    const store = this.service.store;
    store.transaction(() => {
      const epoch = store.get<{ projectId: string; state: string; principalId: string; requestId: string }>("epoch", epochId);
      invariant(epoch?.projectId === projectId && epoch.state === "revoked", "ACTOR_DENIED", "Reconciliation requires a fenced epoch");
      for (const call of store.list<ToolInvocation>("tool_invocation", projectId).filter(call => call.epochId === epochId && ["started", "unresolved"].includes(call.state))) {
        if (store.get("tool_reconciliation", call.id)) continue;
        let receipt: unknown = null;
        const catalogMatches = this.reconciliationCatalogMatches(projectId, call, epoch);
        if (call.tool === 'make_keyframes' && toolContractAtLeast(call.toolContractVersion, '6.0.0') && catalogMatches) {
          const saved = store.get<DirectorKeyframesReceipt>('director_keyframes_receipt', call.id);
          if (saved?.projectId === projectId && saved.requestId === call.requestId && saved.epochId === epochId && saved.argumentsDigest === call.argumentsDigest) {
            // Effects commit with scene publication; blocks commit with refusal checkpoints.
            // Either can survive a lost completion receipt without authorizing another dispatch.
            const effects = store.list<DirectorGenerationEffectRecord>('director_generation_effect', projectId)
              .filter(row => row.requestId === call.requestId && row.epochId === epochId && row.key.startsWith(`director-keyframes:${call.id}:`));
            const blocks = store.list<{ requestId: string; epochId: string; key: string }>('director_generation_block', projectId)
              .filter(row => row.requestId === call.requestId && row.epochId === epochId && row.key.startsWith(`director-keyframes:${call.id}:`));
            if (saved.complete || effects.length || blocks.length) receipt = { started: effects.map(row => ({ ...row.effect, sceneId: row.effect.sceneIds[0] })),
              refused: saved.refused, complete: saved.complete };
          }
        }
        if ((call.tool === "record_notes" || call.tool === "propose_change") && call.toolContractVersion && toolContractAtLeast(call.toolContractVersion, "5.0.0") && catalogMatches) {
          const saved = store.get<{ projectId: string; requestId: string; epochId: string; argumentsDigest: string; receipt: unknown }>(call.tool === "record_notes" ? "director_notes_receipt" : "director_proposal_receipt", call.id);
          if (saved?.projectId === projectId && saved.requestId === call.requestId && saved.epochId === epochId && saved.argumentsDigest === call.argumentsDigest) receipt = saved.receipt;
        }
        if ((call.tool === 'accept_proposal' || call.tool === 'reject_proposal') && toolContractAtLeast(call.toolContractVersion, '6.0.0') && catalogMatches) {
          const saved = store.get<{ projectId: string; requestId: string; epochId: string; argumentsDigest: string; action: string; receipt: unknown }>('director_proposal_decision_receipt', call.id);
          if (saved?.projectId === projectId && saved.requestId === call.requestId && saved.epochId === epochId && saved.argumentsDigest === call.argumentsDigest
            && saved.action === (call.tool === 'accept_proposal' ? 'accept' : 'reject')) receipt = saved.receipt;
        }
        if (call.tool === "apply_change" && call.recovery?.preparedId) {
          const prepared = store.get<{ projectId: string; requestId: string; epochId: string; proposalDigest: string }>("prepared", call.recovery.preparedId);
          if (prepared?.projectId === projectId && prepared.requestId === call.requestId && prepared.epochId === epochId) {
            const row = store.db.prepare("SELECT result FROM commands WHERE actor_scope=? AND key=? AND digest=?")
              .get(`${epoch.principalId}:${projectId}:apply`, call.recovery.preparedId, prepared.proposalDigest) as { result: string } | undefined;
            if (row) receipt = JSON.parse(row.result);
          }
        }
        if (call.tool === "prepare_change" && call.recovery?.proposalDigest) {
          const prepared = store.list<{ id: string; requestId: string; epochId: string; proposalDigest: string }>("prepared", projectId)
            .find(row => row.requestId === call.requestId && row.epochId === epochId && row.proposalDigest === call.recovery!.proposalDigest);
          if (prepared) receipt = { preparedId: prepared.id, proposalDigest: prepared.proposalDigest };
        }
        if (call.tool === "revise_narration_draft" && (SUPPORTED_TOOL_CONTRACTS.slice(1) as readonly string[]).includes(call.toolContractVersion ?? "1.0.0") && call.recovery?.narrationCommand) {
          const command = call.recovery.narrationCommand;
          if (command.key === `director-tool:${call.id}`) {
            const row = store.db.prepare("SELECT result FROM commands WHERE actor_scope=? AND key=? AND digest=?")
              .get(`${epoch.principalId}:${projectId}:${call.requestId}:narration`, command.key, command.digest) as { result: string } | undefined;
            if (row) {
              const snapshot = JSON.parse(row.result) as NarrationSnapshot;
              if (snapshot.state.projectId === projectId) receipt = narrationReceipt(snapshot);
            }
          }
        }
        if (call.tool === 'prepare_recording_transcription' && toolContractAtLeast(call.toolContractVersion, '6.0.0') && catalogMatches) {
          const saved = store.list<DirectorAttachmentTranscriptionRecord>('director_attachment_transcription', projectId)
            .find(row => row.requestId === call.requestId && row.epochId === epochId && row.key === `director-tool:${call.id}` && row.state === 'succeeded');
          if (saved) {
            try {
              const result = readDirectorAttachmentTranscription(this.service, projectId, saved);
              receipt = { state: 'requested', proposalId: result.proposal.id, candidateId: result.receipt.candidateId, generation: result.effect };
            } catch { /* Only exact retained application evidence settles a lost response. */ }
          }
        }
        if (!receipt && (call.toolContractVersion && (SUPPORTED_TOOL_CONTRACTS.slice(2) as readonly string[]).includes(call.toolContractVersion)) && catalogMatches && audioTool(call.tool) && call.recovery?.audioProposalCommand) {
          const command = call.recovery.audioProposalCommand, kind = audioKind(call.tool);
          if (command.kind === kind && command.key === `director-tool:${call.id}`) {
            const suffix = kind === "recording_transcription" ? "owned-transcription" : "narration-speech";
            let inputDigest = command.digest;
            if ((command.requested || command.suggested) && kind === 'narration_speech') {
              const normalized = store.db.prepare('SELECT result FROM commands WHERE actor_scope=? AND key=? AND digest=?')
                .get(`${epoch.principalId}:${projectId}:${call.requestId}:narration-speech-request:${epochId}-input`, command.key, command.digest) as { result: string } | undefined;
              if (normalized) inputDigest = digest(JSON.parse(normalized.result));
            }
            const row = store.db.prepare("SELECT CASE WHEN length(CAST(result AS BLOB))<=? THEN result ELSE NULL END AS result FROM commands WHERE actor_scope=? AND key=? AND digest=?")
              .get(AUDIO_PROPOSAL_MAX_BYTES, `${epoch.principalId}:${projectId}:${call.requestId}:${suffix}:${epochId}`, command.key, inputDigest) as { result: string | null } | undefined;
            if (row?.result) {
              try {
                const proposal = JSON.parse(row.result) as { id: string };
                const family = kind === "recording_transcription" ? "owned_transcription_proposal" : "narration_speech_proposal";
                this.service.recovery.assertFreshAuthority(projectId, family, proposal.id);
                const saved = store.db.prepare("SELECT CASE WHEN length(CAST(body AS BLOB))<=? THEN body ELSE NULL END AS body FROM entities WHERE kind=? AND id=? AND project_id=?")
                  .get(AUDIO_PROPOSAL_MAX_BYTES, family, proposal.id, projectId) as { body: string | null } | undefined;
                if (saved?.body && canonical(JSON.parse(saved.body)) === canonical(proposal)) {
                  if (command.requested) {
                    const reviewKey = digest({ key: command.key, action: kind === 'narration_speech' ? 'request-speech' : 'request-transcription' });
                    const input = { key: reviewKey, proposalId: proposal.id, proposalDigest: digest(proposal) };
                    const published = store.db.prepare('SELECT result FROM commands WHERE actor_scope=? AND key=? AND digest=?')
                      .get(`${epoch.principalId}:${projectId}:${call.requestId}:${suffix}-review`, reviewKey, digest(input)) as { result: string } | undefined;
                    receipt = published ? audioRequestReceipt(store, proposal, JSON.parse(published.result), kind, projectId, epoch, epochId, command.digest, command.key)
                      : { ...audioProposalReceipt(proposal, kind, projectId, epoch, epochId, inputDigest), state: 'prepared_only',
                        next: 'Exact audio preparation was saved, but no application publication was found. Continue from current saved input.' };
                  } else receipt = command.suggested ? pendingAudioReceipt(store, proposal, kind, projectId, epoch, epochId, command.digest, command.key)
                    : audioProposalReceipt(proposal, kind, projectId, epoch, epochId, command.digest);
                }
              } catch { /* Missing, restored or inconsistent evidence cannot authorize a new proposal. */ }
            }
          }
        }
        if (!receipt && toolContractAtLeast(call.toolContractVersion, '7.0.0') && catalogMatches) receipt = contractSevenReceipt(store, projectId, call);
        if (call.state === "started") this.finish(call.id, projectId, "unresolved", null, { code: "TOOL_CALL_UNRESOLVED", message: "Owning turn ended before its tool result was recorded" });
        store.insert("tool_reconciliation", call.id, projectId, { id: call.id, requestId: call.requestId, epochId,
          state: receipt ? "effect_confirmed" : "needs_followup", receipt, receiptDigest: receipt ? digest(receipt) : null });
        store.appendEvent(projectId, "tool.reconciled", { invocationId: call.id, requestId: call.requestId, effectConfirmed: !!receipt });
      }
    });
  }

  private finish(id: string, projectId: string, state: ToolInvocation["state"], result: JsonValue | null, error: ToolInvocation["error"]): void {
    this.service.store.transaction(() => {
      const previous = this.service.store.get<ToolInvocation>("tool_invocation", id);
      invariant(previous && previous.state === "started", "TOOL_CALL_UNRESOLVED", "Tool record cannot be completed twice");
      this.service.store.put("tool_invocation", id, projectId, { ...previous, state, result, resultDigest: state === "succeeded" ? digest(result) : null, error });
      this.service.store.appendEvent(projectId, "tool.finished", { invocationId: id, callId: previous.callId, requestId: previous.requestId, tool: previous.tool, state });
    });
  }
}

/** Split a 7.0.0 character-only creative patch into the character tools' input. Mixed patches are refused. */
function characterChange(proposal: ChangeProposal): CharacterChangeInput {
  const creative = proposal.creative!;
  const casting = (creative.updateShots ?? []).flatMap(row => row.characterIds !== undefined ? [{ shotId: row.id, characterIds: [...row.characterIds] }] : []);
  const otherShotFields = (creative.updateShots ?? []).some(row => Object.keys(row).some(field => !["id", "characterIds"].includes(field)));
  const others = Object.keys(creative).filter(field => !["createCharacters", "updateCharacters", "deleteCharacterIds", "updateShots"].includes(field));
  invariant(!otherShotFields && !others.length && !proposal.source && !proposal.stages?.length && !proposal.requestNewTakes?.length, "VALIDATION_ERROR",
    "prepare_change arguments are invalid: send createCharacters, updateCharacters, deleteCharacterIds and updateShots[].characterIds in their own call, without other creative fields");
  return { ...(creative.createCharacters ? { createCharacters: creative.createCharacters } : {}), ...(creative.updateCharacters ? { updateCharacters: creative.updateCharacters } : {}),
    ...(creative.deleteCharacterIds ? { deleteCharacterIds: creative.deleteCharacterIds } : {}), ...(casting.length ? { casting } : {}) };
}

/** A 7.0.0 edit or card commits with its own domain record; a lost transport result is recovered from it only. */
function contractSevenReceipt(store: Store, projectId: string, call: ToolInvocation): JsonValue | null {
  if (["set_soundtrack", "move_shot", "move_scene", "undo_edit"].includes(call.tool)) {
    const edits = store.list<{ id: string; origin?: { director: { invocationId?: string } } }>("storyboard_edit", projectId)
      .filter(edit => edit.origin?.director.invocationId === call.id);
    return edits.length ? { commandIds: edits.map(edit => edit.id) } : null;
  }
  if (["delete_shots", "delete_scene", "use_take", "control_execution"].includes(call.tool)) {
    const card = store.get<{ projectId: string; noteId: string; letter: string }>("director_card_receipt", call.id);
    if (card?.projectId === projectId) return { state: "awaiting_confirmation", noteId: card.noteId, letter: card.letter, applied: false };
  }
  if (call.tool === "propose_visual_style") {
    const card = store.get<{ projectId: string; noteId: string; letter: string }>("director_card_receipt", call.id);
    if (card?.projectId === projectId) return { state: "awaiting_choice", noteId: card.noteId, letter: card.letter, applied: false };
  }
  return null;
}
