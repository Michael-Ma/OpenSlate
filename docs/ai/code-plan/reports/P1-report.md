# P1 replay runtime report

Date: 2026-10-29. Worktree: `codex-p1-code-plan`; branch: `codex/p1-code-plan-runtime`. The offline runtime and minimum card cases are implemented; detached async rejection reporting remains incomplete, as detailed under Open issues.

## Done

- **P1 item 1 — sandbox:** compared the two candidates offline and selected QuickJS WASM. The Node 24 permission-process/VM spike exposed `process` through a host-function constructor, failing the required absence of process access. QuickJS has no Node globals or module loader. Each pass runs in a disposable worker with a bounded JSON bridge; only that worker blocks while awaiting host replies. Ordinary TypeScript is stripped with `stripTypeScriptTypes`, then evaluated inside QuickJS. Date and seeded random sequences persist per run.
- **P1 item 2 — runtime/journal:** added version, run, step and choice entities with no DDL; declaration/log projections; stable normalized content keys and variants; replay, concurrent calls, pending choices, explicit version fencing and per-project single-flight passes. Answers survive question-only edits; changed options ask again. Reached results are reused, history remains available, and unreached unsent work is cancelled. `speech` reports `NOT_IMPLEMENTED` as allowed by the card.
- **P1 item 2 — durable execution:** fake-only `ExecutionProvider.submit/poll/lookup` bridge retains existing `Attempt` records without graph candidates, nodes or grants. Submission intent and the step reservation commit before dispatch. A process-local one-use permit allows only the first submit. Recovered intents use lookup, accepted jobs poll, and no failure/unknown observation triggers resubmission. The new `code_plan_execution` entity binds request/observation digests and liability. Completion persists before the existing ingestion router and fixture ingester publish verified owned artifacts. Existing output-store spool receipts are checked when supplied; fixtures use the established fixture path.
- **P1 item 3 — limits/accounting:** default project ceiling is 1,000,000 integer micros, with charged, unknown and in-flight work counted before admitting another call. Only definitive rejection releases liability. Raising the ceiling persists and wakes replay. Trusted prices refresh before an unsent step dispatches, while admitted reservations keep their original price. Unpriced steps cost zero. All versions of one run share the 200-distinct-media-step limit. Source, bridge data, host calls, declarations, logs, error text, guest CPU/heap/stack and provider waits are bounded.
- **P1 items 4–5 — integration/docs:** added optional project `planMode`; absent/graph projects remain on the graph path. Graph workers skip code-plan attempts and code-mode graph bindings. The server's existing 500 ms loop calls `tick()`. Startup, terminal results, answers, versions and ceiling increases wake replay. Installation quarantine blocks this mode, and shutdown fences/drains its work. Updated the execution-engine documentation and implementation status.

## Files

Added:

- `apps/server/src/code-plan/{index,identity,records,execution,sandbox}.ts`
- `apps/server/test/code-plan-{runtime,execution,sandbox}.test.mjs`
- `docs/ai/code-plan/reports/P1-report.md`

Changed:

- `apps/server/package.json`, `pnpm-lock.yaml`
- `apps/server/src/index.ts`, `apps/server/src/execution/engine.ts`
- `packages/core/src/contracts.ts`
- `docs/technical/EXECUTION-ENGINE.md`, `docs/implementation/STATUS.md`

Deleted: none. No web source, shipped migration or existing planning implementation was changed.

## Tests

Final verification used Node **24.15.0**, pnpm **10.33.0**, FFmpeg/ffprobe **8.1.1**:

| Command | Observed result |
| --- | --- |
| `pnpm setup:test-media` | Passed; pinned tools already installed, no download |
| `pnpm check:toolchain` | Passed; exact versions and encoders available |
| `pnpm build` | Passed; all five workspace package/app builds |
| `node scripts/run-tests.mjs apps/server/test/code-plan-sandbox.test.mjs apps/server/test/code-plan-execution.test.mjs apps/server/test/code-plan-runtime.test.mjs` | **53 passed, 0 failed/skipped/cancelled/todo**: sandbox 18, execution 13, runtime 22 |
| `pnpm test` | **4,625 passed, 0 failed/cancelled/todo, 1 skipped; 4,626 total**; 658.262 s |
| `pnpm -r typecheck` | **5/5 passed**, zero TypeScript errors |
| `git diff --check` | Passed |

The optional skip is `opt-in native Codex probe never starts a model turn`. The full run took about eleven minutes, including the existing shipped-release validation tests; no failure was reported. An isolated diagnostic rerun of `scripts/test/skills-release.test.mjs` and `scripts/test/test-toolchain.test.mjs` also passed **39/39**, zero failures/skips/cancelled/todo, in 205.991 s; it confirmed the quiet tail was slow synchronous validation rather than a hang. Build output retains the existing Vite dynamic-import/chunk-size warnings; Node emits its expected experimental warning for `stripTypeScriptTypes`.

All code-plan suites are new. Existing tests have not been rewritten, deleted or disabled. Runtime coverage includes replay/determinism, simultaneous media calls, choices and restarts, one-shot code edits, fallback, stale versions, charged/unknown reservations, trusted-price changes, ingestion recovery, unsent cancellation, step limits, graph isolation and quarantine. Execution tests cover intent-before-submit, one-use dispatch, restart lookup, ingestion-only recovery, rejection-versus-unknown liability, deadlines/shutdown, graph worker exclusion, project-owned artifact resolution and corrupt ingestion refusal. Sandbox tests cover denied host capabilities/imports, CPU and memory interruption, deterministic clock/random, synchronous declarations, pending/concurrent effects and recovery after a failed pass.

The two-shot edit fixture includes motion metadata in the render timeline: the stock fake provider deliberately returns the same video bytes for different prompts, so artifact-byte identity alone would correctly reuse that fixture's render. This proves the replay/cache behavior without claiming changed real footage.

Self-review corrected graph worker ownership, unsent price refresh, ingestion-error reporting, shutdown lifetime handling and older-Node-24 import compatibility. Sandbox memory testing exposed an upstream async out-of-memory teardown assertion in the cached QuickJS version; disposable workers prevent reuse of a damaged allocator and release the entire interpreter after each pass. Independent review found and reproduced two additional issues, both fixed with regression tests and independently rechecked: an overlapping tick consuming a choice-answer wake, and an old failed ingestion blocking a replacement plan that no longer reached that step. The review also found the detached-rejection gap below; it remains open. No additional accounting, receipt, restart, mode-isolation, shutdown or sandbox-escape defect was found in that review.

## Contract changes

`packages/core/src/studio-api.ts`: none. `ProjectRecord` in `contracts.ts` gains optional `planMode: "graph" | "code"`; existing project serialization omits it unless explicitly selected. There are no new routes or browser contracts in P1.

## Commits

No commits were created, as required by the card's hard rules. Proposed lead-owned split:

1. `feat(code-plan): isolate TypeScript plans in bounded QuickJS workers` — `apps/server/src/code-plan/sandbox.ts`, `apps/server/test/code-plan-sandbox.test.mjs`, `apps/server/package.json`, `pnpm-lock.yaml`.
2. `feat(code-plan): journal replay and recover fake execution without resubmission` — the other four code-plan modules, runtime/execution test files, `packages/core/src/contracts.ts`, `apps/server/src/execution/engine.ts`.
3. `feat(server): tick experimental code plans and document P1 verification` — `apps/server/src/index.ts`, execution-engine/status documentation and this report.

## Open issues

- **Open semantic gap — detached unhandled Promise rejections.** The cached QuickJS build has no implemented/exported native rejection tracker. Both `export default async function() { Promise.resolve().then(() => { throw new Error("detached bug"); }); }` and `export default async function() { (async () => { throw new Error("lost"); })(); }` currently return `done`. Synchronous throws and awaited failures are captured; detached host-API failures remain fatal. This leaves the design's general programming-error reporting incomplete. Independent probes reproduced both cases. Native async rejections bypass a Promise monkeypatch, so no partial workaround was presented as a fix. A robust fix requires a reviewed pinned WASM build exposing rejection/handled notifications, or a verified newer sandbox dependency. Neither a newer cached dependency nor a local WASM build toolchain is available; the card prohibits external network access. The lead should resolve this before treating code plans' general error reporting as complete.
- New sandbox dependency: **`@tootallnate/quickjs-emscripten` exactly `0.23.0`**. It was available in the local cache; its registry tarball integrity was verified and the lockfile validated offline. No dependency was fetched over the network. The observed allocator teardown defect is contained by the disposable-worker lifetime; the WASM heap cap covers guest allocations rather than total process RSS, and the worker separately caps its V8 heap. Worker startup adds replay overhead; performance optimization is unproven.
- P1 deliberately accepts only registered `fake/1` execution. Its image/video/render artifacts are labeled fixtures; `ctx.render` does not establish real FFmpeg export behavior. Real provider normalization, pricing/catalog integration and output-quality acceptance belong to later phases.
- P2 Director/workspace/typechecking/dry-run/repair, P3 routes/UI/SSE, P4 live-film validation and P5 replacement decisions remain out of scope. Mode selection is available to backend callers through the project record; no UI or route is added for it.
- No browser, external network, real model/media call, protected production-state read, port-3001 listener, commit or push was performed.

## Lead review (2026-10-29)

Accepted for merge. Checked the sandbox boundary, replay and version fencing, intent-before-submit with the one-use permit, restart reconciliation, ceiling accounting, and the `Engine.attempts()` filter against its callers (all graph-mode views). Build, typecheck and the 53 focused tests were re-run outside the sandbox.

Carried into P2:

- **Sandbox dependency.** `@tootallnate/quickjs-emscripten@0.23.0` is a fork chosen because it was in the offline cache. Move to the maintained upstream `quickjs-emscripten` and re-check the allocator teardown and the missing rejection tracker there.
- **Detached rejections.** Until a tracker exists, a plan whose only failure is an unawaited rejected promise can end `done`. P2's `submit_plan` dry run should flag fire-and-forget async calls in the source.
- **Step limit.** The 200-step limit counts every journal entry, including cancelled and budget-blocked steps, for the life of the project. Count dispatched steps only, or reset the count per plan version, before long editing sessions.
