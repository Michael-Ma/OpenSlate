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
  | "timing"; // waiting for timing to be settled

export interface WaitingReason {
  code: WaitingCode;
  ahead?: number;
  since: string;
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
}

export interface KeyframeSlot extends MediaSlot {
  /**
   * True when a frame-view record matches the current artifact's (artifactId, sha256).
   * A view is never authority: the video confirm stays bound to reviewedFrames.
   */
  opened: boolean;
}

export interface ShotNarration {
  /** none: no line; text_only: a line exists but no voice yet; making; ready: voice exists; failed. */
  state: "none" | "text_only" | "making" | "ready" | "failed";
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
}

export interface PriceQuote {
  micros: Micros;
  units: number;
  unitMicros: Micros;
  /** The model has no configured price (unit 0 or quota-based, e.g. Codex images). Never print $0.00. */
  priceUnknown: boolean;
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
