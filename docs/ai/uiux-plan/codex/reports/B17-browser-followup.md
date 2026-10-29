# B17 browser follow-up

The lead reported **158/163 browser scenarios passing** in `codex/browser-failures-b17.md`. This follow-up classifies and addresses all five reported failures using their source, messages, saved screenshot and component code. No browser was launched or browser scenario executed here. Changes remain uncommitted under `codex/RULES.md`.

## Done

### 1. next-keyframes-parity-live-lost-reply-and-takes — (a), intended price label

Cause: the scenario required the exact old label `Regenerate keyframe`. B17 intentionally adds the selected shot's full quote to that purchase action; the reported label includes the expected `$0.0001` estimate. The action was enabled and found, so this is a stale text assertion, not a generation failure.

Change: read the selected shot's exact quote from the intercepted generation overview, require the complete priced label before and after generation, and assert every generation POST carries the quoted `expectedEstimateMicros`, image kind, regeneration flag and exact single-shot target. The existing three-press lost-reply flow still checks the same idempotency key, replayed request receipt and exactly one new take. Take selection and Undo remain covered, with an added assertion that they make no additional generation request.

File: `scripts/browser/next-keyframes-parity.mjs`.

### 2. next-keyframes-narrow — (a), intended inspector edit hold

Cause: the scenario opened the 2.3 narration editor and immediately selected Scene 3. B17 intentionally disables that selection until Save or Cancel, as the failure's explanatory title states.

Change: type an unsaved line, assert that Scene 3 is disabled with the exact reason, verify the words and selected shot remain intact, explicitly Cancel, then require the pill to become enabled before navigating. Original internal card-row scrolling, scene navigation, make-keyframe availability and no-sideways-scroll checks remain.

File: `scripts/browser/next-keyframes.mjs`.

### 3. next-narration-closed-while-sending — (a), intended card edit hold

Cause: the scenario used another shot card to unmount an active recording editor. The shared B17 inspector hold now correctly disables that card; bypassing the hold would lose the draft.

Change: retain the Escape-while-sending assertion and verify the other card's hold/reason. Navigate through the Plan workspace to exercise the original upload-unmount cancellation boundary, require the stopped/nothing-added toast, return to Keyframes and verify the draft remains held, then Cancel before selecting another shot. The final check still requires shot 2.2 to have no narration recording attached.

File: `scripts/browser/next-narration.mjs`.

### 4. next-shell-no-sideways-scroll — reported cause (a); related real defect (b) also fixed

Reported cause: the scenario used `link height <= 24px` as a proxy for overlap. The saved 1366px screenshot shows the newly priced link wrapping onto two lines within its picture. B17 explicitly allows full-price wrapping, so two lines alone are not a defect.

Scenario change: replace that proxy with required presence of both card and inspector purchases, actual picture/panel containment, full nonempty text-range containment, scroll-size visibility, badge/note-chip/caption nonoverlap and unobstructed hit-target checks. Controls are scrolled into view before measuring, so intentionally scrolling card rows are tested correctly. Keep all existing page/topbar/workspace horizontal overflow, desktop page-height, scene-status visibility and card-edge-mask assertions. Recheck scroll after measuring controls, and add priced-control checks at 390px in English and Chinese.

Related real defect: the same screenshot and inherited `.pill { white-space: nowrap }` reveal the inspector's longer paid-action label being clipped by `.insp { overflow: hidden }`. This is a B17 product regression, separate from the reported callout-height assertion. A scoped `.insp-actions .pill` rule now permits wrapping, bounds the action to its available width and keeps the complete quote visible. The new geometry checks cover that exact clipping boundary without increasing an arbitrary pixel threshold.

Files: `apps/web/src/next/keyframes/keyframes.css`, `scripts/browser/next-shell.mjs`.

### 5. next-start-first-run-demo — (b), real completion-toast regression

Cause: `StartView.demo` published its success toast before calling `openFilm`. B17's project-selection reducer intentionally clears the prior film's toast. `selectProject` dispatches that clear synchronously, so the demo was created and opened, but its own completion message vanished. Existing first-run unit tests covered creation/fill, not this navigation/toast sequence.

Change: the tested `showDemoFilm` helper initiates destination selection, opens Keyframes, then publishes success after destination reads finish and only if the same project/selection epoch remains selected. Start captures its originating film/epoch before awaiting demo creation, so an old completion cannot take navigation away from a newer selection. The browser scenario's exact success-message assertion remains unchanged.

Tests: five new unit cases cover a real first run, switching from an existing film with an old Undo toast, switching away during destination reads, a superseded Start origin and returning to the same demo under a newer epoch. The original behavior was extracted into the helper first: the initial focused run returned **22 passed / 3 failed**, reproducing the absent toast and a late view change. All five new regressions now pass, and existing creation, replay and refusal tests remain enabled.

Files: `apps/web/src/next/model/start-commands.ts`, `apps/web/src/next/views/start/StartView.tsx`, `apps/web/test/next/start-commands.test.mjs`.

## Files

Incremental follow-up edits, in addition to the existing B17 working tree:

- `scripts/browser/next-keyframes-parity.mjs`
- `scripts/browser/next-keyframes.mjs`
- `scripts/browser/next-narration.mjs`
- `scripts/browser/next-shell.mjs`
- `apps/web/src/next/keyframes/keyframes.css`
- `apps/web/src/next/model/start-commands.ts`
- `apps/web/src/next/views/start/StartView.tsx`
- `apps/web/test/next/start-commands.test.mjs`
- `docs/implementation/STATUS.md`
- `docs/ai/uiux-plan/codex/reports/B17-web-review-fixes.md` (follow-up link)
- `docs/ai/uiux-plan/codex/reports/B17-browser-followup.md` (added)

No file was deleted. The lead's supplied `codex/browser-failures-b17.md` is an input and is unchanged.

## Tests

Pinned **Node 24.15.0**, **pnpm 10.33.0**, **FFmpeg/ffprobe 8.1.1**. Setup/preflight passed with installed binaries, without a download.

Final ordered verification passed:

| Command | Result |
| --- | --- |
| `pnpm build` | All five package builds passed |
| `node scripts/run-tests.mjs apps/web/test/*.test.mjs apps/web/test/next/*.test.mjs` | **615 passed**, zero failures/cancelled/skipped/todo |
| `cd apps/web && pnpm typecheck` | Passed, zero errors |
| `pnpm test` | **3,052 passed**, zero failures/cancelled/todo, **one optional native-probe skip**; **3,053 total** |
| `pnpm -r typecheck` | All five packages passed, zero errors |
| `node --check` on the four changed browser modules | All four passed |
| `git diff --check` | Passed |

The full suite took **228,518 ms**. The skipped test was the existing `opt-in native Codex probe never starts a model turn`; no model turn was enabled. The existing nonblocking Vite chunk-size warning remains. All final command processes exited zero.

Five new demo/navigation regressions pass; the focused Start/new-film/store run passed **61/61**. Independent read-only review confirmed the toast-clear root cause, both navigation fences, DOM selectors and preservation of the original money/cancellation checks; its nonempty-geometry-loop concern was fixed before the final syntax check.

Logs: `/tmp/b17-browser-{build,web-tests,web-typecheck,full-test,typecheck}.log`, `/tmp/b17-browser-start-{red,green}.log`. No browser pass count is claimed beyond the lead's supplied 158/163 baseline.

Five unit tests were added; four browser scenario modules were strengthened. No unit tests were deleted or disabled. The first three browser scenarios were intentionally rewritten for B17 behavior, retaining their original money, data-preservation and cancellation protections. No synthetic unit geometry check is presented as proof of rendered layout.

## Contract changes

None. No browser-facing type, server source, schema, frozen tool catalog or skill package changed.

## Commits

No commit, stash, checkout or reset was run. Proposed follow-up groups for the lead, on top of the existing B17 work:

1. `test(browser): align B17 prices and inspector edit holds`
   - `scripts/browser/next-keyframes-parity.mjs`
   - `scripts/browser/next-keyframes.mjs`
   - `scripts/browser/next-narration.mjs`
2. `fix(web): keep priced review actions readable`
   - `apps/web/src/next/keyframes/keyframes.css`
   - `scripts/browser/next-shell.mjs`
3. `fix(web): publish demo completion after destination selection`
   - `apps/web/src/next/model/start-commands.ts`
   - `apps/web/src/next/views/start/StartView.tsx`
   - `apps/web/test/next/start-commands.test.mjs`
4. `docs: record B17 browser follow-up verification`
   - `docs/implementation/STATUS.md`
   - `docs/ai/uiux-plan/codex/reports/B17-web-review-fixes.md`
   - `docs/ai/uiux-plan/codex/reports/B17-browser-followup.md`

## Open issues

- The lead must rerun browser checks outside the sandbox, including updated desktop/390px English/Chinese geometry. Source reasoning, a saved screenshot, syntax checks and unit tests do not establish new rendered-browser acceptance.
- Decision: preserve the B17 inspector hold and full visible prices. Update scenarios to use explicit Save/Cancel or permitted workspace navigation, rather than removing those protections.
- Decision: the callout's line count is not a correctness criterion; actual visibility, containment, nonoverlap and usable hit targets are.
- No questions or unavailable credentials were needed. No real provider/model call, external network request, credential read, production-state access/restart or port 3001 listener occurred. Changes remain uncommitted for lead review.
