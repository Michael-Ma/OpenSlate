import { codePlanFixture, runCodePlanOfflineFlow } from "../apps/server/test/code-plan-e2e-fixture.mjs";

const fixture = await codePlanFixture();
try {
  const summary = await runCodePlanOfflineFlow(fixture);
  console.log(summary.label);
  console.log(`Versions: ${summary.versions.join(" → ")}; choices answered: ${summary.choicesAnswered}`);
  console.log(`Edit: ${summary.edit.reusedSteps} reused, ${summary.edit.newSteps.join(" + ")} new; ${summary.submissions.duplicateAttempts} duplicate submissions`);
  console.log(`Preview: ${summary.edit.preview.reusedSteps} reused, video new; render is reached after the pending clip`);
  console.log(`Lookup recoveries: ${summary.submissions.recoveredByLookup}; spend: $${(Number(summary.spentMicros) / 1000000).toFixed(2)} / $${(Number(summary.ceilingMicros) / 1000000).toFixed(2)}; final: ${summary.finalState}`);
} finally { await fixture.close(); }
