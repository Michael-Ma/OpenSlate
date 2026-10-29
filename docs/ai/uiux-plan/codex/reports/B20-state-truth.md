# B20 — truthful waits, own recordings and restart state

## Done

- **B20.1 — waiting clips.** Only an explicit human-review wait maps to `review`. Non-voice `INPUT_PENDING` maps to `input_pending`; absent or unrecognized waits map to `unknown`, even when narration is pending. Retained current takes carry their replacement's wait reason. Scene `making_video` requires a running attempt, a proven automatic retry, or a recognized execution queue whose current video recipe is approved/pending. Human review, human narration timing, stopped and unclassified waits do not claim video is being made. Narration failure/unknown states also contribute to scene attention. Reads remain read-only.
- Shared pure web queue/copy helpers keep Keyframes, Film, export readiness and Plan consistent, with English and Chinese wording for the new waits. Presentation distinguishes known automatic work from passive waits; mutation guards continue to protect bound queues, unknown outcomes and retained replacements. Stop still counts bound unsent jobs it can detach, including review and unclassified queues; that count is separate from whether work is being made. Resolved Director notes no longer call an unclassified or unanswered regeneration finished.
- **B20.2 — own narration writes.** A recording upload advances the retained narration draft's baseline to the immutable receipt's saved text/head, including the server's uncaptioned-recording text. An upload owner token and project epoch preserve newer typing, later external conflicts, Cancel/reopen and film-switch fencing. Recording words/rollback, voice/mode and both fit choices were audited and covered. Lost replies reconcile only the captured original path/key; expiry cannot silently create a fresh request. A definitely stale replay can become fresh only with its original editor, coherent unchanged saved inputs and already-saved local subtitle words. Fixture and live recording scenarios assert no edit-conflict alert after Add recording.
- **B20.3 — restarts.** Scene checks and the video panel name unanswered work and its possible arrival/charge. This replaces the green all-clear row and the opened-frame headline/confirm offer while any current scene outcome is unknown, including narration and retained replacements. Current slot evidence and server blockers both protect against older aggregates/targets. Dismissing the restart strip does not remove the scene explanation. An explicit release or answered outcome restores the usual decision. Unrelated targeted shot generation remains available. The restart scenario asserts no scene generate/confirm POST across reload, navigation and dismiss.

## Files

Changed (28):

- `packages/core/src/studio-api.ts`
- `apps/server/src/generation-overview.ts`
- `apps/server/test/generation-overview.test.mjs`
- `apps/web/src/next/keyframes/CheckBanner.tsx`
- `apps/web/src/next/keyframes/KeyframesView.tsx`
- `apps/web/src/next/keyframes/NarrationPanel.tsx`
- `apps/web/src/next/model/director.ts`
- `apps/web/src/next/model/film.ts`
- `apps/web/src/next/model/film-export.ts`
- `apps/web/src/next/model/inspector.ts`
- `apps/web/src/next/model/keyframes.ts`
- `apps/web/src/next/model/keyframes-takes.ts`
- `apps/web/src/next/model/narration-recording.ts`
- `apps/web/src/next/model/note-banner.ts`
- `apps/web/src/next/model/notes.ts`
- `apps/web/src/next/model/plan.ts`
- `apps/web/src/next/model/shell-states.ts`
- `apps/web/src/next/store/state.ts`
- `apps/web/src/next/i18n/catalog/keyframes.ts`
- `apps/web/src/next/i18n/catalog/notes.ts`
- `apps/web/test/next/film-model.test.mjs`
- `apps/web/test/next/keyframes-model.test.mjs`
- `apps/web/test/next/keyframes-notes.test.mjs`
- `apps/web/test/next/notes-model.test.mjs`
- `apps/web/test/next/plan-model.test.mjs`
- `apps/web/test/next/shell-states.test.mjs`
- `scripts/browser/next-narration.mjs`
- `scripts/browser/next-shell.mjs`

Added (4):

- `apps/web/src/next/model/media-state.ts`
- `apps/web/test/next/keyframes-state-truth.test.mjs`
- `apps/web/test/next/narration-own-writes.test.mjs`
- `docs/ai/uiux-plan/codex/reports/B20-state-truth.md`

Deleted: none. No CSS, schema, frozen provider/model catalog, skill package or implementation-status document changed. The input card remains untouched.

## Tests

**39 added:** six server overview tests, four Film/Plan/Stop tests, eleven keyframe/restart/guard/note tests and eighteen narration own-write/reconciliation tests. Two existing server tests gained assertions for truthful review scene state and narration attention.

**Four existing tests rewritten:**

- `keyframes-model.test.mjs` (two): an unknown outcome now keeps attention beside active work; a queued replacement without a known wait is neutral rather than evidence of activity.
- `keyframes-notes.test.mjs` (one): an unclassified queue still disables its purchase link, with neutral status wording instead of claiming the clip is being made.
- `notes-model.test.mjs` (one): its intended automatic replacement queue now supplies explicit capacity evidence; new regressions separately cover missing/unknown waits and unanswered outcomes.

None deleted, disabled or newly skipped. The recording regressions were written before their implementation. Initial dependency loading required a package build; later exact-replay regressions were observed failing before their fixes. An interim web run found the obsolete note expectations and premature completed-note summary, both resolved. An interim typecheck caught a nullable draft argument, resolved before final checks.

Pinned Node **24.15.0**, pnpm **10.33.0**, FFmpeg/ffprobe **8.1.1** and required encoders passed `pnpm check:toolchain` and `pnpm setup:test-media` without download.

Final checks, in required order:

1. `pnpm build`: all five package/app builds passed; Vite retains its bundle-size advisory.
2. `node scripts/run-tests.mjs` with all nine touched test files: **147 passed**, zero failures/cancelled/skips/todo.
3. `node scripts/run-tests.mjs apps/web/test/*.test.mjs apps/web/test/next/*.test.mjs`: **744 passed**, zero failures/cancelled/skips/todo.
4. `pnpm test`: **3,188 passed**, zero failures/cancelled/todo and **one optional native Codex probe skip (3,189 total)**.
5. `pnpm -r typecheck`: all **five** package/app typechecks passed, zero failures.
6. `node --check scripts/browser/next-narration.mjs` and `node --check scripts/browser/next-shell.mjs`: both passed. These check syntax only.

A filesystem-only check of all 32 B20 files found zero trailing-whitespace or merge-marker errors. No Git diff command was used. Independent review found no outstanding must-fix issue.

Checks use fake transports/providers, disposable databases and synthetic media. The unanswered-clip server regression observes the fake provider's accepted count and attempt count remaining unchanged after a refused fresh scene confirm. No real provider/model call, external-network request, credential read, production-state access/restart or port 3001 listener was performed. No browser was launched.

## Contract changes

`packages/core/src/studio-api.ts` adds:

- `WaitingCode`: `input_pending` and `unknown`. `unknown` describes an unclassified unsent wait, distinct from a provider submission's `no_answer` outcome.
- Optional `MediaSlot.replacement.waiting?: WaitingReason`, so retained current output does not erase a replacement's queue evidence.

No route or schema changes. No recording-receipt extension was needed: its existing saved shot/text/head evidence supplies the baseline.

## Commits

No commits made. Proposed split for the lead:

1. `fix(server): distinguish execution waits from human video confirmation`
   - `packages/core/src/studio-api.ts`
   - `apps/server/src/generation-overview.ts`
   - `apps/server/test/generation-overview.test.mjs`
2. `fix(web): keep unresolved generation state truthful and guarded`
   - `apps/web/src/next/model/{media-state,director,film,film-export,inspector,keyframes,keyframes-takes,note-banner,notes,plan,shell-states}.ts`
   - `apps/web/src/next/keyframes/{CheckBanner,KeyframesView}.tsx`
   - `apps/web/src/next/i18n/catalog/{keyframes,notes}.ts`
   - `apps/web/test/next/{film-model,keyframes-model,keyframes-notes,keyframes-state-truth,notes-model,plan-model,shell-states}.test.mjs`
   - `scripts/browser/next-shell.mjs`
3. `fix(web): rebase narration drafts after their own recording uploads`
   - `apps/web/src/next/keyframes/NarrationPanel.tsx`
   - `apps/web/src/next/model/narration-recording.ts`
   - `apps/web/src/next/store/state.ts`
   - `apps/web/test/next/narration-own-writes.test.mjs`
   - `scripts/browser/next-narration.mjs`
4. `docs(studio): record B20 state-truth verification`
   - `docs/ai/uiux-plan/codex/reports/B20-state-truth.md`

## Open issues

- Browser execution remains with the lead under RULES item 3; replay the recording-added and restart scenarios against disposable state. Syntax/unit results do not establish rendered acceptance or live-provider quality.
- No outstanding must-fix finding after independent source/test/scenario review. The conservative whole-scene unknown-outcome panel guard does not impose a new lock on unrelated individual-shot generation.
- Process exception: the first parallel inspection ran read-only `git status --short` before the card's stricter **No git** instruction was read. It reported only the supplied untracked B20 card. No later Git command or Git mutation was run. `STATUS.md` was read and not edited.
