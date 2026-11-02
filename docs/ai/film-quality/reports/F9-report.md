# F9 — CLI launch port and graceful code-plan shutdown

November 2, 2026. Worktree `codex/f9-cli-shutdown`. No commits or pushes.

## Done

- **F9.1 / V3 problem 6:** the standalone CLI computes its selected port once and passes it to both `requestStudioLaunch` and `studioUrl`: 3001 by default, 5173 with `--dev`. Both use the same fixed loopback origin and reject every other port. Requests still reject redirects, validate the local credential and launch code, and use the existing five-second timeout. There is no fallback destination.
- **F9.2 / V3 problem 4:** a stopping runtime leaves the saved run unchanged after evaluation, before cancelling unreached steps or settling choices. It also skips partial progress publication after shutdown and stops tick continuation after awaited execution/replay. Startup queues the saved run for replay through the existing durable journal. Real errors retain their existing persistence behavior; no error-message matching is used.

## Files

Changed:

- `apps/server/src/studio-launcher.ts`
- `apps/server/src/studio-cli.ts`
- `apps/server/src/code-plan/index.ts`
- `apps/server/test/studio-launcher.test.mjs`
- `apps/server/test/code-plan-runtime.test.mjs`

Added: this report. Deleted: none. No files owned by the other cards were edited.

## Tests

Added six tests: unsupported request ports; shutdown during a completed film's replay; shutdown during a partial pass with existing choices and unsent steps; shutdown immediately after media admission; shutdown while tick awaits execution; and a genuine plan error whose text equals the shutdown message.

Rewrote the old standalone-launcher test because it explicitly expected the broken 3001 request even with `--dev`. The replacement checks the requested URL, POST, credential and returned link against a recording loopback server. It also checks a 503 response and a redirect toward 3001 fail without fallback or another request. Before transport, a child preload refuses any unexpected destination and maps the expected URL to an ephemeral test listener; the test never binds or contacts port 3001. Browser opening remains mocked in the pre-existing launcher tests.

Strengthened the existing capped-programming-error test to assert the error is actually persisted. No tests were deleted. Shutdown regressions use deterministic lifecycle hooks, temporary stores and the fake provider; restart assertions verify no duplicate submissions and preserve the successful fake export, answered choices and unsent-step history.

Before the production fix, the touched files recorded **26 passed / 6 failed**, at the expected regression assertions. After the fix, the touched files recorded **32 passed / 0 failed**. An intermediate launcher fixture assertion was corrected because Node fetch uses the transport URL's Host header; the recording fixture now carries the asserted original destination in an explicit test header.

Final verification:

| Command | Actual result |
| --- | --- |
| `pnpm setup:test-media` | Exit 0; existing FFmpeg/ffprobe 8.1.1 matched, no download or installation needed. |
| `pnpm check:toolchain` | Exit 0; Node 24.15.0, pnpm 10.33.0, FFmpeg/ffprobe 8.1.1 and caption font matched. |
| `pnpm build` | Exit 0; all five workspace packages built. Existing Vite mixed-import and large-chunk warnings only. |
| `node scripts/run-tests.mjs apps/server/test/studio-launcher.test.mjs apps/server/test/code-plan-runtime.test.mjs` | Exit 0; **32 passed, 0 failed, 0 skipped**. |
| `node scripts/run-tests.mjs apps/server/test/studio-launcher.test.mjs apps/server/test/studio-sessions.test.mjs apps/server/test/code-plan-*.test.mjs` | Exit 0; **427 passed, 0 failed, 0 skipped**. |
| `node scripts/run-tests.mjs apps/server/test/studio-launcher.test.mjs` after self-review tightened the fixture | Exit 0; **5 passed, 0 failed, 0 skipped**. |
| `pnpm test` | Exit 0; **5,276 passed, 0 failed, 1 skipped**, 5,277 total; 1,214.465 seconds. The skip is the opt-in native Codex probe. |
| `pnpm -r typecheck` | Exit 0; **all five workspace packages passed, 0 failures**. |
| `pnpm typecheck` | Exit 0; package build and **all five workspace typechecks passed, 0 failures**. |
| `git diff --check` | Exit 0. |

No timing-sensitive test failed in the verification runs, so no failure-triggered rerun was needed. The full run was allowed to finish without interrupting another engineer's processes. Local logs are `/tmp/openslate-f9-build.log`, `/tmp/openslate-f9-touched.log`, `/tmp/openslate-f9-suites.log`, `/tmp/openslate-f9-launcher-final.log`, `/tmp/openslate-f9-full-test.log`, `/tmp/openslate-f9-recursive-typecheck.log` and `/tmp/openslate-f9-typecheck.log`.

## Self-review

Reviewed the complete diff, launcher callers and server shutdown ordering. The review covered post-await writes, obsolete-plan fencing, choice retirement, unsent cancellation and durable admission/reconciliation. In addition to the final pass write, partial progress publication and tick continuation need shutdown guards; both are guarded and tested. Tightened the launcher fixture to log every attempted URL before rejecting unexpected destinations, so a caught fallback attempt cannot hide in the failure cases. The default request signature remains compatible with existing callers. No further important correctness issues found.

## Contract changes

None. No browser API, tool contract, schema or provider behavior changes.

## Proposed commits

- `fix(server): send studio launch requests to the selected port` — `apps/server/src/studio-launcher.ts`, `apps/server/src/studio-cli.ts`, `apps/server/test/studio-launcher.test.mjs`.
- `fix(server): preserve code-plan state during shutdown` — `apps/server/src/code-plan/index.ts`, `apps/server/test/code-plan-runtime.test.mjs`, `docs/ai/film-quality/reports/F9-report.md`.

These are proposals only; no git commit was run.

## Open issues and limits

No implementation blocker. Verification is offline with fake media; no live provider or browser validation was run. The completed-export regression validates the persisted fake export and submission identities, not rendered-media quality. No existing installation data was inspected or changed.
