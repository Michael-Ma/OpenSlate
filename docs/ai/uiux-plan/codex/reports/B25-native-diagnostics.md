# B25 native diagnostics

**Done**

- B25.1 — Native preparation retains `native_timeout`, `native_spawn_failed`, `native_auth_required`, `native_protocol`, `native_rate_limited` or `native_unknown`, plus the actual expired limit when available. Classification reads structured codes/statuses, including nested JSON-RPC error identifiers, and never native error prose. Setup checks persist the diagnostic in `director_local_check`; image failures persist it in the exact attempt's immutable `codex_image_execution_result`. Existing receipts without diagnostics remain readable. Fixed-field server warnings contain the operation, project/attempt identifiers and sanitized diagnostic only.
- B25.1 — `DIRECTOR_SETUP_REQUIRED` HTTP errors, Settings reads and generation overview return allowlisted diagnostic fields. Image projections validate the exact receipt lineage before asserting `notDispatched`. English/Chinese messages live exclusively in `apps/web/src/next/i18n/catalog/errors.ts`; first-film setup, Settings, Inspector and keyframe card tooltips explain the cause and timeout seconds. Failed replacements preserve the current image. “Nothing was charged” requires both proven pre-dispatch failure and a released reservation. Native messages, stderr, auth paths and tokens never enter these projections or diagnostic logs.
- B25.2 — Each cold native app-server process receives a shared 60,000 ms startup deadline across initialize, configuration/catalog, account/model/capability and empty-thread preparation. The version probe also uses the startup limit. The trusted host setting `OPENSLATE_CODEX_STARTUP_TIMEOUT_MS` accepts decimal integers from 15,000 through 120,000; blank/unset selects 60,000. It reaches both Director setup/runtime and Codex image bootstrap/worker construction. Ordinary requests retain 15,000 ms after preparation, including paid `turn/start`. The overall Director run deadline remains independently configured and retains its actual hit limit.
- B25.2 — Complete read-only setup allows three startup budgets: one version probe and two separate app-server discovery processes. Default overall setup ceiling is therefore 180,000 ms, maximum 360,000 ms, while each process shares only one startup budget across its preparation RPCs. Cancellation and owned-process cleanup remain. No automatic retry, API fallback or new media dispatch was added; a person can use the existing generation action again after a proven failure before dispatch. Unknown post-dispatch outcomes retain reconciliation and no blind resubmission.
- B25.3 — Retained LIVE-4 evidence was inspected read-only. Its timing supports the former 15-second timeout hypothesis but cannot prove the original category, failing RPC or machine-load causation; see the evidence below.
- B25.4 — Added 55 behavioral tests across runtime, server and web. Controlled Node child fixtures and mocked time prove startup beyond 15 seconds succeeds within the new limit, a shared startup deadline expires with its actual limit, and ordinary requests still expire at 15 seconds. Category, persistence, restart, redaction, legacy-receipt, no-dispatch, no-retry, replacement and bilingual presentation cases are covered.

Retained evidence, all timestamps on 2026-10-17 UTC:

| Attempt | Created | Failure evidence recorded | Elapsed |
| --- | --- | --- | --- |
| `7a01e19c-826c-4314-8b46-516b8f26ae44` | 00:20:43.003Z | 00:20:59.083Z | 16.080 s |
| `08b52306-30c5-46f0-a22d-896b42d3d481` | 00:20:59.531Z | 00:21:15.570Z | 16.039 s |
| `9cfc4af4-b497-4477-bc2c-58615f4fad15` | 00:22:03.167Z | 00:22:19.218Z | 16.051 s |
| `ad2945b1-76f5-46b5-9842-e263201fca43` | 00:22:19.228Z | 00:22:35.271Z | 16.043 s |

Source: `$HOME/openslate-live-test-20261016d/openslate.sqlite`, opened read-only; `entities` kinds `attempt` (`createdAt`) and `execution_evidence` (`recordedAt`). All four `codex_image_execution_result.observation` values contain only `{kind: "not_dispatched", code: "LOCAL_NATIVE_UNAVAILABLE"}`. There are no native dispatch records, task identifiers or outputs for these attempts. These elapsed values include setup/cleanup/engine work; they do not identify a particular RPC timeout.

`docs/ai/live-test-20261016d/server-excerpts.json` records the failed main-film setup response at 00:17:48.805Z with `responseMs: 15459.855` (inferred HTTP start 00:17:33.345145Z). `setup-refused.json` records its blocked check at 00:17:33.347Z without a diagnostic. A later successful setup response ends at 00:19:05.935Z after 734.806 ms. Subsequent checks overwrote the retained setup row; its current ready timestamp is 00:19:43.480Z. No retained native stderr was identified. Available native-log metadata does not establish coverage of the failed setup; image native logs have zero visible records. Immutable SQLite reads omit WAL, so they are not complete-log evidence. No original failure category can be recovered from this data.

**Files**

Changed:

- `packages/core/src/studio-api.ts`
- `packages/director/src/runtime/codex.ts`
- `packages/director/src/runtime/index.ts`
- `packages/director/src/runtime/policy.ts`
- `packages/director/src/runtime/setup.ts`
- `packages/director/src/runtime/transport.ts`
- `packages/director/src/runtime/types.ts`
- `packages/director/src/runtime/validation.ts`
- `packages/director/src/media/codex-image.ts`
- `packages/director/src/media/image-rpc.ts`
- `packages/director/test/codex-image.test.mjs`
- `packages/director/test/fixture-timing.mjs`
- `packages/director/test/runtime-setup.test.mjs`
- `packages/director/test/runtime.test.mjs`
- `apps/server/src/app.ts`
- `apps/server/src/index.ts`
- `apps/server/src/application/director-run-config.ts`
- `apps/server/src/application/local-director.ts`
- `apps/server/src/application/media-execution-runtime.ts`
- `apps/server/src/execution/codex-image-execution.ts`
- `apps/server/src/execution/codex-image-receipts.ts`
- `apps/server/src/generation-overview.ts`
- `apps/server/test/codex-image-execution.test.mjs`
- `apps/server/test/codex-image-runtime.test.mjs`
- `apps/server/test/director-run-config.test.mjs`
- `apps/server/test/local-director.test.mjs`
- `apps/web/src/next/i18n/catalog/errors.ts`
- `apps/web/src/next/i18n/translate.ts`
- `apps/web/src/next/model/inspector.ts`
- `apps/web/src/next/model/keyframes.ts`
- `apps/web/src/next/model/settings-computer.ts`
- `apps/web/src/next/model/settings-director.ts`
- `apps/web/src/next/model/start-commands.ts`

Added:

- `packages/director/src/runtime/native-diagnostic.ts`
- `packages/director/test/native-startup-fixture.mjs`
- `packages/director/test/native-startup.test.mjs`
- `apps/server/src/application/native-diagnostics.ts`
- `apps/web/test/next/native-diagnostics.test.mjs`
- `docs/ai/uiux-plan/codex/reports/B25-native-diagnostics.md`

Deleted: none. No markup/CSS, frozen skill/catalog package, database migration or `docs/implementation/STATUS.md` changes. Existing untracked LIVE-4 evidence/card files are preserved.

**Tests**

Added: 27 Director tests (25 startup/diagnostic tests and two host-limit tests), 16 server tests and 12 web tests. Existing setup/image readiness assertions now also verify safe categories and propagated limits; the fake protocol fixture explicitly selects a 5-second startup limit so its intentional hang remains bounded. No obsolete behavior tests were removed, no tests disabled, and no integrity/money assertion was weakened. A new corruption test uses direct SQL only in a disposable test store to verify immutable receipt validation.

Pinned Node 24.15.0, pnpm 10.33.0 and FFmpeg/ffprobe 8.1.1 passed `pnpm setup:test-media` and `pnpm check:toolchain` without downloading anything.

Final checks (run in the required order):

- `pnpm build`: passed all five package/app builds; existing large-bundle advisory only.
- Touched test files plus the generation-overview regression file: 238 passed, 0 failed/cancelled/skipped/todo. Command: `node scripts/run-tests.mjs packages/director/test/native-startup.test.mjs packages/director/test/runtime.test.mjs packages/director/test/runtime-setup.test.mjs packages/director/test/codex-image.test.mjs apps/server/test/director-run-config.test.mjs apps/server/test/local-director.test.mjs apps/server/test/codex-image-execution.test.mjs apps/server/test/codex-image-runtime.test.mjs apps/server/test/generation-overview.test.mjs apps/web/test/next/native-diagnostics.test.mjs`.
- `node scripts/run-tests.mjs apps/web/test/*.test.mjs apps/web/test/next/*.test.mjs`: 827 passed, 0 failed/cancelled/skipped/todo.
- `pnpm test`: 3,377 passed, 1 failed, 1 skipped, 0 cancelled/todo (3,379 total). The sole failure is the unchanged intermittent asset-library ordering assertion detailed under Open issues. The skip is `opt-in native Codex probe never starts a model turn`. The command's test phase failed; its preceding build passed.
- `pnpm -r typecheck`: all five package/app checks passed, 0 failed (`core`, `providers`, `director`, `server`, `web`).

Build/test logs are outside the worktree under `/private/tmp/openslate-b25-*.log`. An additional disposable missing-binary check confirmed that setup retains `native_spawn_failed` through its OS-error wrapper without exposing the path. The initial focused server run exposed missing HTTP error-detail projection and a new test trying to mutate an immutable receipt through `store.put`; the projection was added and the corruption fixture now uses explicit disposable-store SQL. Final focused checks passed. Independent review found and verified fixes for nested JSON-RPC cause masking and missing overall-run timeout limit evidence; no outstanding B25 blocker was found.

**Contract changes**

`packages/core/src/studio-api.ts` adds `NativeDiagnostic` (six allowlisted categories, optional numeric `limitMs`) and optional `MediaFailure.nativeDiagnostic` / `MediaFailure.notDispatched`. They apply equally to initial and replacement failures. There is no required-field, endpoint or schema migration change. Setup responses additionally return optional safe diagnostics on readiness/settings/error details; the existing web setup type was extended accordingly. Director runtime options add bounded `startupTimeoutMs`; setup/image readiness and runtime failure results may carry the safe diagnostic.

**Commits**

No commits made; the lead owns review and committing. Proposed split:

1. `fix(director): bound cold native startup and preserve safe diagnostics`
   Files: `packages/core/src/studio-api.ts`; all listed Director source/test/helper files; `apps/server/src/app.ts`, `apps/server/src/index.ts`, `apps/server/src/application/director-run-config.ts`, `apps/server/src/application/local-director.ts`, `apps/server/src/application/media-execution-runtime.ts`, `apps/server/src/application/native-diagnostics.ts`, `apps/server/test/director-run-config.test.mjs`, `apps/server/test/local-director.test.mjs`.
2. `fix(server): retain native image preparation diagnostics`
   Files: `apps/server/src/execution/codex-image-execution.ts`, `apps/server/src/execution/codex-image-receipts.ts`, `apps/server/src/generation-overview.ts`, `apps/server/test/codex-image-execution.test.mjs`, `apps/server/test/codex-image-runtime.test.mjs`.
3. `fix(web): explain native setup and image start failures`
   Files: all listed web files; `docs/ai/uiux-plan/codex/reports/B25-native-diagnostics.md`.

**Open issues**

- Original LIVE-4 causes remain unproven because the old implementation discarded them. Timing supports a timeout; it does not prove timeout or computer-load causation.
- The full test run hit the unchanged intermittent test `one film lists keyframe takes, clip, voice, music, upload and export with scoped identity and stable paging filters`, at `apps/server/test/asset-library.test.mjs:45:49`: actual clip shot `shot-0`, expected `shot-1`. It approves `review.members[0]` but derives the expected shot from the first published image, whose order can vary during concurrent reconciliation. This uses FakeProvider and does not exercise native diagnostics. An independent run passed 2/2; seven subsequent isolated runs produced six 2/2 passes and then the same 1-pass/1-fail result. Its source is unchanged; the lead should fix the ordering assumption separately.
- The lead must run rendered browser checks outside this sandbox. No browser was launched here. These offline tests do not establish live Codex/provider acceptance under load.
- The complete setup ceiling is deliberately three per-process startup budgets; the lead should confirm that host-setting name/bounds and this setup ceiling suit operations.
- No real Codex/model/provider call, credential/auth/token-file read, external network request, retained-data modification, production-state restart or port-3001 listener occurred. No commit, stash, checkout, reset or push occurred. Process exception: one initial read-only `git status --short` ran before RULES were loaded; no subsequent Git commands ran.
