import type { ArtifactRef, JsonObject, JsonValue } from "@openslate/core";
import type { CodePlanMediaKind } from "./identity.js";
import type { CodePlanDiff } from "@openslate/core/public";

export interface CodePlanVersion {
  id: string; projectId: string; version: number; source: string; sha256: string; author: "director" | "user"; createdAt: string;
  diff?: CodePlanDiff;
}
export interface CodePlanHold { id: string; projectId: string; holdId: string; released: boolean }
export interface CodePlanInvocation { id: string; projectId: string; invocationId: string; version: number; diff: CodePlanDiff }
export type CodePlanResult = { ok: true; artifact: ArtifactRef; artifacts: ArtifactRef[]; leadInSamples?: number; durationSamples?: number }
  | { ok: false; error: { code: string; message: string; retry: "safe" | "consent" | "none"; mayHaveCharged: boolean } };
export interface CodePlanStep {
  id: string; projectId: string; key: string; kind: CodePlanMediaKind; input: JsonObject;
  state: "absent" | "in_flight" | "unknown" | "succeeded" | "failed" | "cancelled";
  attemptId: string | null; result: CodePlanResult | null; priceMicros: string; createdAt: string; updatedAt: string;
  retryAt?: number;
  automaticRetries?: number;
}
export interface CodePlanChoice {
  id: string; projectId: string; choiceId: string; optionsDigest: string; question: string; options: JsonValue[];
  answer?: JsonValue; answeredAt?: string;
}
export interface CodePlanRun {
  id: string; projectId: string; planVersion: number;
  state: "running" | "waiting" | "error" | "paused_budget" | "done" | "done_with_failures";
  now: number; seed: number; ceilingMicros: string; lastPassAt: string | null;
  error: { message: string; stack: string } | null;
  reachedStepKeys: string[];
  declarations: { scenes: JsonObject[]; shots: JsonObject[] }; logs: string[];
}
