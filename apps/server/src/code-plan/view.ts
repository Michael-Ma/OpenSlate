import type { CodePlanDiff, CodePlanView } from "@openslate/core/public";
import { invariant, moneyMicros } from "@openslate/core";
import type { ArtifactRef } from "@openslate/core";
import type { CodePlanExecution } from "./execution.js";
import type { Store } from "../persistence/store.js";
import type { CodePlanChoice, CodePlanHold, CodePlanRun, CodePlanStep, CodePlanVersion } from "./records.js";

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
  let spent = 0n, reserved = 0n;
  for (const step of steps) {
    if (!step.attemptId) continue;
    const liability = execution.liability(step.attemptId);
    const price = moneyMicros(step.priceMicros);
    const attempt = store.get<{ phase: string }>("attempt", step.attemptId);
    if (liability === "charged" || liability === "reserved" && attempt?.phase === "submission_unknown") spent += price;
    else if (liability === "reserved") reserved += price;
  }
  return {
    projectId, planVersion: run?.planVersion ?? null, state: run?.state ?? "empty",
    ...(run?.error ? { error: { message: run.error.message } } : {}),
    held: store.list<CodePlanHold>("code_plan_hold", projectId).some(hold => !hold.released),
    ceilingMicros: run?.ceilingMicros ?? "1000000", spentMicros: spent.toString(), reservedMicros: reserved.toString(),
    declarations: run?.declarations ?? { scenes: [], shots: [] },
    steps: steps.map(step => ({ key: step.key, kind: step.kind, state: step.state, model: String(step.input.model),
      label: stepLabel(step.input), ...(step.result?.ok ? { artifact: mediaArtifact(step.result.artifact) } : {}),
      ...(step.result && !step.result.ok ? { error: { code: step.result.error.code } } : {}),
      priceMicros: step.priceMicros, reached: run?.reachedStepKeys.includes(step.key) ?? false, updatedAt: step.updatedAt })),
    choices: store.list<CodePlanChoice>("code_plan_choice", projectId)
      .sort((a, b) => Number(Object.hasOwn(a, "answer")) - Number(Object.hasOwn(b, "answer")))
      .map(({ choiceId, optionsDigest, question, options, answer, answeredAt }) => ({ choiceId, optionsDigest, question, options,
        ...(answer !== undefined ? { answer } : {}), ...(answeredAt ? { answeredAt } : {}) })),
    versions: store.list<CodePlanVersion>("code_plan_version", projectId).sort((a, b) => b.version - a.version).slice(0, 50)
      .map(({ version, author, sha256, createdAt, diff }) => ({ version, author, sha256, createdAt, diff: diff ?? emptyDiff() })),
    logs: run?.logs ?? [], lastPassAt: run?.lastPassAt ?? null,
  };
}
