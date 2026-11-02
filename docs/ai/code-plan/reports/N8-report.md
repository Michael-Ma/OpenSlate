# N8 — Settle lost Viggle submissions from account-list evidence

Implemented offline in `codex/n8-lost`, based on `75b22f5`. Source is left uncommitted for the lead under `docs/ai/uiux-plan/codex/RULES.md`.

## Done

- **N8.1 — Diagnostic evidence.** No-HTTP-status failures retain bounded `errorName`, `causeCode`, `causeName` and `causeSyscall` tokens. Error/cause messages, URLs, headers, bodies, unknown fields and the configured synthetic key are excluded. Error data is read through property descriptors rather than calling error accessors. Existing pre-connect classification still uses the original cause object, including its TLS diagnostic identity. Submit/observation validators accept only the four new optional fields; historical receipts retain their shape/digest.
- **N8.2 — Adapter.** Added `listVideos(limit, options?)` on the existing fixed-origin, authenticated, bounded `call()` path. It validates HTTP status, the list envelope, boolean coverage, task ids, strict second-precision UTC dates, ordering, duplicate ids and item bounds. Unknown fields are ignored. Failures/malformed answers return explicit unknown evidence and cannot supply an empty successful list.
- **N8.3–4 — Durable settlement.** A code-plan Viggle unknown submit without an HTTP status/task id remains pending while the tick/lookup path performs checks at dispatch +10 s/+30 s. The timing and clock are injectable. New JSON entity `viggle_h3_submission_settlement` binds the original immutable request, dispatch and submit digests, policy, claim and append-only checks. Interrupted claims resume after expiry; a delayed second check remains separated from the first. Two complete stranger-free reads return `VIGGLE_H3_NO_TASK_CREATED`, release liability and expose `retry:"safe"`, `mayHaveCharged:false`; the existing two retries, persisted backoff and normal admission/Stop/hold/ceiling fences apply. The retry creates one task. Strangers, unreadable/malformed lists and unexhausted coverage retain `SUBMISSION_RESPONSE_LOST`, consent and possible charge. No stranger is adopted. Ownership reads accepted submit rows across every project and graph/code film in this installation. Graph behavior, status-bearing unknown replies, dispatches with no saved submit receipt and already-terminal historical failures retain their earlier behavior. Settlement evidence is validated by Store and installation-backup closure; checks and final outcomes cannot be rewritten.
- **N8.5 — Director prices.** Viggle `priceBasis` exposes only `resolution` from the locked profile and one scalar `creditsPer5Seconds` for each mode, with `enhance:false`. Its formula and exact admission prices remain the N6 table. No unsupported resolution menu is advertised.
- **N8.6–7 — Tests/docs.** Added fake-transport regressions, adapted the obsolete immediate-terminal assumptions without removing their consent/accounting guards, and documented the state and evidence in `EXECUTION-ENGINE.md` and `STATUS.md`.

## Files

Added:

- `apps/server/src/execution/viggle-h3-settlement.ts`
- `apps/server/test/code-plan-lost-submissions.test.mjs`
- `docs/ai/code-plan/reports/N8-report.md`

Changed:

- `packages/providers/src/viggle-h3.ts`
- `packages/providers/test/viggle-h3.test.mjs`
- `apps/server/src/code-plan/models.ts`
- `apps/server/src/execution/viggle-h3-execution.ts`
- `apps/server/src/execution/viggle-h3-receipts.ts`
- `apps/server/src/execution/viggle-h3-lineage.ts`
- `apps/server/src/persistence/store.ts` — settlement validation/append-only updates only.
- `apps/server/src/persistence/installation-backup-closure.ts` — include settlement rows in Viggle closure.
- `apps/server/test/code-plan-providers-fixture.mjs`
- `apps/server/test/code-plan-providers.test.mjs`
- `apps/server/test/code-plan-reference-video.test.mjs`
- `apps/server/test/code-plan-retry.test.mjs`
- `apps/server/test/code-plan-viggle-model.test.mjs`
- `docs/technical/EXECUTION-ENGINE.md`
- `docs/implementation/STATUS.md`

Deleted: none. No web source, browser contract, skill package, DDL or schema-version changes.

## Tests

Added **21 tests**: 17 settlement integration tests, three adapter/list/diagnostic tests and one pinned-resolution price test. Coverage includes two empty windows and exactly one successful automatic-retry task; strangers in either check; ownership across projects; list errors/malformed lists/incomplete coverage; expanding a prefix to an older boundary or a stranger; skew-window exhaustion; restart between checks and after interrupted publication; durable backup/inspection; immutable checks; no-status receipt redaction; HTTP 200/400/500 exclusion; untouched terminal pre-N8 failure; settled terminal lookup replay; and actual injected timing. Existing graph adapter/backup suites run in the focused gate.

Rewrote **five existing tests** to wait for the first unreadable list check before asserting the original consent-only lost-response outcome: one provider test, one historical-reference retry test and three retry/version/history tests. Their retained liability, explicit-consent, no-resubmit, stale-version, Stop, hold and ceiling assertions remain. The shared fixture helper advances only mocked Date; it does not sleep. No tests were deleted, disabled or newly skipped.

Pinned toolchain: Node **24.15.0**, pnpm **10.33.0**, FFmpeg/ffprobe **8.1.1**. Setup/preflight passed using installed binaries, without a download.

| Check | Final result |
| --- | --- |
| `pnpm setup:test-media` | Passed; the installed media pair already matches the pinned profile. |
| `pnpm check:toolchain` | Passed; exact Node/pnpm/media versions and required encoders. |
| `pnpm build` | **5 workspace builds passed**; existing Vite chunk/dynamic-import warnings remain. |
| Focused command below | **165 passed / 0 failed / 0 skipped**, 165 total; 33.724 s. |
| `pnpm test` | **4,896 passed / 0 failed / 1 skipped**, 4,897 total; 662.181 s. Zero cancelled/todo tests. The only skip is `opt-in native Codex probe never starts a model turn`. |
| `pnpm -r typecheck` | **5 workspace typechecks passed / 0 failed**. |
| Documentation links | **69 local links checked**, all present. |
| `git diff --check` and ownership audit | Passed; web source, browser contract and schema match HEAD. |

Local verification logs are `/tmp/openslate-n8-{build,focused,full,typecheck}.log`; the counts above are from completed commands. Build, focused tests, full `pnpm test`, and recursive typecheck ran in the required order.

Focused command, after `pnpm build`:

```sh
node scripts/run-tests.mjs \
  packages/providers/test/viggle-h3.test.mjs \
  apps/server/test/code-plan-lost-submissions.test.mjs \
  apps/server/test/code-plan-viggle-model.test.mjs \
  apps/server/test/code-plan-retry.test.mjs \
  apps/server/test/code-plan-providers.test.mjs \
  apps/server/test/code-plan-reference-video.test.mjs \
  apps/server/test/viggle-h3-execution.test.mjs \
  apps/server/test/viggle-backup.test.mjs
```

The preliminary six-file run returned **106 passed / 8 failed / 0 skipped (114 total)**. It exposed test fixture project/database assumptions, a previously captured default clock that bypassed later Date mocking, and connect classification reading an error accessor. Those issues were corrected. The subsequent eight-file run passed **163/163** before two added prefix-expansion cases and the evidence-bound adjustment. Only the final completed gates establish final acceptance.

## Self-review

Reviewed the complete source/test diff for money, replay, authority, cross-file callers, bounds and recovery. Corrected terminal lookup so a released no-submit result replays from settlement evidence, kept terminal pre-change attempts ineligible, aligned the 64 KiB settlement bound with backup reads, and bounded exception evidence to three reads. Default clock lookup remains compatible with explicit `now` injection. Tests exercise retained original receipts and resume after publication interruption; no new create path exists in settlement.

## Contract changes

None to `packages/core/src/studio-api.ts`; none requested. Existing code-plan unknown/failed states and safe/consent retry fields carry the result. Provider-internal additions are `listVideos`, its redacted result types and four optional diagnostic fields. The Director's server-owned `priceBasis` changes from a resolution menu/array rates to a single resolution/scalar mode rates.

## Proposed commits

1. `fix(viggle): settle lost code-plan submissions from account lists`
   - `packages/providers/src/viggle-h3.ts`
   - `packages/providers/test/viggle-h3.test.mjs`
   - `apps/server/src/execution/viggle-h3-settlement.ts`
   - `apps/server/src/execution/viggle-h3-execution.ts`
   - `apps/server/src/execution/viggle-h3-receipts.ts`
   - `apps/server/src/execution/viggle-h3-lineage.ts`
   - `apps/server/src/persistence/store.ts`
   - `apps/server/src/persistence/installation-backup-closure.ts`
   - `apps/server/test/code-plan-lost-submissions.test.mjs`
   - `apps/server/test/code-plan-providers-fixture.mjs`
   - `apps/server/test/code-plan-providers.test.mjs`
   - `apps/server/test/code-plan-reference-video.test.mjs`
   - `apps/server/test/code-plan-retry.test.mjs`
2. `fix(code-plan): advertise only the pinned Viggle resolution`
   - `apps/server/src/code-plan/models.ts`
   - `apps/server/test/code-plan-viggle-model.test.mjs`
3. `docs(code-plan): record N8 settlement and validation`
   - `docs/technical/EXECUTION-ENGINE.md`
   - `docs/implementation/STATUS.md`
   - `docs/ai/code-plan/reports/N8-report.md`

No commit or push was performed; the lead owns review and integration.

## Open issues and boundaries

- **Pagination decision for lead review:** the card supplies only `GET /v1/videos?limit=12` and `has_more`, with no cursor/offset request contract. A text clarification was requested; implementation uses at most three bounded **prefix expansions: limit 12, 24, 36**. It never assumes an undocumented cursor or that `has_more` means complete coverage. A provider-imposed/ignored limit that leaves the recent window unseen produces consent. A verified cursor can replace this transport strategy later without changing the settlement rule.
- No live reproduction, real provider/native-model call, external network request, browser launch, personal credential/configuration/protected-state read, production restart or port-3001 listener was performed. All provider calls were fake transports; media tools and loopback tests use disposable local state. The original real transport failure cause and live list consistency/billing behavior remain unverified.
- A process that dies before saving any unknown submit receipt still follows the existing dispatch-only recovery path. Settlement requires the saved no-status observation; it does not infer a missing HTTP status from absent evidence. A restart after that observation/settlement exists is covered.
