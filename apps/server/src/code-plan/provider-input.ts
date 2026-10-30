import { invariant, providerProfileArguments } from "@openslate/core";
import type { JsonObject, ProviderProfile } from "@openslate/core";
import { assertCodexImageOperationOptions } from "../execution/codex-image-receipts.js";
import { assertViggleH3OperationOptions } from "../execution/viggle-h3-receipts.js";
import { assertAudioOperationOptions } from "../execution/audio-preflight.js";

/** Translate the small Studio input into the adapter's existing, pinned operation contract. */
export function codePlanProviderArgs(profile: ProviderProfile, input: JsonObject): JsonObject {
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
    allowed.push("prompt", "firstFrame", "durationSeconds");
    invariant(typeof input.prompt === "string" && input.prompt.trim().length > 0 && Buffer.byteLength(input.prompt) <= 32768
      && Number.isSafeInteger(input.durationSeconds) && Number(input.durationSeconds) * 30 >= (profile.minFrames ?? 1)
      && Number(input.durationSeconds) * 30 <= (profile.maxFrames ?? 450), "CODE_PLAN_INPUT", "Video duration must fit the installed profile");
    invariant(input.firstFrame && typeof input.firstFrame === "object" && !Array.isArray(input.firstFrame)
      && input.firstFrame.kind === "image", "CODE_PLAN_INPUT", "Video requires a first-frame artifact");
    operation = { ...base, prompt: input.prompt, durationFrames: Number(input.durationSeconds) * 30,
      frameRate: { numerator: 30, denominator: 1 }, settings: {} };
    if (profile.adapter === "viggle-h3") assertViggleH3OperationOptions(profile, operation);
  } else {
    invariant(profile.kind === "speech", "CODE_PLAN_MODEL", "Unsupported code-plan operation");
    allowed.push("text", "voice", "instructions");
    operation = { ...base, text: input.text!, voice: input.voice!, instructions: input.instructions ?? "", settings: {} };
    assertAudioOperationOptions(profile, operation);
  }
  invariant(Object.keys(input).every(key => allowed.includes(key)), "CODE_PLAN_INPUT", "Unsupported provider parameters");
  return operation;
}
