import { moneyMicros } from "@openslate/core";
import type { ProviderProfile, PriceQuote } from "@openslate/core";

export interface QuoteRow {
  imageComplete: boolean;
  videoComplete: boolean;
  videoProfileLabel?: string;
  narration?: { mode: string; ready: boolean; recordingCurrent: boolean; profileId: string | null; reusableSpeechTake?: boolean };
}
export interface QuoteLock {
  profiles: ProviderProfile[];
  preferredProfileIds?: Partial<Record<"image" | "video" | "speech", string>>;
}
export type QuoteKind = "makeKeyframes" | "regenerateKeyframe" | "confirmVideo" | "voice";

function selectedProfile(lock: QuoteLock, kind: ProviderProfile["kind"], id?: string | null): ProviderProfile | undefined {
  const selected = id ?? lock.preferredProfileIds?.[kind as "image" | "video" | "speech"];
  return selected ? lock.profiles.find(p => p.id === selected && p.kind === kind) : lock.profiles.find(p => p.kind === kind);
}
function quoteUnits(units: readonly (ProviderProfile | undefined)[]): PriceQuote {
  const subscription = units.some(p => p?.adapter === "codex-image");
  const costs = units.map(p => p ? moneyMicros(p.unitCostMicros) : 0n);
  return { micros: costs.reduce((a, b) => a + b, 0n).toString(), units: units.length,
    unitMicros: costs.length && costs.every(c => c === costs[0]) ? costs[0]!.toString() : "0",
    priceUnknown: units.some(p => !p || (p.adapter !== "codex-image" && moneyMicros(p.unitCostMicros) === 0n)),
    ...(subscription ? { subscription: "codex" as const } : {}) };
}

/** Remake prices remain available after every pending unit has completed. */
export function unitQuote(lock: QuoteLock, kind: "video" | "speech"): PriceQuote | undefined {
  const profile = selectedProfile(lock, kind);
  return profile ? quoteUnits([profile]) : undefined;
}

/** Flat host-configured estimates, taken exclusively from the project's pinned lock. */
export function quote(lock: QuoteLock, rows: readonly QuoteRow[], kind: QuoteKind): PriceQuote {
  const units: (ProviderProfile | undefined)[] = [];
  const profile = (kind: ProviderProfile["kind"], id?: string | null) => selectedProfile(lock, kind, id);
  if (kind === "regenerateKeyframe") units.push(profile("image"));
  for (const row of rows) {
    if (kind === "makeKeyframes" && !row.imageComplete) units.push(profile("image"));
    if (kind === "confirmVideo" && !row.videoComplete) units.push(profile("video", row.videoProfileLabel));
    if ((kind === "voice" || kind === "regenerateKeyframe" || kind === "makeKeyframes" || (kind === "confirmVideo" && !row.videoComplete)) &&
      row.narration?.mode === "generated" && !row.narration.ready && !row.narration.recordingCurrent && !row.narration.reusableSpeechTake)
      units.push(profile("speech", row.narration.profileId));
  }
  return quoteUnits(units);
}
