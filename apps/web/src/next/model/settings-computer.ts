import type { MessageId } from "../i18n/messages.ts";
import { JOB_LABEL, isMediaKind, type MediaKind, type ProviderCatalogView } from "./settings.ts";
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
  /** Jobs that depend on it, in job order; the view joins their names. */
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
  return KIND_ORDER.filter((kind) => set.has(kind)).map((kind) => JOB_LABEL[kind]);
};

function codexRow(setup: DirectorSetup | null, setupError: string | null): ComputerRow {
  const base = { id: "codex", name: msg("set.computer.codex"), jobs: [] as MessageId[] };
  if (!setup) return { ...base, tone: "unknown", status: msg(setupError ? "set.computer.unavailable" : "set.computer.checking"), detail: msg(setupError ? "set.computer.codex_unavailable" : "set.computer.codex_uses") };
  switch (codexState(setup)) {
    case "ready": return { ...base, tone: "ok", status: msg("set.computer.found"), detail: msg("set.computer.codex_ready") };
    case "blocked": return { ...base, tone: "missing", status: msg("set.computer.needs_attention"), detail: msg("set.computer.codex_blocked") };
    case "missing": return { ...base, tone: "missing", status: msg("set.computer.not_found"), detail: msg("set.computer.codex_missing") };
    default: return { ...base, tone: "unknown", status: msg("set.computer.not_checked"), detail: msg("set.computer.codex_unchecked") };
  }
}

/** FFmpeg turns clips and audio into media; only video and audio models report needing it. */
function ffmpegRow(catalog: ProviderCatalogView): ComputerRow {
  const needing = catalog.profiles.filter((option) => option.readiness.mediaTools.required && ["video", "speech", "transcription"].includes(option.profile?.kind ?? ""));
  const base = { id: "ffmpeg", name: msg("set.computer.ffmpeg"), detail: msg("set.computer.ffmpeg_uses"), jobs: [] as MessageId[] };
  if (!needing.length) return { ...base, tone: "unknown", status: msg("set.computer.not_checked") };
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

export function computerView(catalog: ProviderCatalogView | null, setup: DirectorSetup | null, setupError: string | null): ComputerView {
  if (!catalog) return { rows: [codexRow(setup, setupError)], demoOnly: false };
  const demoOnly = catalog.profiles.every((option) => option.estimatedCost?.basis === "fixture" || option.profile?.adapter === "fake");
  return { rows: [codexRow(setup, setupError), ffmpegRow(catalog), ...keyRows(catalog)], demoOnly };
}
