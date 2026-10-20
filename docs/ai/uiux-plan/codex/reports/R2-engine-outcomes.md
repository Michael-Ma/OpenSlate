# R2 engine outcomes

## Done

- **video-01:** Output spool, receipt recovery and completion recovery share a FIFO writer queue across instances with the same storage root. The third operation waits; cancellation releases capacity without opening a queued byte source. Engine reconciliation prioritizes unreleased jobs. Local capacity failures (`OUTPUT_STORE_BUSY`, `OUTPUT_STORE_DISK_FULL`, `MEDIA_BUSY`, and OS resource errors `ENOSPC`, `EDQUOT`, `EMFILE`, `ENFILE`, `ENOMEM`) release only the original owned lease, retaining phase, provider evidence and liability. Speech retains charged response bytes until they are durably spooled and recovers local-capacity failures without another POST.
- **keyframes-retained-take-blocks-video / video-03 root:** Exhausted failed/rejected replacements, Stop detaching an unsent replacement and explicit release restore the retained candidate and outputs as the real selected binding, removing `retainedTake`. Retries with remaining authority retain the replacement. Released late results remain historical takes and are charged without selecting themselves. Temporary frame unavailability does not detach a confirmation's queued speech candidate.
- **video-02:** Immutable confirmation checkpoints capture per-shot intent, prompts, exact frame pin and lock guards. Admission checks only the clip's shot, or the actual scoped shots of its speech operation. Scene title and sibling prompt edits leave already-published queued clips eligible. A genuinely stale video candidate is detached with `confirmation_stale`, its old wait is cleared and the shot returns to video targets for a fresh Confirm. Legacy running checkpoints without per-shot guard evidence block visibly before dispatch instead of silently waiting at attach.
- **video-04:** A validated completed Viggle task remains `ingesting` when downloading, owned recovery or lineage verification needs attention. Sanitized download codes project through `MediaSlot.ingestionIssue {code, at}`; successful ingestion resolves the issue. Immutable completion survives polling-lease loss, a later unavailable GET and local output corruption. Known-finished work cannot use the release/double-charge path, including an old inconsistent `submission_unknown` phase. Invalid receipt publication remains refused.

## Files

Changed source (all seven card paths, with only additive checkpoint/call-site edits in the shared runner):

- `apps/server/src/execution/engine.ts`
- `apps/server/src/execution/output-store.ts`
- `apps/server/src/execution/viggle-h3-execution.ts`
- `apps/server/src/execution/openai-speech-execution.ts`
- `apps/server/src/scene-confirmation-state.ts`
- `apps/server/src/scene-confirmations.ts` — per-shot guard map capture/refresh and legacy-checkpoint presence check only; R4 owns its remaining runner work.
- `apps/server/src/generation-overview.ts` — media-slot issue projection only; scene projection logic unchanged.

Changed tests/helpers:

- `apps/server/test/output-store.test.mjs`
- `apps/server/test/openai-speech-execution.test.mjs`
- `apps/server/test/viggle-h3-execution.test.mjs`
- `apps/server/test/generation-overview.test.mjs`
- `apps/server/test/viggle-h3-execution-fixture.mjs` — optional additional profiles so integrated overview tests can use the actual reader without mutating an immutable lock.

Added:

- `apps/server/test/r2-engine-outcomes.test.mjs`
- `apps/server/test/r2-retained-outcomes.test.mjs`
- `apps/server/test/scene-confirmation-guards.test.mjs`
- `docs/ai/uiux-plan/codex/reports/R2-engine-outcomes.md`

Deleted: none. No web source, browser contract, shipped migrations, frozen catalogs/skills or STATUS file changed.

## Tests

**43 regression cases added:** 14 storage/speech/Viggle adapter cases, 17 engine/projection cases, five retained-frame cases and seven confirmation-guard cases. They cover all card minimums plus raw OS capacity, queue cancellation, lease-owner protection, durable completion after lost ownership, local corruption/repair, legacy checkpoint refusal and queued speech resumption after frame restoration.

**Five existing cases rewritten; none deleted or disabled:**

1. Writer capacity shared across instances: third operation now waits rather than throwing BUSY.
2. Cancellation cleanup retains both occupied slots: the queued third waits through cleanup.
3. Expired signed locator refresh: expects a known-task local ingestion error, then refreshes through the same GET identity.
4. Alternate winning receipt with identical bytes: expects a local ingestion error while continuing to reject invalid lineage, normalization and another POST.
5. Terminal retained-frame refusal overview: expects the restored real selection without a replacement substate; still verifies the rejected reservation is released and the failed attempt remains immutable history.

Money/integrity protection was explicitly reviewed and retained: original task and request identity, no double acceptance, no blind unknown resubmission, idempotent replay, stale-version refusal, late-owner fencing and receipt lineage. The existing `a receipt cannot replace an already known remote task with a synchronous null task` test is unchanged. Disabling only retained-take restoration through a disposable runtime hook made all four initial restoration regressions fail; the hook was removed without changing source or build output.

Toolchain: Node **24.15.0**, pnpm **10.33.0**, FFmpeg/ffprobe **8.1.1**. `pnpm setup:test-media` and `pnpm check:toolchain` passed using already-matching local binaries, without a download.

Final `pnpm build` passed all five builds. The combined touched/related run passed **243/243**, zero failures, skips, cancellations or todo; it included all seven changed test files and six related integrity/confirmation/take suites. A supplemental run after strengthening the old-frame reselection assertions passed **5/5**. Independent source review found two lease/speech integration problems, both fixed and regression-tested; no must-fix finding remains.

Final **`pnpm test` passed 3,424 tests**, zero failures/cancellations/todo and **one optional native-probe skip (3,425 total)**. It ran once after the final source changes and included its normal full rebuild. Final **`pnpm -r typecheck` passed all five packages/apps**, zero failures. No timing-sensitive failure required an isolated rerun. The existing web bundle-size advisory remains a build warning; all builds exit successfully.

Intermediate verification: adapter/storage suite passed **87/87**; guard and existing confirmation suites passed **36/36**; retained suite passed **5/5**. An earlier combined integration run returned **154 passed / two failed / zero skipped**: the obsolete retained-overview expectation above, and an overly broad recovery-error deferral that weakened the unchanged conflicting-task test. The expectation was rewritten and the recovery branch corrected to preserve its original fail-closed behavior. These were implementation issues, not timing flakes; no assertions protecting paid identity were relaxed.

## Contract changes

None to `packages/core/src/studio-api.ts`. Existing `takenOff: "confirmation_stale"` and `ingestionIssue` shapes are used exactly. Internal JSON checkpoints add optional `shotGuardDigests`; no DDL or migration is needed. Legacy checkpoints never receive newly calculated authority silently.

## Commits

No commits or git mutations were made. Proposed conventional split for lead review:

1. `fix(execution): queue output storage and retain charged speech bytes`
   - `apps/server/src/execution/output-store.ts`
   - `apps/server/src/execution/openai-speech-execution.ts`
   - `apps/server/test/output-store.test.mjs`
   - `apps/server/test/openai-speech-execution.test.mjs`
2. `fix(server): restore retained takes and fence only stale confirmed clips`
   - `apps/server/src/execution/engine.ts`
   - `apps/server/src/execution/viggle-h3-execution.ts`
   - `apps/server/src/scene-confirmation-state.ts`
   - `apps/server/src/scene-confirmations.ts`
   - `apps/server/src/generation-overview.ts`
   - `apps/server/test/viggle-h3-execution.test.mjs`
   - `apps/server/test/viggle-h3-execution-fixture.mjs`
   - `apps/server/test/generation-overview.test.mjs`
   - `apps/server/test/r2-engine-outcomes.test.mjs`
   - `apps/server/test/r2-retained-outcomes.test.mjs`
   - `apps/server/test/scene-confirmation-guards.test.mjs`
   - `docs/ai/uiux-plan/codex/reports/R2-engine-outcomes.md`

The second group integrates the engine transitions with the trusted adapter completion signal and should stay together.

## Open issues

No R2 implementation or verification blocker remains. The following decisions and scope limits are recorded for lead review.

- **Scope boundary with R4:** Already-published confirmed clips use per-shot admission guards. The runner's pre-publication whole-scene freshness checks remain unchanged, apart from refusing legacy checkpoints with missing guard evidence. R4 owns stepped narration freshness, attach/accept authority, exact-frame checks in `fresh()`, running-confirmation regeneration refusal and runner publication rebasing. This report makes no claim those R4 changes are implemented.
- **Speech crash boundary:** Charged synchronous bytes survive queue contention, caller cancellation and retryable local-resource errors in the running bridge until their durable write. A process death before the first durable spool still loses response-only bytes; the persisted marker/result prevents blind resubmission. Reserving a writer before POST would require an additional internal admission/permit API and is not introduced here.
- **Expiry test boundary:** The current Viggle response adapter persists `expiresAt: null`; expiry tests inject an expired locator at the trusted downloader boundary and exercise its actual expiry refusal. HTTP 403/503 failures also exercise known-task refresh/recovery. No vendor expiry-field support is claimed.
- **Take selection:** The restored current frame keeps the existing `ALREADY_COMPLETE` response when selected redundantly. Each restoration regression switches to an earlier take, then successfully selects the restored old frame itself again, without paid authority or a new attempt.
- Browser replay remains with the lead under RULES; no browser was launched. Checks use disposable state, fake transports, synthetic media and injected credentials. No real provider/model call, external network request, personal credential read, production-state access/restart or port 3001 listener occurred.
