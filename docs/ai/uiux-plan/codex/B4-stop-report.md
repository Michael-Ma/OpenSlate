# B4 implementation report

## Done

- GR-13 / D6: the controls route accepts `ControlInput`, requires an Idempotency-Key, and returns `ControlReceipt`. Stop supersedes active requests, revokes Director epochs, pauses execution, and detaches unfinished bound candidates with no non-terminal attempt. Their `NodeBinding.outdatedReason` is `stopped`; they require a new generation press. Completed outputs remain available, and admitted jobs keep reconciling and charging normally. Even an unused technical retry loses its old candidate on Stop.
- Stop stores its original counts and timestamp in an `execution_stop` JSON entity. A `candidate_stop` record also fences any future paid retry of a candidate that was still running at Stop, even if it fails after Continue. `ProductionService.stopView(projectId): StopView | null` is the small read-only integration point for B2. It returns only the browser contract's fields for the current paused authority, or null after Continue. The counts describe the moment of Stop, rather than a changing count of remaining jobs.
- Continue requires `expectedAuthorityId` at the HTTP boundary, rejects a changed authority with `STOP_CHANGED`, and only updates control state. It does not tick the Director or dispatch work. Generation while stopped returns `EXECUTION_PAUSED`. Exact command replay preserves the original response without changing later intent.
- GR-10 / D7: the release route requires an Idempotency-Key, the expected unknown phase, and explicit double-charge acknowledgement. It records immutable `Attempt.released = { by, at }`, detaches only the matching candidate, and records `attempt.released` audit evidence. It excludes released attempts from admission guards, provider capacity and current-attempt projection while preserving reconciliation. Late outputs remain on historical attempts and never publish into a current binding.
- Release never refunds the reservation: it remains committed, becoming charged on late success/failure. A later rejected observation also cannot refund a deliberately released attempt. Replay returns the original receipt even after reconciliation, without another request, event or provider submission.

## Files

Changed:

- `apps/server/src/app.ts`
- `apps/server/src/application/service.ts`
- `apps/server/src/execution/engine.ts`
- `apps/server/src/persistence/store.ts`
- `apps/server/src/scene-generation.ts`
- `apps/server/test/api.test.mjs`
- `apps/server/test/installation-recovery-http.test.mjs`
- `apps/server/test/scene-generation.test.mjs`
- `apps/server/test/workspace.test.mjs`

Added:

- `apps/server/test/stop-release.test.mjs`
- `docs/ai/uiux-plan/codex/B4-stop-report.md`

Deleted: none. No DDL, web changes, live-provider calls, external network access or port 3001 use.

## Tests

- Added nine integration tests for queued/submitted Stop, continued work, stale authority, exact replay, missing keys, persisted Stop reads, explicit new generation, capacity-one release, replacement take publication, historical late completion, committed liability, missing acknowledgement, non-unknown/missing/foreign attempts, restart, audit uniqueness and immutable release metadata. Stop tests also cover an already failed unused retry and a submitted job that fails after Stop.
- Updated seven existing tests: authentication, forged-field and quarantine fixtures now supply the required Continue authority, and the stopped-continuation fixture supplies its required Stop key. Authentication and quarantine cases also cover the new release route. The scene Stop assertion now expects `EXECUTION_PAUSED`, while its unanswered-direction assertion retains `WAITING_USER`. Workspace command replay now uses Stop instead of the retired HTTP pause action, explicitly checks the receipt, and retains key-conflict protection for Continue. No tests were deleted.
- Pinned Node 24.15.0, pnpm 10.33.0 and FFmpeg/ffprobe 8.1.1 verified by `pnpm setup:test-media` and `pnpm check:toolchain`; setup used already installed tools.
- `pnpm build`: passed.
- `node scripts/run-tests.mjs apps/server/test/stop-release.test.mjs apps/server/test/api.test.mjs apps/server/test/installation-recovery-http.test.mjs apps/server/test/scene-generation.test.mjs apps/server/test/workspace.test.mjs`: 57 passed, zero failures/skips.
- `pnpm test`: 2,490 total; 2,489 passed, zero failures, one optional native skip. The final full run took 302.47 seconds.
- `pnpm -r typecheck`: all five workspace packages passed, zero failures.
- `git diff --check`: passed. Earlier verification exposed old-schema authentication/quarantine fixtures, the deliberately replaced Stop error assertion, and the retired HTTP pause replay case; all were updated without removing their integrity assertions. Final runs include those corrections.

## Contract changes

None in `packages/core/src/studio-api.ts`. The server implements its existing shapes. Internal engine records add optional `Attempt.released` and `NodeBinding.outdatedReason`; new JSON entity kinds are `execution_stop` and `candidate_stop`.

## Commits

No commits were made, per `RULES.md`. Proposed split by the relevant hunks/tests in shared files:

1. `feat(server): detach unsent work on Stop and fence Continue`
   - `apps/server/src/{app.ts,application/service.ts,execution/engine.ts,scene-generation.ts}`
   - `apps/server/test/api.test.mjs`
   - `apps/server/test/installation-recovery-http.test.mjs`
   - `apps/server/test/scene-generation.test.mjs`
   - `apps/server/test/workspace.test.mjs`
   - Stop/Continue tests in `apps/server/test/stop-release.test.mjs`
2. `feat(server): release unknown submissions while preserving late results`
   - `apps/server/src/{app.ts,application/service.ts,execution/engine.ts,persistence/store.ts,scene-generation.ts}`
   - Release tests in `apps/server/test/stop-release.test.mjs`
   - `docs/ai/uiux-plan/codex/B4-stop-report.md`

## Open issues

- No implementation blocker identified. B2 must call `ProductionService.stopView(projectId)` for the overview. `NodeBinding.outdatedReason` supplies detachment provenance, and a `candidate_stop` entity keyed by candidate ID means that candidate has no automatic retries left. Scene-confirmation cancellation, UI Continue/release controls and request-source classification remain with their owning cards, as explicitly excluded from B4.
- The exact boundary requested by B4 is admission: any non-terminal attempt retains its durable intent and counts as sent, including an attempt still in submission/preparation. Stop detaches candidates without such an attempt; it does not erase an admitted intent or infer that an uncertain submission was free.
- Completed bindings are preserved. Failed candidates without a live attempt are detached; candidates still running at Stop receive a durable retry fence. Continue cannot automatically spend either old retry allowance. A fresh paid press creates a new candidate and can proceed.
- The browser controls route now supports exactly Stop/Continue. Existing trusted internal `ProductionService.control(..., 'pause' | 'resume')` callers remain compatible; HTTP Continue always supplies and checks the expected authority. Legacy pause/restoration records without an `execution_stop` record project as null from the small Stop read; B2 can distinguish those using existing execution control state.
- Both routes currently use the existing authenticated human request path. B1 owns marking application-generated request text by source; no request-source contract was added here.
- Committed liability after release is deliberately conservative, including late rejection. This follows GR-10's requirement that the reservation remain committed rather than treating release as a refund.
