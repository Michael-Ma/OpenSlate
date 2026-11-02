# L3 — remove historical external allowances and engine budget accounting

Date: October 29, 2026. Worktree: `claude/drop-legacy-lf`. No commits or pushes.

## Done

L3 is implemented across configured admission, execution, persistence, recovery, tests and current documentation:

- Removed historical allowance issue/revoke/consumption records, services, validators, receipt fields and fallback authority resolution. Renamed the surviving admission module to `configured-external-admission.ts`; `currentExternalSelection` still validates ordinary nodes and character sheets.
- Removed engine budget records, caps, options and mutation/read APIs. `committedMicros(projectId)` sums the project's reserved and charged reservations, excluding released reservations. Updated the demo and callers.
- All supported external v1 attempts, including fal lip-sync, require their exact `providerUse` proof. Receipt and authority checks retain original capability-lock/profile identity, candidate/grant/reservation evidence, leases and immutable request/transport digests. No constant-null allowance fields remain.
- Preserved submission/preparation intent, positive no-dispatch proof, unknown-outcome reconciliation, candidate/attempt separation, request/epoch/hold isolation, exact actual-frame/video review and current-format backup/restore/quarantine.
- Removed `spendingPermissionRequired`, `allowanceRequired` and `unusedAllowances` from server outputs and the narrowly allowed web types, parsers, fixtures and tests. No UI or copy redesign.
- Converted the eight shared fixtures and the inline OpenAI/MiniMax/fal/routing fixtures to real `ConfiguredExternalAdmission`, synchronous readiness hooks and real lock/candidate/grant/reservation records. Removed allowance helpers and adapted their consumers.
- Deleted `SPENDING-REVIEW.md`, repaired links to it and updated current execution, persistence, provider, local setup and recovery documentation. Added the current L3 STATUS entry; dated history otherwise remains intact.

P1 code-plan source/tests and its independent $1 ceiling, compiler/compositions, tool/catalog/guidance/skill releases, review methods, legacy assembly mode and the engine no-lock harness fallback are unchanged. No DDL/schema version change.

## Files

### Added

- `apps/server/src/execution/configured-external-admission.ts`
- `apps/server/test/configured-external-admission.test.mjs`
- `docs/ai/uiux-plan/codex/reports/L3-report.md`

### Deleted

- `apps/server/src/application/external-allowances.ts`
- `apps/server/src/application/project-budget.ts`
- `apps/server/src/execution/durable-external-admission.ts`
- `apps/server/src/execution/external-allowance-records.ts`
- `apps/server/test/allowance-usage-fixture.mjs`
- `apps/server/test/external-allowances.test.mjs`
- `apps/server/test/project-budget-fixture.mjs`
- `apps/server/test/project-budget.test.mjs`
- `docs/implementation/SPENDING-REVIEW.md`

### Changed server/provider source

- `apps/server/src/application/installation-recovery.ts`
- `apps/server/src/application/media-execution-runtime.ts`
- `apps/server/src/application/project-model-settings.ts`
- `apps/server/src/application/provider-catalog.ts`
- `apps/server/src/demo.ts`
- `apps/server/src/execution/audio-execution-authority.ts`
- `apps/server/src/execution/audio-execution-receipts.ts`
- `apps/server/src/execution/codex-image-authority.ts`
- `apps/server/src/execution/codex-image-execution.ts`
- `apps/server/src/execution/codex-image-receipts.ts`
- `apps/server/src/execution/engine.ts`
- `apps/server/src/execution/fal-lipsync-execution.ts`
- `apps/server/src/execution/fal-lipsync-receipts.ts`
- `apps/server/src/execution/local-execution.ts`
- `apps/server/src/execution/minimax-h3-execution.ts`
- `apps/server/src/execution/minimax-h3-receipts.ts`
- `apps/server/src/execution/openai-image-execution.ts`
- `apps/server/src/execution/openai-image-receipts.ts`
- `apps/server/src/execution/openai-speech-execution.ts`
- `apps/server/src/execution/openai-transcription-execution.ts`
- `apps/server/src/execution/provider-use.ts`
- `apps/server/src/execution/transcription-execution-authority.ts`
- `apps/server/src/execution/transcription-execution-receipts.ts`
- `apps/server/src/execution/transcription-preparation.ts`
- `apps/server/src/execution/viggle-h3-authority.ts`
- `apps/server/src/execution/viggle-h3-execution.ts`
- `apps/server/src/execution/viggle-h3-receipts.ts`
- `apps/server/src/narration/narration-speech-projection.ts`
- `apps/server/src/persistence/recovery-records.ts`
- `apps/server/src/persistence/store.ts`
- `packages/providers/src/audio-http.ts`
- `packages/providers/src/execution.ts`

### Changed server tests and fixtures

- `apps/server/test/audio-execution-runtime.test.mjs`
- `apps/server/test/audio-preflight.test.mjs`
- `apps/server/test/character-sheet-routes.test.mjs`
- `apps/server/test/codex-image-execution-fixture.mjs`
- `apps/server/test/codex-image-execution.test.mjs`
- `apps/server/test/codex-image-runtime.test.mjs`
- `apps/server/test/codex-spending-display.test.mjs`
- `apps/server/test/director-transcription-outcomes.test.mjs`
- `apps/server/test/execution-fixture.mjs`
- `apps/server/test/execution-provider.test.mjs`
- `apps/server/test/execution-routing.test.mjs`
- `apps/server/test/execution-shutdown.test.mjs`
- `apps/server/test/execution.test.mjs`
- `apps/server/test/fake-director-confirm.test.mjs`
- `apps/server/test/fake-director-proposal.test.mjs`
- `apps/server/test/fal-lipsync-execution.test.mjs`
- `apps/server/test/generated-narration-fixture.mjs`
- `apps/server/test/helpers/director-mapped-speech-fixture.mjs`
- `apps/server/test/helpers/generation-fixture.mjs`
- `apps/server/test/installation-recovery-http.test.mjs`
- `apps/server/test/installation-recovery.test.mjs`
- `apps/server/test/mapped-speech-intent.test.mjs`
- `apps/server/test/media-execution-runtime.test.mjs`
- `apps/server/test/minimax-h3-execution.test.mjs`
- `apps/server/test/narration-speech-authorization.test.mjs`
- `apps/server/test/narration-speech-backup.test.mjs`
- `apps/server/test/narration-speech-fixture.mjs`
- `apps/server/test/narration-speech-projection.test.mjs`
- `apps/server/test/openai-image-execution.test.mjs`
- `apps/server/test/openai-speech-execution.test.mjs`
- `apps/server/test/openai-transcription-execution.test.mjs`
- `apps/server/test/output-store.test.mjs`
- `apps/server/test/owned-transcription-authorization.test.mjs`
- `apps/server/test/owned-transcription-execution.test.mjs`
- `apps/server/test/owned-transcription-projection.test.mjs`
- `apps/server/test/owned-transcription-review.test.mjs`
- `apps/server/test/personal-voices.test.mjs`
- `apps/server/test/project-model-settings.test.mjs`
- `apps/server/test/provider-catalog.test.mjs`
- `apps/server/test/provider-use-persistence.test.mjs`
- `apps/server/test/provider-use.test.mjs`
- `apps/server/test/scene-clip-remake-integrity.test.mjs`
- `apps/server/test/scene-generation.test.mjs`
- `apps/server/test/scene-review-concurrency.test.mjs`
- `apps/server/test/shot-narration-scope.test.mjs`
- `apps/server/test/speech-audio-lineage.test.mjs`
- `apps/server/test/speech-execution-fixture.mjs`
- `apps/server/test/speech-execution-records.test.mjs`
- `apps/server/test/spool-transcript-ingestor.test.mjs`
- `apps/server/test/stop-release.test.mjs`
- `apps/server/test/storyboard-delete-attempts.test.mjs`
- `apps/server/test/transcript-candidate.test.mjs`
- `apps/server/test/transcript-engine-ingestion.test.mjs`
- `apps/server/test/transcript-selection-fixture.mjs`
- `apps/server/test/transcription-execution-fixture.mjs`
- `apps/server/test/transcription-execution-records.test.mjs`
- `apps/server/test/transcription-preparation-engine-fixture.mjs`
- `apps/server/test/transcription-preparation-engine.test.mjs`
- `apps/server/test/transcription-preparation-port.test.mjs`
- `apps/server/test/transcription-preparation-storage.test.mjs`
- `apps/server/test/viggle-h3-execution-fixture.mjs`
- `apps/server/test/viggle-h3-execution.test.mjs`
- `apps/server/test/viggle-h3-frame-crop.test.mjs`

### Minimal web changes

- `apps/web/src/next/fixtures/routes/computer.ts`
- `apps/web/src/next/fixtures/routes/recovery.ts`
- `apps/web/src/next/fixtures/routes/settings.ts`
- `apps/web/src/next/model/recovery.ts`
- `apps/web/src/next/model/settings.ts`
- `apps/web/test/next/settings-computer.test.mjs`
- `apps/web/test/next/settings-models.test.mjs`
- `apps/web/test/next/shell-recovery.test.mjs`

### Changed documentation

- `CONTRIBUTING.md`
- `docs/README.md`
- `docs/audit/DOCUMENTATION-RECONCILIATION.md`
- `docs/implementation/INSTALLATION-RECOVERY.md`
- `docs/implementation/LOCAL-SETUP.md`
- `docs/implementation/MANUAL-AUDIO-TESTING.md`
- `docs/implementation/MEDIA-EXECUTION-LAUNCHER.md`
- `docs/implementation/PERSONAL-VOICE.md`
- `docs/implementation/PROVIDER-CATALOG.md`
- `docs/implementation/RUNTIME-TRUST-DECISION.md`
- `docs/implementation/SHOT-AUDIO.md`
- `docs/implementation/STATUS.md`
- `docs/technical/DATA-PERSISTENCE.md`
- `docs/technical/EXECUTION-ENGINE.md`
- `docs/technical/PRODUCTION-WORKFLOW.md`
- `docs/technical/README.md`

## Tests

Baseline supplied by the lead: **4,630 total; 4,629 pass; 0 fail; 1 optional skip**.

Added **16 cases**: nine configured-admission cases and seven per-adapter missing-providerUse guards. The configured cases cover missing readiness, asynchronous/nonempty receipts without partial admission, transaction rollback on reservation insertion failure, exact human frame review, candidate/attempt separation, actual `EXTERNAL_PROFILE_MISMATCH` and `EXTERNAL_SELECTION_STALE`, holds/pause/grants without caps, restart without another start, and restored-authority fencing.

Removed **29 cases from retired paths**, after porting their current integrity invariants to configured admission: 23 in `external-allowances.test.mjs`, two in `project-budget.test.mjs`, one allowance-only owned-review case, one budget receipt recovery case, one allowance half of `provider-use.test.mjs`, and one speech allowance revocation/expiry case. Two entire suites and two helper fixtures were deleted. Retired-route coverage in `allowance-routes.test.mjs` remains. Money/integrity cases were rewritten rather than discarded, including forged provider/profile evidence, original reservation liability under contention/restart, returned-frame review, restore fencing, current-selection changes, capacity, Stop, missing/lost dispatch replies and no resubmission.

Verified with the pinned toolchain: Node **24.15.0**, pnpm **10.33.0**, FFmpeg/ffprobe **8.1.1**. `pnpm setup:test-media` reused the matching tools without downloading; `pnpm check:toolchain` passed.

- `pnpm build`: passed. Existing Vite dynamic-import/chunk-size warnings remain non-failing.
- Broad targeted run: **190 test files; 2,257 total; 2,254 pass; 3 fail; 0 skip**. The three failures were remaining historical-consumption expectations in `speech-audio-lineage.test.mjs` and `transcription-preparation-storage.test.mjs`. They were rewritten to check the exact configured provider lock and reservation. The grep audit also converted `spool-transcript-ingestor.test.mjs` and `transcript-candidate.test.mjs`. All four corrected suites passed **39/39**, zero failures/skips. The final configured-admission suite, including malformed receipts, passed **9/9**.
- Earlier focused batches passed **211/211** engine/provider tests, **200/200** provider/forgery tests, **113/113** web/catalog/recovery/runtime tests and **32/32** audio-preflight/model-settings tests; these overlap the broad/full runs and are not additive suite totals.
- P1 `code-plan-*.test.mjs`: **53/53 pass**, zero failures/skips; no P1 source/test changes.
- `pnpm test` (`pnpm build` then full `node scripts/run-tests.mjs`): **4,617 total; 4,616 pass; 0 fail; 1 optional native-probe skip; 0 cancelled/todo**. Exit **0**; duration **1,021,737.929791 ms** (about 17 minutes). The quiet final tail was the unchanged synchronous skill-release checks; all passed. The observed total is exactly the supplied baseline minus 29 removed cases plus 16 added cases.
- `pnpm -r typecheck`: **all five workspace typechecks pass**.
- `git diff --check`: passed. No test was disabled or newly skipped.

Build, target and full-suite logs are local verification artifacts under `/tmp/openslate-l3-*.log`; no logs, generated output, media or databases are part of the source diff.

## Contract changes

`packages/core/src/studio-api.ts`: **none**.

Internal/wire changes: `ExecutionRequest.externalAllowanceId` removed; `ExternalExecutionAdmission` now returns an empty synchronous readiness receipt and has no `recordAdmission`; `Engine.budget`, `setBudget`, `defaultBudgetMicros` and `budgetMicros` removed in favor of `committedMicros(projectId)`; runtime `allowances` service removed; provider mapping/dispatch/preparation records omit allowance/consumption fields; provider/model/recovery responses omit the three retired fields. Historical shapes are intentionally unsupported.

## Commits

None created, as required by COMMON/RULES. Proposed conventional-commit split:

1. `refactor(execution): remove legacy allowances and engine budgets` — all server/provider source and server tests/fixtures in the Added, Deleted, Changed server/provider source and Changed server tests sections above, plus every Minimal web changes file. This keeps the shape changes and their callers/tests together.
2. `docs(execution): document configured admission without budget accounting` — every file in Changed documentation, deleted `docs/implementation/SPENDING-REVIEW.md`, and added `docs/ai/uiux-plan/codex/reports/L3-report.md`.

Each proposed commit's file list is the corresponding exhaustive inventory above. The lead owns review and commits.

## Review and open issues

Self-review covered correctness, cross-file callers, exact receipt fields, recovery, test integrity and scope boundaries. It found and corrected remaining ingestion/preparation tests that referenced removed consumption records, and missing capability locks in secondary OpenAI/MiniMax capacity fixtures that permissive stubs had hidden; assertions remain intact. Other fixture corrections retain the original candidate by ID after a legitimate replan, schedule the first admitted transcription before a newer ready proposal, and change the current lock without corrupting the original immutable lock when testing current-selection fencing. Engine readiness rejects a synchronous hook that returns a promise, and invalid nonempty/array/null admission receipts roll back without attempts/reservations.

A fresh independent read-only review examined admission, engine, provider-use, all seven receipt families, four authorities, bridges, preparation intent and changed money/integrity tests; it found no actionable issue. A follow-up review of the four final lineage/preparation test rewrites likewise found no material weakening or actionable finding. Current Markdown link checks and whitespace checks pass.

No unresolved L3 implementation issue is known. Offline verification does not claim real-provider acceptance. No browser, real provider/native model call, external network request, protected `.env*`/secrets/`.openslate/` access, port-3001 listener, production-state change, commit or push occurred. No user action is needed; the lead reviews and commits the prepared worktree.
