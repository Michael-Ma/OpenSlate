import { FalQueueClient } from "./fal-queue.js";
import type { FalQueueOptions } from "./fal-queue.js";
import { videoEnsure as ensure } from "./video-http.js";
export const FAL_VIDEO_MODELS = Object.freeze({
  "fal-ai/kling-video/v3/standard/image-to-video": { minSeconds: 3, maxSeconds: 15, durations: null, resolutions: ["720p"], ratios: ["adaptive"], audio: false },
  "fal-ai/veo3.1/fast/image-to-video": { minSeconds: 4, maxSeconds: 8, durations: [4,6,8], resolutions: ["720p","1080p","4k"], ratios: ["auto","16:9","9:16"], audio: true },
  "alibaba/wan-3.0/image-to-video": { minSeconds: 2, maxSeconds: 30, durations: null, resolutions: ["480p","720p","1080p"], ratios: ["adaptive","16:9","4:3","1:1","3:4","9:16"], audio: true },
});
export interface FalVideoSettings { resolution: string; aspectRatio?: string; generateAudio?: boolean }
export function falVideoModel(model: string) {
  ensure(Object.hasOwn(FAL_VIDEO_MODELS, model), "FAL_VIDEO_MODEL_UNSUPPORTED"); return FAL_VIDEO_MODELS[model as keyof typeof FAL_VIDEO_MODELS];
}
export function validateFalVideoSettings(model: string, settings: FalVideoSettings): void {
  const row = falVideoModel(model);
  ensure((row.resolutions as readonly string[]).includes(settings.resolution) && (row.ratios as readonly string[]).includes(settings.aspectRatio ?? (model.includes("veo") ? "auto" : "adaptive"))
    && (settings.generateAudio === undefined || typeof settings.generateAudio === "boolean") && (!settings.generateAudio || row.audio), "FAL_VIDEO_SETTINGS_INVALID");
}
/** Published USD micros per output second; all dispatch and authority paths call this function. */
export function falVideoPriceMicros(model: string, settings: FalVideoSettings, seconds: number): string {
  validateFalVideoSettings(model, settings); const row = falVideoModel(model);
  ensure(Number.isSafeInteger(seconds) && seconds >= row.minSeconds && seconds <= row.maxSeconds
    && (row.durations === null || (row.durations as readonly number[]).includes(seconds)), "FAL_VIDEO_DURATION_INVALID");
  const rate = model.includes("kling") ? 84000 : model.includes("veo") ? (settings.resolution === "4k" ? 300000 : 100000) + (settings.generateAudio ? 50000 : 0)
    : settings.resolution === "480p" ? 50000 : settings.resolution === "720p" ? 100000 : 200000;
  return (BigInt(rate) * BigInt(seconds)).toString();
}
export function falVideoBody(input: { model: string; prompt: string; seconds: number; settings: FalVideoSettings; imageUrl: string; lastFrameUrl?: string; seed?: number }): string {
  falVideoPriceMicros(input.model, input.settings, input.seconds);
  ensure(typeof input.prompt === "string" && input.prompt.trim().length > 0 && Buffer.byteLength(input.prompt) <= 32768
    && /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(input.imageUrl)
    && (input.seed === undefined || Number.isSafeInteger(input.seed) && input.seed >= 0 && input.seed <= 2147483647), "FAL_VIDEO_INPUT_INVALID");
  const settings = input.settings;
  if (input.model.includes("kling")) {
    ensure(input.seed === undefined, "FAL_VIDEO_SEED_UNSUPPORTED");
    return JSON.stringify({ prompt: input.prompt, start_image_url: input.imageUrl, duration: String(input.seconds), generate_audio: false,
      ...(input.lastFrameUrl ? { end_image_url: input.lastFrameUrl } : {}) });
  }
  if (input.model.includes("veo")) {
    ensure(!input.lastFrameUrl, "FAL_VIDEO_LAST_FRAME_UNSUPPORTED");
    return JSON.stringify({ prompt: input.prompt, image_url: input.imageUrl, duration: `${input.seconds}s`, resolution: settings.resolution,
      aspect_ratio: settings.aspectRatio ?? "auto", generate_audio: settings.generateAudio ?? false, auto_fix: false, ...(input.seed === undefined ? {} : { seed: input.seed }) });
  }
  return JSON.stringify({ prompt: input.prompt, start_image_url: input.imageUrl, duration: input.seconds, resolution: settings.resolution,
    aspect_ratio: settings.aspectRatio ?? "adaptive", audio: settings.generateAudio ?? false, enable_safety_checker: true,
    ...(input.lastFrameUrl ? { end_image_url: input.lastFrameUrl } : {}), ...(input.seed === undefined ? {} : { seed: input.seed }) });
}
export class FalVideoProvider extends FalQueueClient {
  constructor(options: FalQueueOptions & { model: string }) { falVideoModel(options.model); super(options); }
}
