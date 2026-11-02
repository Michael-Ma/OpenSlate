import type { CodePlanDiff, CodePlanView, StudioArtifactRef } from "@openslate/core/public";
import { invariant } from "@openslate/core";
import type { ArtifactRef } from "@openslate/core";
import type { CodePlanExecution } from "./execution.js";
import type { Store } from "../persistence/store.js";
import type { CodePlanChoice, CodePlanHold, CodePlanRun, CodePlanReview, CodePlanStep, CodePlanVersion } from "./records.js";
import { codePlanCeiling } from "./settings.js";
import { codePlanShotLinks } from "./projection.js";
import type { CodePlanPoster } from "./posters.js";
import { codePlanArtifacts, pictureSize, publicArtifact } from "./artifacts.js";
import { codePlanFitWarning } from "./fit-warning.js";

export const emptyDiff = (): CodePlanDiff => ({ reusedSteps: 0, newSteps: [], cancelledSteps: 0,
  certainMicros: "0", dependsOnPending: false, findings: [] });
export const stepLabel = (input: Record<string, unknown>): string =>
  (typeof input.prompt === "string" ? input.prompt : typeof input.motion === "string" ? input.motion : "").slice(0, 200);
const mediaArtifact = (artifact: ArtifactRef) => {
  invariant(artifact.kind !== "data", "CODE_PLAN_ARTIFACT", "Media steps require a media artifact");
  return { ...artifact, kind: artifact.kind };
};

export function codePlanView(store: Store, execution: CodePlanExecution, projectId: string): CodePlanView {
  const run = store.get<CodePlanRun>("code_plan_run", projectId);
  const steps = store.list<CodePlanStep>("code_plan_step", projectId);
  const reached = new Set(run?.reachedStepKeys);
  const choices = store.list<CodePlanChoice>("code_plan_choice", projectId), links = codePlanShotLinks(steps, choices, reached);
  const posters = new Map(store.list<CodePlanPoster>("code_plan_poster", projectId).map(row => [row.id, row.poster]));
  const media = codePlanArtifacts(store, projectId);
  const keyframes = new Set(steps.filter(step => step.kind === "image" && links.has(step.key))
    .flatMap(step => step.result?.ok ? [step.result.artifact, ...step.result.artifacts].map(ref => ref.artifactId) : []));
  const originals = new Map(media.records.filter(record => record.projectId === projectId && record.artifact.kind === "image")
    .flatMap(record => {
      const reference = media.imageReferences.get(record.id);
      return reference ? [[reference.id, record] as const] : [];
    }));
  const references: StudioArtifactRef[] = [], seen = new Set<string>();
  // The journal is first-seen order; reached keys select only inputs used by the latest pass.
  inputs: for (const step of steps) {
    if (!reached.has(step.key) || step.kind !== "image" && step.kind !== "video") continue;
    for (const input of [...(Array.isArray(step.input.references) ? step.input.references : []), step.input.firstFrame, step.input.lastFrame]) {
      const record = media.find(input);
      if (record?.artifact.kind !== "image" || keyframes.has(record.id)) continue;
      const original = originals.get(record.id) ?? record;
      if (keyframes.has(original.id) || seen.has(original.id)) continue;
      seen.add(original.id); references.push(publicArtifact(original.artifact));
      if (references.length === 24) break inputs;
    }
  }
  const sizes = new Map(media.records.filter(record => record.artifact.kind === "video" && media.posters.has(record.id))
    .map(record => [`video:${record.artifact.sha256}`, pictureSize(media.posters.get(record.id))]));
  const accounting = execution.accounting(projectId), attempts = execution.attempts(projectId);
  return {
    projectId, planVersion: run?.planVersion ?? null, state: run?.state ?? "empty",
    ...(run?.error ? { error: { message: run.error.message } } : {}),
    held: store.list<CodePlanHold>("code_plan_hold", projectId).some(hold => !hold.released),
    ceilingMicros: codePlanCeiling(store, projectId), spentMicros: (accounting.charged + accounting.unknown).toString(), reservedMicros: accounting.inFlight.toString(),
    declarations: run?.declarations ?? { scenes: [], shots: [] },
    ...(references.length ? { references } : {}),
    steps: steps.map(step => {
      const fitWarning = step.kind === "render" ? codePlanFitWarning(step.input, sizes) : undefined;
      return { key: step.key, kind: step.kind, state: step.state, model: String(step.input.model),
      label: stepLabel(step.input), ...(step.result?.ok ? { artifact: mediaArtifact(step.result.artifact) } : {}),
      ...(links.has(step.key) ? { shotId: links.get(step.key)! } : {}),
      ...(step.result?.ok && posters.get(step.result.artifact.artifactId) ? { poster: mediaArtifact(posters.get(step.result.artifact.artifactId)!) } : {}),
      ...(fitWarning ? { fitWarning } : {}),
      ...(step.result && !step.result.ok ? { error: step.attemptId ? execution.failure(step.attemptId)
        : { code: step.result.error.code, retry: "none" as const, mayHaveCharged: false } } : {}),
      attempts: attempts.filter(attempt => attempt.fingerprint === step.key).length,
      priceMicros: step.priceMicros, reached: run?.reachedStepKeys.includes(step.key) ?? false, updatedAt: step.updatedAt };
    }),
    choices: choices
      .sort((a, b) => Number(Object.hasOwn(a, "answer")) - Number(Object.hasOwn(b, "answer")))
      .map(({ choiceId, optionsDigest, question, options, answer, answeredAt, askedAt, stale }) => ({ choiceId, optionsDigest, question, options,
        ...(answer !== undefined ? { answer } : {}), ...(answeredAt ? { answeredAt } : {}),
        ...(askedAt ? { askedAt } : {}), ...(stale ? { stale } : {}) })),
    reviews: store.list<CodePlanReview>("code_plan_review", projectId)
      .filter(review => run?.reviewKeys?.includes(review.id))
      .map(review => ({ id: review.reviewId, note: review.note, state: review.state, clipCount: review.clips.length, updatedAt: review.updatedAt })),
    versions: store.list<CodePlanVersion>("code_plan_version", projectId).sort((a, b) => b.version - a.version).slice(0, 50)
      .map(({ version, author, sha256, createdAt, diff }) => ({ version, author, sha256, createdAt, diff: diff ?? emptyDiff() })),
    logs: run?.logs ?? [], lastPassAt: run?.lastPassAt ?? null,
  };
}
