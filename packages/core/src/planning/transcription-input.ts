import { types } from "node:util";
import { canonical, invariant } from "../common.js";
import type { CompileContext, TranscriptionApplicationInput, TranscriptionInputBinding } from "../contracts.js";

export const TRANSCRIPTION_INPUT_LIMITS = Object.freeze({ bindings: 64, canonicalBytes: 65536, identityBytes: 160 });
const fail = (condition: unknown): void => invariant(condition, "TRANSCRIPTION_INPUT_INVALID", "Transcription inputs require bounded exact application metadata");
const identity = (value: unknown): value is string => typeof value === "string" && value.length > 0
  && Buffer.byteLength(value, "utf8") <= TRANSCRIPTION_INPUT_LIMITS.identityBytes;
const sha256 = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

function fields(input: unknown, expected: readonly string[]): Record<string, unknown> {
  fail(input !== null && typeof input === "object" && !types.isProxy(input) && !Array.isArray(input)
    && [Object.prototype, null].includes(Object.getPrototypeOf(input)));
  const object = input as object, keys = Reflect.ownKeys(object);
  fail(keys.length === expected.length && keys.every(key => typeof key === "string" && expected.includes(key)));
  const result: Record<string, unknown> = {};
  for (const key of expected) {
    const field = Object.getOwnPropertyDescriptor(object, key);
    fail(field && Object.hasOwn(field, "value") && field.enumerable);
    Object.defineProperty(result, key, { value: field!.value, enumerable: true });
  }
  return result;
}

/** Detached/frozen data only. The application must separately verify the digest, source ownership and human review. */
export function snapshotTranscriptionInputs(input: unknown): readonly TranscriptionInputBinding[] {
  fail(!types.isProxy(input) && Array.isArray(input) && Object.getPrototypeOf(input) === Array.prototype);
  const array = input as unknown[], length = Object.getOwnPropertyDescriptor(array, "length")!.value as number;
  fail(Number.isSafeInteger(length) && length >= 0 && length <= TRANSCRIPTION_INPUT_LIMITS.bindings
    && Reflect.ownKeys(array).length === length + 1);
  const result: TranscriptionInputBinding[] = [], ids = new Set<string>();
  for (let index = 0; index < length; index++) {
    const item = Object.getOwnPropertyDescriptor(array, String(index));
    fail(item && Object.hasOwn(item, "value") && item.enumerable);
    const value = fields(item!.value, ["id", "digest", "consumerAlias", "artifact"]);
    const artifact = fields(value.artifact, ["artifactId", "sha256", "kind"]);
    fail(identity(value.id) && sha256(value.digest) && identity(value.consumerAlias)
      && identity(artifact.artifactId) && sha256(artifact.sha256) && artifact.kind === "audio" && !ids.has(value.id as string));
    ids.add(value.id as string);
    result.push(Object.freeze({ id: value.id as string, digest: value.digest as string, consumerAlias: value.consumerAlias as string,
      artifact: Object.freeze({ artifactId: artifact.artifactId as string, sha256: artifact.sha256 as string, kind: "audio" as const }) }));
  }
  fail(Buffer.byteLength(canonical(result)) <= TRANSCRIPTION_INPUT_LIMITS.canonicalBytes);
  return Object.freeze(result);
}

/** Capture the optional context member without evaluating an accessor or inherited catalog. */
export function snapshotCompileTranscriptionInputs(context: Pick<CompileContext, "transcriptionInputs">): readonly TranscriptionInputBinding[] | undefined {
  fail(context !== null && typeof context === "object" && !types.isProxy(context));
  const field = Object.getOwnPropertyDescriptor(context, "transcriptionInputs");
  if (!field) { fail(!("transcriptionInputs" in context)); return undefined; }
  fail(Object.hasOwn(field, "value") && field.enumerable);
  return field!.value === undefined ? undefined : snapshotTranscriptionInputs(field!.value);
}

export function snapshotTranscriptionApplicationInput(input: unknown): Readonly<TranscriptionApplicationInput> {
  const value = fields(input, ["kind", "id", "digest"]);
  fail(value.kind === "owned_transcription" && identity(value.id) && sha256(value.digest));
  return Object.freeze({ kind: "owned_transcription", id: value.id as string, digest: value.digest as string });
}
