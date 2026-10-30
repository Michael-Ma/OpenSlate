# P2b runtime port report

Date: 2026-10-29. Worktree: `codex-p2b-runtime-port`; branch: `codex/p2b-runtime-port`.

## Done

- **P2b item 1 — port:** `CodePlanRuntime` implements `CodePlanPort` directly. It projects empty/current state, charged/possibly-charged spend versus pending reservations, reached/history steps, bounded prompt/motion labels, unanswered-first choices, holds and the latest 50 versions with saved diffs. Source reads return the agreed metadata. Submission dry-runs first, rejects syntax/evaluation or runtime findings with `CODE_PLAN_REJECTED` and `details.diff`, atomically rechecks the expected version and persists a `code_plan_invocation` receipt. Lost-response, concurrent and restarted retries return the original version/diff. Answer/ceiling methods return the view; failure exposes the current version's error. Reads reject graph/unknown projects and writes also enforce installation quarantine.
- **P2b item 1 — holds:** persisted `code_plan_hold` identities stop only new positive-price admission; steps remain absent while already admitted work and zero-price calls/renders continue. Release wakes replay. Multiple holds survive restart; retries cannot reopen a released identity, including when a release arrived before its hold.
- **P2b item 2 — dry runs:** a shared replay/call path classifies unique reused/new/cancelled steps using in-memory provisional state, with no entity, attempt, choice, run, event, cursor or provider write. It prices the reached prefix, records whether execution stopped waiting, and reports all five required finding codes. The first accepted submission's preview and live replay share the same time/random seed. Bootstrap Promise-subclass tracking detects `ctx` calls lacking a then/await consumer while preserving await, then, catch and Promise.all behavior. Tracking state is private to the bootstrap and survives guest mutation of promise properties and array methods.
- **P2b item 3 — events:** mutations and changed passes append `code_plan.changed` with `{ planVersion, state }` through `store.appendEvent`. A persisted view digest suppresses identical replays, idle ticks, repeated answers/holds/releases and restart-only wakes. `lastPassAt` alone does not change the digest; unchanged absent steps preserve `updatedAt`.
- **P2b item 4 — carry-overs:** replaced the fork with exact upstream `quickjs-emscripten@0.32.0`; only dependency-install metadata/install commands used external network access. The npm publication record is **2026-02-16T04:48:55.938Z**, more than two weeks before this task. The upstream API still declares `promiseRejectionHandler` as an unimplemented `TODO<"JSHostPromiseRejectionTracker">`; the detached-rejection probes still return `done`, so no native rejection tracker is claimed. Disposable-worker interruption/OOM containment and all P1 sandbox cases pass. The 200-step project limit now counts only journal entries with admitted attempts across versions; held, budget-blocked, absent and cancelled entries consume no slot. Fake speech now has kind `speech`, normalized text/voice/model input, a `fake-speech` price of **10,000 micros**, a fixture audio artifact, and replay reuse.
- **P2b item 5 — docs:** updated the Code plans execution-engine section and added the implementation-status entry. Director wiring, routes/UI, real providers and live-media validation remain assigned to other cards.

## Files

Added:

- `apps/server/src/code-plan/view.ts`
- `apps/server/test/code-plan-port.test.mjs`
- `docs/ai/code-plan/reports/P2b-report.md`

Changed:

- `apps/server/src/code-plan/{index,records,identity,execution,sandbox}.ts`
- `apps/server/test/code-plan-{runtime,sandbox}.test.mjs`
- `apps/server/package.json`, `pnpm-lock.yaml` — dependency swap only
- `docs/technical/EXECUTION-ENGINE.md`, `docs/implementation/STATUS.md`

Deleted: none. Lead-owned `port.ts` and `packages/core/src/studio-api.ts`, app/server entry points, Director and web source remain unchanged.

## Tests

Added **27 tests**: 25 port cases and two sandbox cases. Rewrote **one** P1 runtime test because `ctx.speech` now succeeds instead of returning `NOT_IMPLEMENTED`. No test was deleted, skipped or disabled by this change. Existing execution and sandbox integrity cases remain intact.

The port suite covers empty/source/version projection, stale-version refusal, concurrent submission fencing, durable invocation replay, full store snapshots around previews, new/reused/cancelled classification, syntax/evaluation/runtime rejection, unawaited-call findings and consumed promises, ceiling and liability accounting, paid holds/free progress/restart/release, exact event counts/cursors, bounded history/labels, choice ordering, current-version failure, 205 held/cancelled entries followed by 200 dispatched entries and refusal of the 201st, graph/unknown refusal, quarantine, clock/seed agreement, quiet blocked replay/restart, and a hold opened during an active pass.

Verification uses Node **24.15.0**, pnpm **10.33.0**, FFmpeg/ffprobe **8.1.1**:

| Command | Observed result |
| --- | --- |
| `pnpm setup:test-media` | Passed; pinned system media tools already matched, no download |
| `pnpm check:toolchain` | Passed; exact versions and encoders available |
| `pnpm build` | Passed; five workspace builds |
| `node scripts/run-tests.mjs apps/server/test/code-plan-sandbox.test.mjs apps/server/test/code-plan-execution.test.mjs apps/server/test/code-plan-runtime.test.mjs apps/server/test/code-plan-port.test.mjs` | **80 passed, 0 failed/skipped/cancelled/todo**; 25.488 s |
| `pnpm test` | **4,650 passed, 0 failed/cancelled/todo, 1 skipped; 4,651 total**; 1,656.339 s |
| `pnpm -r typecheck` | **5/5 workspace typechecks passed**, zero TypeScript errors |
| `git diff --check` | Passed after the final documentation update |

Initial implementation checks caught three strict-TypeScript errors (two optional finding details and the public contract's exclusion of `data` artifacts), all corrected before the passing build. The initial P1 run had the expected obsolete speech assertion failure, resolved by the single test rewrite. No unrelated failure was observed. Build output retains the existing Vite chunk/dynamic-import warnings, and Node emits the expected TypeScript-stripping experimental warning. The optional skip is `opt-in native Codex probe never starts a model turn`. The full run had a long quiet tail in the existing release-validation suite; its final checks passed. A read-only `ps` diagnostic was denied by the sandbox; the test session continued and exited successfully without intervention.

Self-review checked the full diff, contracts/callers, shared preview/execution behavior, price liabilities, hold/submit races, event persistence, replay/restart and sandbox data boundaries. It corrected first-submission clock/seed disagreement, timestamp-only events for unchanged absent work, step-limit checks before hold/budget admission, and guest-mutable warning-tracking state. Regression cases cover those corrections. No subagent review was requested or run.

## Contract changes

None. Both lead-owned contracts remain byte-for-byte unchanged. Runtime's existing `raiseCeiling` now returns the contract view; existing callers that ignore its return remain compatible. P1 version rows without a diff project an empty diff; port submissions persist their actual diff.

## Commits

No commits created, per the hard rules. Proposed lead-owned split:

1. `fix(code-plan): use upstream QuickJS and track unawaited ctx calls` — `apps/server/package.json`, `pnpm-lock.yaml`, `apps/server/src/code-plan/sandbox.ts`, `apps/server/test/code-plan-sandbox.test.mjs`.
2. `feat(code-plan): implement durable port previews holds and events` — `apps/server/src/code-plan/{index,records,view,identity,execution}.ts`, `apps/server/test/code-plan-{port,runtime}.test.mjs`.
3. `docs(code-plan): record P2b runtime behavior and verification` — `docs/technical/EXECUTION-ENGINE.md`, `docs/implementation/STATUS.md`, `docs/ai/code-plan/reports/P2b-report.md`.

## Open issues

- **Upstream detached rejection limitation:** unrelated discarded async rejections can still produce `done`. `UNAWAITED_CALL` diagnoses unconsumed asynchronous `ctx` promises; it is a warning, not a substitute for native rejection tracking. The new sandbox probe records both actual detached-rejection cases. This is the card's permitted fallback when upstream exposes no tracker.
- **Preview reachability interpretation for lead review:** one dry run reports only calls actually reached before pending results/choices block their continuation. The one-shot motion-edit test reaches exactly one new video and one new render because its assembly descriptor is independent and concurrent. A render sequentially awaiting the new clip cannot be priced/classified until a later replay; the additional pending-result test explicitly verifies this boundary. No hypothetical output is supplied to let a preview run beyond an unresolved result.
- **Fake-only scope:** speech pricing/artifacts and rendering are fixtures. No real-provider behavior, media quality, native model turn, route integration or browser acceptance is established here.
- A release before a hold permanently closes that hold identity. Further Director work must use a fresh holdId. This preserves idempotency under delayed retries; the lead should retain that identity discipline when wiring P2a/P3a.
- No protected state or personal configuration was read; no browser, real provider/model call, port-3001 listener, commit or push occurred. External network access was limited to the authorized upstream dependency metadata/install.
