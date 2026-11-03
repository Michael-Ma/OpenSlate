import { formatMicros } from "./price.ts";
import { msg, type Msg } from "./types.ts";
import { perSecondMsg, type VideoPricing } from "./settings.ts";

/**
 * A code-plan film's video resolution (card G1): one choice per film, used for clips not sent yet. Clips already
 * made, running or recorded keep theirs, so a switch makes nothing and charges nothing by itself.
 */
export type VideoResolution = "480p" | "768p" | "1080p" | "2k";
export const VIDEO_RESOLUTIONS: readonly VideoResolution[] = ["480p", "768p", "1080p", "2k"];
export const VIDEO_SETTINGS_PATH = "/code-plan/video-settings";

/** GET and PUT /api/projects/:projectId/code-plan/video-settings */
export interface VideoSettingsView {
  version: 1;
  projectId: string;
  model: "viggle-h3";
  quality: "high" | "low";
  resolution: VideoResolution;
  /** All four, cheapest first. */
  options: { resolution: VideoResolution; pricing: VideoPricing }[];
  /** The finished film's size at the current resolution and the film's aspect. */
  exportSize: { width: number; height: number };
  appliesTo: "unsent";
}

export interface ResolutionChoice {
  value: VideoResolution;
  /** "about $0.05–$0.06 a second", by the input chosen on each keyframe card. */
  estimate: Msg;
}

/** "480p", "768p", "1080p", "2K": the names the provider uses, the same in every language. */
export const resolutionLabel = (value: VideoResolution): string => (value === "2k" ? "2K" : value);

const isResolution = (value: unknown): value is VideoResolution => (VIDEO_RESOLUTIONS as readonly unknown[]).includes(value);

/** The options in the server's order; a view without a usable option list shows no row. */
export function resolutionChoices(view: VideoSettingsView, locale: string): ResolutionChoice[] {
  return view.options.filter((option) => isResolution(option.resolution)).map((option) => ({
    value: option.resolution,
    estimate: perSecondMsg(option.pricing, locale, { one: "set.estimate.video_second", range: "set.estimate.video_second_range" }),
  }));
}

/** What switching to `value` means, before Switch: new clips only, at the new rate; nothing is remade. */
export function resolutionImpact(view: VideoSettingsView, value: VideoResolution, locale: string): Msg[] {
  const option = view.options.find((row) => row.resolution === value);
  const min = option ? formatMicros(option.pricing.minMicrosPerSecond, locale) : null;
  const max = option ? formatMicros(option.pricing.maxMicrosPerSecond, locale) : null;
  return [
    min && max ? (min === max ? msg("set.res.impact_rate", { price: min }) : msg("set.res.impact_rate_range", { min, max })) : msg("set.res.impact_new"),
    msg("set.res.impact_kept"),
    msg("set.impact.nothing_made"),
  ];
}

export function resolutionRequest(resolution: VideoResolution): { path: string; body: { resolution: VideoResolution }; method: "PUT" } {
  return { path: VIDEO_SETTINGS_PATH, body: { resolution }, method: "PUT" };
}
