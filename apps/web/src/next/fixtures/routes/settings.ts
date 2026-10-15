import { ApiError } from "../../api/client.ts";
import type { DirectorSelection, DirectorSetup } from "../../model/settings-director.ts";
import type { PersonalVoice } from "../../model/settings-voice.ts";
import { STOCK_VOICES } from "../../model/settings-voice.ts";
import { MEDIA_KINDS, type MediaKind, type ModelPreview, type ModelSelection, type ModelSettingsStatus, type ProviderCatalogView, type ProviderOption } from "../../model/settings.ts";
import type { FixtureWorld } from "../fixture-port.ts";
import type { FixtureRoute } from "./types.ts";

/**
 * Simulated server routes the Settings view needs in the sample film: models with preview and apply,
 * the provider catalog, Director setup, the review switch (server card B10), the narrator voice and
 * personal voices. Nothing is checked on this computer and nothing is saved.
 */

interface SettingsState {
  selected: ModelSelection;
  lock: number;
  previews: Map<string, ModelPreview>;
  /** The pending work each preview was made from (the server's work digest), by preview id. */
  previewWork: Map<string, string>;
  director: DirectorSelection;
  directorRevision: number;
  catalogStatus: DirectorSetup["modelCatalogStatus"];
  review: boolean;
  narratorVoice: string;
  voices: PersonalVoice[];
  next: number;
}

const states = new WeakMap<FixtureWorld, SettingsState>();

function state(world: FixtureWorld): SettingsState {
  let current = states.get(world);
  if (!current) {
    current = {
      selected: { image: "openai-image-2", video: "minimax-h3", speech: "openai-tts", transcription: "openai-whisper" },
      lock: 1,
      previews: new Map(),
      previewWork: new Map(),
      director: { mode: "native", binaryPath: "/usr/local/bin/codex", model: "gpt-6-astra" },
      directorRevision: 1,
      catalogStatus: "ready",
      review: true,
      narratorVoice: "cedar",
      voices: [{ id: "openai-custom:voice_m7f3a", identityId: hex("voice", 1), label: "Michael (my voice)", provider: "openai", ready: true, state: "registered", providerAccessVerified: false }],
      next: 1,
    };
    states.set(world, current);
  }
  return current;
}

/** A 64-character lowercase hex stand-in for the server's digests. */
function hex(seed: string, n: number): string {
  let out = "";
  for (const char of `${seed}:${n}`) out += char.charCodeAt(0).toString(16);
  return out.padEnd(64, "0").slice(0, 64);
}

// ---- the installed catalog -----------------------------------------------------------------

const READY = { configurationValid: true, registered: true, mediaTools: { required: true, available: true }, credential: { required: true, present: true, backendUnavailable: false, apiValidated: false }, spendingPermissionRequired: false, enabledByHost: true, realExecutionEnabled: true };
const DEMO_READY = { configurationValid: true, registered: true, mediaTools: { required: false, available: true }, credential: { required: false, present: null, backendUnavailable: false, apiValidated: false }, spendingPermissionRequired: false, enabledByHost: false, realExecutionEnabled: false };

function option(id: string, label: string, kind: MediaKind, adapter: string, micros: string, extra: Partial<ProviderOption> = {}): ProviderOption {
  const demo = adapter === "fake";
  return {
    id, label,
    profile: { id, kind, adapter, unitCostMicros: micros },
    estimatedCost: { currency: "USD", unitMicros: micros, basis: demo ? "fixture" : "host_configured", actualVendorPriceVerified: false },
    readiness: structuredClone(demo ? DEMO_READY : READY),
    ...extra,
  };
}

function catalog(): ProviderOption[] {
  const viggle = option("viggle-h3", "MiniMax H3 via Viggle", "video", "viggle-h3", "450000");
  viggle.readiness = { ...viggle.readiness, realExecutionEnabled: false, credential: { required: true, present: false, backendUnavailable: false, apiValidated: false } };
  const codexImage = option("codex-image", "Codex image · gpt-6-astra", "image", "codex-image", "0", { usage: { kind: "codex_subscription", unit: "native_turn", quotaEstimateAvailable: false } });
  codexImage.readiness = { ...codexImage.readiness, mediaTools: { required: true, available: true }, credential: { required: false, present: null, backendUnavailable: false, apiValidated: false }, nativeAccess: { configured: true, authentication: "checked_before_dispatch", quota: "unverified" } };
  return [
    option("fake-image-v1", "Demo image", "image", "fake", "100"),
    option("fake-video-v1", "Demo video", "video", "fake", "100"),
    option("fake-speech-v1", "Demo speech", "speech", "fake", "100"),
    option("fake-transcription-v1", "Demo transcription", "transcription", "fake", "100"),
    option("openai-image-2", "OpenAI gpt-image-2", "image", "openai-image", "40000"),
    codexImage,
    option("minimax-h3", "MiniMax H3", "video", "minimax-h3", "500000"),
    viggle,
    option("openai-tts", "OpenAI gpt-4o-mini-tts", "speech", "openai-speech", "10000"),
    option("openai-whisper", "OpenAI whisper-1", "transcription", "openai-transcription", "10000"),
  ];
}

const CATALOG_DIGEST = hex("catalog", 1);

function providers(): ProviderCatalogView {
  return { catalogDigest: CATALOG_DIGEST, defaults: ["fake-image-v1", "fake-video-v1"], profiles: catalog(), realExecutionEnabled: true };
}

function modelStatus(world: FixtureWorld): ModelSettingsStatus {
  const s = state(world);
  const project = world.snapshot.project;
  return {
    version: 1, projectId: project.id, headVersion: project.headVersion, revisionId: project.revisionId,
    capabilityLockId: `lock-${s.lock}`, selectionDigest: hex("selection", s.lock), catalogDigest: CATALOG_DIGEST,
    selected: { ...s.selected }, options: catalog(),
  };
}

// ---- preview: unfinished work of the switched job uses the new model; made or running work stays ----

type Slot = "made" | "running" | "pending" | "none";

function slotOf(world: FixtureWorld, shotId: string, kind: MediaKind): Slot {
  const shot = world.overview.shots[shotId];
  if (!shot || kind === "transcription") return "none";
  if (kind === "speech") {
    const narration = shot.narration.state;
    return narration === "none" ? "none" : narration === "ready" ? "made" : narration === "making" ? "running" : "pending";
  }
  const slot = kind === "image" ? shot.keyframe : shot.video;
  return slot.state === "ready" ? "made" : slot.state === "running" || slot.state === "queued" ? "running" : "pending";
}

/**
 * The film's pending work, as the server's work digest sees it: which keyframes, clips and voice lines are
 * made, running or waiting. A job starting or finishing changes it.
 */
function workOf(world: FixtureWorld): string {
  return JSON.stringify(Object.values(world.overview.shots).map((shot) => [shot.shotId, shot.keyframe.state, shot.video.state, shot.narration.state]));
}

function preview(world: FixtureWorld, body: unknown): ModelPreview {
  const s = state(world);
  const input = body as { expectedHeadVersion?: number; expectedSelectionDigest?: string; expectedCatalogDigest?: string; profileIds?: unknown; scope?: { kind?: string } } | null;
  const status = modelStatus(world);
  if (!input || !Array.isArray(input.profileIds) || input.scope?.kind !== "unfinished") throw new ApiError("VALIDATION_ERROR", 400);
  if (input.expectedHeadVersion !== status.headVersion || input.expectedSelectionDigest !== status.selectionDigest || input.expectedCatalogDigest !== status.catalogDigest) throw new ApiError("MODEL_SETTINGS_STALE", 409);
  const options = catalog();
  const selected = { ...s.selected };
  for (const id of input.profileIds) {
    const found = options.find((o) => o.id === id);
    if (!found?.profile) throw new ApiError("PROVIDER_SELECTION_INVALID", 409);
    selected[found.profile.kind as MediaKind] = found.id;
  }
  const changes: ModelPreview["changes"] = [];
  const preserved: ModelPreview["preserved"] = [];
  for (const kind of MEDIA_KINDS) {
    if (selected[kind] === s.selected[kind]) continue;
    for (const shotId of Object.keys(world.overview.shots)) {
      const slot = slotOf(world, shotId, kind);
      if (slot === "none") continue;
      const node = { nodeId: `${kind}-${shotId}`, alias: `${kind}-${shotId}`, kind, shotId };
      if (slot === "pending") changes.push({ ...node, fromProfileId: s.selected[kind] ?? "", toProfileId: selected[kind] ?? "" });
      else preserved.push({ ...node, reason: slot === "made" ? "completed" : "in_flight" });
    }
  }
  const id = `preview-${s.next++}`;
  const result: ModelPreview = {
    version: 1, id, previewDigest: hex(id, s.lock), projectId: status.projectId,
    base: { headVersion: status.headVersion, revisionId: status.revisionId, capabilityLockId: status.capabilityLockId, selectionDigest: status.selectionDigest, catalogDigest: status.catalogDigest },
    selected, scope: { kind: "unfinished" }, changes, preserved,
    counts: { changed: changes.length, preserved: preserved.length },
    generationApprovalRequired: changes.some((change) => change.kind === "image" || change.kind === "video"),
    allowanceRequired: false,
  };
  s.previews.set(id, result);
  s.previewWork.set(id, workOf(world));
  return structuredClone(result);
}

function apply(world: FixtureWorld, body: unknown) {
  const s = state(world);
  const input = body as { previewId?: string; previewDigest?: string } | null;
  const saved = input?.previewId ? s.previews.get(input.previewId) : undefined;
  if (!saved || saved.previewDigest !== input?.previewDigest) throw new ApiError("MODEL_SETTINGS_STALE", 409);
  const status = modelStatus(world);
  if (saved.base.selectionDigest !== status.selectionDigest || saved.base.headVersion !== status.headVersion) throw new ApiError("MODEL_SETTINGS_STALE", 409);
  // Like the server: a job that started or finished since the preview makes it stale.
  if (s.previewWork.get(saved.id) !== workOf(world)) throw new ApiError("MODEL_SETTINGS_STALE", 409);
  world.update((w) => {
    s.selected = { ...saved.selected };
    s.lock += 1;
    s.previews.clear();
    s.previewWork.clear();
    bumpHead(w);
  });
  const after = modelStatus(world);
  return { receipt: { previewId: saved.id, previewDigest: saved.previewDigest, projectId: after.projectId, headVersion: after.headVersion, changedNodeIds: saved.changes.map((c) => c.nodeId) }, status: after };
}

// ---- Director --------------------------------------------------------------------------------

function directorSetup(world: FixtureWorld): DirectorSetup {
  const s = state(world);
  return {
    selection: structuredClone(s.director), selectionDigest: hex("director", s.directorRevision),
    busy: world.director.status === "running", changeAvailable: world.director.status !== "running", changeAppliesTo: "next_turn",
    defaults: { binaryPath: "/usr/local/bin/codex", model: "gpt-6-astra" },
    locked: true, modelCalls: 4,
    modelChoices: s.catalogStatus === "ready" ? [{ id: "gpt-6-astra", label: "gpt-6-astra" }, { id: "gpt-6-astra-mini", label: "gpt-6-astra-mini" }] : [],
    modelCatalogStatus: s.catalogStatus, modelCatalogCheckedAt: s.catalogStatus === "unchecked" ? null : "2026-10-15T10:40:00.000Z",
  };
}

function changeDirector(world: FixtureWorld, body: unknown) {
  const s = state(world);
  const input = body as { expectedSelectionDigest?: string; selection?: DirectorSelection } | null;
  if (!input?.selection || !["fake", "native"].includes(input.selection.mode)) throw new ApiError("VALIDATION_ERROR", 400);
  if (input.expectedSelectionDigest !== hex("director", s.directorRevision)) throw new ApiError("DIRECTOR_SELECTION_STALE", 409);
  if (world.director.status === "running") throw new ApiError("DIRECTOR_SETUP_BUSY", 409);
  const next = input.selection;
  if (next.mode === "native" && (!next.binaryPath?.startsWith("/") || !next.model)) throw new ApiError("VALIDATION_ERROR", 400);
  world.update(() => {
    s.director = next.mode === "fake" ? { mode: "fake" } : { mode: "native", binaryPath: next.binaryPath!, model: next.model!, ...(next.codexHome ? { codexHome: next.codexHome } : {}) };
    s.directorRevision += 1;
    s.catalogStatus = next.mode === "native" ? "ready" : s.catalogStatus;
  });
  return { ...directorSetup(world), readiness: next.mode === "native" ? { status: "ready" } : null, readinessSelectionDigest: hex("director", s.directorRevision), selectionMatchesCommand: true };
}

// ---- voices -------------------------------------------------------------------------------------

function headCheck(world: FixtureWorld, expected: unknown) {
  if (expected !== world.snapshot.project.headVersion) throw new ApiError("REVISION_CONFLICT", 409);
}

/** A project setting change bumps the head version, like the server's saveProject. */
function bumpHead(world: FixtureWorld) {
  const headVersion = world.snapshot.project.headVersion + 1;
  world.snapshot = { ...world.snapshot, project: { ...world.snapshot.project, headVersion } };
  world.overview = { ...world.overview, headVersion };
}

function setNarrator(world: FixtureWorld, body: unknown) {
  const s = state(world);
  const input = body as { narratorVoice?: string; expectedHeadVersion?: number } | null;
  headCheck(world, input?.expectedHeadVersion);
  const voice = input?.narratorVoice ?? "";
  const personal = s.voices.find((v) => v.id === voice);
  if (!(STOCK_VOICES as readonly string[]).includes(voice) && !voice.startsWith("openai-custom:")) throw new ApiError("VALIDATION_ERROR", 400);
  if (voice.startsWith("openai-custom:") && !personal) throw new ApiError("PERSONAL_VOICE_NOT_ENROLLED", 409);
  if (personal?.state === "revoked") throw new ApiError("PERSONAL_VOICE_REVOKED", 409);
  world.update((w) => { s.narratorVoice = voice; bumpHead(w); });
  return { headVersion: world.snapshot.project.headVersion, project: { id: world.snapshot.project.id, narratorVoice: voice } };
}

function register(world: FixtureWorld, body: unknown) {
  const s = state(world);
  const input = body as { expectedHeadVersion?: number; label?: string; provider?: string; providerVoiceId?: string; ownVoice?: unknown; permitSynthesis?: unknown } | null;
  if (!input || input.ownVoice !== true || input.permitSynthesis !== true) throw new ApiError("VALIDATION_ERROR", 400);
  headCheck(world, input.expectedHeadVersion);
  const provider = input.provider === "elevenlabs" ? "elevenlabs" : input.provider === "openai" ? "openai" : null;
  const label = input.label?.trim() ?? "";
  const id = input.providerVoiceId ?? "";
  const valid = provider === "openai" ? /^voice_[A-Za-z0-9_-]{1,120}$/.test(id) : /^[A-Za-z0-9_-]{1,120}$/.test(id);
  if (!provider || !label || label.length > 120 || !valid) throw new ApiError("PERSONAL_VOICE_INVALID", 409);
  const selector = `${provider === "openai" ? "openai-custom" : "elevenlabs-personal"}:${id}`;
  const existing = s.voices.find((v) => v.id === selector);
  if (existing?.state === "revoked") throw new ApiError("PERSONAL_VOICE_REVOKED", 409);
  if (existing) return { voice: existing };
  if (s.voices.length >= 32) throw new ApiError("PERSONAL_VOICE_LIMIT", 409);
  const voice: PersonalVoice = { id: selector, identityId: hex(selector, s.next++), label, provider, ready: provider === "openai", state: provider === "openai" ? "registered" : "provider_unavailable", providerAccessVerified: false };
  world.update(() => { s.voices = [voice, ...s.voices]; });
  return { voice };
}

function revoke(world: FixtureWorld, identityId: string) {
  const s = state(world);
  const voice = s.voices.find((v) => v.identityId === identityId);
  if (!voice) throw new ApiError("PERSONAL_VOICE_NOT_ENROLLED", 409);
  world.update(() => { s.voices = s.voices.map((v) => (v.identityId === identityId ? { ...v, ready: false, state: "revoked" } : v)); });
  return { revocation: { id: identityId, voiceId: identityId, createdAt: "2026-10-15T10:50:00.000Z" } };
}

function setReview(world: FixtureWorld, body: unknown) {
  const s = state(world);
  const input = body as { enabled?: unknown; expectedHeadVersion?: number } | null;
  if (typeof input?.enabled !== "boolean") throw new ApiError("VALIDATION_ERROR", 400);
  headCheck(world, input.expectedHeadVersion);
  if (input.enabled && s.director.mode !== "native") throw new ApiError("DIRECTOR_SETUP_REQUIRED", 409);
  world.update(() => { s.review = input.enabled as boolean; });
  return { enabled: s.review };
}

export const settingsRoutes: FixtureRoute[] = [
  { method: "GET", match: /^\/api\/providers$/, handle: () => providers() },
  { method: "GET", match: /^\/settings\/models$/, handle: (world) => modelStatus(world) },
  { method: "POST", match: /^\/settings\/models\/preview$/, handle: (world, _params, body) => preview(world, body) },
  { method: "POST", match: /^\/settings\/models\/apply$/, handle: (world, _params, body) => apply(world, body) },
  { method: "GET", match: /^\/director\/setup$/, handle: (world) => directorSetup(world) },
  { method: "GET", match: /^\/director\/models$/, handle: (world) => { state(world).catalogStatus = "ready"; return directorSetup(world); } },
  { method: "POST", match: /^\/director\/change$/, handle: (world, _params, body) => changeDirector(world, body) },
  // The sample film already had conversations, so its Director is chosen: a first setup is refused like the server does.
  { method: "POST", match: /^\/director\/setup$/, handle: () => { throw new ApiError("DIRECTOR_SELECTION_LOCKED", 409); } },
  { method: "GET", match: /^\/settings\/director-review$/, handle: (world) => ({ enabled: state(world).review }) },
  { method: "POST", match: /^\/settings\/director-review$/, handle: (world, _params, body) => setReview(world, body) },
  { method: "GET", match: /^\/settings\/voice$/, handle: (world) => ({ headVersion: world.snapshot.project.headVersion, narratorVoice: state(world).narratorVoice }) },
  { method: "POST", match: /^\/settings\/voice$/, handle: (world, _params, body) => setNarrator(world, body) },
  { method: "GET", match: /^\/narration\/personal-voices$/, handle: (world) => ({ headVersion: world.snapshot.project.headVersion, voices: structuredClone(state(world).voices) }) },
  { method: "POST", match: /^\/narration\/personal-voices$/, handle: (world, _params, body) => register(world, body) },
  { method: "POST", match: /^\/narration\/personal-voices\/([^/]+)\/revoke$/, handle: (world, params) => revoke(world, decodeURIComponent(params[0] ?? "")) },
];
