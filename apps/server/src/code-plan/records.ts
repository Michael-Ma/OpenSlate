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
  /** Display metadata from the latest pass that reached this step; never provider input. */
  shotId?: string;
  state: "absent" | "in_flight" | "unknown" | "succeeded" | "failed" | "cancelled";
  attemptId: string | null; result: CodePlanResult | null; priceMicros: string; createdAt: string; updatedAt: string;
  retryAt?: number;
  automaticRetries?: number;
}
export interface CodePlanSettings { ceilingMicros: string }
export interface CodePlanChoice {
  id: string; projectId: string; choiceId: string; optionsDigest: string; question: string; options: JsonValue[];
  answer?: JsonValue; answeredAt?: string;
  askedAt?: string; stale?: true;
}
/** One round with a retake needs four: clips, render, the retaken clips, the new render. */
export const CODE_PLAN_REVIEW_TURNS = 4;
export interface CodePlanReview {
  id: string; projectId: string; reviewId: string; clipsDigest: string;
  clips: ArtifactRef[]; note: string; state: "waiting" | "watching" | "done" | "failed";
  requestId?: string; skipped?: boolean; createdAt: string; updatedAt: string;
}
export interface CodePlanRun {
  id: string; projectId: string; planVersion: number;
  state: "running" | "waiting" | "reviewing" | "error" | "paused_budget" | "done" | "done_with_failures";
  now: number; seed: number; ceilingMicros: string; lastPassAt: string | null;
  error: { message: string; stack: string } | null;
  reachedStepKeys: string[];
  reviewKeys?: string[];
  declarations: { scenes: JsonObject[]; shots: JsonObject[] }; logs: string[];
}
