import type { MessageId } from "../i18n/messages.ts";
import { formatMicros } from "./price.ts";
import { msg, type Msg } from "./types.ts";

/**
 * Settings view, Models section (SB-23, D15): one model per job, its host-configured estimate and readiness,
 * and the impact of a switch before it applies (POST /settings/models/preview, then /apply).
 * Shapes follow apps/server/src/application/project-model-settings.ts and provider-catalog.ts.
 */

export type MediaKind = "image" | "video" | "speech" | "transcription";
export const MEDIA_KINDS: readonly MediaKind[] = ["image", "video", "speech", "transcription"];

/** One installed profile as the provider catalog describes it (GET /api/providers, GET /settings/models options). */
export interface ProviderOption {
  id: string;
  label: string;
  usage?: { kind: "codex_subscription"; unit: string; quotaEstimateAvailable: boolean };
  profile: { id: string; kind: string; adapter: string; unitCostMicros: string } | null;
  estimatedCost: { currency: "USD"; unitMicros: string; basis: "fixture" | "host_configured"; actualVendorPriceVerified: boolean } | null;
  readiness: {
    configurationValid: boolean;
    registered: boolean;
    mediaTools: { required: boolean; available: boolean };
    credential: { required: boolean; present: boolean | null; backendUnavailable: boolean; apiValidated: boolean };
    nativeAccess?: { configured: boolean; authentication: string; quota: string };
    spendingPermissionRequired: boolean;
    enabledByHost: boolean;
    realExecutionEnabled: boolean;
  };
}

export interface ProviderCatalogView {
  catalogDigest: string;
  defaults: string[];
  profiles: ProviderOption[];
  realExecutionEnabled: boolean;
  /** Gemini song analysis (sections, lyrics, mood); absent on servers without it. The key itself is never sent. */
  musicListener?: MusicListenerStatus;
}

export interface MusicListenerStatus {
  id: "gemini-music";
  provider: string;
  model: string;
  /** The environment variable the key is read from. */
  variable: string;
  configured: boolean;
  backendUnavailable: boolean;
  audioLeavesMachine: string;
  /** A typical three-minute song, in USD micros. */
  typicalSongMicros: number;
}

export type ModelSelection = Record<MediaKind, string | null>;

/** GET /api/projects/:projectId/settings/models */
export interface ModelSettingsStatus {
  version: 1;
  projectId: string;
  headVersion: number;
  revisionId: string;
  capabilityLockId: string;
  selectionDigest: string;
  catalogDigest: string;
  selected: ModelSelection;
  options: ProviderOption[];
}

export type PreservedReason = "completed" | "in_flight" | "reviewed_audio" | "protected_dependency" | "outside_scope" | "unchanged";

interface WorkNode {
  nodeId: string;
  alias: string;
  kind: string;
  shotId: string | null;
}

/** POST /settings/models/preview */
export interface ModelPreview {
  version: 1;
  id: string;
  previewDigest: string;
  projectId: string;
  base: { headVersion: number; revisionId: string; capabilityLockId: string; selectionDigest: string; catalogDigest: string };
  selected: ModelSelection;
  scope: { kind: "unfinished" } | { kind: "shots"; shotIds: string[] };
  changes: (WorkNode & { fromProfileId: string; toProfileId: string })[];
  preserved: (WorkNode & { reason: PreservedReason })[];
  counts: { changed: number; preserved: number };
  generationApprovalRequired: boolean;
  allowanceRequired: boolean;
}

/** POST /settings/models/apply */
export interface ModelApplyResult {
  receipt: { previewId: string; previewDigest: string; projectId: string; headVersion: number; changedNodeIds: string[] };
  status: ModelSettingsStatus;
}

export interface Request {
  path: string;
  body: unknown;
}

// ---- jobs ----------------------------------------------------------------------

export const JOB_LABEL: Record<"director" | MediaKind, MessageId> = {
  director: "set.job.director",
  image: "set.job.image",
  video: "set.job.video",
  speech: "set.job.speech",
  transcription: "set.job.transcription",
};

const DEMO_LABEL: Record<MediaKind, MessageId> = {
  image: "set.model.demo.image",
  video: "set.model.demo.video",
  speech: "set.model.demo.speech",
  transcription: "set.model.demo.transcription",
};

const ESTIMATE: Record<MediaKind, MessageId> = {
  image: "set.estimate.image",
  video: "set.estimate.video",
  speech: "set.estimate.speech",
  transcription: "set.estimate.transcription",
};

/** A tenth of a cent, in micro-dollars: the smallest price formatMicros shows without rounding to zero. */
const TENTH_CENT = 1000;
const UNDER: Record<MediaKind, MessageId> = {
  image: "set.estimate.under.image",
  video: "set.estimate.under.video",
  speech: "set.estimate.under.speech",
  transcription: "set.estimate.under.transcription",
};

/** Job names inside a sentence ("used by keyframes, narration"): lowercase in English, the same in Chinese. */
export const JOB_IN_SENTENCE: Record<MediaKind, MessageId> = {
  image: "set.job_lc.image",
  video: "set.job_lc.video",
  speech: "set.job_lc.speech",
  transcription: "set.job_lc.transcription",
};

export const isMediaKind = (value: string): value is MediaKind => (MEDIA_KINDS as readonly string[]).includes(value);

const isFixture = (option: ProviderOption) => option.estimatedCost?.basis === "fixture" || option.profile?.adapter === "fake";

/** The model's name: the host's label for configured models; the built-in stand-ins get a translated name. */
export function modelName(option: ProviderOption): Msg {
  const kind = option.profile?.kind;
  if (isFixture(option) && kind && isMediaKind(kind)) return msg(DEMO_LABEL[kind]);
  return msg("set.model.host", { name: option.label });
}

/**
 * The host-configured estimate per operation (D15): "about $0.04 a keyframe", "uses your Codex plan" or
 * "free stand-in". Never "$0.00".
 */
export function estimateMsg(option: ProviderOption, locale: string): Msg {
  if (isFixture(option)) return msg("set.estimate.free");
  if (option.usage?.kind === "codex_subscription") return msg("set.estimate.codex");
  const micros = Number(option.estimatedCost?.unitMicros ?? option.profile?.unitCostMicros ?? 0);
  const kind = option.profile?.kind;
  if (!Number.isFinite(micros) || micros <= 0 || !kind || !isMediaKind(kind)) return msg("set.estimate.none");
  // Below a tenth of a cent the price would round to "$0.000": say "under $0.001" instead.
  if (micros < TENTH_CENT) return msg(UNDER[kind], { price: formatMicros(TENTH_CENT, locale) });
  return msg(ESTIMATE[kind], { price: formatMicros(micros, locale) });
}

export interface Readiness {
  ready: boolean;
  /** Why it cannot run, when it cannot. */
  reason: Msg | null;
}

/** Readiness from the catalog's own checks; the first missing piece is the reason. */
export function readiness(option: ProviderOption): Readiness {
  if (isFixture(option)) return { ready: true, reason: null };
  const r = option.readiness;
  if (r.realExecutionEnabled) return { ready: true, reason: null };
  const why = (id: MessageId): Readiness => ({ ready: false, reason: msg(id) });
  if (!r.configurationValid) return why("set.why.invalid");
  if (!r.enabledByHost) return why("set.why.not_enabled");
  if (!r.registered) return why("set.why.not_installed");
  if (r.credential.required && r.credential.backendUnavailable) return why("set.why.key_unreadable");
  if (r.credential.required && r.credential.present !== true) return why("set.why.key_missing");
  if (r.mediaTools.required && !r.mediaTools.available) return why("set.why.ffmpeg");
  if (r.nativeAccess && !r.nativeAccess.configured) return why("set.why.codex_image");
  return why("set.why.not_ready");
}

export interface ModelChoice {
  value: string;
  name: Msg;
  estimate: Msg;
  ready: boolean;
  reason: Msg | null;
  /** The film's saved model is no longer installed here: shown so the select stays honest, never chosen. */
  missing?: true;
}

export interface ModelRow {
  kind: MediaKind;
  job: MessageId;
  /** The saved choice; null when the film has none for this job. */
  selected: string | null;
  choices: ModelChoice[];
}

/**
 * One row per media job, in the design's order, with every installed model for that job. A saved model that
 * is no longer installed (the server keeps old profiles in the film's lock) comes first, marked missing.
 */
export function modelRows(status: ModelSettingsStatus, locale: string): ModelRow[] {
  return MEDIA_KINDS.map((kind) => {
    const choices = status.options
      // Lip sync makes only singing shots and is pinned beside the video model; it is never the video choice.
      .filter((option) => option.profile?.kind === kind && option.profile.adapter !== "fal-h3-lipsync")
      .map((option): ModelChoice => {
        const ready = readiness(option);
        return { value: option.id, name: modelName(option), estimate: estimateMsg(option, locale), ready: ready.ready, reason: ready.reason };
      });
    // Configured models first, the stand-in last, as in the design.
    choices.sort((a, b) => Number(a.name.id === DEMO_LABEL[kind]) - Number(b.name.id === DEMO_LABEL[kind]));
    const selected = status.selected[kind] ?? null;
    if (selected && !choices.some((choice) => choice.value === selected)) {
      choices.unshift({ value: selected, name: msg("set.models.saved_missing", { id: selected }), estimate: msg("set.estimate.none"), ready: false, reason: msg("set.why.not_installed"), missing: true });
    }
    return { kind, job: JOB_LABEL[kind], selected, choices };
  });
}

export const choiceFor = (row: ModelRow, value: string | null): ModelChoice | null => row.choices.find((choice) => choice.value === value) ?? null;

// ---- preview and apply -----------------------------------------------------------

/** The whole selection with one job switched, for the unfinished work only (the server's scope). */
export function previewRequest(status: ModelSettingsStatus, kind: MediaKind, profileId: string): Request {
  const profileIds = MEDIA_KINDS.map((k) => (k === kind ? profileId : status.selected[k])).filter((id): id is string => !!id);
  return {
    path: "/settings/models/preview",
    body: {
      expectedHeadVersion: status.headVersion,
      expectedSelectionDigest: status.selectionDigest,
      expectedCatalogDigest: status.catalogDigest,
      profileIds,
      scope: { kind: "unfinished" },
    },
  };
}

/** A preview applies only to the exact settings it was made from; any change since makes it stale. */
export function previewCurrent(preview: ModelPreview, status: ModelSettingsStatus): boolean {
  const base = preview.base;
  return preview.projectId === status.projectId && base.headVersion === status.headVersion && base.revisionId === status.revisionId
    && base.capabilityLockId === status.capabilityLockId && base.selectionDigest === status.selectionDigest && base.catalogDigest === status.catalogDigest;
}

/**
 * Whether Switch may apply a preview as shown: while the settings it was made from are the current ones.
 * Studio events (a Director message, a job starting or finishing) do not count by themselves: the server
 * re-checks the project, lock and pending work on apply and refuses only a real change
 * (MODEL_SETTINGS_STALE), which the view then shows as a stale row. A status read older than the preview
 * (lower head version, still being re-read) cannot speak for it.
 */
export function previewUsable(preview: ModelPreview, status: ModelSettingsStatus): boolean {
  if (status.projectId === preview.projectId && status.headVersion < preview.base.headVersion) return true;
  return previewCurrent(preview, status);
}

/**
 * Jobs whose saved model is no longer installed, other than `kind`. A preview sends every job's model and the
 * server refuses an uninstalled one (PROVIDER_SELECTION_INVALID); leaving it out would quietly put that job on
 * the built-in stand-in. So those jobs must be switched first.
 */
export function blockedBy(rows: readonly ModelRow[], kind: MediaKind): MediaKind[] {
  return rows.filter((row) => row.kind !== kind && !!choiceFor(row, row.selected)?.missing).map((row) => row.kind);
}

/**
 * One request per key at a time: asking again while the first is on its way gets the same entry (choosing
 * A, then B, then A again waits for A's first check instead of failing). The key is free again once it settles.
 */
export function sharedRequest<T extends { promise: Promise<unknown> }>(inflight: Map<string, T>, key: string, start: () => T): T {
  const running = inflight.get(key);
  if (running) return running;
  const entry = start();
  inflight.set(key, entry);
  entry.promise.then(
    () => { if (inflight.get(key) === entry) inflight.delete(key); },
    () => { if (inflight.get(key) === entry) inflight.delete(key); },
  );
  return entry;
}

export const applyRequest = (preview: ModelPreview): Request => ({ path: "/settings/models/apply", body: { previewId: preview.id, previewDigest: preview.previewDigest } });

// ---- impact ------------------------------------------------------------------------

const CHANGED: Record<MediaKind, MessageId> = {
  image: "set.impact.changed.image",
  video: "set.impact.changed.video",
  speech: "set.impact.changed.speech",
  transcription: "set.impact.changed.transcription",
};
/** The same, when the work is not tied to shots (e.g. a whole-film transcription). */
const CHANGED_PLAIN: Record<MediaKind, MessageId> = {
  image: "set.impact.changed_plain.image",
  video: "set.impact.changed_plain.video",
  speech: "set.impact.changed_plain.speech",
  transcription: "set.impact.changed_plain.transcription",
};
const KEPT: Record<MediaKind, MessageId> = {
  image: "set.impact.kept.image",
  video: "set.impact.kept.video",
  speech: "set.impact.kept.speech",
  transcription: "set.impact.kept.transcription",
};
const TITLE: Record<MediaKind, MessageId> = {
  image: "set.impact.title.image",
  video: "set.impact.title.video",
  speech: "set.impact.title.speech",
  transcription: "set.impact.title.transcription",
};

/** A short list in the interface language: "a, b, c" or "a、b、c". */
export const joinList = (items: readonly string[], locale: string): string => items.join(locale.startsWith("zh") ? "、" : ", ");

/** "3.1, 3.2" in storyboard order; long lists end with "+n". */
export function shotList(labels: readonly string[], locale: string, max = 6): string {
  const sorted = [...new Set(labels)].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  const shown = joinList(sorted.slice(0, max), locale);
  return sorted.length > max ? `${shown} +${sorted.length - max}` : shown;
}

export interface Impact {
  /** "Use {model} for keyframes?": the view fills {model} with the translated model name. */
  titleId: MessageId;
  lines: Msg[];
  /** True when something unfinished would use the new model. */
  changes: boolean;
}

/**
 * What a switch touches, from the server's preview: unfinished work of this job uses the new model, what is
 * made or running stays. Labels map shot ids to "2.3".
 */
export function impactOf(preview: ModelPreview, kind: MediaKind, labels: Readonly<Record<string, string>>, locale: string): Impact {
  const own = preview.changes.filter((change) => change.kind === kind);
  const dependent = preview.changes.filter((change) => change.kind !== kind && isMediaKind(change.kind));
  const kept = (reason: PreservedReason) => preview.preserved.filter((row) => row.kind === kind && row.reason === reason).length;
  const lines: Msg[] = [];
  if (own.length) {
    const shots = own.map((change) => (change.shotId ? labels[change.shotId] : undefined)).filter((label): label is string => !!label);
    lines.push(shots.length ? msg(CHANGED[kind], { n: own.length, shots: shotList(shots, locale) }) : msg(CHANGED_PLAIN[kind], { n: own.length }));
  } else {
    lines.push(msg("set.impact.none"));
  }
  if (dependent.length) lines.push(msg("set.impact.dependent", { n: dependent.length }));
  const made = kept("completed");
  if (made) lines.push(msg(KEPT[kind], { n: made }));
  const running = kept("in_flight");
  if (running) lines.push(msg("set.impact.running", { n: running }));
  const reviewed = kept("reviewed_audio");
  if (reviewed) lines.push(msg("set.impact.reviewed", { n: reviewed }));
  if (preview.generationApprovalRequired) lines.push(msg("set.impact.review"));
  lines.push(msg("set.impact.nothing_made"));
  return { titleId: TITLE[kind], lines, changes: own.length + dependent.length > 0 };
}

// ---- section index ---------------------------------------------------------------------

export interface PanelPlace {
  id: string;
  /** The panel's edges, in the same coordinates as `line` and `viewBottom`. */
  top: number;
  bottom: number;
}

/**
 * Which section the index marks while the page scrolls: the last panel whose top has passed `line` (just under
 * the top of the scrolling area). At the end of the scroll the last panels can never reach the line, so the one
 * last chosen in the index stays marked while it is on screen, and otherwise the panel that fills most of it.
 */
export function activeSection(panels: readonly PanelPlace[], line: number, viewBottom: number, atEnd: boolean, chosen: string | null): string | null {
  if (!panels.length) return null;
  if (atEnd) {
    const shown = (panel: PanelPlace) => Math.max(0, Math.min(panel.bottom, viewBottom) - Math.max(panel.top, line));
    const picked = panels.find((panel) => panel.id === chosen);
    if (picked && shown(picked) > 0) return picked.id;
    return panels.reduce((best, panel) => (shown(panel) >= shown(best) ? panel : best)).id;
  }
  let current = panels[0]!.id;
  for (const panel of panels) if (panel.top <= line) current = panel.id;
  return current;
}
