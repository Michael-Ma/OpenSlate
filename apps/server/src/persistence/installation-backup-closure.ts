import Database from "better-sqlite3";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { canonical, composeTranscriptionPlanIsolated, digest, invariant, snapshotLocalExecution } from "@openslate/core";
import type { CompiledPlan, ProjectRecord, ProviderProfile } from "@openslate/core";
import { assertOwnedTranscriptionSource, assertOwnedTranscriptionProposal, ownedTranscriptionCatalog } from "../narration/owned-transcription-records.js";
import type { OwnedTranscriptionSource } from "../narration/owned-transcription-types.js";
import { assertOwnedTranscriptionReview, assertOwnedTranscriptionApplication, assertOwnedTranscriptionAttemptInput, resolveOwnedTranscriptionApplication } from "../narration/owned-transcription-authorization.js";
import type { ExecutionSpoolOutput } from "@openslate/providers";
import { parseOpenAITranscriptionResponse } from "@openslate/providers";
import { assertVideoDerivationIntent, assertVideoDerivationReceipt } from "../execution/video-derivation.js";
import type { VideoDerivationIntent, VideoDerivationReceipt } from "../execution/video-derivation.js";
import { assertAudioDerivationIntent, assertAudioDerivationReceipt, assertNormalizedAudioIngestion } from "../execution/audio-derivation.js";
import type { AudioDerivationIntent, AudioDerivationReceipt } from "../execution/audio-derivation.js";
import { assertTranscriptionAudioIntent, assertTranscriptionAudioReceipt, resolveTranscriptionAudioSource, transcriptionAudioInput } from "../execution/transcription-audio.js";
import type { TranscriptionAudioIntent, TranscriptionAudioReceipt, TranscriptionAudioSourceRecord } from "../execution/transcription-audio.js";
import { inspectPcmWave } from "../media/pcm-wave.js";
import { assertSpeechMappingAdmission, resolveSpeechAdmission } from "../execution/audio-execution-authority.js";
import { assertSpeechSpoolLineage } from "../execution/audio-execution-lineage.js";
import type { SpeechAuthorityStore } from "../execution/audio-execution-authority.js";
import { assertSpeechExecutionDispatch, assertSpeechExecutionResult } from "../execution/audio-execution-receipts.js";
import type { SpeechExecutionMapping, SpeechExecutionDispatch, SpeechExecutionResult } from "../execution/audio-execution-receipts.js";
import { assertTranscriptionMappingAdmission, resolveTranscriptionAdmission, resolveTranscriptionPreparation } from "../execution/transcription-execution-authority.js";
import { assertTranscriptionExecutionDispatch, assertTranscriptionExecutionResult, compactTranscriptionExecutionResult, prepareTranscriptionExecutionRequest } from "../execution/transcription-execution-receipts.js";
import type { TranscriptionExecutionMapping, TranscriptionExecutionDispatch, TranscriptionExecutionResult } from "../execution/transcription-execution-receipts.js";
import { assertTranscriptionPreparationIntent, resolveTranscriptionPreparationIntent } from "../execution/transcription-preparation.js";
import type { TranscriptionPreparationIntent } from "../execution/transcription-preparation.js";
import { assertTranscriptionPreparationAttemptState, assertTranscriptionPreparationMapping } from "./transcription-preparation-state.js";
import { assertTranscriptCandidateIngestion, createTranscriptCandidate, resolveTranscriptionSpoolLineage } from "../execution/transcript-candidate.js";
import type { TranscriptCandidate } from "../execution/transcript-candidate.js";
import { assertOutputReceiptIdentity } from "../execution/output-store.js";
import type { OutputReceipt } from "../execution/output-store.js";
import type { Attempt } from "../execution/engine.js";
import type { BackupFile } from "./installation-backup.js";
import { assertGeneratedCanonicalNarrationSegment, assertGeneratedNarrationAudio, resolveGeneratedNarrationAudio } from "../narration/generated-audio.js";
import { assertTranscriptCanonicalSegment, assertTranscriptSelection, assertTranscriptSelectionOutput, transcriptCanonicalProvenance } from "../narration/transcript-selection.js";

type RecordValue = Record<string, any>;
const object = (value: unknown): value is RecordValue => value !== null && typeof value === "object" && !Array.isArray(value);
const HASH = /^[a-f0-9]{64}$/;
function fail(condition: unknown, message: string): asserts condition { invariant(condition, "BACKUP_REFERENCE_INVALID", message); }

/** Validate published ownership references without creating Store/media/provider objects. */
export async function verifyBackupClosure(bundle: string, originalRoot: string, files: ReadonlyMap<string, BackupFile>, read: (path: string) => Promise<Buffer>): Promise<void> {
  const required = (path: string, sha256?: unknown, byteLength?: unknown): BackupFile => {
    const file = files.get(path); fail(file, `Required published file is missing: ${path}`);
    if (sha256 !== undefined) fail(typeof sha256 === "string" && HASH.test(sha256) && file.sha256 === sha256, `Recorded content differs: ${path}`);
    if (byteLength !== undefined) fail(Number.isSafeInteger(byteLength) && file.byteLength === byteLength, `Recorded length differs: ${path}`);
    return file;
  };
  const absoluteReference = (path: unknown, sha256?: unknown, byteLength?: unknown): void => {
    fail(typeof path === "string" && isAbsolute(path) && resolve(path) === path, "Owned artifact path must be absolute and normalized");
    const sub = relative(originalRoot, path);
    fail(sub !== "" && sub !== ".." && !isAbsolute(sub) && !sub.startsWith(`..${sep}`), "Owned artifact lies outside this installation");
    required(sub.split(sep).join("/"), sha256, byteLength);
  };
  const json = async (path: string): Promise<RecordValue> => {
    required(path); const bytes = await read(path); let value: unknown;
    try { value = JSON.parse(bytes.toString("utf8")); } catch { fail(false, `Invalid owned metadata: ${path}`); }
    fail(object(value), `Owned metadata must be an object: ${path}`); return value;
  };
  const source = async (value: unknown): Promise<void> => {
    fail(object(value) && HASH.test(value.id) && (value.kind === "video" || value.kind === "audio"), "Invalid media source descriptor");
    const { id, ...body } = value;
    fail(digest(body) === id, "Media source descriptor digest differs");
    const saved = await json(`media/sources/${id}.json`); fail(canonical(saved) === canonical(value), "Media source differs from its saved descriptor");
    required(`media/blobs/${value.originalSha256}.source`, value.originalSha256, value.originalByteLength);
    required(`media/blobs/${value.sha256}.${value.kind === "video" ? "mp4" : "wav"}`, value.sha256, value.byteLength);
  };
  const renderManifest = async (value: unknown): Promise<void> => {
    fail(object(value) && HASH.test(value.digest) && Array.isArray(value.clips) && Array.isArray(value.audio), "Invalid frozen render manifest");
    const { digest: identity, ...body } = value; fail(digest(body) === identity, "Frozen render manifest digest differs");
    fail(canonical(await json(`media/manifests/${identity}.json`)) === canonical(value), "Frozen render manifest differs from its published file");
    for (const placement of [...value.clips, ...value.audio]) { fail(object(placement), "Invalid media placement"); await source(placement.source); }
  };
  const artifact = (value: unknown): void => {
    fail(object(value) && object(value.artifact) && value.id === value.artifact.artifactId, "Invalid owned artifact record");
    absoluteReference(value.path, value.artifact.sha256, value.byteLength);
  };
  const db = new Database(join(bundle, "openslate.sqlite"), { readonly: true, fileMustExist: true });
  try {
    for (const table of ["entities", "projects"]) fail(!db.prepare(`SELECT 1 FROM ${table} WHERE length(CAST(body AS BLOB)) > ? LIMIT 1`).get(16 * 1024 ** 2), "Database record exceeds backup verification bound");
    const get = (kind: string, id: string): RecordValue => {
      const row = db.prepare("SELECT body FROM entities WHERE kind=? AND id=?").get(kind, id) as { body: string } | undefined;
      fail(row && Buffer.byteLength(row.body) <= 16 * 1024 ** 2, `Required database identity is missing: ${kind}`);
      const value: unknown = JSON.parse(row.body); fail(object(value), "Invalid saved record"); return value;
    };
    const speechReader: SpeechAuthorityStore = { db,
      get<T>(kind: string, id: string): T | undefined {
        const row = db.prepare("SELECT 1 FROM entities WHERE kind=? AND id=?").get(kind, id);
        return row ? get(kind, id) as T : undefined;
      },
      getProject(id) {
        const row = db.prepare("SELECT body FROM projects WHERE id=?").get(id) as { body: string } | undefined;
        fail(row, "Speech admission project is missing"); return JSON.parse(row.body);
      },
    };
    const checkedSpeech = new Set<string>();
    const checkedOwnedSources = new Map<string, string>();
    const ownedSource = async (value: unknown, projectId: string): Promise<void> => {
      assertOwnedTranscriptionSource(speechReader, projectId, value);
      const identity = digest(value), previous = checkedOwnedSources.get(value.id);
      if (previous) { fail(previous === identity, "Owned transcription source changed during backup"); return; }
      await source(value.source); artifact(get("artifact", value.artifact.artifactId));
      const path = `media/blobs/${value.source.sha256}.wav`;
      const measured = await inspectPcmWave(join(bundle, path), value.source.byteLength), pcm = measured.pcm;
      fail(measured.sha256 === value.source.sha256 && measured.byteLength === value.source.byteLength
        && pcm.sampleRate === 48000 && pcm.channels === 2 && pcm.bitsPerSample === 16 && pcm.sampleCount === value.sourceEndSample,
        "Owned recording normalized samples differ");
      // Exact source() closure also retains the original upload and descriptor. Generated rows receive their existing full speech closure below.
      checkedOwnedSources.set(value.id, identity);
    };
    const checkedOwnedProposals = new Map<string, string>();
    const ownedProposal = async (value: unknown, projectId: string): Promise<void> => {
      assertOwnedTranscriptionProposal(speechReader, projectId, value);
      const identity = digest(value), previous = checkedOwnedProposals.get(value.id);
      if (previous) { fail(previous === identity, "Owned transcription proposal changed during backup"); return; }
      const binding = get("owned_transcription_source", value.sourceBinding.id) as OwnedTranscriptionSource;
      await ownedSource(binding, projectId);
      const project = get("project_revision", value.baseProject.revisionId).project as ProjectRecord;
      const lock = get("capability_lock", value.capabilityLock.id) as { profiles: ProviderProfile[]; localExecution?: unknown };
      const base = value.basePlan ? get("plan", value.basePlan.id).compiled as CompiledPlan : null;
      const catalog = ownedTranscriptionCatalog(speechReader, projectId, base);
      for (const item of catalog) await ownedSource(get("owned_transcription_source", item.id), projectId);
      const logicalIds = { ...value.logicalIds }, localExecution = Object.hasOwn(lock, "localExecution") ? snapshotLocalExecution(lock.localExecution) : undefined;
      const compiled = await composeTranscriptionPlanIsolated(base, value.operation, { project, profiles: lock.profiles, logicalIds,
        allocateId: () => { fail(false, "Owned transcription proposal lacks an exact saved logical ID"); return ""; },
        transcriptionInputs: [...catalog, { id: binding.id, digest: digest(binding), consumerAlias: binding.consumerAlias, artifact: binding.artifact }],
        ...(localExecution ? { localExecution } : {}) });
      fail(canonical(compiled) === canonical(value.compiled) && canonical(logicalIds) === canonical(value.logicalIds),
        "Owned transcription proposal differs from isolated historical recomposition");
      checkedOwnedProposals.set(value.id, identity);
    };
    const checkedGeneratedNarration = new Map<string, string>();
    const generatedNarration = async (value: RecordValue): Promise<void> => {
      assertGeneratedNarrationAudio(speechReader, value.projectId, value);
      const identity = digest(value), previous = checkedGeneratedNarration.get(value.id);
      if (previous) { fail(previous === identity, "Generated narration provenance changed during backup"); return; }
      const resolved = resolveGeneratedNarrationAudio(speechReader, value.projectId, value.id);
      await source(value.media); artifact(resolved.artifact);
      const intent = resolved.derivationIntent;
      const raw = await inspectPcmWave(join(bundle, "media", "blobs", `${intent.rawSha256}.source`), intent.rawByteLength);
      const normalized = await inspectPcmWave(join(bundle, "media", "blobs", `${value.media.sha256}.wav`), value.media.byteLength);
      fail(raw.sha256 === intent.rawSha256 && raw.byteLength === intent.rawByteLength && canonical(raw.pcm) === canonical(intent.rawPcm), "Generated narration original PCM differs");
      fail(normalized.sha256 === value.media.sha256 && normalized.byteLength === value.media.byteLength && normalized.pcm.sampleRate === 48000
        && normalized.pcm.channels === 2 && normalized.pcm.bitsPerSample === 16 && normalized.pcm.sampleCount === resolved.derivationReceipt.normalizedSamples,
      "Generated narration normalized PCM differs");
      checkedGeneratedNarration.set(value.id, identity);
    };
    const speechRecords = (attemptId: string) => {
      if (checkedSpeech.has(attemptId)) return;
      const attempt = get("attempt", attemptId) as Attempt;
      const mapping = speechReader.get<SpeechExecutionMapping>("speech_execution_mapping", attemptId);
      const dispatch = speechReader.get<SpeechExecutionDispatch>("speech_execution_dispatch", attemptId);
      const result = speechReader.get<SpeechExecutionResult>("speech_execution_result", attemptId);
      const admission = resolveSpeechAdmission(speechReader, attempt.request, mapping);
      if (mapping) assertSpeechMappingAdmission(admission, mapping);
      if (dispatch) { fail(mapping, "Speech dispatch lost its exact mapping"); assertSpeechExecutionDispatch(attempt, mapping, dispatch); }
      if (result) assertSpeechExecutionResult(attempt, mapping, dispatch, result, result.observation.kind === "completed"
        ? get("execution_output_receipt", result.observation.outputReceiptId) as OutputReceipt : undefined);
      checkedSpeech.add(attemptId);
    };
    const audioIntents = new Map<string, { identity: string; attempt: Attempt; output: ExecutionSpoolOutput }>();
    const audioIntent = async (intent: AudioDerivationIntent) => {
      const identity = digest(intent), previous = audioIntents.get(intent.id);
      if (previous) { fail(previous.identity === identity, "Audio intent changed during closure verification"); return previous; }
      const attempt = get("attempt", intent.attemptId) as Attempt;
      const spool = await json(`execution-output/manifests/${intent.spoolId}.json`);
      const slot = await json(`execution-output/slots/${intent.slotId}.json`);
      const receipt = get("execution_output_receipt", intent.spoolId) as OutputReceipt;
      assertOutputReceiptIdentity(receipt, attempt);
      fail(receipt.kind === "audio" && receipt.port === "audio" && spool.projectId === intent.projectId
        && slot.projectId === intent.projectId && slot.attemptId === intent.attemptId && slot.spoolId === intent.spoolId
        && slot.port === "audio" && spool.attemptId === intent.attemptId && spool.sha256 === intent.rawSha256
        && spool.byteLength === intent.rawByteLength, "Audio derivation differs from its exact raw spool and winning slot");
      assertSpeechSpoolLineage(speechReader, attempt, intent.spoolId);
      const output = { port: "audio", kind: "audio", mimeType: "audio/wav", extension: "wav", sha256: spool.sha256,
        byteLength: spool.byteLength, fixture: false, storage: { type: "spool", spoolId: spool.id } } as const;
      assertAudioDerivationIntent(intent, attempt, output);
      const checked = { identity, attempt, output }; audioIntents.set(intent.id, checked); return checked;
    };
    const transcriptionIntents = new Map<string, string>(), transcriptionCompletions = new Map<string, string>();
    const transcriptionIntent = async (intent: TranscriptionAudioIntent) => {
      const identity = digest(intent), previous = transcriptionIntents.get(intent.id);
      if (previous) { fail(previous === identity, "Transcription intent changed during closure verification"); return; }
      const attempt = get("attempt", intent.attemptId) as Attempt;
      const input = transcriptionAudioInput(attempt);
      const records = (["media_source", "narration_audio"] as const).flatMap(kind => {
        const row = db.prepare("SELECT body FROM entities WHERE kind=? AND id=?").get(kind, input.artifactId) as { body: string } | undefined;
        return row ? [{ kind, record: JSON.parse(row.body) as TranscriptionAudioSourceRecord["record"] }] : [];
      });
      assertTranscriptionAudioIntent(intent, attempt, resolveTranscriptionAudioSource(attempt, records, intent.sourceRecord));
      await source(intent.source);
      const pcm = await inspectPcmWave(join(bundle, "media", "blobs", `${intent.source.sha256}.wav`), intent.recipe.maxInputBytes);
      fail(pcm.sha256 === intent.source.sha256 && pcm.byteLength === intent.source.byteLength && pcm.pcm.sampleRate === 48000
        && pcm.pcm.channels === 2 && pcm.pcm.sampleCount === intent.sourceEndSample, "Transcription source PCM differs from its complete descriptor");
      transcriptionIntents.set(intent.id, identity);
    };
    const transcriptionCompletion = async (receipt: TranscriptionAudioReceipt) => {
      const identity = digest(receipt), previous = transcriptionCompletions.get(receipt.id);
      if (previous) { fail(previous === identity, "Transcription completion changed during closure verification"); return; }
      const intent = get("transcription_audio_intent", receipt.id) as TranscriptionAudioIntent;
      await transcriptionIntent(intent); assertTranscriptionAudioReceipt(intent, receipt, false);
      const path = `audio-derivatives/blobs/${receipt.audio.sha256}.wav`;
      required(path, receipt.audio.sha256, receipt.audio.byteLength);
      const pcm = await inspectPcmWave(join(bundle, path), intent.recipe.maxOutputBytes);
      fail(pcm.sha256 === receipt.audio.sha256 && pcm.byteLength === receipt.audio.byteLength && pcm.pcm.sampleRate === 16000
        && pcm.pcm.channels === 1 && pcm.pcm.sampleCount === receipt.audio.sampleCount, "Transcription derivative PCM differs from its measured receipt");
      transcriptionCompletions.set(receipt.id, identity);
    };
    const checkedWaiting = new Set<string>();
    const waitingPreparation = async (attempt: Attempt): Promise<void> => {
      if (checkedWaiting.has(attempt.id)) return;
      assertTranscriptionPreparationAttemptState(speechReader, attempt, true);
      if (!Object.hasOwn(attempt, "preparation")) return;
      const proof = resolveTranscriptionPreparationIntent(speechReader, attempt), input = transcriptionAudioInput(attempt);
      await source(proof.source);
      const saved = get("artifact", input.artifactId);
      fail(saved.projectId === attempt.projectId && canonical(saved.artifact) === canonical(input), "Waiting preparation lost its exact owned input artifact");
      artifact(saved);
      const pcm = await inspectPcmWave(join(bundle, "media", "blobs", `${proof.source.sha256}.wav`), 256 * 1024 ** 2);
      fail(pcm.sha256 === proof.source.sha256 && pcm.byteLength === proof.source.byteLength && pcm.pcm.sampleRate === 48000
        && pcm.pcm.channels === 2 && pcm.pcm.sampleCount === proof.sourceEndSample,
      "Waiting preparation source differs from its complete recorded PCM identity");
      checkedWaiting.add(attempt.id);
    };
    const checkedTranscription = new Set<string>();
    const transcriptionRecords = async (attemptId: string) => {
      if (checkedTranscription.has(attemptId)) return;
      const attempt = get("attempt", attemptId) as Attempt;
      const mapping = speechReader.get<TranscriptionExecutionMapping>("transcription_execution_mapping", attemptId);
      const dispatch = speechReader.get<TranscriptionExecutionDispatch>("transcription_execution_dispatch", attemptId);
      const result = speechReader.get<TranscriptionExecutionResult>("transcription_execution_result", attemptId);
      const admission = resolveTranscriptionAdmission(speechReader, attempt.request, mapping);
      const preparation = mapping ? resolveTranscriptionPreparation(speechReader, attempt, mapping) : undefined;
      if (mapping) {
        assertTranscriptionMappingAdmission(admission, mapping, preparation!);
        if (Object.hasOwn(attempt, "preparation") || speechReader.get("transcription_preparation_intent", attemptId)) {
          await waitingPreparation(attempt);
          assertTranscriptionPreparationMapping(resolveTranscriptionPreparationIntent(speechReader, attempt), mapping);
        }
        await transcriptionCompletion(preparation!.receipt);
        fail(canonical(await json(`audio-derivatives/completions/${preparation!.receipt.id}.json`)) === canonical(preparation!.receipt),
          "Transcription mapping lost its exact derivative completion file");
        const bytes = await read(`audio-derivatives/blobs/${preparation!.receipt.audio.sha256}.wav`);
        const prepared = prepareTranscriptionExecutionRequest(attempt.request, preparation!, bytes);
        fail(canonical(prepared.description) === canonical(mapping.transport), "Transcription multipart differs from the actual saved upload bytes");
      }
      if (dispatch) { fail(mapping && preparation, "Transcription dispatch lost its exact mapping"); assertTranscriptionExecutionDispatch(attempt, mapping, dispatch, preparation); }
      if (result) {
        const raw = result.observation.kind === "completed" ? get("execution_output_receipt", result.observation.outputReceiptId) as OutputReceipt : undefined;
        assertTranscriptionExecutionResult(attempt, mapping, dispatch, result, preparation, raw);
        if (result.observation.kind === "completed") {
          const observation = result.observation, manifestPath = `execution-output/manifests/${observation.outputReceiptId}.json`;
          // Preserve unsaved/conflicting synchronous results as liabilities. No candidate is published by this bridge.
          // When this exact receipt has durable bytes, reparse it independently of whichever raw slot won.
          if (files.has(manifestPath)) {
            const spool = await json(manifestPath), value = observation.result;
            fail(spool.receiptId === observation.outputReceiptId && spool.sha256 === value.rawResponseSha256
              && spool.byteLength === value.rawResponseByteLength, "Transcription raw spool differs from its observed result");
            const path = `execution-output/blobs/${spool.blobKey}`; required(path, value.rawResponseSha256, value.rawResponseByteLength);
            const parsed = parseOpenAITranscriptionResponse({ bytes: await read(path), mimeType: "application/json",
              sourceDurationSeconds: preparation!.receipt.audio.sampleCount / 16000 }, {
              maxTextBytes: mapping!.parser.maxTextBytes, maxWords: mapping!.parser.maxWords, maxWordBytes: mapping!.parser.maxWordBytes });
            fail(parsed.reportedModel === observation.reportedModel && canonical(compactTranscriptionExecutionResult(parsed.result)) === canonical(value),
              "Transcription compact result differs from its exact raw response and pinned parser");
          }
        }
      }
      checkedTranscription.add(attemptId);
    };
    const checkedTranscriptCandidates = new Map<string, string>();
    const transcriptCandidate = async (candidate: TranscriptCandidate): Promise<void> => {
      const identity = digest(candidate), previous = checkedTranscriptCandidates.get(candidate.id);
      if (previous) { fail(previous === identity, "Transcript candidate changed during backup validation"); return; }
      const lineage = resolveTranscriptionSpoolLineage(speechReader, get("attempt", candidate.attemptId) as Attempt, candidate.raw.spoolId);
      // Selections and candidates share one exact raw/derivative closure. Do not
      // re-read a large response for every historical editorial selection.
      await transcriptionRecords(candidate.attemptId);
      const path = `execution-output/blobs/${lineage.spool.blobKey}`;
      required(path, lineage.spool.sha256, lineage.spool.byteLength);
      const parsed = parseOpenAITranscriptionResponse({ bytes: await read(path), mimeType: "application/json",
        sourceDurationSeconds: lineage.preparation.receipt.audio.sampleCount / 16000 }, {
        maxTextBytes: lineage.mapping.parser.maxTextBytes, maxWords: lineage.mapping.parser.maxWords, maxWordBytes: lineage.mapping.parser.maxWordBytes });
      fail(canonical(createTranscriptCandidate(lineage, parsed)) === canonical(candidate), "Published transcript candidate differs from its raw response and source-sample projection");
      assertTranscriptCandidateIngestion(lineage, { port: "cues", kind: "data", mimeType: "application/json", extension: "json",
        sha256: lineage.spool.sha256, byteLength: lineage.spool.byteLength, fixture: false, storage: { type: "spool", spoolId: lineage.spool.id } }, {
        type: "transcript_candidate", artifact: get("artifact", candidate.artifactId) as any, candidate });
      checkedTranscriptCandidates.set(candidate.id, identity);
    };
    let storageId: string | undefined;
    if (files.has("execution-output/identity.json")) {
      const identity = await json("execution-output/identity.json");
      fail(identity.version === 1 && typeof identity.id === "string" && /^[a-f0-9-]{36}$/.test(identity.id), "Invalid execution storage identity"); storageId = identity.id;
    }
    fail(storageId || ![...files.keys()].some(path => path.startsWith("execution-output/")), "Execution output storage identity is missing");
    for (const [path, file] of files) {
      // Binary objects and timeline documents use the exact byte hash as the name.
      const named = /^(?:artifacts\/(?:images\/blobs|local-timelines\/documents|[^/]+)|media\/blobs|execution-output\/blobs|audio-derivatives\/blobs)\/([a-f0-9]{64})\.[a-z]+$/.exec(path)
        ?? /^native\/[^/]+\/workspace\/image-attachments\/[a-f0-9]{64}\/[0-3]-([a-f0-9]{64})\.jpg$/.exec(path);
      if (named) fail(file.sha256 === named[1], `Content-addressed filename differs: ${path}`);
      if (path.startsWith("media/sources/")) { const value = await json(path); fail(path === `media/sources/${value.id}.json`, "Source descriptor filename differs"); await source(value); }
      else if (path.startsWith("media/manifests/")) { const value = await json(path); fail(path === `media/manifests/${value.digest}.json`, "Render manifest filename differs"); await renderManifest(value); }
      else if (path.startsWith("media/completions/")) {
        const receipt = await json(path); await renderManifest(receipt.manifest);
        fail(object(receipt.artifact) && receipt.artifact.manifestDigest === receipt.manifest.digest
          && path === `media/completions/${receipt.manifest.digest}-${receipt.artifact.sha256}.json`, "Render receipt identity differs");
        fail(receipt.artifact.path === join(originalRoot, "media", "blobs", `${receipt.artifact.sha256}.mp4`), "Render receipt output is outside its exact media blob path");
        absoluteReference(receipt.artifact.path, receipt.artifact.sha256, receipt.artifact.byteLength);
      } else if (path.startsWith("execution-output/manifests/")) {
        const spool = await json(path), receipt = get("execution_output_receipt", spool.receiptId), attempt = get("attempt", spool.attemptId);
        fail(spool.version === 1 && spool.storageId === storageId && spool.id === spool.receiptId && path === `execution-output/manifests/${spool.id}.json`
          && spool.projectId === receipt.projectId && spool.projectId === attempt.projectId && spool.attemptId === receipt.attemptId
          && spool.requestDigest === receipt.requestDigest && spool.requestDigest === digest(attempt.request) && spool.port === receipt.port
          && spool.blobKey === `${spool.sha256}.blob`, "Output spool ownership differs");
        const { id, ...body } = receipt; fail(id === digest(body), "Output receipt digest differs");
        if (receipt.kind === "audio" || receipt.kind === "data" || attempt.request.kind === "speech" || attempt.request.kind === "transcription")
          assertOutputReceiptIdentity(receipt as OutputReceipt, attempt as Attempt);
        fail(receipt.source?.kind === "protected_locator" || (receipt.source?.kind === "returned_bytes"
          && receipt.source.sha256 === spool.sha256 && receipt.source.byteLength === spool.byteLength), "Spool differs from its returned byte receipt");
        required(`execution-output/blobs/${spool.blobKey}`, spool.sha256, spool.byteLength);
      } else if (path.startsWith("execution-output/slots/")) {
        const slot = await json(path), spool = await json(`execution-output/manifests/${slot.spoolId}.json`);
        fail(slot.version === 1 && slot.storageId === storageId && slot.id === digest({ projectId: slot.projectId, attemptId: slot.attemptId, port: slot.port })
          && path === `execution-output/slots/${slot.id}.json` && slot.projectId === spool.projectId && slot.attemptId === spool.attemptId
          && slot.port === spool.port && slot.sha256 === spool.sha256 && slot.byteLength === spool.byteLength, "Winning output slot differs");
      } else if (path.startsWith("video-derivations/completions/")) {
        const receipt = await json(path), intent = get("video_derivation_intent", receipt.id);
        fail(path === `video-derivations/completions/${receipt.id}.json`, "Video derivation filename differs");
        assertVideoDerivationReceipt(intent as VideoDerivationIntent, receipt as VideoDerivationReceipt, false); await source(receipt.source);
        const spool = await json(`execution-output/manifests/${intent.spoolId}.json`);
        fail(spool.sha256 === intent.rawSha256 && spool.byteLength === intent.rawByteLength && spool.attemptId === intent.attemptId, "Video derivation raw source differs");
        const slot = await json(`execution-output/slots/${intent.slotId}.json`);
        fail(slot.spoolId === intent.spoolId, "Video derivation differs from its winning raw slot");
        assertVideoDerivationIntent(intent as VideoDerivationIntent, get("attempt", intent.attemptId) as Attempt,
          { port: "video", kind: "video", mimeType: "video/mp4", extension: "mp4", sha256: spool.sha256, byteLength: spool.byteLength, fixture: false, storage: { type: "spool", spoolId: spool.id } });
      } else if (path.startsWith("audio-derivations/completions/")) {
        const receipt = await json(path), intent = get("audio_derivation_intent", receipt.id) as AudioDerivationIntent;
        fail(path === `audio-derivations/completions/${receipt.id}.json`, "Audio derivation filename differs");
        await audioIntent(intent);
        // Keep valid measured receipts even when their endpoint failed final acceptance; do not force another conversion.
        assertAudioDerivationReceipt(intent, receipt as AudioDerivationReceipt, false); await source(receipt.source);
      } else if (path.startsWith("audio-derivatives/completions/")) {
        fail(file.byteLength <= 32768, "Transcription completion exceeds its metadata bound");
        const receipt = await json(path) as TranscriptionAudioReceipt;
        fail(path === `audio-derivatives/completions/${receipt.id}.json`, "Transcription completion filename differs");
        await transcriptionCompletion(receipt);
      }
    }
    for (const row of db.prepare("SELECT kind,id,body FROM entities").iterate() as Iterable<{ kind: string; id: string; body: string }>) {
      fail(Buffer.byteLength(row.body) <= 16 * 1024 ** 2, "Saved record exceeds backup verification bound");
      const value: RecordValue = JSON.parse(row.body);
      if (row.kind === "artifact") {
        artifact(value);
        if (value.origin === "generated_audio") fail(get("audio_derivation_receipt", value.derivationId).source.artifactId === value.id,
          "Generated audio artifact lost its derivation receipt");
        if (value.origin === "transcription_response") fail(get("transcript_candidate", value.transcriptCandidateId).artifactId === value.id,
          "Raw transcription artifact lost its unreviewed candidate");
      }
      else if (row.kind === "owned_transcription_source") await ownedSource(value, value.projectId);
      else if (row.kind === "owned_transcription_proposal") await ownedProposal(value, value.projectId);
      else if (row.kind === "owned_transcription_review") {
        assertOwnedTranscriptionReview(speechReader, value.projectId, value);
        await ownedProposal(get("owned_transcription_proposal", value.proposal.id), value.projectId);
      } else if (row.kind === "owned_transcription_application") {
        assertOwnedTranscriptionApplication(speechReader, value.projectId, value);
        const resolved = resolveOwnedTranscriptionApplication(speechReader, value.projectId, value.id);
        await ownedProposal(resolved.proposal, value.projectId);
      } else if (row.kind === "candidate" && (speechReader.get("owned_transcription_review", value.grantId) || speechReader.get("owned_transcription_application", value.id))) {
        const resolved = resolveOwnedTranscriptionApplication(speechReader, value.projectId, value.id);
        await ownedProposal(resolved.proposal, value.projectId);
      }
      else if (row.kind === "media_source") {
        await source(value.source);
        if (value.origin === "generated_audio") {
          const receipt = get("audio_derivation_receipt", value.derivationId);
          fail(canonical(value) === canonical({ id: receipt.source.artifactId, projectId: receipt.projectId, source: receipt.source,
            origin: "generated_audio", attemptId: receipt.attemptId, derivationId: receipt.id }), "Generated audio source lost its exact provenance");
        }
      }
      else if (row.kind === "narration_audio") {
        if (Object.hasOwn(value, "originEvidence") || Object.hasOwn(value, "generation")) await generatedNarration(value);
        else await source(value.media);
      } else if (row.kind === "narration_prepared") {
        for (const view of value.snapshot?.segments ?? []) {
          transcriptCanonicalProvenance(speechReader, value.projectId, view.script, view.cue);
          const saved = view.audio ? speechReader.get<RecordValue>("narration_audio", view.audio.id) : undefined;
          if (!view.audio || !(Object.hasOwn(view.audio, "originEvidence") || Object.hasOwn(view.audio, "generation") || saved && Object.hasOwn(saved, "generation"))) continue;
          fail(canonical(get("narration_audio", view.audio.id)) === canonical(view.audio), "Prepared generated narration differs from its saved recording");
          await generatedNarration(view.audio);
        }
      } else if (row.kind === "narration_canonical") {
        for (const segment of value.segments ?? []) {
          assertTranscriptCanonicalSegment(speechReader, value.projectId, segment,
            { narrationRevisionId: value.narrationRevisionId, narrationVersion: value.narrationVersion });
          const provenance = segment.provenance;
          const saved = provenance ? speechReader.get<RecordValue>("narration_audio", provenance.audioId) : undefined;
          if (!provenance || provenance.originEvidence === "human_declared_supplied_recording" && !Object.hasOwn(provenance, "generation") && !(saved && Object.hasOwn(saved, "generation"))) continue;
          assertGeneratedCanonicalNarrationSegment(speechReader, value.projectId, segment,
            { narrationRevisionId: value.narrationRevisionId, narrationVersion: value.narrationVersion });
          const audio = get("narration_audio", provenance.audioId); await generatedNarration(audio);
        }
      } else if (row.kind === "narration_segment" || row.kind === "narration_cue") {
        assertTranscriptSelectionOutput(speechReader, value.projectId, row.kind, value);
      } else if (row.kind === "narration_transcript_selection") {
        assertTranscriptSelection(speechReader, value.projectId, value);
        const output = get(value.output.kind, value.output.id);
        assertTranscriptSelectionOutput(speechReader, value.projectId, value.output.kind, output);
        fail(output.id === value.id && digest(output) === value.output.digest, "Transcript selection lost its reciprocal output");
        await transcriptCandidate(get("transcript_candidate", value.candidateId) as TranscriptCandidate);
      }
      else if (row.kind === "media_render") { await renderManifest(value.manifest); if (value.artifact) {
        const saved = get("artifact", value.artifact.artifactId); fail(canonical(saved.artifact) === canonical(value.artifact), "Render artifact identity differs"); }
      }
      else if (row.kind === "execution_output_spool" || row.kind === "execution_output_slot") {
        const path = `execution-output/${row.kind === "execution_output_spool" ? "manifests" : "slots"}/${row.id}.json`;
        fail(canonical(await json(path)) === canonical(value), "Saved output metadata differs from its published receipt");
      } else if (row.kind === "video_derivation_receipt") {
        fail(canonical(await json(`video-derivations/completions/${row.id}.json`)) === canonical(value), "Saved derivation differs from its published receipt");
      } else if (row.kind === "audio_derivation_intent") {
        await audioIntent(value as AudioDerivationIntent);
      } else if (row.kind === "audio_derivation_receipt") {
        fail(canonical(await json(`audio-derivations/completions/${row.id}.json`)) === canonical(value), "Saved audio derivation differs from its published receipt");
        const intent = get("audio_derivation_intent", row.id) as AudioDerivationIntent;
        const { attempt, output } = await audioIntent(intent);
        assertNormalizedAudioIngestion(intent, attempt, output, { type: "normalized_audio", artifact: get("artifact", intent.artifactId) as any,
          derivation: value as AudioDerivationReceipt, mediaSource: get("media_source", intent.artifactId) as any });
      } else if (row.kind === "attempt") {
        const owned = assertOwnedTranscriptionAttemptInput(speechReader, value as Attempt);
        if (owned) await ownedProposal(owned.proposal, value.projectId);
        await waitingPreparation(value as Attempt);
      } else if (row.kind === "transcription_preparation_intent") {
        const attempt = get("attempt", row.id) as Attempt;
        assertTranscriptionPreparationIntent(speechReader, attempt, value as TranscriptionPreparationIntent);
        await waitingPreparation(attempt);
      } else if (row.kind === "transcription_audio_intent") {
        await transcriptionIntent(value as TranscriptionAudioIntent);
      } else if (row.kind === "transcription_audio_receipt") {
        fail(canonical(await json(`audio-derivatives/completions/${row.id}.json`)) === canonical(value), "Saved transcription preparation differs from its durable completion");
        const intent = get("transcription_audio_intent", row.id) as TranscriptionAudioIntent;
        assertTranscriptionAudioReceipt(intent, value as TranscriptionAudioReceipt);
        await transcriptionCompletion(value as TranscriptionAudioReceipt);
      } else if (row.kind === "execution_output_receipt") {
        const attempt = get("attempt", value.attemptId);
        if (value.kind === "audio" || value.kind === "data" || attempt.request.kind === "speech" || attempt.request.kind === "transcription")
          assertOutputReceiptIdentity(value as OutputReceipt, attempt as Attempt);
      } else if (["speech_execution_mapping", "speech_execution_dispatch", "speech_execution_result"].includes(row.kind)) {
        speechRecords(row.id);
      } else if (["transcription_execution_mapping", "transcription_execution_dispatch", "transcription_execution_result"].includes(row.kind)) {
        await transcriptionRecords(row.id);
      } else if (row.kind === "transcript_candidate") {
        await transcriptCandidate(value as TranscriptCandidate);
      } else if (row.kind === "request_image_projection") {
        fail(Array.isArray(value.images), "Invalid saved image projection");
        for (const [index, image] of value.images.entries()) required(`native/${value.projectId}/workspace/image-attachments/${digest({ requestId: value.requestId })}/${index}-${image.thumbnailSha256}.jpg`, image.thumbnailSha256, image.byteLength);
      } else if (row.kind === "skill_activation") {
        for (const skill of value.activation?.skills ?? []) absoluteReference(skill.entryPath, skill.entrySha256);
      } else if (row.kind === "director_skill_lock") {
        fail(Array.isArray(value.lock?.skills), "Invalid saved skill lock");
        for (const skill of value.lock.skills) fail(files.has(`skill-snapshots/${skill.packageDigest}/SKILL.md`)
          || files.has(`native/${value.projectId}/workspace/.agents/skills/${skill.packageDigest}/SKILL.md`), "A locked skill snapshot is missing");
      }
    }
    // Current canonical references must retain their owned artifact identity too.
    for (const row of db.prepare("SELECT body FROM projects").iterate() as Iterable<{ body: string }>) {
      fail(Buffer.byteLength(row.body) <= 16 * 1024 ** 2, "Project exceeds backup verification bound");
      const project = JSON.parse(row.body) as RecordValue;
      for (const ref of project.artifacts ?? []) {
        const saved = get("artifact", ref.artifactId); fail(saved.projectId === project.id && canonical(saved.artifact) === canonical(ref), "Canonical artifact ownership differs");
      }
    }
  } finally { db.close(); }
}
