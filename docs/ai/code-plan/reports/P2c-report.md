# P2c offline integration report

Date: 2026-10-29. Worktree: `codex-p2c-e2e`; branch: `codex/p2c-e2e`.

## Done

- **P2c change 1 — integrated HTTP proof:** added `apps/server/test/code-plan-e2e.test.mjs` with a shared fixture/scenario. It constructs the real `createApp`, `CodePlanRuntime`, `CodePlanExecution`, `LocalDirectorController` and `FakeProvider`, pairs through `POST /api/session`, and uses cookies, CSRF and Idempotency-Key on the actual routes. Explicit production Director/engine/code-plan tick functions advance the run; no scheduler sleeps or server listener are used. The fake Director submits the exact pinned example as version 1, with an observable open request hold and release on completed turn. Each of two choices has three distinct succeeded image artifacts; authenticated media bytes are hash-checked through P3a's existing route.
- **P2c change 1 — editing/recovery:** initial work is six images, two videos and one fixture render (**9 submissions**). A user source edit changes only shot 1's motion. The completed version 2 reuses **7 steps** and adds exactly **one video and one render** (**11 total submissions**), retaining both choices and all historical results. The fake vendor accepts the edited video and deliberately loses its POST reply. The app/runtime/Director/provider/store are closed and rebuilt on the same temporary paths, with fresh sessions. Recovery calls lookup on the same attempt and never resubmits it. A separate single-effect restart case finishes with **zero new submissions of any kind** after restart; repeated unavailable lookups preserve unknown liability and stay event-quiet. The immediate preview requirement is unresolved below.
- **P2c change 1 — boundaries:** creation, hold/submission/release, generated choices, answers, edited source, recovered clip and final render publish `code_plan.changed` with increasing event sequence. Reads, receipt replays and idle ticks stay quiet. All five code-plan routes refuse a graph project with `CODE_PLAN_MODE`; its original project/generation reads and storyboard editing still work. Further real-runtime cases cover missing authentication/CSRF/key, changed-key-body refusal, stale versions, rejected syntax, lost HTTP submission-result recovery, and ceiling pause/raise without duplicate work.
- **P2c change 2 — demo:** `pnpm demo:code` builds and runs the exact shared scenario, then removes its own temporary directory. Its short summary gives versions, reached preview versus eventual new/reused work, lookup recovery, spend and final state. The fixture uses explicit positive estimates (10,000 micros/image and 100,000/video), totaling **360,000 micros ($0.36) under 1,000,000 ($1.00)**, with zero pending reservations. No production environment/configuration is loaded.
- **P2c change 3 — narrow fixes:** code-project creation now appends the initial `{planVersion: null, state: "empty"}` event; omitted/graph creation remains unchanged. The example now has independently editable motion per shot and carries the actual successful/fallback motion alongside each clip in its fixture timeline. Stock fake video bytes are deliberately identical across prompts, so the old artifact-only timeline reused the render even after a motion edit. The timeline correction makes the new render explicit without changing fake output bytes or weakening content-based reuse. `CODE_PLAN_GUIDANCE_DIGEST` now matches the changed package (`939bb8e7daf8fb1267fbfa8ab629fb3a64b776bf607d67200b7116f7cd649b3e`).
- **P2c change 4 — docs:** added the demo and its evidence boundaries to operations/testing and implementation status.

## Files

Added:

- `apps/server/test/code-plan-e2e.test.mjs`
- `apps/server/test/code-plan-e2e-fixture.mjs`
- `scripts/demo-code.mjs`
- `docs/ai/code-plan/reports/P2c-report.md`

Changed:

- `apps/server/src/application/service.ts`
- `apps/server/src/application/director-capabilities.ts`
- `apps/server/test/code-plan-director.test.mjs`
- `skills/code-plan/references/example-plan.ts`
- `package.json`
- `docs/technical/OPERATIONS-TESTING.md`
- `docs/implementation/STATUS.md`

Deleted: none. Web source, both lead-owned contracts, dependencies, schema/DDL and real-provider code are unchanged.

## Tests

Added **5 integration tests**. Extended **1 existing example sandbox test** to verify fallback motion reaches the render timeline. No existing test was rewritten, deleted, skipped, disabled or relaxed. The initial event and successful-motion render changes are covered in the integrated scenario.

Verification used Node **24.15.0**, pnpm **10.33.0**, FFmpeg/ffprobe **8.1.1**:

| Command | Observed result |
| --- | --- |
| `pnpm setup:test-media` | Passed; matching installed tools, no download |
| `pnpm check:toolchain` | Passed; exact versions and required encoders |
| `pnpm build` | Passed; all five workspace builds |
| `node scripts/run-tests.mjs apps/server/test/code-plan-e2e.test.mjs apps/server/test/code-plan-director.test.mjs apps/server/test/code-plan-routes.test.mjs` | **51 passed, 0 failed/skipped/cancelled/todo**; 8.244 s |
| `pnpm test` | **4,703 passed, 0 failed/cancelled/todo, 1 skipped; 4,704 total**; 1,108.718 s; all four shipped releases verified |
| `pnpm -r typecheck` | **5/5 passed** (core, providers, director, server, web), zero TypeScript errors |
| `pnpm exec tsc --strict --noEmit --target ES2022 --module ESNext --skipLibCheck --types node skills/code-plan/references/studio.d.ts skills/code-plan/references/example-plan.ts` | Passed |
| `pnpm demo:code` | Passed; versions 1 → 2, two choices, seven reused steps, one new render/video, one lookup recovery, zero duplicate submissions, $0.36 / $1.00, final `done` |
| `git diff --check` | Passed |

The optional skip is `opt-in native Codex probe never starts a model turn`. No unrelated failure was observed. Build output retains the existing Vite mixed-import/chunk-size warnings; sandbox passes emit the expected Node TypeScript-stripping experimental warning. The full suite had a quiet existing release-validation tail and completed successfully without a duplicate full run. Logs are `/tmp/openslate-p2c-{build,focused,full-test,typecheck,demo}.log`. A direct `node scripts/demo-code.mjs` run also passed before the final named-command check. The guidance package digest and introduced documentation/demo targets were verified locally. Final ownership checks confirm no web or lead-owned contract diff.

Self-review covered the complete tracked and new-file diff: callers, event publication/replay, fixture prices/liability, actual submission/lookup counts, stored receipts, restart/session replacement, graph isolation, example primary/fallback timelines, guidance identity, cleanup and file ownership. It added assertions for distinct image options, absence of graph bindings/selections, quiet media reads and the actual motion sent to the replacement render. No further actionable implementation issue remained; the preview-contract mismatch is intentionally unresolved below. During initial harness bring-up, an assertion omitted the required project argument to `Store.list`; the provider bridge correctly treated that thrown call as an unknown outcome. The fixture assertion was corrected without changing production recovery behavior. Early focused failures were harness issues, not evidence of a runtime failure.

## Contract changes

None. `apps/server/src/code-plan/port.ts` and `packages/core/src/studio-api.ts` remain unchanged.

## Commits

No commits created, under the hard card rules. Proposed lead-owned split:

1. `test(code-plan): prove offline HTTP editing and restart recovery` — `apps/server/test/code-plan-e2e.test.mjs`, `apps/server/test/code-plan-e2e-fixture.mjs`, `apps/server/test/code-plan-director.test.mjs`, `scripts/demo-code.mjs`, `package.json`, `apps/server/src/application/{service,director-capabilities}.ts`, `skills/code-plan/references/example-plan.ts`.
2. `docs(code-plan): record offline demo verification and preview gap` — `docs/technical/OPERATIONS-TESTING.md`, `docs/implementation/STATUS.md`, `docs/ai/code-plan/reports/P2c-report.md`.

## Open issues

- **P2c 1.5 is not fully satisfied: immediate edit receipt cannot report the downstream render under the current contract.** The actual receipt is `reusedSteps: 3`, `newSteps: [video]`, `certainMicros: "100000"`, `dependsOnPending: true`. The edited example sequentially awaits the new video before reaching shot 2 and the final render. `CodePlanPort.dryRun` and `CodePlanDiff.certainMicros` explicitly describe reached work before a pending result/choice; P2b's report documents this limitation. Once the actual video is ingested, version 2 reaches seven reused steps and exactly the video/render pair. The test/demo report and assert both observations rather than inventing pending output artifacts or changing the immutable saved diff after the fact. A compliant complete forecast needs a lead-owned contract/design decision: either accept this reached-only receipt and verify eventual work, or define estimated/unresolved downstream work separately from the reached `newSteps`/`certainMicros` fields and coordinate runtime/routes/Director/UI consumers. Per the card's stop rule, that contract change was not made. This card is therefore **partially complete**, not full acceptance of every requirement.
- **Fixture-only recovery/media evidence:** the stock fake cannot look up a missing POST reply; this fixture explicitly installs a durable fake-vendor receipt oracle using the separate fake database. It never discovers the job from missing application state or calls submit to recover it. This proves runtime lookup/reconciliation behavior, not a real vendor's lookup capabilities. MP4 output and rendering remain labeled placeholders, and fixture prices are not provider quotes. No FFmpeg assembly or live quality acceptance is claimed.
- Existing upstream detached-Promise rejection reporting remains at the P2b boundary; it was not changed by this card.
- No browser/check, real model/provider call, external network request, protected-state read, port-3001 listener, commit or push occurred. No subagent was used.
