# B15 backend review fixes

Implemented against `cx/b15` on October 15, 2026. This report follows `codex/RULES.md`; all changes remain uncommitted for lead review. No browser source, browser contract, schema migration, frozen tool catalog or skill package changed.

## Done

| Finding | Implemented behavior | Regression coverage |
| --- | --- | --- |
| B15.1 | Stop settles positively unsent preparations as obsolete, releases their reservation and detaches them. Admission, prepared transcription, direct transcription and speech recheck the candidate fence before first dispatch. Possibly submitted jobs retain their liability and reconciliation. | Deferred unsent preparation; Stop during upload before the marker; Stop after dispatch; first-admission, speech and direct-transcription marker fences. |
| B15.2 | Undo reconnects an exact submitted live/succeeded candidate by node, spec and resolved input identity. Completed outputs are verified and restored. A candidate fence permits result reconciliation while preventing any retry. | Running video across Undo/restart; completion during the edit; later technical failure cannot retry. Failed/known-unsent preparations are excluded. |
| B15.3 | Retained ready outputs expose the queued/running/failed/no-answer replacement separately, with attempt identity, phase and failure. Unknown replacements supply the scene blocker and can be released without hiding the retained output. | Queued/running/unknown replacement, release, retained artifact and failure details. |
| B15.4 | Human edits record project Brief, Story, narration script and narration source. Director publication checks the earliest captured cursor, including later reads and ABA edits. | Actual alongside treatment edits, narration script/source and original-cursor/ABA refusal. |
| B15.5 | One accepted within-shot narration duration validator runs for storyboard, shared prepared publication/proposal acceptance and canonical narration publication. Stale-version refusal keeps its existing priority. | Proposal and direct shared publication cannot shorten below accepted narration; atomic refusal. Existing storyboard and narration suites remain. |
| B15.6 | Accepted narration proposals capture cue identity/digest plus exact pending/timing/fit presence and values. Undo restores those only when untouched, preserving later acceptance, fit changes, ABA edits and changed detached cues. Historical narration fields without snapshots are left alone. | Generated/none narration inverse, absent flags, later accepted audio, pending ABA, detached original cue edits and legacy selective inverse. |
| B15.7 | Runner materialization keeps the authored shot voice tag while pinning the effective stock/personal selector in the narration segment and paid command. Generated-recording validation accepts the same bounded personal selector supported by the transport, retaining all lineage checks. | Personal project default with authored stock tag through both keyframe and video confirmation, restart between publication and dispatch, and refusal of forged personal recording identity. |
| B15.8 | Admission and overview share effective automatic retry eligibility. Confirmations and Stop-fenced candidates report failed with zero retries; scenes leave making_video. | Failed confirmed video, Stop-fenced technical failure after Continue and no extra attempt. |
| B15.9 | Released speech attempts do not supply current narration status or no-answer blockers; immutable job and charged reservation remain. | Unknown voice release clears the blocker and admits a new explicit confirmation without an automatic dispatch. |
| B15.10 | Owned/shared conditioning-source histories without a dedicated switchable shot binding report selectable false; use refuses atomically with TAKE_NOT_SELECTABLE. Normal take switching remains available. | Owned/shared conditioning source refusals and positive selectable take switching. |

## Verification

The pinned toolchain is Node **24.15.0**, pnpm **10.33.0**, FFmpeg/ffprobe **8.1.1**. `pnpm check:toolchain` and `pnpm setup:test-media` passed using installed binaries; no download occurred.

Before source fixes, reproducing runs reported:

- Execution/speech/preparation: **69 passed, 4 failed**. New direct-transcription and post-dispatch integrity cases were then added.
- Takes/Undo: **15 passed, 5 failed**.
- Proposals/publication: **23 passed, 7 failed**; the additional detached-cue regression also failed before its guard.
- Overview/confirmations: **43 passed, 6 failed**. Stop projection coverage was then added.
- Initial build failed because the existing updated `ShotTakes` contract required the missing `selectable` projection; B15.10 fixes it.

Final required checks, in order:

1. `pnpm build` — passed.
2. `node scripts/run-tests.mjs apps/server/test/director-proposals.test.mjs apps/server/test/execution.test.mjs apps/server/test/generation-overview.test.mjs apps/server/test/openai-speech-execution.test.mjs apps/server/test/openai-transcription-execution.test.mjs apps/server/test/scene-confirmations.test.mjs apps/server/test/takes-undo.test.mjs apps/server/test/transcription-preparation-engine.test.mjs` — **205 passed, zero failures/skips/todo**, eight files.
3. `pnpm test` — **3,054 passed, zero failures, one optional native-probe skip, zero todo; 3,055 total**. Includes the normal full rebuild. Duration: 276,496 ms.
4. `pnpm -r typecheck` — **all five packages passed**, zero errors.
5. `git diff --check` — passed.

The touched files contain **30 added regression cases**. No test was deleted or rewritten to remove an existing behavior check. Existing test fixtures/assertions were extended where needed.

Independent read-only review covered Stop/Undo reconnection, publication/field fences/narration restoration, replacement projection and personal recording provenance; no outstanding must-fix finding remains.

Tests use disposable local stores, fake providers, synthetic audio and stubbed transports. No real provider/model call, external network request, credential read, production-state access/restart or port 3001 listener occurred. No existing test was deleted or had its behavior protections relaxed; existing fixture helpers/assertions were extended for the new cases.

## Files

Changed source:

- `apps/server/src/application/director-proposals.ts`
- `apps/server/src/application/human-fields.ts`
- `apps/server/src/application/service.ts`
- `apps/server/src/execution/audio-execution-authority.ts`
- `apps/server/src/execution/engine.ts`
- `apps/server/src/execution/transcription-execution-authority.ts`
- `apps/server/src/execution/transcription-preparation.ts`
- `apps/server/src/generation-overview.ts`
- `apps/server/src/narration/canonical.ts`
- `apps/server/src/narration/generated-audio.ts`
- `apps/server/src/narration/shot-audio-routes.ts`
- `apps/server/src/scene-confirmations.ts`
- `apps/server/src/shot-takes.ts`
- `apps/server/src/storyboard-history.ts`
- `apps/server/src/storyboard.ts`

Added source:

- `apps/server/src/application/publication-validation.ts`
- `apps/server/src/execution/retry-eligibility.ts`

Changed tests:

- `apps/server/test/director-proposals.test.mjs`
- `apps/server/test/execution.test.mjs`
- `apps/server/test/generation-overview.test.mjs`
- `apps/server/test/openai-speech-execution.test.mjs`
- `apps/server/test/openai-transcription-execution.test.mjs`
- `apps/server/test/scene-confirmations.test.mjs`
- `apps/server/test/takes-undo.test.mjs`
- `apps/server/test/transcription-preparation-engine.test.mjs`

Documentation: this report (added) and `docs/implementation/STATUS.md` (updated after final checks). Deleted files: none.

## Contract changes

None. Implements the already supplied `MediaSlot.replacement` and `ShotTakes.keyframes[].selectable` shapes in `packages/core/src/studio-api.ts` without editing that file.

## Proposed commits

No git commit/stash/checkout/reset was run. Proposed conventional split for the lead:

1. `fix(execution): fence stopped preparations and share retry eligibility`
   - `execution/engine.ts`, `execution/retry-eligibility.ts`, `execution/audio-execution-authority.ts`, `execution/transcription-execution-authority.ts`, `execution/transcription-preparation.ts` under `apps/server/src/`.
   - `execution.test.mjs`, `openai-speech-execution.test.mjs`, `openai-transcription-execution.test.mjs`, `transcription-preparation-engine.test.mjs` under `apps/server/test/`.
2. `fix(server): preserve paid candidates through undo and mark selectable takes`
   - `apps/server/src/storyboard-history.ts`, `apps/server/src/shot-takes.ts`, `apps/server/test/takes-undo.test.mjs`.
3. `fix(application): fence project fields and preserve narration proposal state`
   - `application/human-fields.ts`, `application/publication-validation.ts`, `application/service.ts`, `application/director-proposals.ts`, `storyboard.ts`, `narration/canonical.ts` under `apps/server/src/`.
   - `apps/server/test/director-proposals.test.mjs`.
4. `fix(server): expose replacements and preserve personal voice confirmations`
   - `generation-overview.ts`, `scene-confirmations.ts`, `narration/shot-audio-routes.ts`, `narration/generated-audio.ts` under `apps/server/src/`.
   - `apps/server/test/generation-overview.test.mjs`, `apps/server/test/scene-confirmations.test.mjs`.
   - `docs/implementation/STATUS.md`, `docs/ai/uiux-plan/codex/reports/B15-review-fixes.md`.

## Open issues

- No questions required. The card's no-commit and no-external-network rules govern this worktree.
- Unsupported conditioning takes remain visible but disabled, as the card permits; this change does not create new dedicated shot image operations or rebind shared sources.
- Undo reuses the existing candidate_stop entity with reason undo_reconnect. It restores publication/reconciliation identity and never grants first-dispatch or retry authority.
- Stop uses the existing PREPARATION_OBSOLETE settlement shape so stored preparation/backup integrity validators continue to recognize it; the event separately records stopped_before_dispatch.
- Personal recording provenance remains readable historically without rechecking current consent; new synthesis still checks registered consent before dispatch.
- Proposal narration snapshots apply to newly accepted proposals. Undo leaves narration fields in older accepted records without snapshots alone and reports leftAlone; independent fields remain undoable. No missing historical state is invented.
- Independent review observed an existing adjacent display issue: capacity-ahead counts include released jobs although executor admission excludes them. It is outside the ten findings; no capacity behavior was changed.
- Real-provider quality and live UI rendering are outside this fake-only backend card.
