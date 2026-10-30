# P2c · Offline end-to-end: one message to an edited film through the real stack

Read `docs/ai/uiux-plan/codex/RULES.md` first; its hard rules apply in full. Then read `docs/ai/code-plan/DESIGN.md` and the P1, P2a, P2b and P3a reports in `docs/ai/code-plan/reports/`.

P2a, P2b and P3a were each tested against a fake `CodePlanPort`. They are now merged and wired together on `feature/last-ferry-ui`:

- `CodePlanRuntime` implements the port;
- `createApp` and `LocalDirectorController` both receive it;
- the fake Director submits `skills/code-plan/references/example-plan.ts` in code projects.

This card proves the pieces work together, and fixes what does not.

## Change

1. **An end-to-end test** `apps/server/test/code-plan-e2e.test.mjs`. It drives the real `createApp` with the real `CodePlanRuntime`, `CodePlanExecution` on the fake provider, the fake Director and a temporary data directory, through HTTP like the browser does: session, CSRF, Idempotency-Key. It advances by calling the same tick functions the 500 ms loop calls, never by sleeping on wall time.
   1. `POST /api/projects` with `planMode: "code"`.
   2. Post a human message. Expect a hold to open; the fake Director turn submits the example plan as version 1; the hold is released when the turn ends.
   3. Tick until `GET .../code-plan` is `waiting` with an unanswered keyframe choice whose options are three succeeded image artifacts. Fetch one option's media through the route P3a documented.
   4. Answer every choice through `POST .../code-plan/choices`. Tick until `done`, with a succeeded render. Spend is within the $1 ceiling.
   5. Submit an edited source through `POST .../code-plan/source` that changes one shot's motion only. The receipt's diff reports exactly one new video and one new render, everything else reused. Tick until `done`: the provider saw exactly those two new submissions.
   6. Restart in the middle: rebuild the app on the same data directory while a step is in flight. The intent is reconciled by lookup with zero new submits, and the run finishes.
   7. Events: every step above appended at least one `code_plan.changed`, and idle ticks appended none.
   8. Graph isolation: a graph project created in the same app keeps its old routes and behaviour, and the code-plan routes refuse it with `CODE_PLAN_MODE`.
2. **An offline demo** `pnpm demo:code`, next to `pnpm demo:headless`. It runs the same flow headlessly against a temporary directory and prints a short summary: versions, steps reused and new, spend, final state. It must never touch `.openslate/` or port 3001.
3. **Fix what the test finds.** Any defect goes in the narrowest place, with a regression test, and is listed in your report. That covers the runtime, port, routes, Director wiring, fake Director or example plan. If a fix would change `apps/server/src/code-plan/port.ts` or the code-plan section of `packages/core/src/studio-api.ts` (lead-owned), stop and describe the needed change under Open issues instead.
4. **Docs:** add the demo to `docs/technical/OPERATIONS-TESTING.md` and an entry to `docs/implementation/STATUS.md`.

## Files you own

- The new test and demo files, and `package.json` scripts.
- Narrow fixes anywhere under `apps/server/src/code-plan/`, `apps/server/src/application/` and `skills/code-plan/`. If you change any file in `skills/code-plan/`, update `CODE_PLAN_GUIDANCE_DIGEST` in `director-capabilities.ts` to the package's new digest.

Do not edit `apps/web/**`.

## Out of scope

- Real providers (P4a).
- The web (lead).
