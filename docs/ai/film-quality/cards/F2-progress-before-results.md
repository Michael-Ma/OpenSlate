# F2 · A code film shows its scenes, shots and making steps as soon as a pass reaches them

Read `docs/ai/uiux-plan/codex/RULES.md` first; its hard rules apply in full. F1 and F3 run at the same time: stay out of `apps/server/src/studio-launcher.ts`, `apps/server/src/index.ts`, `apps/server/src/application/provider-catalog.ts`, `apps/server/src/code-plan/models.ts` and `apps/web/**`. You own `apps/server/src/code-plan/index.ts`, `view.ts` and their tests.

## Problem

In the live V1 run the first reference picture was being made while Plan still showed no scenes, no shots and no References row, for about a minute per picture. The view reads `run.declarations` and `run.reachedStepKeys`, and `CodePlanRuntime.pass()` writes them only after `evaluate` returns. `evaluate` awaits `Promise.allSettled(submissions)`, and a Codex image submission lasts the whole native turn, so the pass and its record wait for the picture.

## Change

As soon as the sandbox has finished the pass's evaluation, before waiting for submissions, persist what the pass now knows: its `declarations`, `logs`, `reachedStepKeys` (the steps reached so far), and `reviewKeys`, with the run still `running`, and emit `code_plan.changed`. The end of the pass then writes the final state as now. Keep every existing fence: an obsolete pass for an older plan version must not write; nothing about admission, settling choices (K2), retries or accounting changes; a dry run writes nothing. If writing before submissions finish needs a different shape (for example not awaiting submission completion inside the pass at all), choose the safer one and say why in the report.

## Tests

1. A plan whose first step is a slow image (a fake execution that holds its submission open): while it is in flight, the view already shows the plan's scenes and shots, the step as reached and `in_flight`, and the run as `running`.
2. When it finishes, the final run state is the same as before this change.
3. A pass overtaken by a newer version writes nothing, before or after its submissions.
4. Existing code-plan suites stay green.

## Finish

Run `pnpm test`, `pnpm typecheck`, `pnpm demo:code`. Write `docs/ai/film-quality/reports/F2-report.md`.
