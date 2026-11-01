import type { CodePlanStepDetail } from "@openslate/core/public";
import { madeMsg } from "./assets.ts";
import { formatMicros } from "./price.ts";
import { msg, type Msg } from "./types.ts";

/**
 * What the media viewer says about a step (GET /code-plan/steps/:stepKey): the facts anyone can read, and in Developer
 * mode what went to the provider.
 */
export interface FactRow {
  label: Msg;
  value: Msg;
}

const raw = (text: string): Msg => msg("assets.raw", { text });
const size = (width: number, height: number): string => `${width} × ${height}`;

export function stepFacts(detail: CodePlanStepDetail, now: Date, locale: string): FactRow[] {
  const rows: FactRow[] = [{ label: msg("viewer.fact.model"), value: raw(detail.model) }];
  const { width, height } = detail.output ?? {};
  if (width && height) rows.push({ label: msg("viewer.fact.size"), value: raw(size(width, height)) });
  const seconds = detail.output?.durationSeconds ?? detail.durationSeconds;
  if (seconds) rows.push({ label: msg("viewer.fact.length"), value: msg("assets.seconds", { seconds: Math.round(seconds * 10) / 10 }) });
  if (detail.aspectRatio) rows.push({ label: msg("viewer.fact.ratio"), value: raw(detail.aspectRatio) });
  if (BigInt(detail.priceMicros) > 0n) rows.push({ label: msg("viewer.fact.price"), value: raw(formatMicros(detail.priceMicros, locale)) });
  if (detail.attempts > 1) rows.push({ label: msg("viewer.fact.attempts"), value: raw(String(detail.attempts)) });
  rows.push({ label: msg("viewer.fact.made"), value: madeMsg(detail.createdAt, now, locale) });
  return rows;
}

export function callFacts(detail: CodePlanStepDetail): { label: string; value: string }[] {
  const call = detail.call;
  if (!call) return [];
  const crop = call.firstFrameCrop;
  return [
    { label: "adapter", value: call.adapter },
    ...(call.providerModel ? [{ label: "model", value: call.providerModel }] : []),
    ...Object.entries(call.settings).map(([label, value]) => ({ label, value: String(value) })),
    ...(crop ? [{ label: "firstFrameCrop", value: `${size(crop.sourceWidth, crop.sourceHeight)} → ${size(crop.width, crop.height)}` }] : []),
    ...(call.taskId ? [{ label: "taskId", value: call.taskId }] : []),
    ...(call.requestDigest ? [{ label: "requestDigest", value: call.requestDigest }] : []),
  ];
}
