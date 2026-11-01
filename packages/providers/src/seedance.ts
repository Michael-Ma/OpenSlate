import { VideoJsonClient, videoEnsure as ensure, videoObject as object } from "./video-http.js";
import type { VideoApiOptions } from "./video-http.js";
export const SEEDANCE_ORIGIN = "https://ark.ap-southeast.bytepluses.com";
const TASKS = `${SEEDANCE_ORIGIN}/api/v3/contents/generations/tasks`;
export const SEEDANCE_MODELS = Object.freeze({
  "seedance-1-0-pro-fast-251015": { minSeconds: 2, maxSeconds: 12, maxResolution: 1080, lastFrame: false, audio: false },
  "dreamina-seedance-2-0-mini-260615": { minSeconds: 4, maxSeconds: 15, maxResolution: 720, lastFrame: true, audio: true },
  "dreamina-seedance-2-0-260128": { minSeconds: 4, maxSeconds: 15, maxResolution: 1080, lastFrame: true, audio: true },
});
export type SeedanceModel = keyof typeof SEEDANCE_MODELS;
export interface VideoImageSize { width: number; height: number }
export interface SeedanceSettings { resolution: string; ratio?: string; generateAudio?: boolean }
export const SEEDANCE_RATIOS = ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"] as const;
export function seedanceModel(model: string) {
  ensure(Object.hasOwn(SEEDANCE_MODELS, model), "SEEDANCE_MODEL_UNSUPPORTED"); return SEEDANCE_MODELS[model as SeedanceModel];
}
export function validateSeedanceSettings(model: string, settings: SeedanceSettings): void {
  const row = seedanceModel(model);
  ensure(["480p", "720p", "1080p"].includes(settings.resolution) && Number.parseInt(settings.resolution) <= row.maxResolution
    && (settings.ratio === undefined || settings.ratio === "adaptive" || (SEEDANCE_RATIOS as readonly string[]).includes(settings.ratio))
    && (settings.generateAudio === undefined || typeof settings.generateAudio === "boolean") && (!settings.generateAudio || row.audio), "SEEDANCE_SETTINGS_INVALID");
}
// Published ModelArk dimensions, ordered by SEEDANCE_RATIOS. 1.0 and 2.0 have different pixel grids.
const DIMENSIONS: Record<string, number[][]> = {
  "1:480p": [[864,480],[736,544],[640,640],[544,736],[480,864],[960,416]],
  "1:720p": [[1248,704],[1120,832],[960,960],[832,1120],[704,1248],[1504,640]],
  "1:1080p": [[1920,1088],[1664,1248],[1440,1440],[1248,1664],[1088,1920],[2176,928]],
  "2:480p": [[864,496],[752,560],[640,640],[560,752],[496,864],[992,432]],
  "2:720p": [[1280,720],[1112,834],[960,960],[834,1112],[720,1280],[1470,630]],
  "2:1080p": [[1920,1080],[1664,1248],[1440,1440],[1248,1664],[1080,1920],[2206,946]],
};
export function seedanceOutputSize(model: string, settings: SeedanceSettings, firstFrame?: VideoImageSize): VideoImageSize {
  validateSeedanceSettings(model, settings);
  if (firstFrame) ensure(Number.isSafeInteger(firstFrame.width) && Number.isSafeInteger(firstFrame.height) && firstFrame.width >= 300 && firstFrame.width <= 6000
    && firstFrame.height >= 300 && firstFrame.height <= 6000 && firstFrame.width / firstFrame.height >= 0.4 && firstFrame.width / firstFrame.height <= 2.5, "SEEDANCE_IMAGE_LIMIT");
  ensure(firstFrame || settings.ratio && settings.ratio !== "adaptive", "SEEDANCE_TEXT_RATIO_REQUIRED");
  const inputRatio = firstFrame ? firstFrame.width / firstFrame.height : 1;
  const ratio = settings.ratio && settings.ratio !== "adaptive" ? settings.ratio : [...SEEDANCE_RATIOS].sort((a,b) => {
    const n = (s: string) => { const [w,h] = s.split(":").map(Number); return Math.abs(Math.log(w! / h! / inputRatio)); };
    return n(a) - n(b);
  })[0]!;
  const pair = DIMENSIONS[`${model.startsWith("seedance-1") ? 1 : 2}:${settings.resolution}`]![SEEDANCE_RATIOS.indexOf(ratio as typeof SEEDANCE_RATIOS[number])]!;
  return { width: pair[0]!, height: pair[1]! };
}
/** Integer rational arithmetic, rounded up once to a micro. Same function prices reservations and reported usage. */
export function seedancePriceMicros(model: string, settings: SeedanceSettings, input: { seconds: number; firstFrame?: VideoImageSize } | { completionTokens: number }): string {
  validateSeedanceSettings(model, settings);
  const rateTenths = model.startsWith("seedance-1") ? 10n : model.includes("mini") ? 35n : settings.resolution === "1080p" ? 77n : 70n;
  let numerator: bigint, denominator: bigint;
  if ("completionTokens" in input) {
    ensure(Number.isSafeInteger(input.completionTokens) && input.completionTokens >= 0, "SEEDANCE_USAGE_INVALID");
    numerator = BigInt(input.completionTokens) * rateTenths; denominator = 10n;
  } else {
    const row = seedanceModel(model); ensure(Number.isSafeInteger(input.seconds) && input.seconds >= row.minSeconds && input.seconds <= row.maxSeconds, "SEEDANCE_DURATION_INVALID");
    const {width,height} = seedanceOutputSize(model, settings, input.firstFrame);
    numerator = BigInt(input.seconds) * BigInt(width) * BigInt(height) * 24n * rateTenths; denominator = 10240n;
  }
  return ((numerator + denominator - 1n) / denominator).toString();
}
export interface SeedanceRequest { model: string; prompt: string; seconds: number; settings: SeedanceSettings; seed?: number;
  firstFrame?: VideoImageSize & { bytes: Uint8Array }; lastFrame?: VideoImageSize & { bytes: Uint8Array }; references?: (VideoImageSize & { bytes: Uint8Array })[] }
export function seedanceBody(input: SeedanceRequest): string {
  const row = seedanceModel(input.model), references = input.references;
  ensure(references === undefined || Array.isArray(references) && references.length >= 1 && references.length <= 9, "SEEDANCE_INPUT_INVALID");
  ensure(!references || !input.firstFrame && !input.lastFrame, "SEEDANCE_INPUT_INVALID");
  ensure(!input.lastFrame || input.firstFrame, "SEEDANCE_INPUT_INVALID");
  ensure(!input.model.startsWith("seedance-1") || input.firstFrame && !references, "SEEDANCE_INPUT_INVALID");
  ensure(input.firstFrame || references || input.settings.ratio && input.settings.ratio !== "adaptive", "SEEDANCE_TEXT_RATIO_REQUIRED");
  const priceFrame = input.firstFrame ?? references?.[0];
  seedancePriceMicros(input.model, input.settings, { seconds: input.seconds, ...(priceFrame ? { firstFrame: priceFrame } : {}) });
  ensure(typeof input.prompt === "string" && input.prompt.trim().length > 0 && Buffer.byteLength(input.prompt) <= 32768
    && (input.seed === undefined || Number.isSafeInteger(input.seed) && input.seed >= 0 && input.seed <= 2147483647)
    && (!input.lastFrame || row.lastFrame), "SEEDANCE_INPUT_INVALID");
  const frame = (image: NonNullable<SeedanceRequest["firstFrame"]>, role: string) => {
    seedanceOutputSize(input.model, input.settings, image);
    ensure(image.bytes instanceof Uint8Array && image.bytes.length >= 33 && image.bytes.length < 30_000_000, "SEEDANCE_IMAGE_LIMIT");
    const bytes = Buffer.from(image.bytes);
    ensure(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.readUInt32BE(16) === image.width && bytes.readUInt32BE(20) === image.height, "SEEDANCE_IMAGE_INVALID");
    return { type: "image_url", role, image_url: { url: `data:image/png;base64,${bytes.toString("base64")}` } };
  };
  return JSON.stringify({ model: input.model, content: [{ type: "text", text: input.prompt }, ...(input.firstFrame ? [frame(input.firstFrame,"first_frame")] : []), ...(references ?? []).map(image => frame(image,"reference_image")), ...(input.lastFrame ? [frame(input.lastFrame,"last_frame")] : [])],
    resolution: input.settings.resolution, ratio: input.settings.ratio ?? "adaptive", duration: input.seconds, generate_audio: input.settings.generateAudio ?? false,
    ...(input.seed === undefined ? {} : { seed: input.seed }), watermark: false, return_last_frame: true });
}
export type VideoSubmit = { kind: "accepted"; taskId: string } | { kind: "rejected"; code: string } | { kind: "unknown"; code: string };
export type SeedancePoll = { kind: "pending"; taskId: string } | { kind: "completed"; taskId: string; videoUrl: string; lastFrameUrl: string | null; completionTokens: number | null }
  | { kind: "failed"; taskId: string; code: string; message: string; retry: "none"; free: true } | { kind: "unknown"; taskId: string; code: string };
const task = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(value);
export const videoHttps = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length > 8192 || /[\s\x00-\x1f\x7f\\]/.test(value)) return false;
  try { const u = new URL(value); return u.protocol === "https:" && !u.username && !u.password && !u.hash; } catch { return false; }
};
function refusal(error: unknown): { code: string; message: string } {
  const code = object(error) && typeof error.code === "string" ? error.code : "";
  if (/face|portrait|realperson|real_person/i.test(code) || object(error) && typeof error.message === "string" && /face|portrait|real.?person/i.test(error.message))
    return { code: "SEEDANCE_FACE_REJECTED", message: "Seedance 2.x cannot use this image of a realistic human face. Use a stylized frame or a different model." };
  if (/sensitive|moderation|content|policy/i.test(code)) return { code: "SEEDANCE_MODERATION_REJECTED", message: "Seedance refused this content. Change the frame or prompt before generating again." };
  return { code: "SEEDANCE_TASK_FAILED", message: "Seedance could not complete this clip. This task was not charged." };
}
export class SeedanceProvider {
  readonly #http: VideoJsonClient;
  constructor(options: VideoApiOptions) { this.#http = new VideoJsonClient(options); }
  async submit(body: string, signal?: AbortSignal): Promise<VideoSubmit> {
    if (signal?.aborted) return { kind: "rejected", code: "SEEDANCE_NOT_SUBMITTED" };
    const result = await this.#http.call("POST", TASKS, body, signal);
    if ("error" in result) return { kind: result.error === "CONNECT_NOT_SUBMITTED" ? "rejected" : "unknown", code: `SEEDANCE_${result.error}` };
    if (result.status >= 200 && result.status < 300 && object(result.body) && task(result.body.id)) return { kind: "accepted", taskId: result.body.id };
    if (result.status >= 400 && result.status < 500 && object(result.body) && object(result.body.error) && !("id" in result.body))
      return { kind: "rejected", code: refusal(result.body.error).code };
    return { kind: "unknown", code: "SEEDANCE_CREATE_UNKNOWN" };
  }
  async poll(taskId: string, signal?: AbortSignal): Promise<SeedancePoll> {
    ensure(task(taskId), "SEEDANCE_TASK_INVALID");
    const result = await this.#http.call("GET", `${TASKS}/${taskId}`, undefined, signal);
    const unknown = (): SeedancePoll => ({ kind: "unknown", taskId, code: "SEEDANCE_POLL_UNKNOWN" });
    if ("error" in result || result.status !== 200 || !object(result.body) || result.body.id !== taskId) return unknown();
    const data = result.body;
    if (data.status === "queued" || data.status === "running") return { kind: "pending", taskId };
    if (["failed", "expired", "cancelled"].includes(String(data.status))) return { kind: "failed", taskId, ...refusal(data.error), retry: "none", free: true };
    if (data.status !== "succeeded" || !object(data.content) || !videoHttps(data.content.video_url)
      || data.content.last_frame_url != null && !videoHttps(data.content.last_frame_url)) return unknown();
    return { kind: "completed", taskId, videoUrl: data.content.video_url, lastFrameUrl: data.content.last_frame_url as string ?? null,
      completionTokens: object(data.usage) && Number.isSafeInteger(data.usage.completion_tokens) && Number(data.usage.completion_tokens) >= 0 ? Number(data.usage.completion_tokens) : null };
  }
  async cancelQueued(taskId: string, signal?: AbortSignal): Promise<boolean> {
    ensure(task(taskId), "SEEDANCE_TASK_INVALID"); const r = await this.#http.call("DELETE", `${TASKS}/${taskId}`, undefined, signal);
    return !("error" in r) && r.status >= 200 && r.status < 300;
  }
}
