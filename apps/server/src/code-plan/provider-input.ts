import { videoMode, videoModes } from "./identity.js";
import { lyriaBody } from "@openslate/providers";
import { codeOnlyVideoAdapter, videoI2vOptions } from "../execution/video-i2v-options.js";
import { invariant, providerProfileArguments } from "@openslate/core";
import type { JsonObject, ProviderProfile } from "@openslate/core";
import { assertCodexImageOperationOptions } from "../execution/codex-image-receipts.js";
import { assertViggleH3OperationOptions } from "../execution/viggle-h3-receipts.js";
import { assertAudioOperationOptions } from "../execution/audio-preflight.js";

export const videoRatios = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"] as const;
const ratioValue = (ratio: string): number => { const [w, h] = ratio.split(":").map(Number); return w! / h!; };
export function videoAspect(input: JsonObject, profile: ProviderProfile, frame?: { width?: number; height?: number }): JsonObject {
  if (profile.adapter !== "viggle-h3" && profile.adapter !== "minimax-h3") return input;
  if (!input.firstFrame && !(Array.isArray(input.references) && input.references.length)) return input;
  invariant(frame?.width && frame?.height, "CODE_PLAN_INPUT", "Video requires a measured conditioning image");
  const source = frame!.width! / frame!.height!;
  const aspect = input.aspectRatio ?? (profile.adapter === "viggle-h3"
    ? [...videoRatios].sort((a, b) => Math.abs(Math.log(source / ratioValue(a))) - Math.abs(Math.log(source / ratioValue(b))))[0]! : undefined);
  if (aspect === undefined) return input; // MiniMax follows the first frame; it has no ratio wire parameter.
  invariant(typeof aspect === "string" && videoRatios.includes(aspect as typeof videoRatios[number]), "CODE_PLAN_INPUT", "Unsupported video aspect ratio");
  invariant(profile.adapter !== "minimax-h3" || Math.abs(source / ratioValue(aspect) - 1) <= .01,
    "CODE_PLAN_INPUT", "MiniMax follows the first frame; choose a matching frame for this aspect ratio");
  return { ...input, aspectRatio: aspect };
}

/** Translate the small Studio input into the adapter's existing, pinned operation contract. */
export function codePlanProviderArgs(profile: ProviderProfile, input: JsonObject, policy: { enhance?: false } = {}): JsonObject {
  const base = providerProfileArguments(profile), settings = profile.configuration?.settings ?? {};
  const allowed = ["model", "profileDefinitionDigest", "variant"];
  let operation: JsonObject;
  if (profile.kind === "image") {
    allowed.push("prompt", "references", "width", "height");
    invariant(typeof input.prompt === "string" && input.prompt.trim().length > 0 && Buffer.byteLength(input.prompt) <= 32768,
      "CODE_PLAN_INPUT", "Images require a bounded nonempty prompt");
    const width = input.width ?? settings.width, height = input.height ?? settings.height;
    invariant(width === settings.width && height === settings.height, "CODE_PLAN_INPUT", "Image dimensions must match the installed profile");
    operation = { ...base, prompt: input.prompt, width: width!, height: height!, settings: profile.adapter === "openai-image" ? { quality: settings.quality! } : {} };
    if (profile.adapter === "codex-image") assertCodexImageOperationOptions(profile, operation);
  } else if (profile.kind === "video") {
    allowed.push("prompt", "firstFrame", "lastFrame", "references", "durationSeconds", "aspectRatio");
    const mode = videoMode(input), modes = videoModes({ kind: "video", profile });
    invariant(modes.includes(mode), "CODE_PLAN_INPUT", `${profile.id} supports video modes: ${modes.join(", ")}`);
    invariant(mode !== "text" || typeof input.aspectRatio === "string" && videoRatios.includes(input.aspectRatio as never), "CODE_PLAN_INPUT", "Text video requires an explicit aspectRatio");
    invariant(!Array.isArray(input.references) || input.references.length <= (profile.adapter === "viggle-h3" ? 4 : 9), "CODE_PLAN_INPUT", "Too many reference images");
    invariant(profile.adapter !== "viggle-h3" || mode !== "reference" || Number(input.durationSeconds) >= 5, "CODE_PLAN_INPUT", "Viggle reference clips need 5–15 seconds");
    const frameHash = (frame: unknown): string => {
      invariant(frame && typeof frame === "object" && !Array.isArray(frame) && "sha256" in frame && "kind" in frame
        && frame.kind === "image" && typeof frame.sha256 === "string" && /^[a-f0-9]{64}$/.test(frame.sha256), "CODE_PLAN_INPUT", "Use an owned image artifact");
      return frame.sha256;
    };
    const references = Array.isArray(input.references) && input.references.length ? input.references.map(frameHash) : undefined;
    const frames = { ...(input.firstFrame ? { firstFrameSha256: frameHash(input.firstFrame) } : {}),
      ...(input.lastFrame ? { lastFrameSha256: frameHash(input.lastFrame) } : {}), ...(references ? { references } : {}) };
    invariant(typeof input.prompt === "string" && input.prompt.trim().length > 0 && Buffer.byteLength(input.prompt) <= 32768
      && Number.isSafeInteger(input.durationSeconds) && Number(input.durationSeconds) * 30 >= (profile.minFrames ?? 1)
      && Number(input.durationSeconds) * 30 <= (profile.maxFrames ?? 450), "CODE_PLAN_INPUT", "Video duration must fit the installed profile");
    if (codeOnlyVideoAdapter(profile.adapter)) {
      allowed.push("resolution", "generateAudio", "seed");
      const options = videoI2vOptions(profile, input);
      operation = { ...base, prompt: input.prompt, durationFrames: options.seconds * 30, frameRate: { numerator: 30, denominator: 1 },
        ...frames,
        settings: { resolution: options.resolution, [profile.adapter === "seedance" ? "ratio" : "aspectRatio"]: options.aspectRatio, generateAudio: options.generateAudio },
        ...(options.seed === undefined ? {} : { seed: options.seed }) };
      invariant(Object.keys(input).every(key => allowed.includes(key)), "CODE_PLAN_INPUT", "Unsupported provider parameters");
      return operation;
    }
    operation = { ...base, prompt: input.prompt, durationFrames: Number(input.durationSeconds) * 30,
      frameRate: { numerator: 30, denominator: 1 }, settings: {},
      ...(profile.adapter === "viggle-h3" ? { ...(policy.enhance === undefined ? {} : { enhance: policy.enhance }), ...(references ? { references } : {}), ...(input.lastFrame ? { lastFrameSha256: frameHash(input.lastFrame) } : {}) } : {}),
      ...(profile.adapter === "viggle-h3" && input.aspectRatio !== undefined ? { aspectRatio: input.aspectRatio } : {}) };
    if (profile.adapter === "viggle-h3") assertViggleH3OperationOptions(profile, operation);
  } else if (profile.kind === "music") {
    allowed.push("prompt", "durationSeconds", "instrumental");
    lyriaBody({ prompt: input.prompt as string, durationSeconds: input.durationSeconds as number, instrumental: input.instrumental as boolean });
    operation = { ...base, prompt: input.prompt!, durationSeconds: input.durationSeconds!, instrumental: input.instrumental ?? true };
  } else {
    invariant(profile.kind === "speech", "CODE_PLAN_MODEL", "Unsupported code-plan operation");
    allowed.push("text", "voice", "instructions");
    operation = { ...base, text: input.text!, voice: input.voice!, instructions: input.instructions ?? "", settings: {} };
    assertAudioOperationOptions(profile, operation);
  }
  invariant(Object.keys(input).every(key => allowed.includes(key)), "CODE_PLAN_INPUT", "Unsupported provider parameters");
  return operation;
}
