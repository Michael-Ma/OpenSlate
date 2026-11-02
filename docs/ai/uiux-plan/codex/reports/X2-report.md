# X2 — web contract gaps

Verified October 27, 2026 in the assigned `cx/x2` worktree, based on `628ea53`.

## Done

- **X2.1 — released restart casualties:** the server excludes released attempts from `restartCasualties` for every job kind. This fixes voice lines and Director transcriptions as well as images/clips. A released job remains in attempt history, retains its reservation/liability and continues reconciliation. No execution, release, retry or late-result publication rule changed. Filtering this actionable list at its source is preferable to adding `ShotNarration.releasedAttemptIds`: a narration-only field cannot account for transcriptions with no shot slot.
- **X2.2 — hidden blocking jobs:** extracted `readGenerationJobBlockers` from the existing assertion. Both generation refusal and overview now use the same pending-job predicate, ordering, cap and release eligibility, including durable provider-completed evidence. Each scene exposes a live inventory across all of its shots, including older jobs obscured by a newer slot and detached jobs. Only `attemptId`, `shotId`, `kind`, `phase` and `action` enter the public summaries. The oldest 20 jobs are returned; the full count and truncation flag remain available, and remaining jobs refill the list after earlier ones settle.

The overview stays inside its existing read transaction and cursor cache. Reads publish no events, authority or provider calls; the existing release event invalidates the cache. Refusal error codes, prose, human acknowledgement, idempotency and recovery details remain unchanged. Historical Director refusal records remain immutable. No DDL, store entity kind or tool/skill catalog changed.

## Files

Changed:

- `apps/server/src/application/generation-blockers.ts` — shared blocker reader and existing throwing wrapper.
- `apps/server/src/generation-overview.ts` — released-casualty filter and per-scene live blocker projection.
- `packages/core/src/studio-api.ts` — three optional scene fields and clarified restart-list documentation.
- `apps/server/test/generation-overview.test.mjs` — released voice restart/reconciliation regression.
- `apps/server/test/director-transcription-outcomes.test.mjs` — released transcription restart/reconciliation regression.

Added:

- `apps/server/test/generation-overview-blockers.test.mjs` — six blocker projection regressions.
- `docs/ai/uiux-plan/codex/reports/X2-report.md` — this report and lead integration checklist.

Deleted: none. `apps/web/**` is unchanged.

## Tests

**Eight tests added; zero existing tests rewritten, deleted or disabled.**

| File | Added | Coverage |
| --- | ---: | --- |
| `generation-overview.test.mjs` | 1 | A restarted voice line leaves the strip on release, remains in history with reserved liability, is still polled once and is never resubmitted. |
| `director-transcription-outcomes.test.mjs` | 1 | The same lifecycle for a Director transcription with no shot slot; original generation-effect history remains unchanged. |
| `generation-overview-blockers.test.mjs` | 6 | Older hidden jobs, detached clips after edits, scene isolation, exact refusal parity, release and successful fresh human press, failure/success resolution, 20-job cap/refill, read-only/allowlisted projection and provider-completed unknown-phase jobs offering follow-only recovery. |

Before the source change, the two gap-1 files returned **33 passed / 2 failed / 0 skipped (35 total)**. Both added regressions failed because the released ID remained in `restartCasualties`. The new gap-2 file returned **0 passed / 6 failed / 0 skipped** against the pristine build, all on missing `blockedBy`. During after-change verification, two test setup issues were corrected: an unrelated scene was queued behind the fake model's capacity, and the voice lookup spy used the wrong argument shape. These corrections do not change product code or old assertions.

Pinned preflight passed with **Node 24.15.0**, **pnpm 10.33.0**, and **FFmpeg/ffprobe 8.1.1**. `pnpm setup:test-media` used installed tools without a download; `pnpm check:toolchain` passed.

Final checks, in card order:

1. `pnpm build` — **passed** (all five packages/apps). Vite reports its existing bundle-size advisory.
2. `node scripts/run-tests.mjs apps/server/test/generation-overview.test.mjs apps/server/test/director-transcription-outcomes.test.mjs apps/server/test/generation-overview-blockers.test.mjs` — **41 passed, 0 failed, 0 skipped/cancelled/todo**.
3. `pnpm test` — **4,201 passed, 0 failed, 1 skipped, 0 cancelled/todo (4,202 total)**. The sole skip is `opt-in native Codex probe never starts a model turn`.
4. `pnpm -r typecheck` — **all five packages/apps passed**, zero failures.
5. `git diff --check` — **passed**. Added files were also checked for whitespace.

All test provider responses, credentials and media are synthetic/injected or disposable. No real provider/model call, external-network request, personal credential read, forbidden state access, production restart, port-3001 listener or browser launch occurred. Browser acceptance belongs to the lead under the card rules.

## Contract changes

Additive optional fields on `SceneOverview` only:

```ts
blockedBy?: {
  attemptId: string;
  shotId: string;
  kind: "image" | "video";
  phase: string;
  action: "follow_existing_job" | "human_release";
}[];
blockedByTotal?: number;
blockedByTruncated?: boolean;
```

Current servers always emit these fields, including `[]`, `0`, `false` for an empty inventory. The list is ordered by attempt creation time, then ID, and capped by `GENERATION_BLOCKER_LIMIT` (20) per scene. No node IDs, paths, bodies, prompts, instructions, provider payloads or native prose enter it. `restartCasualties` retains its type and now means **unreleased** pre-start no-answer attempts. `ShotNarration` is unchanged.

## What the sample film and web must mirror

The lead owns these changes; no web source was edited for X2:

1. The initial sample overview in `apps/web/src/next/fixtures/last-ferry.ts` and new-film overviews in `fixtures/routes/start.ts` should emit `blockedBy: []`, `blockedByTotal: 0`, `blockedByTruncated: false` when there are no pending image/video attempts.
2. The mutable fixture transport (`fixture-commands.ts` and Director fixture flows) must update the live inventory on start, phase changes, replacement, detachment, release and terminal completion. A detached/older pending job stays in that inventory even when no current slot exposes it. Historical `DirectorGenerationBlock` records must stay unchanged.
3. Fixture release must remove the ID directly from `restartCasualties` for image, video, voice and transcription jobs. The last two must work without consulting `MediaSlot.releasedAttemptIds`. Retain released history and late-result/reconciliation semantics.
4. `model/generation-progress.ts` must resolve an attempt refusal from **current scene inventory**, rather than solely intersecting historical attempt IDs with current slots. New blockers and jobs beyond a historical cap must still keep the line unresolved. Use the current action: known-running and proven-completed/local-recovery jobs are follow-only; genuinely unknown submissions allow human release.
5. Missing optional fields mean **unknown**, not proof of resolution. A truncated list is incomplete: reread after settlement, and do not declare the scene clear merely because the displayed historical IDs disappeared. An inventory total of zero resolves attempt liabilities only; other generation prerequisites still apply.
6. Add sample/unit/browser scenarios for released voice and slotless transcription after restart; a detached video hidden by a changed recipe; an older job hidden behind the latest slot; more than 20 liabilities with refill; a provider-completed/local-recovery job; and unrelated/narrower shot scopes. Lead browser checks should verify that the strip clears on release and the refusal line stays current until the applicable liability is resolved.

## Commits

No commits, staging, checkout/reset or stash operations were performed. Proposed conventional commit split for the lead:

1. `fix(server): expose current generation recovery truth`
   - `apps/server/src/application/generation-blockers.ts`
   - `apps/server/src/generation-overview.ts`
   - `packages/core/src/studio-api.ts`
   - `apps/server/test/generation-overview.test.mjs`
   - `apps/server/test/director-transcription-outcomes.test.mjs`
   - `apps/server/test/generation-overview-blockers.test.mjs`
2. `docs(uiux): record X2 contract verification and fixture handoff`
   - `docs/ai/uiux-plan/codex/reports/X2-report.md`

## Open issues

- **Lead integration remains:** consume and mirror the new fields in the web/sample film, then run rendered browser acceptance outside this sandbox. This card explicitly reserves all `apps/web/**` edits and browser runs to the lead.
- **Scope decision:** `blockedBy` is a live inventory across the scene's shots, not a universal generation-availability flag. A nonzero scene total does not prove an unrelated subset command is blocked. Match `shotId` when the requested scope is known; an unmatched subset remains unknown while the list is truncated. Existing `DirectorGenerationBlock.shotIds` records the blocking jobs' shots and does not always reconstruct the entire original target scope. Exact historical subset-command availability would require a separate request-history contract change; X2 does not invent it.
- **Other guards remain:** an empty attempt inventory does not clear stopped/held/review prerequisites, and a queued candidate with no admitted attempt may still cause generic `ATTEMPT_EXISTS`. Only the shared pending-attempt refusal predicate is represented here.
- **Review:** self-review corrected the two test setup mistakes and tightened scope/absence/truncation contract documentation. Independent final source/test/caller review found no outstanding must-fix issue. No product-code change was needed after that review.
