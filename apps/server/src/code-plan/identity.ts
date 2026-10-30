import { canonical, digest, invariant } from "@openslate/core";
import type { JsonObject, JsonValue, ProviderProfile } from "@openslate/core";

export type CodePlanMediaKind = "image" | "video" | "speech" | "render";
export interface CodePlanModel { kind: CodePlanMediaKind; defaults?: JsonObject; priceMicros?: string; priceUnit?: "call" | "input"; profile?: ProviderProfile; profileDefinitionDigest?: string }
export const CODE_PLAN_MODELS: Readonly<Record<string, CodePlanModel>> = Object.freeze({
  "fake-image": { kind: "image" },
  "fake-video": { kind: "video", defaults: { durationSeconds: 6 } },
  "fake-speech": { kind: "speech", defaults: { voice: "fixture" }, priceMicros: "10000" },
  "local-render": { kind: "render", priceMicros: "0" },
});
const defaultModel = { image: "fake-image", video: "fake-video", speech: "fake-speech", render: "local-render" };

/** Whitespace in creative strings is significant. Only object order, defaults and artifact identities normalize. */
export function normalizeStepInput(kind: CodePlanMediaKind, value: unknown,
  models: Readonly<Record<string, CodePlanModel>> = CODE_PLAN_MODELS): JsonObject {
  const input = kind === "render" && Array.isArray(value) ? { timeline: value } : value;
  invariant(input && typeof input === "object" && !Array.isArray(input), "CODE_PLAN_INPUT", "Media input must be an object");
  const source = input as Record<string, unknown>;
  if (kind !== "render" && Object.hasOwn(source, "shot")) invariant(typeof source.shot === "string" && source.shot.length > 0 && source.shot.length <= 120,
    "CODE_PLAN_INPUT", "Use a shot annotation of 1 to 120 characters");
  const { shot: _shot, ...media } = source;
  const model = source.model ?? (models[defaultModel[kind]] ? defaultModel[kind] : Object.keys(models).find(id => models[id]?.kind === kind));
  invariant(typeof model === "string" && Object.hasOwn(models, model) && models[model]?.kind === kind,
    "CODE_PLAN_MODEL", "Use a configured model for this operation");
  const normalize = (item: unknown, depth: number): JsonValue => {
    invariant(depth <= 40, "CODE_PLAN_INPUT", "Media input nesting exceeds its limit");
    if (item === null || typeof item === "string" || typeof item === "boolean") return item;
    if (typeof item === "number") { invariant(Number.isFinite(item), "CODE_PLAN_INPUT", "Use finite parameters"); return Object.is(item, -0) ? 0 : item; }
    if (Array.isArray(item)) return item.map(value => normalize(value, depth + 1));
    invariant(item && typeof item === "object", "CODE_PLAN_INPUT", "Media parameters must be JSON values");
    const object = item as Record<string, unknown>;
    if (typeof object.sha256 === "string" && typeof object.kind === "string") {
      invariant(/^[a-f0-9]{64}$/.test(object.sha256) && ["image", "video", "audio", "document", "data"].includes(object.kind),
        "CODE_PLAN_INPUT", "Invalid input artifact identity");
      return { kind: object.kind, sha256: object.sha256 };
    }
    return Object.fromEntries(Object.keys(object).sort().map(key => [key, normalize(object[key], depth + 1)]));
  };
  const result = normalize({ ...models[model]?.defaults, ...(kind === "render" ? source : media), model, ...(models[model]?.profileDefinitionDigest ? { profileDefinitionDigest: models[model]!.profileDefinitionDigest! } : {}) }, 0) as JsonObject;
  invariant(Buffer.byteLength(canonical(result)) <= 256 * 1024, "CODE_PLAN_INPUT", "Media input exceeds its byte limit");
  return result;
}

export function stepKey(kind: CodePlanMediaKind, input: JsonObject): string { return digest({ kind, input }); }
