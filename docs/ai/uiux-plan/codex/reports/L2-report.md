# L2 — explicit provider/execution records and callers

## Done

- **L2.1:** Execution requests (including `Attempt.request`) require an adapter/version identity. The registry and output store no longer infer fake/v1. Current demo execution uses `isDemoExecution` and `DEMO_EXECUTION_IDENTITY`; demo requests still need no configured profile snapshot.
- **L2.2:** Present capability locks must pin `RECIPE_DIGEST`. Video admission and first dispatch require a current narration decision and measured/planned timing. The separate no-lock `options.profiles` executor harness remains available; saved locks without `localExecution` still follow the existing upgrade boundary.
- **L2.3:** Every media runtime route boolean and host array is required and returned explicitly. Disabled fal returns `false` and `[]`. Runtime construction rejects partial configurations before local side effects. Codex binary/home paths remain optional.
- **L2.4:** Failed/rejected outcomes require explicit `retryAllowed`; malformed outcomes stay unknown and retain liability. Lip-sync passes the explicit boolean through. Engine retry/read models remain unchanged.
- **L2.5:** Removed Viggle pre-crop preparation/replay selection and the equivalent backup bypass. Current crop/no-crop recipes are reproduced exactly; invalid uncropped preparations are refused with no POST. Current exact-aspect and 1:1 inputs remain supported.

No allowance/budget logic, narration placement, planning compiler, Director catalog/guidance/release, scene confirmation/review, web source or browser contract changed. Allowance-related test edits only supply supported recipe locks.

## Files

Changed 55 existing files; added this report; deleted no files.

### Source

- `apps/server/src/application/media-execution-config.ts`
- `apps/server/src/application/media-execution-runtime.ts`
- `apps/server/src/application/provider-catalog.ts`
- `apps/server/src/execution/current-generated-selection.ts`
- `apps/server/src/execution/durable-external-admission.ts`
- `apps/server/src/execution/engine.ts`
- `apps/server/src/execution/lip-sync.ts`
- `apps/server/src/execution/output-store.ts`
- `apps/server/src/execution/viggle-h3-authority.ts`
- `apps/server/src/execution/viggle-h3-execution.ts`
- `apps/server/src/execution/viggle-h3-lineage.ts`
- `apps/server/src/execution/viggle-h3-receipts.ts`
- `apps/server/src/persistence/viggle-backup.ts`
- `packages/core/src/provider-profile.ts`
- `packages/providers/src/execution.ts`

### Tests and fixtures

- `apps/server/test/artifact-fixture.test.mjs`
- `apps/server/test/audio-execution-runtime.test.mjs`
- `apps/server/test/codex-image-execution-fixture.mjs`
- `apps/server/test/codex-image-runtime.test.mjs`
- `apps/server/test/codex-spending-display.test.mjs`
- `apps/server/test/director-media-protection.test.mjs`
- `apps/server/test/director-proposals.test.mjs`
- `apps/server/test/execution-fixture.mjs`
- `apps/server/test/execution-provider.test.mjs`
- `apps/server/test/execution-routing.test.mjs`
- `apps/server/test/execution.test.mjs`
- `apps/server/test/external-allowances.test.mjs`
- `apps/server/test/fal-lipsync-execution.test.mjs`
- `apps/server/test/ingestion-router.test.mjs`
- `apps/server/test/installation-audio-backup.test.mjs`
- `apps/server/test/installation-backup.test.mjs`
- `apps/server/test/lip-sync-seam.test.mjs`
- `apps/server/test/local-execution.test.mjs`
- `apps/server/test/media-execution-config.test.mjs`
- `apps/server/test/media-execution-runtime.test.mjs`
- `apps/server/test/media-production-pipeline.test.mjs`
- `apps/server/test/openai-speech-execution.test.mjs`
- `apps/server/test/speech-audio-lineage.test.mjs`
- `apps/server/test/speech-execution-fixture.mjs`
- `apps/server/test/speech-execution-records.test.mjs`
- `apps/server/test/storyboard-cross-scene.test.mjs`
- `apps/server/test/storyboard-delete-attempts.test.mjs`
- `apps/server/test/storyboard.test.mjs`
- `apps/server/test/transcription-audio-fixture.mjs`
- `apps/server/test/transcription-execution-records.test.mjs`
- `apps/server/test/transcription-preparation-storage.test.mjs`
- `apps/server/test/viggle-h3-execution-fixture.mjs`
- `apps/server/test/viggle-h3-execution.test.mjs`
- `apps/server/test/viggle-h3-frame-crop.test.mjs`
- `packages/providers/test/execution-registry.test.mjs`
- `packages/providers/test/execution.test.mjs`
- `packages/providers/test/fake.test.mjs`

### Current documentation

- `docs/implementation/STATUS.md`
- `docs/technical/EXECUTION-ENGINE.md`
- `docs/technical/PROVIDERS-ARTIFACTS.md`

### Added

- `docs/ai/uiux-plan/codex/reports/L2-report.md`

## Tests

Baseline supplied by the lead after L1: **4,571 total / 4,570 pass / 0 fail / 1 optional skip**.

Added seven behavior cases and removed one obsolete historical-outcome case (net +6):

- Required request identity, with current demo/profile-free support.
- Explicit retry authority for failed/rejected outcomes (replaces the deleted historical-outcome case).
- Missing workflow recipe lock rejected before attempt/reservation insertion.
- Unsupported workflow recipe lock rejected before attempt/reservation insertion.
- Every runtime route/host field required before construction effects.
- Current Viggle lock/narration checks reject invalid first dispatch.
- Uncropped saved mapping cannot bypass the current crop recipe, including backup validation.

Rewrote two evidence/retry replay tests using current immutable records instead of SQL removal of identity/retry fields. Rewrote pre-crop replay and backup/restore cases using legitimate exact-aspect no-crop inputs; retained cropped variants. Removed obsolete absent-identity/absent-retry positive subcases and the speech-lineage absent-identity subcase. Exact configuration assertions and direct-store/partial request fixtures now supply current fields. Narrated fixtures explicitly choose generated/uploaded narration so silent defaults do not mask timing or deletion assertions. No test was skipped or disabled by this change.

### Verification

- `pnpm setup:test-media`: passed without download.
- `pnpm check:toolchain`: passed, Node 24.15.0 / pnpm 10.33.0 / FFmpeg and ffprobe 8.1.1.
- `pnpm build`: passed.
- Initial targeted run: 796 total / 776 pass / 20 fail / 0 skip; failures exposed incomplete test requests, missing/conflicting narration decisions and an overly strict lock-presence check in the no-lock executor harness. Corrected fixtures and preserved the existing no-lock harness, without weakening assertions.
- Final targeted `node scripts/run-tests.mjs <62 files>`: **855 total / 855 pass / 0 fail / 0 skip**.
- Full `pnpm test` (build plus `node scripts/run-tests.mjs`): **4,577 total / 4,576 pass / 0 fail / 1 optional native-probe skip**, zero cancelled/todo. Net +6 cases versus L1; 773,829.870417 ms.
- `pnpm -r typecheck`: **all five workspace typechecks passed**, zero errors (core, providers, director, server and web).
- `git diff --check`: passed.

Targeted scope includes all provider tests and the card execution/engine/storyboard/local/Viggle/Codex/media/audio/fal/lip-sync/proposal/retry families, every changed test file, and related speech/transcription/backup suites. Temporary check logs are under `/tmp/openslate-l2-*.log`.

## Review

Self-review corrected the equivalent Viggle backup bypass, preserved the no-lock executor harness and corrected narrated fixture setups that would otherwise exercise a silent-cue conflict instead of the intended timing boundary. Final independent read-only review found no actionable correctness or scope issue. Recovery remains separate from first-dispatch eligibility; submission intent, uncertain-submission reconciliation, reservations, candidate/attempt separation, exact receipt/spool evidence and lease/epoch checks remain intact.

## Contract changes

`packages/core/src/studio-api.ts`: none. Internal provider API requires `ExecutionRequest.execution` and failed/rejected `retryAllowed`, and renames `isLegacyExecution` to `isDemoExecution` without an alias. Internal `MediaExecutionConfiguration` requires every non-path field.

## Commits

No commits made under the card rules. Proposed single task commit:

`refactor(execution): remove legacy provider and runtime fallbacks`

File list: every changed/added file in the Files section above. The lead reviews and commits this worktree.

## Open issues

None in L2. Old incomplete requests/locks/configurations and pre-crop preparations are intentionally unsupported; no migration, alias or old-shape shim was added. L3 allowance/budget removal and L4 narration placement remain separate cards. No live provider/model call, browser launch, external network call, personal credential/configuration read, production-state access or port-3001 listener was used. No new real-provider acceptance is claimed.
