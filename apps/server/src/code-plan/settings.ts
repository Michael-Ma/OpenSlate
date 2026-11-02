import type { Store } from "../persistence/store.js";
import type { CodePlanRun, CodePlanSettings } from "./records.js";

export function codePlanCeiling(store: Store, projectId: string): string {
  return store.get<CodePlanRun>("code_plan_run", projectId)?.ceilingMicros
    ?? store.get<CodePlanSettings>("code_plan_settings", projectId)?.ceilingMicros ?? "4000000";
}
