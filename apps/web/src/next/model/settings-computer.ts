import type { MessageId } from "../i18n/messages.ts";
import { JOB_IN_SENTENCE, isMediaKind, type MediaKind, type ProviderCatalogView } from "./settings.ts";
import { codexState, type DirectorSetup } from "./settings-director.ts";
import { msg, type Msg } from "./types.ts";

/**
 * Settings view, "This computer": Codex, FFmpeg and each provider key, from the catalog's read-only readiness
 * (GET /api/providers) and Codex's setup check (GET /director/setup, /director/models). Keys are explained,
 * never shown or fixed here.
 */

export type ComputerTone = "ok" | "missing" | "unknown";

export interface ComputerRow {
  id: string;
  name: Msg;
  tone: ComputerTone;
  status: Msg;
  detail: Msg;
  /** Jobs that depend on it, in job order, named as inside a sentence; the view joins them. */
  jobs: MessageId[];
}

type Credential = "openai" | "minimax" | "viggle";

const CREDENTIAL_OF: Record<string, Credential> = {
  "openai-image": "openai",
  "openai-speech": "openai",
  "openai-transcription": "openai",
  "minimax-h3": "minimax",
  "viggle-h3": "viggle",
};

const KEY_NAME: Record<Credential, MessageId> = { openai: "set.computer.key.openai", minimax: "set.computer.key.minimax", viggle: "set.computer.key.viggle" };

const KIND_ORDER: readonly MediaKind[] = ["image", "video", "speech", "transcription"];
const jobsOf = (kinds: Iterable<string>): MessageId[] => {
  const set = new Set(kinds);
  return KIND_ORDER.filter((kind) => set.has(kind)).map((kind) => JOB_IN_SENTENCE[kind]);
};

export interface CodexContext {
  /** No film is open: Codex's setup check runs inside a film, so it cannot be checked here. */
  noFilm?: boolean;
  /** The error code of the last "Check again" that could not check Codex. */
  checkFailed?: string | null;
}

/** The server answered that it has no Director setup: a fact about this studio, not a failed check. */
const UNAVAILABLE = new Set(["SERVICE_UNAVAILABLE", "NOT_FOUND"]);

function codexRow(setup: DirectorSetup | null, setupError: string | null, context: CodexContext): ComputerRow {
  const base = { id: "codex", name: msg("set.computer.codex"), jobs: [] as MessageId[], tone: "unknown" as const };
  if (context.noFilm) return { ...base, status: msg("set.computer.not_checked"), detail: msg("set.computer.codex_no_film") };
  const failure = context.checkFailed ?? (setup ? null : setupError);
  if (failure && UNAVAILABLE.has(failure)) return { ...base, status: msg("set.computer.unavailable"), detail: msg("set.computer.codex_unavailable") };
  if (failure) return { ...base, status: msg("set.computer.check_failed"), detail: msg("set.computer.codex_check_failed") };
  if (!setup) return { ...base, status: msg("set.computer.checking"), detail: msg("set.computer.codex_uses") };
  switch (codexState(setup)) {
    case "found": return { ...base, tone: "ok", status: msg("set.computer.found"), detail: msg("set.computer.codex_version_only", { version: setup.codexVersion!, binaryPath: setup.selection.binaryPath ?? setup.defaults.binaryPath }) };
    case "ready": return setup.lastSuccessfulCheck
      ? { ...base, tone: "ok", status: msg("set.computer.checked"), detail: msg("set.computer.codex_last_check", setup.lastSuccessfulCheck) }
      : { ...base, tone: "ok", status: msg("set.computer.found"), detail: msg("set.computer.codex_ready") };
    case "blocked": return { ...base, tone: "missing", status: msg("set.computer.needs_attention"), detail: msg("set.computer.codex_blocked") };
    case "missing": return { ...base, tone: "missing", status: msg("set.computer.not_found"), detail: msg("set.computer.codex_missing") };
    default: return { ...base, tone: "unknown", status: msg("set.computer.not_checked"), detail: msg("set.computer.codex_unchecked") };
  }
}

/**
 * FFmpeg turns clips and audio into media. No route reports it on its own (a server gap): the catalog only
 * checks it for the video and audio models that need it, so with none installed it is "not checked", and the
 * detail says when it will be.
 */
function ffmpegRow(catalog: ProviderCatalogView): ComputerRow {
  const needing = catalog.profiles.filter((option) => option.readiness.mediaTools.required && ["video", "speech", "transcription"].includes(option.profile?.kind ?? ""));
  const base = { id: "ffmpeg", name: msg("set.computer.ffmpeg"), detail: msg("set.computer.ffmpeg_uses"), jobs: [] as MessageId[] };
  if (!needing.length) return { ...base, tone: "unknown", status: msg("set.computer.not_checked"), detail: msg("set.computer.ffmpeg_unchecked") };
  return needing.every((option) => option.readiness.mediaTools.available)
    ? { ...base, tone: "ok", status: msg("set.computer.found") }
    : { ...base, tone: "missing", status: msg("set.computer.not_found") };
}

/** One row per key that an installed model needs: set or not set, and which jobs use it. */
function keyRows(catalog: ProviderCatalogView): ComputerRow[] {
  const keys = new Map<Credential, { present: boolean; unreadable: boolean; kinds: Set<string> }>();
  for (const option of catalog.profiles) {
    const credential = CREDENTIAL_OF[option.profile?.adapter ?? ""];
    if (!credential || !option.readiness.credential.required) continue;
    const entry = keys.get(credential) ?? { present: false, unreadable: false, kinds: new Set<string>() };
    entry.present ||= option.readiness.credential.present === true;
    entry.unreadable ||= option.readiness.credential.backendUnavailable;
    if (option.profile?.kind && isMediaKind(option.profile.kind)) entry.kinds.add(option.profile.kind);
    keys.set(credential, entry);
  }
  return (["openai", "minimax", "viggle"] as const).flatMap((credential) => {
    const entry = keys.get(credential);
    if (!entry) return [];
    const jobs = jobsOf(entry.kinds);
    const tone: ComputerTone = entry.present ? "ok" : entry.unreadable ? "unknown" : "missing";
    const status = msg(entry.present ? "set.computer.set" : entry.unreadable ? "set.computer.unreadable" : "set.computer.not_set");
    return [{ id: `key-${credential}`, name: msg(KEY_NAME[credential]), tone, status, detail: msg("set.computer.used_for"), jobs }];
  });
}

export interface ComputerView {
  rows: ComputerRow[];
  /** No paid model is installed: only the free stand-ins can run. */
  demoOnly: boolean;
}

export function computerView(catalog: ProviderCatalogView | null, setup: DirectorSetup | null, setupError: string | null, context: CodexContext = {}): ComputerView {
  if (!catalog) return { rows: [codexRow(setup, setupError, context)], demoOnly: false };
  const demoOnly = catalog.profiles.every((option) => option.estimatedCost?.basis === "fixture" || option.profile?.adapter === "fake");
  return { rows: [codexRow(setup, setupError, context), ffmpegRow(catalog), ...keyRows(catalog)], demoOnly };
}

export type CheckOutcome =
  | { kind: "checked" }
  /** Codex's check was skipped because the Director is in a turn or a setup check; the keys were read. */
  | { kind: "busy" }
  | { kind: "failed"; code: string };

/**
 * What "Check again" says: success only when every read it made succeeded. `codex` is the result of the
 * Codex setup check (null when no film is open, so it was not asked); `catalog` the provider catalog read.
 */
export function checkOutcome(codex: { ok: true; busy: boolean } | { ok: false; code: string } | null, catalog: { ok: true } | { ok: false; code: string }): CheckOutcome {
  if (codex && !codex.ok) return { kind: "failed", code: codex.code };
  if (!catalog.ok) return { kind: "failed", code: catalog.code };
  return codex?.busy ? { kind: "busy" } : { kind: "checked" };
}
