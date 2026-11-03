import { ApiError } from "../../api/client.ts";
import type { VideoPricing } from "../../model/settings.ts";
import { VIDEO_RESOLUTIONS, type VideoResolution, type VideoSettingsView } from "../../model/settings-video.ts";
import type { FixtureWorld } from "../fixture-port.ts";

/**
 * The sample code-plan film's video resolution (card G1): GET and PUT /code-plan/video-settings. Prices are
 * Viggle's published table with prompt enhancement off, as code films send it; the lead measured 768p and 1080p
 * first frame and 1080p reference against the account balance (2026-11-02) and they matched.
 */
const FIRST_FRAME: Record<VideoResolution, number> = { "480p": 20000, "768p": 30000, "1080p": 50000, "2k": 60000 };
const REFERENCE: Record<VideoResolution, number> = { "480p": 30000, "768p": 50000, "1080p": 60000, "2k": 70000 };
/** 16:9, the sample film's frame: 1080 on the short side from 1080p up. */
const EXPORT: Record<VideoResolution, { width: number; height: number }> = {
  "480p": { width: 854, height: 480 }, "768p": { width: 1280, height: 720 }, "1080p": { width: 1920, height: 1080 }, "2k": { width: 1920, height: 1080 },
};

export function viggleSecondPricing(resolution: VideoResolution): VideoPricing {
  const first = String(FIRST_FRAME[resolution]), reference = String(REFERENCE[resolution]);
  return { unit: "second", modes: [{ mode: "reference", microsPerSecond: reference }, { mode: "first_frame", microsPerSecond: first },
    { mode: "first_last_frame", microsPerSecond: reference }, { mode: "text", microsPerSecond: first }], minMicrosPerSecond: first, maxMicrosPerSecond: reference };
}

const resolutions = new WeakMap<FixtureWorld, VideoResolution>();
/** New code films start at 1080p. */
export const filmResolution = (world: FixtureWorld): VideoResolution => resolutions.get(world) ?? "1080p";

function view(world: FixtureWorld, projectId: string): VideoSettingsView {
  const resolution = filmResolution(world);
  return { version: 1, projectId, model: "viggle-h3", quality: "high", resolution,
    options: VIDEO_RESOLUTIONS.map((value) => ({ resolution: value, pricing: viggleSecondPricing(value) })),
    exportSize: { ...EXPORT[resolution] }, appliesTo: "unsent" };
}

export function readVideoSettings(world: FixtureWorld, projectId: string): VideoSettingsView {
  return view(world, projectId);
}

export function saveVideoSettings(world: FixtureWorld, projectId: string, body: unknown): VideoSettingsView {
  const value = (body as { resolution?: unknown } | null)?.resolution;
  if (!(VIDEO_RESOLUTIONS as readonly unknown[]).includes(value)) throw new ApiError("VALIDATION_ERROR", 400);
  // Like the server: nothing is made or charged; the film's prices change for clips not sent yet.
  world.update(() => { resolutions.set(world, value as VideoResolution); });
  return view(world, projectId);
}
