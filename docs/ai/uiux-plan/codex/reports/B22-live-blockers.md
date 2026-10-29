# B22 live blockers

## Done

### B22.1 — generation after Plan edit and Undo

Cause: generation reads excluded active `alongside` editing requests, while the write-side freshness check included them. A fresh browser read therefore returned a request identity that could never pass after Undo.

Fix: `currentHumanRequestId` is shared by the read/digest and the write assertion. Alongside edits preserve Director epochs but still fence old human generation presses. Both scene and single-shot generation now work after Director-authored planning, human Plan edit and Undo. Genuine newer requests still reject stale presses.

Tests: the pre-fix server run reproduced `409 SCENE_REVIEW_STALE` for the scene and single-shot paths. Added same-head alongside freshness, both edit/Undo paths, and original-command replay/unknown-attempt protection. The disposable fake-studio browser scenario uses actual application routes without response mocks; syntax checked only.

The full suite also exposed an old proposal-rejection expectation that the fresh read would keep excluding the new alongside request. That test now requires the shared fresh identity, while preserving unchanged project contents and asserting old-press refusal and exact reject replay without another request or generation grant.

### B22.2 — failed first-film setup

Cause: creating the first project removed the empty-library Start fallback before the new project was selected, unmounting the recovery sheet.

Fix: pin Start synchronously before publishing and selecting the created film. The existing sheet remains mounted through setup, failed setup, and selection refresh. It retains the error, Open the film and Try again. Retry resumes the existing film; it never creates another film. Structured version errors retain their original refusal code and localized details.

Tests: first-film selection through every store notification, failed setup and same-film retry, structured version refusal; a Start fixture/browser scenario covers the failed recovery sheet. No browser run was performed here.

### B22.3 — pinned Codex discovery and diagnosis

Cause: discovery preferred the ChatGPT bundle independently of the image worker and supported install, then setup replaced the useful version failure with a generic refusal.

Fix: prefer explicit `OPENSLATE_CODEX_BINARY`, then the image worker's `OPENSLATE_CODEX_IMAGE_BINARY`, then `~/.local/share/openslate-codex/node_modules/.bin/codex`, then discovered executables whose version matches `0.153.4`. Explicit/pinned selections remain visible when their version is incompatible so they can be repaired. Fallback discovery has a three-second aggregate budget, one second per executable and 64 candidates maximum. Version-only subprocesses have a restricted environment and never start a native session or inspect an account.

`DIRECTOR_CODEX_VERSION_MISMATCH`, its localized error, and Settings identify expected/found versions, the selected program and supported install. Arbitrary version stdout is never returned. A failed choice stays unsaved and its exact setup key remains retryable. Safe diagnosis persists across the failed-save refresh; a stale model inspection cannot overwrite newer setup evidence.

Tests: configuration priority, pinned install priority, realpath/deduplication, incompatible and vanished candidates, version-only subprocesses, aggregate discovery budget, prerelease parsing, malformed stdout privacy, HTTP/Settings error details, retry identity, and stale diagnosis fencing.

### B22.4 — long first planning turn

The retained SQLite database was inspected through an immutable read-only connection. Only timestamps, operation names, states, counts and result sizes were extracted. No retained prompts, private text or database were copied into this repository. The retained runtime `logs` and `native-state` directories contained no session-log files.

| First turn evidence, UTC on 2026-10-16 | Result |
| --- | --- |
| 17:51:03.551 | Turn created |
| 17:51:03.864 | Native dispatch intent persisted |
| 17:51:13.274 → 17:51:13.276 | The only application tool call, `read_context`, succeeded in 2 ms; result approximately 7.3 KB |
| 17:51:16.776 | Commentary acknowledgment persisted |
| 17:54:03.898 | Confirmed interruption, `RUNTIME_RUN_TIMEOUT` |
| End state | No prepared change, apply call, note, proposal or media attempt from this turn |

The first turn lasted **180.347 s**, consistent with the configured **180,000 ms** runtime deadline after dispatch. The later shorter request lasted **33.268 s** and completed read → prepare → apply → read. The hours between those turns are an observation gap, not measured provider latency.

Finding: there was no application tool loop, slow application tool, pending application mutation, or oversized tool result explaining the stall. The remaining interval was inside the native turn after a successful read and acknowledgment. No retained native trace explains whether it was model reasoning, upstream waiting, or native code-mode work. **The exact original native cause remains unproven; this card does not claim a reproduced or cured native stall.**

Implemented mitigations and observability:

- New-film guidance saves a small first usable draft before expanding the plan, while retaining proposal/import review rules. This is guidance, not a guarantee about model behavior.
- The thread shows an elapsed clock, actual application tool state and observed native reasoning/tool phase. A completed read no longer continues to say “Reading the film.” Concurrent native item IDs are tracked privately until the last active item finishes; an older active application tool remains visible when a later call finishes. No reasoning text, arguments or native item IDs enter the public phase record.
- Safe phase/state/timestamp records and diagnostic **codes only** are persisted. Raw native diagnostic messages remain private.
- Timeout markers report confirmed Plan changes, notes and change proposals for that turn, including zero, and give a smaller next request. Counts describe historical records, not current proposal eligibility. No-op apply receipts are excluded. Other saved work and pending suggestions remain inspectable; these three counters are not an exhaustive audio-draft counter.
- The total run deadline is deliberate host configuration: `OPENSLATE_DIRECTOR_RUN_TIMEOUT_MS`, integer **1,000–600,000 ms**. Default remains **180,000 ms** because the evidence does not establish that extending it fixes this stall. Other runtime limits still only tighten defaults. Changing the deadline never dispatches or retries a turn automatically.

Tests: bounded host parsing and forwarding, runtime ceiling, exact-thread/turn phase filtering and privacy, overlapping native items, diagnostic-code privacy, retained early changes on timeout, no automatic replay, no-op effects, concurrent application tools, bilingual elapsed/progress/timeout wording. These use synthetic runtimes and protocol fixtures.

### B22.5 — subscription prices

Cause: the provider catalog already identified Codex subscription billing, but generation quotes only exposed missing-price state. Downstream controls consequently called the subscription “no price set.”

Fix: `PriceQuote.subscription?: "codex"` carries that existing distinction to the browser. Inspector, scene panel, note links/banner, Settings and Plan edit impacts say “uses your Codex plan” / “使用你的 Codex 订阅”. Mixed voice quotes retain both the per-call estimate and subscription wording. Missing per-call prices still say no price set. Integer quote arithmetic and price fences remain unchanged.

Tests: server subscription-only/mixed/unknown quotes and every affected UI presentation in English and Chinese, including Plan impacts and selected-shot totals.

## Files

All paths below are relative to the worktree. No file was deleted. Existing LIVE-1 evidence and the supplied B22 card were left untouched. No schema migration, frozen catalog, immutable skill package, CSS, database, media, secret, dependency or generated build artifact is part of the proposed changes.

### A — request fences

Changed:

- `apps/server/src/application/expected-human-request.ts`
- `apps/server/src/scene-generation.ts`
- `apps/server/test/scene-review-concurrency.test.mjs`
- `apps/server/test/director-proposals.test.mjs`

Added:

- `scripts/browser/next-keyframes-plan-undo-live.mjs`

### B — first-film recovery

Changed:

- `apps/web/src/next/model/start-commands.ts`
- `apps/web/src/next/views/start/StartView.tsx`
- `apps/web/src/next/views/start/NewFilmSheet.tsx`
- `apps/web/src/next/fixtures/routes/start.ts`
- `apps/web/src/next/fixtures/routes/computer.ts`
- `apps/web/test/next/start-commands.test.mjs`
- `scripts/browser/next-start.mjs`

### C — Codex setup

Changed:

- `apps/server/src/application/local-director.ts` (also D deadline forwarding)
- `apps/server/src/app.ts`
- `apps/server/src/installation-status.ts`
- `apps/server/test/local-director.test.mjs` (also D deadline forwarding test)
- `apps/server/test/installation-status.test.mjs`
- `apps/server/test/installation-recovery-http.test.mjs`
- `packages/director/src/runtime/setup.ts`
- `packages/director/test/runtime-setup-fixture.mjs`
- `packages/director/test/runtime-setup.test.mjs`
- `apps/web/src/next/i18n/translate.ts`
- `apps/web/src/next/i18n/catalog/errors.ts`
- `apps/web/src/next/model/settings-director.ts`
- `apps/web/src/next/views/settings/DirectorPanel.tsx`
- `apps/web/src/next/store/store.ts`
- `apps/web/test/next/settings-director.test.mjs`
- `apps/web/test/next/settings-catalog.test.mjs`
- `apps/web/test/next/store.test.mjs`

Added:

- `apps/server/src/application/codex-binary.ts`
- `apps/server/test/codex-binary.test.mjs`

### D — Director progress, timeout and investigation

Changed:

- `packages/director/src/runtime/policy.ts`
- `packages/director/src/runtime/index.ts`
- `packages/director/src/runtime/types.ts`
- `packages/director/src/runtime/codex.ts`
- `packages/director/test/runtime.test.mjs`
- `packages/director/test/runtime-fixture.mjs`
- `apps/server/src/application/director-supervisor.ts`
- `apps/server/src/application/director-turn-view.ts`
- `apps/server/src/application/film-planning-guidance.ts`
- `apps/server/src/index.ts`
- `apps/server/test/director-supervisor.test.mjs`
- `apps/web/src/next/model/types.ts`
- `apps/web/src/next/model/director.ts`
- `apps/web/src/next/director/Thread.tsx`
- `apps/web/src/next/i18n/catalog/director.ts`
- `apps/web/test/next/director-model.test.mjs`
- `docs/implementation/LOCAL-SETUP.md`

Added:

- `apps/server/src/application/director-run-config.ts`
- `apps/server/test/director-run-config.test.mjs`
- `docs/ai/uiux-plan/codex/reports/B22-live-blockers.md`

### E — subscription pricing

Changed:

- `packages/core/src/studio-api.ts`
- `apps/server/src/generation-quotes.ts`
- `apps/server/test/generation-overview.test.mjs`
- `apps/web/src/next/model/price.ts`
- `apps/web/src/next/model/keyframes.ts`
- `apps/web/src/next/model/inspector.ts`
- `apps/web/src/next/model/note-banner.ts`
- `apps/web/src/next/model/plan-edit.ts`
- `apps/web/src/next/model/settings.ts`
- `apps/web/src/next/i18n/catalog/keyframes.ts`
- `apps/web/src/next/i18n/catalog/notes.ts`
- `apps/web/src/next/i18n/catalog/settings.ts`
- `apps/web/src/next/i18n/catalog/plan.ts`
- `apps/web/test/next/settings-models.test.mjs`
- `apps/web/test/next/plan-edit.test.mjs`

Added:

- `apps/web/test/next/subscription-prices.test.mjs`

## Tests

**40 node regression cases added**: 4 request-fence, 11 first-film/pricing, 15 Codex setup, and 10 Director progress/timeout (the forwarding test is in `local-director.test.mjs`). Three existing behavioral expectations were rewritten: bundled-binary priority now tests image-worker priority, Settings Codex pricing now expects subscription wording, and a proposal rejection now exposes its alongside freshness identity while preserving unchanged creative state and exact replay. One server quote test title was corrected; its per-call protections remain. No tests deleted, disabled or skipped by this card.

The existing quarantine inspection fixture was updated to implement the new version-only `inspectSettings` method; its existing case now asserts the safe response too. All database, upload, provider and exact route/method read-only assertions are retained. The first integrated suite exposed this fixture-interface mismatch and the replaced proposal identity expectation; their targeted corrections passed **8/8** and **41/41**, respectively.

Browser additions: `next-keyframes-live-plan-edit-undo` and `next-start-first-run-setup-refusal`; authored and syntax checked, not run.

Verification used Node **24.15.0**, pnpm **10.33.0**, FFmpeg/ffprobe **8.1.1**. `pnpm setup:test-media` and `pnpm check:toolchain` passed using the existing matching tools, without downloading anything.

| Final check | Actual result |
| --- | --- |
| `pnpm build` | All five workspace builds passed; Vite retains its non-failing large-chunk advisory |
| `node scripts/run-tests.mjs <all 19 touched test files>` | **309 passed**, zero failed/skipped/cancelled/todo |
| `node scripts/run-tests.mjs apps/web/test/*.test.mjs apps/web/test/next/*.test.mjs` | **801 passed**, zero failed/skipped/cancelled/todo |
| `pnpm test` | **3,271 passed, zero failed/cancelled/todo, 1 optional native-probe skip (3,272 total)**; 228.986 s |
| `pnpm -r typecheck` | All **five** package/app typechecks passed |
| `node --check` on both changed browser scenarios | Both passed; neither browser scenario executed |
| `node --check` on both changed native protocol fixtures | Both passed |
| Report/source inventory and whitespace inspection, without Git | All **67** listed files exist; **60 changed**, **7 added**, zero deleted; no trailing whitespace |

The first full run returned **3,269 passed, 2 failed, 1 optional native-probe skip (3,272 total)**. Its only failures were the proposal identity expectation and handwritten quarantine Settings fixture described above; both have been corrected before the final rerun.

Earlier failures were fixed: the new bilingual test used `zh` instead of the actual `zh-CN` locale; a concurrency-test cleanup could hang when an assertion failed; TypeScript's current library target required an array-filter equivalent instead of `findLast`. Independent review also corrected historical proposal wording, no-op effect counts and overlapping progress. No remaining must-fix finding was reported by the independent reviews.

## Contract changes

`packages/core/src/studio-api.ts`: added optional `PriceQuote.subscription?: "codex"`; clarified that `priceUnknown` denotes missing **per-call** pricing. No command authority, idempotency or quote-number field changed.

Other additive response metadata: setup/Settings exposes an allowlisted `codexDiagnostic`; setup readiness includes parsed expected/found `binaryVersion`; project turn views include safe optional `activity` phase/state/timestamp metadata. The existing web-local Settings and turn types describe these additions. No arbitrary native stdout, configuration, credentials, tool arguments or reasoning text is exposed.

## Commits

No commits made. Proposed split, with complete file lists defined under Files above:

1. `fix(server): align generation request fences after Plan undo` — all five files in A.
2. `fix(director): select pinned Codex and explain version mismatches` — all nineteen files in C, excluding only the D deadline hunks in the two shared files.
3. `fix(web): retain first-film setup failure recovery` — all seven files in B; this follows the structured error support in C.
4. `fix(director): report long-turn progress and retained timeout effects` — all twenty files in D, plus the D deadline hunks in `apps/server/src/application/local-director.ts` and `apps/server/test/local-director.test.mjs`.
5. `fix(studio): identify Codex subscription generation prices` — all sixteen files in E.

The detailed report may be kept with the final pricing commit or as `docs(ai): record B22 verification and native-stall limits` with its one report file.

## Open issues

- **B22.4 exact native stall cause remains unresolved.** The supplied data proves fast completed application work followed by native silence; it contains no native trace of the remaining interval. New metadata and small-step guidance are fake-tested mitigations. A bounded native follow-up by the lead is needed before claiming the original three-shot planning failure is fixed. Do not blindly retry an unknown prior turn.
- Lead must run both authored browser scenarios outside this sandbox and inspect rendered progress, Settings diagnosis, first-film recovery, and billing wording. No new browser or real-provider acceptance is claimed.
- The three saved-effect counters cover confirmed Plan apply receipts, notes and change proposals, not every narration draft/audio suggestion. Timeout text explicitly limits its claim and directs the person to inspect other saved work.
- The new deadline is trusted host configuration; no default increase was inferred from one failed run. Supporting other native versions still requires new compatibility evidence.
- No live model/media/provider call, external-network request, credential read, production-state mutation/restart or port 3001 listener was performed. The expressly permitted retained LIVE-1 directory was read for diagnosis only. `docs/implementation/STATUS.md` was not edited.
- Process exception: the initial batched discovery invoked **one read-only `git status --short` before RULES was read**. After reading the no-Git card rules, no further Git command was run. No commit, stash, checkout, reset or push occurred.
