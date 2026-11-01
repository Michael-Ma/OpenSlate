import { videoMode } from "./identity.js";
import { invariant } from "@openslate/core";
import type { CodePlanStepDetail } from "@openslate/core/public";
import type { Attempt } from "../execution/engine.js";
import type { Store } from "../persistence/store.js";
import type { CodePlanStep } from "./records.js";
import { codePlanArtifacts, codePlanOutput, object, positive, publicArtifact } from "./artifacts.js";

type Call = NonNullable<CodePlanStepDetail["call"]>;
const mappings: Record<string, string> = { "viggle-h3": "viggle_h3_execution_mapping", "minimax-h3": "h3_execution_mapping",
  "seedance": "video_i2v_mapping", "fal-video-i2v": "video_i2v_mapping", "gemini-lyria": "lyria_dispatch",
  "codex-image": "codex_image_execution_mapping", "openai-image": "image_execution_mapping", "openai-speech": "speech_execution_mapping" };
const settingsKeys = ["model", "resolution", "quality", "aspectRatio", "ratio", "durationSeconds", "durationFrames", "width", "height", "seed", "generateAudio", "instrumental", "voice", "mode", "enhance"] as const;
const token = (value: unknown): value is string => typeof value === "string" && value.length <= 200
  && /^[A-Za-z0-9][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9][A-Za-z0-9_.-]*)*$/.test(value) && !/^(sk-|AIza|Bearer\b)/i.test(value);
function settings(...sources: Record<string, unknown>[]): Call["settings"] {
  const result: Call["settings"] = {};
  for (const source of sources) for (const key of settingsKeys) {
    const value = source[key];
    if (typeof value === "boolean" && ["generateAudio", "instrumental", "enhance"].includes(key)
      || typeof value === "number" && Number.isFinite(value) && ["durationSeconds", "durationFrames", "width", "height", "seed"].includes(key)
      || typeof value === "string" && (["aspectRatio", "ratio"].includes(key) ? /^(\d{1,4}:\d{1,4}|auto|adaptive)$/.test(value)
        : key === "mode" ? ["reference", "first_frame", "first_last_frame", "text"].includes(value) : ["model", "resolution", "quality", "voice"].includes(key) && token(value) && (key === "model" || !value.includes("/")))) result[key] = value;
  }
  return result;
}

/** Never serialize a request, profile, mapping, native session or receipt wholesale. */
function providerCall(store: Store, attempt: Attempt): Call | undefined {
  const adapter = attempt.request.execution.adapter;
  if (!Object.hasOwn(mappings, adapter)) return undefined;
  const kind = mappings[adapter]!;
  const saved = store.get<Record<string, unknown>>(kind, attempt.id);
  const mapping = saved?.projectId === attempt.projectId ? saved : {};
  const transport = object(mapping.transport), config = object(attempt.request.profile?.configuration), args = attempt.request.args;
  // H3/image/speech mappings record the exact wire description. The N2 video and Lyria
  // markers record a digest; their immutable attempt holds the scalar request settings.
  const exact = Object.keys(transport).length > 0;
  const selected = exact ? settings(transport) : settings(config, object(config.settings), args, object(args.settings), { mode: mapping.mode });
  const providerModel = selected.model;
  const projectCrop = (value: unknown): Call["firstFrameCrop"] => {
    const crop = object(value), cropKeys = ["sourceWidth", "sourceHeight", "width", "height"] as const;
    return cropKeys.every(key => positive(crop[key])) ? {
      sourceWidth: crop.sourceWidth as number, sourceHeight: crop.sourceHeight as number, width: crop.width as number, height: crop.height as number,
    } : undefined;
  };
  const firstFrameCrop = projectCrop(mapping.firstFrameCrop), lastFrameCrop = projectCrop(mapping.lastFrameCrop);
  const requestDigest = transport.requestDigest ?? mapping.requestDigest;
  return { adapter, ...(typeof providerModel === "string" ? { providerModel } : {}), settings: selected,
    ...(firstFrameCrop ? { firstFrameCrop } : {}), ...(lastFrameCrop ? { lastFrameCrop } : {}),
    ...(token(attempt.taskId) && !attempt.taskId.includes("/") ? { taskId: attempt.taskId } : {}),
    ...(typeof requestDigest === "string" && /^[a-f0-9]{64}$/.test(requestDigest) ? { requestDigest } : {}) };
}

export function codePlanStepDetail(store: Store, projectId: string, stepKey: string, attempts: Attempt[]): CodePlanStepDetail {
  const step = store.list<CodePlanStep>("code_plan_step", projectId).find(row => row.key === stepKey);
  invariant(step, "NOT_FOUND", "Code plan step not found");
  const media = codePlanArtifacts(store, projectId), input = step.input;
  const attempt = attempts.find(row => row.id === step.attemptId && row.fingerprint === step.key);
  const call = attempt ? providerCall(store, attempt) : undefined;
  const output = codePlanOutput(media, step.result?.ok ? step.result.artifact : undefined);
  const firstFrame = media.find(input.firstFrame), lastFrame = media.find(input.lastFrame);
  const references = Array.isArray(input.references) ? input.references.flatMap(ref => { const row = media.find(ref); return row?.artifact.kind === "image" ? [publicArtifact(row.artifact)] : []; }) : [];
  const prompt = typeof input.prompt === "string" ? input.prompt : typeof input.text === "string" ? input.text : typeof input.motion === "string" ? input.motion : undefined;
  return { key: step.key, kind: step.kind, state: step.state, model: String(input.model), ...(prompt !== undefined ? { prompt } : {}),
    ...(positive(input.durationSeconds) ? { durationSeconds: input.durationSeconds } : {}),
    ...(typeof input.aspectRatio === "string" ? { aspectRatio: input.aspectRatio } : {}), ...(typeof input.variant === "string" ? { variant: input.variant } : {}),
    ...(step.kind === "video" ? { mode: videoMode(input) } : {}), ...(references.length ? { references } : {}),
    ...(lastFrame?.artifact.kind === "image" ? { lastFrame: publicArtifact(lastFrame.artifact) } : {}),
    ...(firstFrame?.artifact.kind === "image" ? { firstFrame: publicArtifact(firstFrame.artifact) } : {}), ...(output ? { output } : {}),
    priceMicros: step.priceMicros, attempts: attempts.filter(row => row.fingerprint === step.key).length, createdAt: step.createdAt, ...(call ? { call } : {}) };
}
