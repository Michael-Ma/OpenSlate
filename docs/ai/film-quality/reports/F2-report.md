# F2 report: progress before submission results

## Implemented

`CodePlanRuntime.evaluate()` now persists the sandbox's declarations, logs, reached step keys and review keys immediately after sandbox evaluation, before awaiting its media submissions. The snapshot keeps the run `running`, clears the previous run error, retains `lastPassAt` until finalization, and publishes `code_plan.changed` through the existing view-digest mechanism. The existing view therefore exposes scenes, shots, making steps, input references and reviews while a submission is still open.

Both the interim write and the existing final write check the current plan version. A replacement plan prevents subsequent old-pass run writes and events; its previously admitted submission stays in history. Dry runs never take the progress-write path.

## Design decision and preserved behavior

Keep the existing `Promise.allSettled(submissions)` and pass lifecycle. Publishing a snapshot at the existing sandbox/submission boundary fixes visibility without changing single-flight replay, submission admission, retry behavior, failure handling, accounting or shutdown ownership. Detaching submissions would unnecessarily change those lifecycles.

Only passes with new submissions need an interim write. A pass without submissions immediately takes the existing final-write path, preserving silent identical replays and avoiding a transient `running` state on every completed, waiting or budget-blocked replay. Choice liveness settlement (K2), unsent-step cancellation, final run-state selection and `lastPassAt` remain at finalization after submission settlement.

`view.ts` needs no changes: its existing projection reads the newly persisted fields. There are no public-contract, schema or provider changes.

## Files

- Changed: `apps/server/src/code-plan/index.ts`.
- Added: `apps/server/test/code-plan-progress.test.mjs`.
- Added: `docs/ai/film-quality/reports/F2-report.md`.
- Deleted: none.

## Test coverage

Six tests added; no existing tests rewritten or deleted:

1. Hold the first image submission open and read the HTTP view: scenes, shots, logs, a reached `in_flight` step, reserved cost and a `running` change event already exist. Releasing it preserves the usual waiting-to-done sequence, one submission, final logs and accounting. An identical final replay emits no extra events.
2. Replace the plan before its sandbox progress publication: the obsolete pass cannot write progress or final run state, nor emit a change event.
3. Replace the plan after its progress publication but before submission returns: the obsolete pass cannot overwrite or emit changes for the new version.
4. Reach a review and an image using an owned reference in parallel: reviews and references appear before submission completion, while existing choices remain untouched until final settlement.
5. Dry-run different declarations, media and a choice during a held submission: entities, events and dispatch calls remain identical.
6. Reject a held submission: the final run still becomes an error, retains the evaluated declarations/logs and leaves choice liveness untouched.

Tests use explicit promise gates and persisted-write observations, with no elapsed-time sleeps. All state, provider transport and media used for verification are disposable offline fixtures.

## Verification

Pinned toolchain: Node 24.15.0, pnpm 10.33.0, FFmpeg/ffprobe 8.1.1 with the required encoders. `pnpm setup:test-media` found matching installed tools without downloading anything; `pnpm check:toolchain` exited 0.

| Command | Result |
| --- | --- |
| `pnpm build` | Exit 0. Existing Vite dynamic-import/chunk-size warnings only. |
| `node scripts/run-tests.mjs apps/server/test/code-plan-progress.test.mjs` | Exit 0: 6 passed, 0 failed, 0 skipped. |
| `node scripts/run-tests.mjs apps/server/test/code-plan-*.test.mjs` | Exit 0: 409 passed, 0 failed, 0 skipped. |
| `pnpm test` | Exit 0: 5,230 tests; 5,228 passed, 0 failed, 2 skipped, 0 cancelled. Duration 2,159,891 ms (about 36 minutes). |
| `pnpm typecheck` | Exit 0: all 5 workspace projects typechecked; no diagnostics. Includes the required package build. |
| `pnpm -r typecheck` | Exit 0: all 5 workspace projects typechecked; no diagnostics. |
| `pnpm demo:code` | Exit 0: final `done`; versions 1 → 2 → 3 → 4, 2 answered choices, 4 reused edit steps, 1 lookup recovery, 0 duplicate submissions; fixture spend $0.40 / $4.00. |
| `node scripts/run-tests.mjs scripts/test/setup-readiness.test.mjs scripts/test/skills-release.test.mjs scripts/test/test-toolchain.test.mjs` | Exit 0: 50 passed, 0 failed, 0 skipped. Diagnostic recheck of the full run's quiet script phase. |

The full suite had a long quiet interval during the existing synchronous skill-release tests, then completed successfully. The independent 50-test script recheck also passed. No failing or timing-sensitive test needed a failure retry. The demo explicitly uses placeholder media, fixture prices and fixture rendering; it does not export a real film.

## Self-review

Reviewed the complete owned diff for stale-version races, dry-run side effects, choice settlement, final error/accounting behavior, event deduplication, view callers and test cleanup. Kept intermediate writes conditional on submissions so unchanged replays retain their existing event behavior. Strengthened the first regression to read the HTTP route while the pass is held. No remaining correctness issue identified.

## Contract changes

None. `packages/core/src/studio-api.ts` is unchanged.

## Proposed commit

No commits created, as requested. Suggested lead commit:

`fix(code-plan): publish progress before submission results`

- `apps/server/src/code-plan/index.ts`
- `apps/server/test/code-plan-progress.test.mjs`
- `docs/ai/film-quality/reports/F2-report.md`

## Open issues and limitations

The browser and live providers were not run under the card's hard rules. Verification covers persisted runtime progress and the HTTP projection, not rendered browser acceptance or native-provider timing. Declarations following a still-pending awaited media call are unavailable until the plan actually reaches them on a later pass, as before.
