import { errorMsg } from "../i18n/translate.ts";
import type { EditDraft } from "../store/state.ts";
import type { StudioStore } from "../store/store.ts";
import { afterFailure, formatBytes, IMPORT_LIMITS, IMPORT_MAX_SECONDS, importKind, retryable, type AfterFailure, type ChosenFile, type ImportKeys, type ImportRequest, type SavedImport } from "./assets-import.ts";
import { displayedHead } from "./displayed-baseline.ts";
import { editConflict } from "./edit-conflict.ts";
import { clock } from "./motion.ts";
import { wordsOf } from "./narration.ts";
import { msg, type Msg } from "./types.ts";

/**
 * A recording as a shot's narration (classic-UI parity, card B13):
 *   POST /api/projects/:projectId/shots/:shotId/narration/recording?expectedHeadVersion=N
 * The raw audio bytes as application/octet-stream with an Idempotency-Key. The studio imports and measures the
 * recording, sets the shot to "my recording", attaches it, and accepts it when it fits the shot. A recording
 * longer than the shot stays attached and is settled through the narration-fit choices (Make N s / Keep N s).
 * Free: nothing is sent to a service. One Undo restores the shot's narration as it was. Pure.
 */

/** The studio's managed upload limit for recordings (128 MiB), and its media length limit (6 minutes). */
export const RECORDING_MAX_BYTES = IMPORT_LIMITS.audio;
export const RECORDING_MAX_SECONDS = IMPORT_MAX_SECONDS;
export const RECORDING_ACCEPT = "audio/*,.wav,.mp3,.m4a,.aac,.flac,.ogg,.oga,.opus,.aif,.aiff,.weba";

/** The project-relative route, query included. */
export const recordingPath = (shotId: string, headVersion: number): string =>
  `/shots/${encodeURIComponent(shotId)}/narration/recording?expectedHeadVersion=${headVersion}`;

/** Which file for which shot: the same file chosen again (even after a reload) resends its saved request. */
export const recordingIdentity = (shotId: string, file: Pick<File, "name" | "size" | "lastModified">): string =>
  ["narration-recording", shotId, file.size, file.lastModified, file.name].join(":");

export type RecordingCheck = { ok: true } | { ok: false; refusal: Msg };

/** Refused before anything is sent: not audio, empty, or over the studio's byte limit. */
export function checkRecording(file: ChosenFile): RecordingCheck {
  if (importKind(file) !== "audio") return { ok: false, refusal: msg("narr.refusal.type") };
  if (file.size <= 0) return { ok: false, refusal: msg("narr.refusal.empty") };
  if (file.size > RECORDING_MAX_BYTES) return { ok: false, refusal: msg("narr.refusal.too_large", { size: formatBytes(file.size), limit: formatBytes(RECORDING_MAX_BYTES) }) };
  return { ok: true };
}

/** Refused before sending when the browser can read the length and it is over 6 minutes; an unknown length is left to the studio. */
export function checkRecordingLength(seconds: number | null): RecordingCheck {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= RECORDING_MAX_SECONDS + 0.05) return { ok: true };
  return { ok: false, refusal: msg("narr.refusal.too_long", { length: clock(seconds) }) };
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/** "take-3.wav · 820 KB · 4.2 s", or without the length while the browser cannot tell it. */
export function recordingFileMsg(file: Pick<ChosenFile, "name" | "size">, seconds: number | null): Msg {
  return seconds === null ? msg("narr.file", { name: file.name, size: formatBytes(file.size) }) : msg("narr.file_length", { name: file.name, size: formatBytes(file.size), seconds: round1(seconds) });
}

/** Said under the file before sending: a recording longer than the shot is attached, then fitted through the usual choices. */
export function recordingFitNote(seconds: number | null, shotSeconds: number): Msg | null {
  if (seconds === null || seconds <= shotSeconds + 1e-6) return null;
  return msg("narr.file_long", { seconds: round1(seconds), shot: shotSeconds });
}

/** The route's receipt (apps/server/src/narration/shot-recording-routes.ts). */
export interface RecordingReceipt {
  shotId: string;
  headVersion: number;
  /** The storyboard command, for Undo. */
  commandId?: string;
  fits: boolean;
  measuredSeconds: number;
  recording: { id: string; sha256: string; samples: number };
  /** Exact narration saved by this command, including the studio's stand-in for an uncaptioned recording. */
  shot?: { shotId: string; headVersion: number; segment: { script: { text: string } } | null };
}

export function isRecordingReceipt(value: unknown): value is RecordingReceipt {
  const receipt = value as Partial<RecordingReceipt> | null;
  return !!receipt && typeof receipt.shotId === "string" && typeof receipt.fits === "boolean" && typeof receipt.measuredSeconds === "number";
}

type RecordingStore = Pick<StudioStore, "getState" | "dispatch">;
export interface RecordingWriteOwner {
  projectId: string;
  projectEpoch: number;
  shotId: string;
  revision: number;
}

/** Only the retained request for this exact recording route can bypass a changed display to check its receipt. */
export function isRecordingReplay(shotId: string, saved: SavedImport | undefined): saved is SavedImport {
  if (!saved?.key) return false;
  const prefix = `/shots/${encodeURIComponent(shotId)}/narration/recording?expectedHeadVersion=`;
  if (!saved.path.startsWith(prefix)) return false;
  const version = saved.path.slice(prefix.length);
  return /^(0|[1-9][0-9]*)$/.test(version) && Number.isSafeInteger(Number(version));
}

/** A captured receipt check keeps its exact key/path even when the saved entry's TTL expires before sending. */
export function recordingRequest(keys: Pick<ImportKeys, "begin">, identity: string, freshPath: string, replay?: SavedImport): ImportRequest {
  return replay ? { key: replay.key, path: replay.path, resent: true } : keys.begin(identity, freshPath);
}

/** Exact receipt checks send no new edits; field/projection differences must not strand a lost upload reply. */
export function recordingSaveBlocked(blocked: Msg | null, replay: boolean): Msg | null {
  return replay && (blocked?.id === "error.EDIT_BASELINE_CHANGED" || blocked?.id === "error.PROJECTION_CHANGED") ? null : blocked;
}

/** Keep this upload's editor identity through newer typing without lending it to a reopened form. */
export function beginRecordingWrite(store: RecordingStore, draft: EditDraft, replay?: SavedImport): RecordingWriteOwner | null {
  const state = store.getState(), current = state.edit;
  if (!draft.projectId || draft.revision === undefined || !current || current.saving
    || state.projectId !== draft.projectId || current.projectId !== draft.projectId || current.field !== "narration"
    || current.shotId !== draft.shotId || current.revision !== draft.revision
    || !isRecordingReplay(draft.shotId, replay) && editConflict(current, state.overview, displayedHead(state.projectId, state.snapshot, state.overview)).kind !== "none") return null;
  const owner = { projectId: draft.projectId, projectEpoch: state.projectEpoch, shotId: draft.shotId, revision: draft.revision };
  store.dispatch({ type: "edit", edit: { ...current, saving: true, recordingRevision: owner.revision } });
  return owner;
}

function recordingDraft(store: RecordingStore, owner: RecordingWriteOwner): EditDraft | null {
  const state = store.getState(), draft = state.edit;
  return state.projectId === owner.projectId && state.projectEpoch === owner.projectEpoch && draft?.projectId === owner.projectId
    && draft.shotId === owner.shotId && draft.field === "narration" && draft.recordingRevision === owner.revision ? draft : null;
}

/** A stale replay may get a fresh key only while its original field inputs and editor owner still hold. */
export function recordingCanRetryFresh(store: RecordingStore, owner: RecordingWriteOwner, words?: string): boolean {
  const draft = recordingDraft(store, owner), state = store.getState();
  return !!draft && editConflict(draft, state.overview, displayedHead(state.projectId, state.snapshot, state.overview)).kind === "none"
    && (words === undefined || words.trim() === wordsOf(draft.baselineValue ?? "").trim());
}

/** A refusal/close releases only this upload's local saving flag; it never changes the saved-value baseline. */
export function endRecordingWrite(store: RecordingStore, owner: RecordingWriteOwner): void {
  const current = recordingDraft(store, owner);
  if (!current) return;
  const { recordingRevision: _owner, ...draft } = current;
  store.dispatch({ type: "edit", edit: { ...draft, saving: false } });
}

/**
 * The upload is an own Save: rebase to its immutable receipt, not a later refreshed saved line. The receipt
 * may predate another writer; keeping its exact text ensures that writer still produces a real conflict.
 */
export function acknowledgeRecording(store: RecordingStore, owner: RecordingWriteOwner, value: unknown): boolean {
  const current = recordingDraft(store, owner);
  if (!current || !isRecordingReceipt(value) || value.shotId !== owner.shotId || !Number.isSafeInteger(value.headVersion)
    || value.headVersion < 0 || value.shot?.shotId !== owner.shotId || value.shot.headVersion !== value.headVersion
    || typeof value.shot.segment?.script?.text !== "string") return false;
  const { recordingRevision: _owner, ...draft } = current;
  store.dispatch({ type: "edit", edit: { ...draft, saving: false, baselineValue: value.shot.segment.script.text, expectedHeadVersion: value.headVersion } });
  return true;
}

/**
 * The toast after a recording is added: its measured length, and whether it still needs fitting. `newWords`: its
 * words were saved first as their own command, so the toast's Undo (the recording's) leaves them as they are now.
 */
export function recordingDone(label: string, receipt: Pick<RecordingReceipt, "fits" | "measuredSeconds">, shotSeconds: number, newWords = false): Msg {
  const values = { shot: label, seconds: round1(receipt.measuredSeconds) };
  if (receipt.fits) return msg(newWords ? "narr.toast.recording_words" : "narr.toast.recording", values);
  return msg(newWords ? "narr.toast.recording_long_words" : "narr.toast.recording_long", { ...values, length: shotSeconds });
}

/**
 * The words of a recording are saved before its bytes are sent (the studio keeps the shot's words as the
 * recording's subtitle). When the recording is then not added (stopped, refused, failed), that save is undone;
 * `restored` says it was, `kept` that it could not be (the words stay saved), `none` that no words were saved.
 */
export type WordsAfterFailure = "none" | "restored" | "kept";

/** Said with the panel's stopped or refused state: what happened to the words saved for the recording. */
export function wordsNote(words: WordsAfterFailure): Msg | null {
  return words === "restored" ? msg("narr.words.restored") : words === "kept" ? msg("narr.words.kept") : null;
}

/**
 * The toast when the panel was closed before a recording finished: sending stopped (closing it stops the bytes),
 * or the studio's refusal, unless the words saved for it could not be undone: then that is what it says.
 */
export function notAddedToast(label: string, stopped: boolean, words: WordsAfterFailure, refusal: Msg): Msg {
  const values = { shot: label };
  if (stopped) return msg(words === "kept" ? "narr.toast.stopped_words" : "narr.toast.stopped", values);
  return words === "kept" ? msg("narr.toast.not_added_words", values) : refusal;
}

/** What to do with a saved request after a failure (keep the key for an unknown answer, a fresh one after a stale resend). */
export const afterRecordingFailure = (code: string, resent: boolean): AfterFailure => afterFailure(code, resent);

/** Whether the same file can work on another try (an unknown answer, a film that moved, bytes changed on the way). */
export const recordingRetryable = (code: string): boolean => retryable(code) || code === "CONFIRMATION_RUNNING";

/** Server and client codes for this route, said in the interface language. Neutral: an icon and words. */
export function recordingRefusal(code: string): Msg {
  if (code.startsWith("AUDIO_PCM_")) return msg(code === "AUDIO_PCM_DURATION_LIMIT" ? "narr.refusal.too_long_server" : "narr.refusal.unreadable");
  if (code.startsWith("MEDIA_TOOL_")) return msg(code === "MEDIA_TOOL_UNAVAILABLE" ? "narr.refusal.unavailable" : "narr.refusal.unreadable");
  switch (code) {
    case "NARRATION_MEDIA_UNAVAILABLE":
    case "SERVICE_UNAVAILABLE":
      return msg("narr.refusal.unavailable");
    case "UPLOAD_TOO_LARGE":
    case "MEDIA_INPUT_LIMIT":
    case "AUDIO_NORMALIZATION_INPUT_LIMIT":
      return msg("narr.refusal.too_large_server");
    case "MEDIA_DURATION_LIMIT":
      return msg("narr.refusal.too_long_server");
    case "MEDIA_UNSUPPORTED":
    case "MEDIA_INVALID_INPUT":
    case "MEDIA_STREAM_MISSING":
    case "MEDIA_VALIDATION_FAILED":
    case "MEDIA_INTEGRITY_ERROR":
    case "NARRATION_RECORDING_REQUIRED":
      return msg("narr.refusal.unreadable");
    case "VALIDATION_ERROR":
      return msg("narr.refusal.empty");
    case "MEDIA_TIMEOUT":
      return msg("narr.refusal.slow");
    case "REVISION_CONFLICT":
      return msg("narr.refusal.changed");
    case "UPLOAD_CORRUPT":
      return msg("narr.refusal.corrupt");
    case "CONFIRMATION_RUNNING":
      return msg("narr.refusal.confirming");
    case "IDEMPOTENCY_CONFLICT":
      return msg("narr.refusal.key");
    case "NOT_FOUND":
      return msg("narr.refusal.gone");
    case "NETWORK_ERROR":
    case "TIMEOUT":
    case "REQUEST_FAILED":
      return msg("narr.refusal.network");
    case "AUTH_REQUIRED":
    case "CSRF_DENIED":
    case "SESSION_CLOSED":
      return msg("narr.refusal.session");
    case "INSTALLATION_QUARANTINED":
      return msg("narr.refusal.recovery");
    default:
      return errorMsg(code);
  }
}

/** Bytes sent as a real fraction; the studio's check afterwards has none, so it is drawn indeterminate. */
export function sendingMsg(loaded: number, total: number): { fraction: number; label: Msg } {
  const whole = Math.max(total, 1);
  const sent = Math.min(Math.max(loaded, 0), whole);
  return { fraction: sent / whole, label: msg("narr.sending", { sent: formatBytes(sent), total: formatBytes(whole) }) };
}
