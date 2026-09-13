import { canonical, digest, invariant, moneyMicros, providerProfileArguments } from "@openslate/core";
import type { JsonObject, ProviderConfiguration, ProviderProfile } from "@openslate/core";
import { describeOpenAISpeechWireRequest, validateOpenAITranscriptionOptions } from "@openslate/providers";
import type { OpenAISpeechDescription, OpenAISpeechRequest, OpenAITranscriptionRequest } from "@openslate/providers";

export interface AudioProfilePreflight {
  id: string; revision: string; kind: "speech" | "transcription";
  adapter: "openai-speech" | "openai-transcription"; executionVersion: "1";
  model: string; profileDigest: string; definitionDigest: string; estimatedMicros: string;
}
export type AudioOperationPreflight = {
  kind: "speech"; profile: AudioProfilePreflight; voice: OpenAISpeechRequest["voice"];
  textSha256: string; instructionSha256: string; textBytes: number; instructionBytes: number; totalTextBytes: number;
  budgetPolicy: "utf8-cap-v1"; responseFormat: "wav"; speed: 1;
} | {
  kind: "transcription"; profile: AudioProfilePreflight; language: string | null; timing: "word"; responseFormat: "verbose_json";
};
const MAX_BYTES = 16384;
const PROFILE_FIELDS = ["id", "revision", "kind", "adapter", "executionVersion", "configuration", "maxConcurrency", "unitCostMicros", "maxRetries"];
const ARGUMENT_FIELDS = ["profileIdentity", "profileRevision", "adapter", "executionVersion", "profileConfiguration", "profileDigest"];
const fail = (value: unknown, code: string): void => invariant(value, code, "Audio options require a supported exact profile and operation");
const integer = (value: unknown, min: number, max: number): boolean => Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;

/** Small detached data only; no getters, coercion hooks, source handles or IO. */
function snapshot<T>(input: T, code: string): T {
  const ancestors = new Set<object>(); let count = 0, bytes = 0;
  const copy = (value: unknown, depth: number): unknown => {
    fail(++count <= 512 && depth <= 8, code);
    if (typeof value === "string") { bytes += Buffer.byteLength(value); fail(bytes <= MAX_BYTES, code); return value; }
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "number") { fail(Number.isFinite(value), code); return value; }
    fail(value !== null && typeof value === "object" && !Array.isArray(value) && !ancestors.has(value as object)
      && [Object.prototype, null].includes(Object.getPrototypeOf(value)), code);
    const object = value as object, keys = Reflect.ownKeys(object); fail(keys.length <= 64, code); ancestors.add(object);
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      fail(typeof key === "string", code); const property = Object.getOwnPropertyDescriptor(object, key)!;
      fail(Object.hasOwn(property, "value") && property.enumerable, code);
      bytes += Buffer.byteLength(key as string); fail(bytes <= MAX_BYTES, code);
      Object.defineProperty(result, key, { value: copy(property.value, depth + 1), enumerable: true, configurable: true, writable: true });
    }
    ancestors.delete(object); return result;
  };
  const result = copy(input, 0); fail(Buffer.byteLength(canonical(result)) <= MAX_BYTES, code); return result as T;
}
function fields(value: unknown, expected: readonly string[], code: string): asserts value is Record<string, unknown> {
  fail(value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key)), code);
}

/** Shared bridge kernel: keeps the existing request, description and exact body length. */
export function prepareSpeechOperationOptions(configuration: ProviderConfiguration, input: JsonObject): {
  request: OpenAISpeechRequest; description: OpenAISpeechDescription; bodyByteLength: number;
} {
  const code = "SPEECH_EXECUTION_CONFLICT", { config, args } = snapshot({ config: configuration, args: input }, code);
  fields(config, ["model", "settings"], code); fields(config.settings, [], code);
  fields(args, [...ARGUMENT_FIELDS, "text", "voice", "instructions", "settings"], code); fields(args.settings, [], code);
  const request = { model: config.model, text: args.text, voice: args.voice, instructions: args.instructions } as OpenAISpeechRequest;
  const { description, bodyByteLength } = describeOpenAISpeechWireRequest(request);
  return { request, description, bodyByteLength };
}

/** Shared bridge kernel: maps only the explicit auto language choice; never prepares audio. */
export function transcriptionOperationOptions(configuration: ProviderConfiguration, input: JsonObject): Pick<OpenAITranscriptionRequest, "model" | "language" | "timing"> {
  const code = "TRANSCRIPTION_EXECUTION_CONFLICT", { config, args } = snapshot({ config: configuration, args: input }, code);
  fields(config, ["model", "settings"], code); fields(config.settings, [], code);
  fields(args, [...ARGUMENT_FIELDS, "language", "timing", "settings"], code); fields(args.settings, [], code);
  fail(typeof args.language === "string", code);
  const options = { model: config.model, language: args.language === "auto" ? null : args.language, timing: args.timing } as Pick<OpenAITranscriptionRequest, "model" | "language" | "timing">;
  validateOpenAITranscriptionOptions(options); return options;
}

function profileValue(input: unknown): { profile: ProviderProfile; result: AudioProfilePreflight } {
  const code = "AUDIO_PREFLIGHT_INVALID", value = snapshot(input, code); fields(value, PROFILE_FIELDS, code);
  fail(value.executionVersion === "1" && (value.adapter === "openai-speech" && value.kind === "speech"
    || value.adapter === "openai-transcription" && value.kind === "transcription")
    && integer(value.maxConcurrency, 1, 64) && integer(value.maxRetries, 0, 3) && typeof value.unitCostMicros === "string", code);
  fields(value.configuration, ["model", "settings"], code); fields(value.configuration.settings, [], code);
  const profile = value as unknown as ProviderProfile, args = providerProfileArguments(profile);
  const estimatedMicros = moneyMicros(profile.unitCostMicros).toString();
  if (value.kind === "speech") describeOpenAISpeechWireRequest({ model: value.configuration.model, text: "Local configuration validation", voice: "coral", instructions: "" } as OpenAISpeechRequest);
  else validateOpenAITranscriptionOptions({ model: value.configuration.model, language: null, timing: "word" } as Pick<OpenAITranscriptionRequest, "model" | "language" | "timing">);
  return { profile, result: { id: profile.id, revision: profile.revision, kind: profile.kind as AudioProfilePreflight["kind"],
    adapter: profile.adapter as AudioProfilePreflight["adapter"], executionVersion: "1", model: profile.configuration!.model,
    profileDigest: args.profileDigest as string, definitionDigest: digest(profile), estimatedMicros } };
}

/** Catalog/readiness policy only. The estimate is configured, and no authority or key is inspected. */
export function preflightAudioProfile(profile: unknown): AudioProfilePreflight {
  try { return profileValue(profile).result; }
  catch { invariant(false, "AUDIO_PREFLIGHT_INVALID", "Audio profile requires supported pinned settings and an explicit estimate"); }
}

/** Synchronous option eligibility before admission. Does not resolve or validate input source ownership/arity. */
export function assertAudioOperationOptions(input: ProviderProfile, inputArgs: JsonObject): AudioOperationPreflight {
  try {
    const { profile, result } = profileValue(input), args = snapshot(inputArgs, "AUDIO_PREFLIGHT_INVALID"), expected = providerProfileArguments(profile);
    fail(Object.entries(expected).every(([key, value]) => Object.hasOwn(args, key) && canonical(args[key]) === canonical(value)), "AUDIO_PREFLIGHT_INVALID");
    if (profile.kind === "speech") {
      const { description } = prepareSpeechOperationOptions(profile.configuration!, args);
      return { kind: "speech", profile: result, voice: description.voice, textSha256: description.textSha256,
        instructionSha256: description.instructionSha256, textBytes: description.textBytes, instructionBytes: description.instructionBytes,
        totalTextBytes: description.totalTextBytes, budgetPolicy: description.budgetPolicy, responseFormat: "wav", speed: 1 };
    }
    const options = transcriptionOperationOptions(profile.configuration!, args);
    return { kind: "transcription", profile: result, language: options.language, timing: "word", responseFormat: "verbose_json" };
  } catch { invariant(false, "AUDIO_PREFLIGHT_INVALID", "Audio operation options are unsupported or differ from their exact pinned profile"); }
}
