import { moneyMicros } from "@openslate/core";
import type { ProviderProfile, PriceQuote } from "@openslate/core";
import { falH3LipSyncPriceMicros } from "@openslate/providers";
import type { FalH3LipSyncResolution } from "@openslate/providers";
import { lipSyncAudioSamples } from "./execution/lip-sync.js";

export interface QuoteRow {
  imageComplete: boolean;
  videoComplete: boolean;
  videoProfileLabel?: string;
  /** Clip length; per-second profiles (lip sync) price from it. */
  durationFrames?: number;
  narration?: { mode: string; ready: boolean; recordingCurrent: boolean; profileId: string | null; reusableSpeechTake?: boolean };
}
export interface QuoteLock {
  profiles: ProviderProfile[];
  preferredProfileIds?: Partial<Record<"image" | "video" | "speech", string>>;
}
export type QuoteKind = "makeKeyframes" | "regenerateKeyframe" | "remakeClip" | "confirmVideo" | "voice";

function selectedProfile(lock: QuoteLock, kind: ProviderProfile["kind"], id?: string | null): ProviderProfile | undefined {
  const selected = id ?? lock.preferredProfileIds?.[kind as "image" | "video" | "speech"];
  return selected ? lock.profiles.find(p => p.id === selected && p.kind === kind) : lock.profiles.find(p => p.kind === kind);
}
/** A lip-sync clip is priced per second of the audio it is made from, not at the profile's flat per-clip ceiling. */
interface PerSecondUnit { perSecond: ProviderProfile; micros: bigint }
type Unit = ProviderProfile | PerSecondUnit | undefined;
const unitProfile = (unit: Unit): ProviderProfile | undefined => unit && "perSecond" in unit ? unit.perSecond : unit;
function quoteUnits(units: readonly Unit[]): PriceQuote {
  const subscription = units.some(p => unitProfile(p)?.adapter === "codex-image");
  const costs = units.map(p => p ? "perSecond" in p ? p.micros : moneyMicros(p.unitCostMicros) : 0n);
  return { micros: costs.reduce((a, b) => a + b, 0n).toString(), units: units.length,
    unitMicros: costs.length && costs.every(c => c === costs[0]) ? costs[0]!.toString() : "0",
    priceUnknown: units.some((p, i) => !p || (unitProfile(p)!.adapter !== "codex-image" && costs[i] === 0n)),
    ...(subscription ? { subscription: "codex" as const } : {}) };
}
/** fal H3 Max lip sync: published per-second price for this clip's audio (clip plus the short tail). */
function videoUnit(profile: ProviderProfile | undefined, row: QuoteRow): Unit {
  const resolution = profile?.configuration?.settings?.resolution;
  if (profile?.adapter !== "fal-h3-lipsync" || !Number.isSafeInteger(row.durationFrames) || typeof resolution !== "string") return profile;
  try { return { perSecond: profile, micros: BigInt(falH3LipSyncPriceMicros(resolution as FalH3LipSyncResolution, lipSyncAudioSamples(row.durationFrames!) / 48000)) }; }
  catch { return profile; }
}

/** Remake prices remain available after every pending unit has completed. */
export function unitQuote(lock: QuoteLock, kind: "video" | "speech"): PriceQuote | undefined {
  const profile = selectedProfile(lock, kind);
  return profile ? quoteUnits([profile]) : undefined;
}

/**
 * Character sheets are image units on the pinned image profile, quoted like keyframes: Codex image is the
 * subscription ($0, `subscription: "codex"`), a metered profile multiplies its unit cost, an unpriced one is unknown.
 */
export function characterSheetQuote(lock: QuoteLock, sheets: number): PriceQuote {
  if (!Number.isSafeInteger(sheets) || sheets < 0 || sheets > 32) throw new RangeError("Quote between 0 and 32 character sheets");
  const image = selectedProfile(lock, "image");
  return quoteUnits(Array.from({ length: sheets }, () => image));
}

/** Flat host-configured estimates, taken exclusively from the project's pinned lock. */
export function quote(lock: QuoteLock, rows: readonly QuoteRow[], kind: QuoteKind): PriceQuote {
  const units: Unit[] = [];
  const profile = (kind: ProviderProfile["kind"], id?: string | null) => selectedProfile(lock, kind, id);
  if (kind === "regenerateKeyframe") units.push(profile("image"));
  for (const row of rows) {
    if (kind === "makeKeyframes" && !row.imageComplete) units.push(profile("image"));
    if (kind === "remakeClip" || kind === "confirmVideo" && !row.videoComplete) units.push(videoUnit(profile("video", row.videoProfileLabel), row));
    if ((kind === "voice" || kind === "regenerateKeyframe" || kind === "makeKeyframes" || (kind === "confirmVideo" && !row.videoComplete)) &&
      row.narration?.mode === "generated" && !row.narration.ready && !row.narration.recordingCurrent && !row.narration.reusableSpeechTake)
      units.push(profile("speech", row.narration.profileId));
  }
  return quoteUnits(units);
}
