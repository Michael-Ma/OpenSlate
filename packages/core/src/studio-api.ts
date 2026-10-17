/**
 * Browser-facing contract for the Last Ferry studio (docs/ai/UIUX-IMPLEMENTATION-PLAN.md).
 *
 * Types only. The server builds these shapes; the web reads them. Change this file
 * only together with both sides. Every status is a code, never an English sentence:
 * the web maps codes to message ids in both locales.
 */

/** Money in integer micro-dollars, as a decimal string (matches ProviderProfile.unitCostMicros). */
export type Micros = string;

export interface StudioArtifactRef {
  artifactId: string;
  sha256: string;
  kind: "image" | "video" | "audio";
}

// ---------------------------------------------------------------------------
// GET /api/projects/:projectId/generation  (GR-1, GR-2, GR-5, GR-9..GR-12)
// ---------------------------------------------------------------------------

/**
 * One state per media slot. Exactly one applies:
 * - none: never made (or detached by Stop / give-up and not made again)
 * - direction_required: the shot still has placeholder direction; making it would waste money
 * - queued: bound and waiting to be sent; see `waiting`
 * - running: an attempt is in flight; see `phase` and `startedAt`
 * - ready: a current output exists
 * - outdated: an earlier output exists but an edit changed its intent; see `previous` and `outdatedFields`
 * - failed: the last attempt failed; see `failure`
 * - no_answer: the provider never confirmed the submission (submission_unknown); see `attemptId`
 * - choose_take: more than one active alternative; a person must pick one
 */
export type MediaState =
  | "none"
  | "direction_required"
  | "queued"
  | "running"
  | "ready"
  | "outdated"
  | "failed"
  | "no_answer"
  | "choose_take";

/** Why a queued slot is not moving. */
export type WaitingCode =
  | "capacity" // behind other jobs on the same model; `ahead` says how many
  | "edit_pending" // held by an open edit or Director turn covering this shot
  | "stopped" // the film is stopped
  | "review" // waiting for a human confirm
  | "voice" // waiting for the voice line
  | "input_pending" // waiting for required media other than the voice line
  | "unknown" // the studio has not reported a recognized waiting reason
  | "timing"; // waiting for timing to be settled

export interface WaitingReason {
  code: WaitingCode;
  ahead?: number;
  since: string;
  /** edit_pending: the unfinished request whose holds the person can let go (card B13). */
  requestId?: string;
}

export interface MediaFailure {
  /** Provider or engine failure id, mapped to a message id by the web. */
  code: string;
  technical: boolean;
  retryAllowed: boolean;
  /** Automatic technical retries still available for this candidate. */
  autoRetriesLeft: number;
  /** True unless the reservation was released (engine reservation state "released"). */
  charged: boolean;
  at: string;
}

export interface MediaSlot {
  state: MediaState;
  /** Engine attempt phase while running (e.g. "queued", "submitting", "running", "ingesting"). */
  phase?: string;
  startedAt?: string;
  /** Present for running and no_answer; the target of POST .../attempts/:attemptId/release. */
  attemptId?: string;
  /** The current output (ready). */
  artifact?: StudioArtifactRef;
  /** The output that was current before the latest edit or regenerate (outdated, running, failed). */
  previous?: StudioArtifactRef;
  /** Number of outputs ever made for this shot and kind, including the current one. */
  takeCount: number;
  failure?: MediaFailure;
  waiting?: WaitingReason;
  /** Shot fields whose change outdated the output, e.g. ["imagePrompt"]. */
  outdatedFields?: string[];
  /** A released no-answer attempt is still polled; a late result becomes an earlier take. */
  releasedAttemptIds?: string[];
  /** The slot was taken off by Stop or by giving up on a job with no answer; it needs a new press. */
  takenOff?: "stopped" | "released";
  /**
   * A replacement take in progress while the current output stays shown (state "ready"): its own state,
   * so a no-answer replacement can be given up (attemptId) and a failed one explained.
   */
  replacement?: { state: "running" | "queued" | "failed" | "no_answer"; attemptId?: string; phase?: string; failure?: MediaFailure; waiting?: WaitingReason };
}

export interface KeyframeSlot extends MediaSlot {
  /**
   * True when a frame-view record matches the current artifact's (artifactId, sha256).
   * A view is never authority: the video confirm stays bound to reviewedFrames.
   */
  opened: boolean;
}

export interface ShotNarration {
  /** none: no line; text_only: a line exists but no voice yet; making; ready: voice exists; failed; no_answer: outcome unknown. */
  state: "none" | "text_only" | "making" | "ready" | "failed" | "no_answer";
  text: string;
  /** Measured length of the accepted or current voice line. */
  measuredSeconds?: number;
  /** Rough text estimate (0.3 s per word, or per CJK character) when no voice exists yet. */
  estimatedSeconds?: number;
  /** null while the length is unknown. */
  fits: boolean | null;
  /** How a too-long line was settled, if it was. */
  fit?: "cut_to_shot" | "extend_shot";
}

export interface ShotOverview {
  shotId: string;
  sceneId: string;
  /** "2.3": scene ordinal and shot ordinal, 1-based. */
  label: string;
  framing: string;
  purpose: string;
  imagePrompt: string;
  motion: string;
  durationFrames: number;
  keyframe: KeyframeSlot;
  video: MediaSlot;
  narration: ShotNarration;
  /** Exact selected-shot estimate, including a missing voice line. */
  quotes?: { regenerateKeyframe: PriceQuote };
}

export interface PriceQuote {
  micros: Micros;
  units: number;
  unitMicros: Micros;
  /** At least one per-call operation has no configured price. Never print $0.00. */
  priceUnknown: boolean;
  /** Some operations use this subscription. Per-call micros may also be present (e.g. voice); absent on historical quotes. */
  subscription?: "codex";
}

export type SceneState =
  | "not_started"
  | "keyframes_partial"
  | "keyframes_back"
  | "making_video"
  | "video_saved"
  | "needs_attention";

export type SceneBlockerCode =
  | "frame_not_opened"
  | "narration_too_long"
  | "narration_making"
  | "no_answer_in_scene"
  | "stopped"
  | "director_working"
  | "direction_required"
  | "keyframe_missing"
  | "recommendation_open"
  | "confirmation_running";

export interface SceneBlocker {
  code: SceneBlockerCode;
  shotId?: string;
}

export interface SceneOverview {
  sceneId: string;
  /** 1-based. */
  ordinal: number;
  title: string;
  purpose: string;
  state: SceneState;
  shotIds: string[];
  counts: { shots: number; keyframesReady: number; opened: number; videosReady: number };
  /** The shots a video confirm would make, by the server's own target rule. */
  videoTargets: string[];
  /** The shots a "make keyframes" press would make. */
  keyframeTargets: string[];
  quotes: {
    makeKeyframes?: PriceQuote;
    regenerateKeyframe?: PriceQuote;
    confirmVideo?: PriceQuote;
    voice?: PriceQuote;
  };
  /** Why confirm is unavailable right now (empty when it is available). */
  blockers: SceneBlocker[];
  /** Freshness token the confirm command must echo. */
  confirmationDigest: string | null;
  confirmation?: SceneConfirmationView;
}

export interface SceneConfirmationView {
  confirmationId: string;
  state: "running" | "blocked" | "done" | "cancelled";
  currentShotId?: string;
  currentStep?: "speech" | "attach" | "accept" | "video";
  blocker?: { code: string; shotId?: string };
}

export interface StopView {
  stopId: string;
  at: string;
  /** Jobs already sent when the film stopped; they finish and are charged. */
  sentJobs: number;
  /** Bound but unsent jobs that Stop detached; they need a new confirm. */
  detachedJobs: number;
}

export interface DirectorActivity {
  state: "idle" | "working" | "waiting_user";
  /** Scene or shot ids the current turn or question covers; empty means the whole film. */
  scopeIds: string[];
  requestId?: string;
}

export interface GenerationOverview {
  projectId: string;
  revisionId: string;
  headVersion: number;
  /** Event cursor the overview was built at. */
  cursor: number;
  fps: number;
  stopped: StopView | null;
  director: DirectorActivity;
  /** Control authority to echo on resume; null when no control authority exists. */
  controlAuthorityId: string | null;
  scenes: SceneOverview[];
  shots: Record<string, ShotOverview>;
  /** no_answer attempts created before the current server start. */
  restartCasualties: string[];
}

// ---------------------------------------------------------------------------
// Commands. Every paid or state-changing command requires an Idempotency-Key header.
// ---------------------------------------------------------------------------

/** POST /api/projects/:projectId/shots/:shotId/frame-views  (GR-2). No hold, no message, no authority. */
export interface FrameViewInput {
  artifactId: string;
  sha256: string;
}
export interface FrameViewReceipt {
  shotId: string;
  artifactId: string;
  sha256: string;
  at: string;
}

/** POST /api/projects/:projectId/attempts/:attemptId/release  (GR-10). */
export interface ReleaseAttemptInput {
  expectedPhase: "submission_unknown";
  /** Must be true: the old job may still finish and be charged. */
  acknowledgeDoubleCharge: true;
}
export interface ReleaseAttemptReceipt {
  attemptId: string;
  shotId: string | null;
  releasedAt: string;
}

/** POST /api/projects/:projectId/controls  (GR-13). */
export type ControlInput =
  | { action: "stop" }
  | { action: "resume"; expectedAuthorityId: string | null };
export interface ControlReceipt {
  action: "stop" | "resume";
  stopped: StopView | null;
}

/** Who started a request. Only "user" requests appear in the conversation as the user's words. */
export type RequestSource = "user" | "app" | "director";

/** New error codes introduced by this contract. */
export type StudioErrorCode =
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "FRAME_STALE"
  | "EXECUTION_PAUSED"
  | "ESTIMATE_CHANGED"
  | "SCENE_EMPTY"
  | "DIRECTION_REQUIRED"
  | "SHOT_SHORTER_THAN_NARRATION"
  | "ATTEMPT_NOT_RELEASABLE"
  | "DOUBLE_CHARGE_NOT_ACKNOWLEDGED"
  | "HUMAN_EDITED_FIELD";

// ---------------------------------------------------------------------------
// Director notes (phase P4: DC-1, DC-9, DC-10). Returned in the project snapshot as `notes`.
// ---------------------------------------------------------------------------

/** App-owned summary on snapshot.turns[].notesSaveFailure; never model prose or note content. */
export interface ReviewNotesFailure {
  code: string;
  reason: "invalid_anchor" | "invalid_arguments" | "outside_scope" | "unseen_keyframe" | "missing_keep_choice" | "unavailable" | "unknown";
}

/**
 * A typed action attached to a note. The web renders every label from the action itself
 * ("Make 2.3 8 s", "Regenerate 2.2"); the model never writes button text, except the short
 * `label` of an "accept" choice (e.g. "Keep maroon").
 */
export type NoteChoice =
  | { kind: "accept"; label: string }
  | { kind: "proposal"; proposalId: string }
  | { kind: "regenerate_keyframe"; shotIds: string[] }
  | { kind: "edit_field"; shotId: string; field: "narration" | "imagePrompt" | "motion" }
  | { kind: "reply" };

export interface DirectorNote {
  noteId: string;
  requestId: string;
  turnId: string;
  /** App-assigned per turn: "a", "b", ... */
  letter: string;
  anchor: { sceneId?: string; shotIds?: string[] };
  kind: "observation" | "recommendation";
  /** A blocking note must be settled before the scene's video confirm. */
  blocking: boolean;
  text: string;
  /** The keyframe the Director looked at when writing the note, if any. */
  seenKeyframe?: { shotId: string; artifactId: string; sha256: string };
  choices: NoteChoice[];
  /** stale: the anchored shot or the seen keyframe changed since the note was written. */
  state: "open" | "resolved" | "stale";
  resolution?: { choiceIndex: number; at: string; resultRef?: string };
  version: number;
  createdAt: string;
}

/** POST /api/projects/:projectId/director/notes/:noteId/resolve (Idempotency-Key required). */
export interface ResolveNoteInput {
  choiceIndex: number;
  expectedVersion: number;
  /** The request or edit that carried out the choice (a regenerate press, a hand edit). */
  resultRef?: string;
}

// ---------------------------------------------------------------------------
// Export from storyboard order (phase P5: SB-15..SB-18)
// ---------------------------------------------------------------------------

export type ExportBlockerCode = "no_clip" | "clip_outdated" | "voice_unsettled" | "mixed_demo_media" | "too_long" | "empty_film";

export interface ExportReadiness {
  ready: boolean;
  /** Every shot's clip is a demo fixture: the export is stamped "Demo". */
  demo: boolean;
  seconds: number;
  blockers: { code: ExportBlockerCode; shotId?: string }[];
}

export interface ExportRecord {
  exportId: string;
  state: "rendering" | "done" | "failed" | "cancelled";
  headVersion: number;
  demo: boolean;
  startedAt: string;
  finishedAt?: string;
  /** The MP4 when done. Download through the artifact content route. */
  artifact?: StudioArtifactRef;
  failure?: { code: string };
  /** What changed in the film since this export (empty when it is current). */
  outdatedBy: ("shots" | "order" | "music" | "narration")[];
}

/** GET /api/projects/:projectId/exports */
export interface ExportView {
  readiness: ExportReadiness;
  current: ExportRecord | null;
  history: ExportRecord[];
}

/** POST /api/projects/:projectId/exports (Idempotency-Key required) and POST .../exports/:exportId/cancel | recover. */
export interface StartExportInput {
  expectedHeadVersion: number;
}

// ---------------------------------------------------------------------------
// Phase P3: the server owns the generation chain (GR-3, GR-4, SB-2, SB-3, SB-5, SB-9, GR-6)
// ---------------------------------------------------------------------------

/**
 * POST /api/projects/:projectId/scenes/:sceneId/confirm (Idempotency-Key required).
 * One durable command: it binds the opened frames, makes any voice line still missing, settles
 * narration by the chosen fit, then makes the clips. Returns the confirmation's view.
 */
export interface ConfirmSceneInput {
  confirmationDigest: string;
  reviewedFrames: { shotId: string; artifactId: string; sha256: string }[];
  expectedEstimateMicros?: Micros;
}

/**
 * POST /api/projects/:projectId/shots/:shotId/narration-fit (Idempotency-Key required). Free.
 * extend_shot: lengthen the shot to fit the line (whole seconds, within the model's range) and accept the line.
 * cut_to_shot: keep the shot length and accept the line cut at the shot's end with a short fade.
 */
export interface NarrationFitInput {
  fit: "extend_shot" | "cut_to_shot";
  expectedHeadVersion: number;
}
export interface NarrationFitReceipt {
  shotId: string;
  fit: "extend_shot" | "cut_to_shot";
  durationFrames: number;
  /** Storyboard command id, for Undo. */
  commandId: string;
}

/** POST /api/projects/:projectId/shots/:shotId/takes/:artifactId/use (Idempotency-Key required). Free; outdates the clip. */
export interface UseTakeReceipt {
  shotId: string;
  artifactId: string;
  commandId: string;
}

/** Earlier takes of a shot, newest first. GET /api/projects/:projectId/shots/:shotId/takes */
export interface ShotTakes {
  shotId: string;
  /** `selectable` false: an earlier frame the shot cannot switch back to (e.g. a shared conditioning source). */
  keyframes: { artifact: StudioArtifactRef; current: boolean; createdAt: string; selectable: boolean }[];
}

// ---------------------------------------------------------------------------
// Held Director proposals (phase P4: DC-2, DC-3, DC-4, DC-5; decision D1)
// ---------------------------------------------------------------------------

export type MediaEffect = "keeps_keyframe" | "keyframe_remade" | "clip_remade" | "voice_remade" | "no_media_yet";

/** App-computed preview of a proposal; the web draws Now / After from it without diffing anything itself. */
export interface ProposalPreview {
  changes: { shotId?: string; sceneId?: string; field: string; before: string; after: string }[];
  /** Per-shot seconds now and after, in film order, for the Now / After timeline. */
  timeline: { shotId: string; sceneId: string; label: string; nowSeconds: number; afterSeconds: number; changed: boolean }[];
  effects: { shotId: string; effect: MediaEffect }[];
  filmSecondsNow: number;
  filmSecondsAfter: number;
}

export interface DirectorProposal {
  proposalId: string;
  noteId?: string;
  requestId: string;
  state: "held" | "accepted" | "rejected" | "stale" | "undone";
  /** Why it went stale, e.g. SHOT_CHANGED. */
  staleReason?: string;
  preview: ProposalPreview;
  previewDigest: string;
  createdAt: string;
  /** After accept: what can be undone. Fields a person changed since are left alone. */
  accepted?: { at: string; touchedFields: { shotId?: string; sceneId?: string; field: string }[] };
}

/** GET /api/projects/:projectId/director/proposals */
export interface ProposalList {
  proposals: DirectorProposal[];
}

/** POST .../director/proposals/:proposalId/accept (Idempotency-Key required). reject and undo take no body. */
export interface AcceptProposalInput {
  previewDigest: string;
}
export interface ProposalReceipt {
  proposal: DirectorProposal;
  /** For undo: fields left as the person changed them. */
  leftAlone?: { shotId?: string; field: string }[];
}

// ---------------------------------------------------------------------------
// Scenes, projects and the asset library (phase P5: SB-13, SB-14, SB-21, SB-24)
// ---------------------------------------------------------------------------

/** GET /api/projects: each film with its status counts. */
export interface ProjectListItem {
  id: string;
  name: string;
  archived: boolean;
  scenes: number;
  shots: number;
  seconds: number;
  videosReady: number;
  updatedAt: string;
}

export type AssetRole = "keyframe" | "clip" | "voice" | "music" | "upload" | "export";

/** GET /api/projects/:projectId/assets?sceneId=&shotId=&role= */
export interface AssetItem {
  artifact: StudioArtifactRef;
  role: AssetRole;
  sceneId?: string;
  shotId?: string;
  /** 1-based take number for keyframes and clips. */
  takeIndex?: number;
  current: boolean;
  source: "generated" | "imported" | "demo";
  label: string;
  createdAt: string;
  durationSeconds?: number;
}

// ---------------------------------------------------------------------------
// This computer (Start and Settings): GET /api/installation/status. No secrets, no paths beyond tool names.
// ---------------------------------------------------------------------------

export interface InstallationStatus {
  codex: { found: boolean; version: string | null; pinnedVersion: string | null; signedIn: boolean | null };
  mediaTools: { ffmpeg: { available: boolean; version: string | null }; ffprobe: { available: boolean; version: string | null } };
  /** Whether real providers are configured at all; false means only the demo path works. */
  providersConfigured: boolean;
}
