# B21 final review fixes

## Done

- **B21-1 — Failed note regeneration:** primary and retained-replacement failures say “Regeneration failed for …” in English and Chinese. Director notes, Keyframes callouts and Plan chips reserve completed checks for returned frames. Failed resolved notes remain reachable with a priced regeneration choice; a fresh human request preserves the original immutable note resolution and does not attempt a second resolution. Non-executable resolved choices stay disabled. Unknown outcomes, active work, missing estimates and pending technical retries still prevent a new purchase. A shared retry predicate also closes the retained-replacement eligibility discrepancy in Inspector and the fixture transport.
- **B21-2 — Failed narration:** the scene check row names the affected shot or shots, including short lines with no length warning. Unknown-outcome attention retains priority. Failures in another scene do not affect the current scene’s row.
- **B21-3 — Passive input waits:** `input_pending` is a dependency wait rather than evidence of execution, including when retry metadata remains. A clip or retained clip replacement waiting for its keyframe permits the Inspector and note’s normally priced repair. Fixture generation accepts that same repair. Running work, uncertain/unclassified outcomes and actual automatic retries remain guarded. The lead’s Stop predicate is unchanged: an input wait alone supplies no Stop, while making its input does.
- **B21-4 — Recording subtitle refusal:** a refused subtitle pre-save passes the localized server-code reason into the recording panel’s existing refused phase. No upload follows a failed pre-save. Internal success and rollback feedback remain quiet. The transient refusal callback is excluded from persisted request bodies/feedback and fenced to the originating film and editor revision.
- **B21-5 — Inspector focus:** after a refit and when the focus listener is installed, the existing focused unit is scrolled wholly into view. Display-contents rows and scrolling actions with their price note stay together; already pinned actions do not scroll the rows. Focus itself is unchanged.
- **B21-6 — Film fitting:** lane-size changes, chip content/forms, relevant element styles and explicit language changes drive fitting. Style subscriptions name exact chips, their contents and ancestors; the playhead has no style subscription. Dynamic lane/chip insertion/removal updates observer targets, and cleanup disconnects all observers.

## Files

Changed application files (all under `apps/web/src/next/`):

- `director/NoteCards.tsx` (comment only)
- `director/director.css`
- `fixtures/fixture-commands.ts`
- `i18n/catalog/keyframes.ts`
- `i18n/catalog/notes.ts`
- `keyframes/CheckBanner.tsx` (comment only)
- `keyframes/NarrationPanel.tsx`
- `keyframes/useInspectorFit.ts`
- `model/director.ts`
- `model/inspector.ts`
- `model/keyframes.ts`
- `model/media-state.ts`
- `model/note-banner.ts`
- `model/note-command.ts`
- `model/notes.ts`
- `model/plan.ts`
- `model/recording-words.ts`
- `store/store.ts`
- `views/film/Timeline.tsx`
- `views/film/layout-hooks.ts`

Changed existing tests (all under `apps/web/test/next/`):

- `film-model.test.mjs`
- `keyframes-fixture.test.mjs`
- `keyframes-state-truth.test.mjs`
- `plan-model.test.mjs`
- `recording-words.test.mjs`

Added tests (same directory):

- `keyframe-repair.test.mjs`
- `layout-hooks.test.mjs`
- `note-failure.test.mjs`

Changed browser scenario: `scripts/browser/next-shell.mjs`. Added this report. No files deleted. `docs/implementation/STATUS.md` and `packages/core/src/studio-api.ts` are byte-for-byte unchanged from the starting snapshot.

## Tests

**24 tests added; 3 obsolete expectations rewritten; none deleted, disabled or skipped by this change.**

Additions: ten note-failure cases, four keyframe-repair cases, four actual-hook layout cases, four recording subtitle cases and two fixture-generation cases. They cover failure feedback and completion checks, resolved-note retry history, unknown/active/automatic-retry protection, missing/failed inputs and retained replacements, refusal ownership and quiet success, dynamic observers/language/cleanup and focused whole-unit visibility.

The three rewrites remove `input_pending` from B20’s execution-wait list, change Film’s input-wait making flag from true to false, and change Plan’s input-wait tone from busy to plain. Their old expectations conflict with B21-3; the tests and all other integrity checks remain.

Failing-first evidence:

- B21-1/2: the initial eight new note tests failed on the original source (0 passed / 8 failed), reproducing false “regenerated” labels, absent recovery choices, a refused repeat resolution and missing failed-narration attention. The additional Plan-chip and automatic-retry tests each failed before their fixes.
- B21-3: the passive-input repair test failed before changing execution classification; further tests reproduced input waits with retry metadata and fixture `ATTEMPT_EXISTS` refusal. Follow-up shared-guard tests reproduced an enabled retained-frame repurchase in Inspector and an accepted fixture repurchase (29 passed / 2 failed before that fix).
- B21-4: after the initial dependency build, the original recording behavior returned no refusal callback instead of `error.VALIDATION_ERROR` (9 passed / 1 failed). The 16,001-character subtitle case now returns the reason, preserves quiet feedback and makes no upload or automatic retry.
- B21-5/6: all four actual-hook tests failed before source changes (0 passed / 4 failed). Existing focused rows/actions failed to scroll (0 instead of 90/160 px), and sixty playhead style mutations caused 61 measurements instead of the initial one. The final test harness also asserts that playhead styles are not subscribed at all.

Final verification, in the required order:

1. Node **24.15.0**, pnpm **10.33.0**, FFmpeg/ffprobe **8.1.1** matched the pinned profiles. `pnpm setup:test-media` and `pnpm check:toolchain` passed with existing tools and no download.
2. `pnpm build`: all five package/application builds passed. Vite retains its chunk-size advisory.
3. `node scripts/run-tests.mjs` with the eight changed/added unit-test files above: **104 passed, 0 failed/cancelled/skipped/todo**.
4. `node scripts/run-tests.mjs apps/web/test/*.test.mjs apps/web/test/next/*.test.mjs`: **787 passed, 0 failed/cancelled/skipped/todo**.
5. `pnpm test`: **3,231 passed, 0 failed/cancelled/todo, 1 optional native-probe skip (3,232 total)**. The skipped test is `opt-in native Codex probe never starts a model turn`.
6. `pnpm -r typecheck`: all **five** package/application typechecks passed, zero failures.
7. `node --check scripts/browser/next-shell.mjs`: passed. The bilingual Inspector scenario now checks existing focus after resizing and after closing Takes; it was not executed.

Final command logs are in `/tmp/openslate-b21-{build,touched,web,test,typecheck}.log`. Tests use disposable state, fake transports and synthetic media. No browser, real model/provider call, external-network request, credential read, production-state access/restart or port-3001 listener was used. Source/DOM-harness review does not establish rendered geometry or measured browser playback performance.

## Contract changes

None. New regeneration/retry state and the transient refusal callback are internal frontend types/helpers; no browser contract, server source, schema, catalog lock or skill package changed.

## Commits

No commits made. Proposed split; shared-file entries mean the corresponding hunks:

1. `fix(web): report failed generation and keep safe recovery available` — `model/{notes,note-banner,note-command,director,plan,keyframes,media-state,inspector}.ts`, `fixtures/fixture-commands.ts`, `director/{NoteCards.tsx,director.css}`, `keyframes/CheckBanner.tsx`, `i18n/catalog/{notes,keyframes}.ts`, `test/next/{note-failure,keyframe-repair,keyframes-fixture,keyframes-state-truth,film-model,plan-model}.test.mjs` (all paths under `apps/web/`, with application paths under `src/next/`).
2. `fix(web): surface recording subtitle save refusals` — `apps/web/src/next/{store/store.ts,model/recording-words.ts,keyframes/NarrationPanel.tsx}`; `apps/web/test/next/recording-words.test.mjs`.
3. `fix(web): preserve inspector focus and bound Film fitting` — `apps/web/src/next/keyframes/useInspectorFit.ts`, `apps/web/src/next/views/film/{layout-hooks.ts,Timeline.tsx}`, `apps/web/test/next/layout-hooks.test.mjs`, `scripts/browser/next-shell.mjs`, this report.

## Open issues

- No known outstanding must-fix source issue. Independent review caught the automatic-retry purchase guard gap; the fix and failing-first regressions are included. Cross-review of refusal ownership and the final layout observer/focus behavior found no further must-fix issue.
- The lead must run browser replay outside this sandbox. The updated scenario is syntax-checked only; actual resize/Takes focus behavior and playback performance remain unclaimed.
- Resolved-note recovery preserves server history: it creates a new priced generation request without changing or re-resolving the original note. Other resolved choices remain disabled when the server cannot execute them.
- Process exception: the initial inventory ran one read-only `git status --short` before the B21 card’s no-Git instruction was loaded. No Git command followed; no staging, commit, stash, checkout, reset or push occurred.
