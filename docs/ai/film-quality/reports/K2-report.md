# K2 — cards follow the choices a plan reaches

## Implemented

- `CodePlanChoice` stores optional `askedAt` and `stale: true`; the browser view passes them through without changing its existing unanswered-first sort.
- Both `ctx.choose` and `ctx.keyframe` collect reached row identities. New non-preview choices receive `askedAt`. An unchanged choice is not rewritten by replay.
- A completed pass of the current version retires unreached choices, revives reached choices, and moves only a returning unanswered card's `askedAt`. Failed, CPU-limited, shutdown and overtaken passes leave existing choice liveness and backfill alone. `submitPlan` does not reset choices.
- Legacy rows without `askedAt` use the matching first option's image step `updatedAt`, including answered frame choices. Without a matching frame, only reached unanswered rows without `answeredAt` get the pass time; other rows remain undated. Settlement writes only changed rows.
- A stale answer is refused with `CODE_PLAN_CHOICE_STALE`, message `This card no longer applies`. An exact previously stored answer succeeds without rewriting the row, publishing a change or waking the run.
- `readCodeFilm` filters stale choices; `CodePlanPort.view` preserves history for the browser. Media-failure shot lookup excludes stale choices.
- Assets excludes stale frame choices and keeps an image current when a reached image or video step uses it as a reference/first frame, including reduced image-reference copies.
- The video gate exempts journal entries only when they have an attempt or a result. A held, never-dispatched video cannot bypass confirmation just because its cancelled/absent journal row exists.
- Current guidance contains the card's two requested paragraphs verbatim. The generic options-digest sentence now acknowledges previously answered exact options. Guidance digest: `1a3900cb45b263c96ea12a9f9a0ebc43b9666a36a64cfea62b9d511167964c26`. Archived 0.1.0/0.2.0 packages are unchanged.

## HTTP refusal

`POST /api/projects/:projectId/code-plan/choices` calls the runtime through `registerCodePlanRoutes`; `DomainError` reaches the existing error handler in `apps/server/src/app.ts`. Both `CODE_PLAN_CHOICE` and `CODE_PLAN_CHOICE_STALE` take its default **409 Conflict** branch. No route/error-handler modification was needed. The new HTTP integration test verifies the status, code, exact message, unchanged choices/events, and success for an identical stored stale answer.

## Other choice reader and self-review

`codePlanShotLinks` in `projection.ts` also reads keyframe choices for legacy shot inference. It now ignores stale rows, preventing retired cards from relabelling a current reference/clip. Explicit persisted `step.shotId` continues to work.

Self-review checked replay/version fences, answer idempotency, null answers, callers, view ordering, asset uses and guidance pins. It caught two boundary cases now covered: stopping after sandbox completion but before submission promises settle, and retired pictures consumed by a new image step rather than a video. Neither boundary may retire a valid card or hide a current reference. It also added reached/answered legacy-frame backfill coverage and checks both absent and cancelled gate bypasses.

## Verification

Pinned Node 24.15.0, pnpm 10.33.0 and FFmpeg/ffprobe 8.1.1 passed `pnpm check:toolchain` and `pnpm setup:test-media`; existing binaries matched, with no download.

Final results on this working tree:

| Command | Result |
| --- | --- |
| `pnpm build` | All **5/5** workspace builds passed. Existing web chunk-size/dynamic-import warnings remain. |
| `node scripts/run-tests.mjs apps/server/test/code-plan-choice-retire.test.mjs apps/server/test/code-plan-runtime.test.mjs apps/server/test/code-plan-keyframes.test.mjs` | **58 passed / 0 failed / 0 skipped**. |
| `pnpm test` | **5,100 passed / 0 failed / 2 skipped**, **5,102 total**, zero cancelled/todo; 739.450 seconds. |
| `pnpm typecheck` | All **5/5** workspace typechecks passed, zero errors. |
| `pnpm -r typecheck` | All **5/5** workspace typechecks passed again, zero errors. |
| `pnpm demo:code` | Passed: versions **1 → 2 → 3 → 4**, two answered choices, four reused steps, one new video plus render, **zero duplicate submissions**, **one lookup recovery**, fixture spend **$0.40 / $4.00**, final state **done**. |
| Guidance package digest verification | Current package bytes match `CODE_PLAN_GUIDANCE_DIGEST`. |
| `git diff --check` and ownership audit | Passed; only the files listed below changed. |

The two full-suite skips are `HTTP picture: animated WebP` (the installed decoder cannot decode animation; its explicit unsupported-format refusal is preserved) and the opt-in native Codex probe. No web tests failed. No timing-sensitive test failed, so no timing retry was needed. The full run had a quiet final interval but completed normally; a read-only process-list diagnostic was denied by the sandbox and no process control was attempted on another session.

Added **16 tests** in `code-plan-choice-retire.test.mjs`. Two existing files were adapted without deleting or disabling tests: `code-plan-runtime.test.mjs` now asserts the explicit stale-card code/message rather than the obsolete generic-error wording; `code-plan-keyframes.test.mjs` waits for and selects live unanswered cards rather than historical unanswered cards. The first compatibility run returned **85 passed / 1 failed**: that generic-error assertion was the sole failure, and its exact mismatch was deterministic. The first 15-case new suite passed; the strengthened 16-case suite also passed. An early full run was intentionally interrupted to rebuild after the self-review asset fix; it is not a completed full-gate result.

## File inventory

Modified:

- `apps/server/src/application/director-capabilities.ts`
- `apps/server/src/code-plan/assets.ts`
- `apps/server/src/code-plan/director.ts`
- `apps/server/src/code-plan/index.ts`
- `apps/server/src/code-plan/port.ts` (documentation only; method signatures unchanged)
- `apps/server/src/code-plan/projection.ts`
- `apps/server/src/code-plan/records.ts`
- `apps/server/src/code-plan/view.ts`
- `apps/server/test/code-plan-keyframes.test.mjs`
- `apps/server/test/code-plan-runtime.test.mjs`
- `skills/code-plan/SKILL.md`

Added:

- `apps/server/test/code-plan-choice-retire.test.mjs`
- `docs/ai/film-quality/reports/K2-report.md`

No deleted files. No web, shared browser-contract, schema, archived guidance or other card's source changes. This explicitly requested report is the only edit outside `apps/server/**` and `skills/code-plan/**`.

## Scope and lead handoff

All 14 requested test areas have offline coverage through the actual `CodePlanRuntime`, with fake provider accounting and disposable stores. Persisted programming-error/CPU-limit tests use the low-level `submitPlan` entry because ordinary `submit` rejects invalid source during preview. Shutdown and supersession use bounded submission barriers rather than timing sleeps. Fresh-turn coverage starts from the actual previous digest and verifies current guidance activation.

No live model/provider call, external-network request, browser launch/check, protected production-state read, port-3001 listener or commit was made. Actual Director compliance with story-rejection guidance and rendered thread placement remain for the lead to verify outside this sandbox. No requested card behavior was rejected. The extra shutdown fence, shot-link filter and current image-reference handling implement the stated failure/projection boundaries without adding a dependency graph.

Contract changes: none; `packages/core/src/studio-api.ts` already contained the optional fields.

Proposed commit (not created): `fix(code-plan): retire cards when their plan dependencies change`, including every file in the inventory above.
