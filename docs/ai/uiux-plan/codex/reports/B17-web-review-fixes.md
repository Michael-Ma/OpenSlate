# B17 web review fixes

Implemented on `cx/b17` on October 16, 2026, following `codex/RULES.md` and card B17. All fifteen findings in `review-web.md` are addressed. Source remains uncommitted for the lead. The fixed Last Ferry design and browser-facing contract remain unchanged.

The lead subsequently reported 158/163 browser scenarios passing. [Browser follow-up classification, fixes and verification](B17-browser-followup.md) records the five failures and supersedes the browser-handoff status below.

## Done

Paths in this table are relative to `apps/web/`; tests are under `test/next/` and import the actual `.ts` models/store, with fake transports and deferred replies.

| Finding | Regression tests | Fix and implementation files |
| --- | --- | --- |
| 1 | `keyframes-review.test.mjs`: each card purchase names its exact selected-shot total; `notes-command.test.mjs`: missing quotes cannot enable a purchase | `src/next/model/{price,note-banner,inspector}.ts` share the same integer-micros total. Card callout labels show their price independently of the banner, and `keyframes/keyframes.css` wraps them without price truncation. Inspector regeneration also shows its cost on the action. |
| 2 | `composer-draft.test.mjs`: same-film and background send preserve another tab's newer unsent draft; `review-store.test.mjs`: A→B→A message reply | `director/{composer-draft,useComposerDraft,Composer}.ts[x]` keep exact owned draft versions; removal compares only the version actually sent. Sending flags do not rewrite the shared cache. `store/store.ts` fences message completion by film and selection epoch. |
| 3 | `review-store.test.mjs`: opening-head refusal, explicit conflict choice, motion/duration field grouping, atomic motion save, retained editor across films and reconnect | `store/{state,reducer,store}.ts` capture the opening film/head, retain inspector drafts by film, and refuse stale writes while preserving text. `keyframes/Inspector.tsx` shows the current saved value with explicit Keep my text / Use saved text choices. Motion and duration use one original baseline and one `shotFields` command. Existing reconnect carries preserve baseline/seconds metadata; older carries without a baseline require explicit conflict review. |
| 4 | `displayed-baseline.test.mjs`; `plan-review-fixes.test.mjs`: mismatched projections, captured retry head, superseded completion; `film-gain.test.mjs`: delayed gain conflicts | `model/{displayed-baseline,plan-session,film-gain}.ts`, `views/film/{FilmView,Tools}.tsx`, `views/plan/{PlanView,commands}.ts[x]` bind commands to the actual displayed film/head/revision. Mixed projections cannot authorize edits. Delayed volume changes retain their opening baseline and require conflict resolution. |
| 5 | `settings-ownership.test.mjs`: opening digest/mode, reopened-form completion | `model/settings-director.ts`, `views/settings/{DirectorPanel,ModelsPanel}.tsx` retain the opening digest and setup mode; newer selections expose a conflict with explicit Keep / Use saved. A completed older form cannot rebase a freshly reopened form with an identical digest. |
| 6 | `settings-ownership.test.mjs`: per-film drafts, synchronous resource masking, absolute request identity, reselected-film epochs; `settings-voice.test.mjs`: fresh Undo baselines and stale-origin refusal | `model/settings-ownership.ts`, `store/useResource.ts`, `views/settings/{useRead,useProjectDraft,SettingsView,DirectorPanel,ModelsPanel,VoicePanel}.ts[x]` retain per-film forms above view mounts, hide another film's resource data before effects, and freeze command paths. Narrator Undo reads current voice and eligibility at one matching head rather than reusing the old save's head. |
| 7 | `plan-review-fixes.test.mjs`: Brief/shot/import drafts survive view/recovery/project remounts, isolated notifications | `model/plan-session.ts`, `views/plan/{usePlanSession,PlanView,ImportSheet}.ts[x]` own sessions above workspace mounts, by store and film. Returning to an editor rechecks conflicts with current saved values. |
| 8 | `keyframes-review.test.mjs`: prompt/motion/narration holds across cards, scene pills and focus; `notes-command.test.mjs`: note edit cannot replace a held draft | `store/reducer.ts` applies one edit hold to every selection/focus path. `keyframes/{ShotCards,SceneHeader,KeyframesView}.tsx` expose disabled controls and the existing localized reason. `model/note-command.ts` protects note editor entry too. |
| 9 | `review-store.test.mjs`: success/failure preserve newer typing, reverts, cancel/reopen, film switches, durable newer requests | `store/{state,reducer,store,press-keys}.ts` fence saves by film/epoch and monotonically increasing draft revision. Completion changes only its own draft. Request settlement compares the exact key and preserves newer/other-tab recovery entries. |
| 10 | `plan-conflict.test.mjs`: reverted original value and multiple post-submit field changes | `model/plan-conflict.ts` compares every field with the submitted snapshot, preserving reverts and allowing untouched fields to follow newer saved values. |
| 11 | `review-store.test.mjs`: heterogeneous multi-shot expected total; `keyframes-review.test.mjs`: exact/deduplicated sum | `model/price.ts` sums exact selected quotes with BigInt; `store/store.ts` sends that same total. Missing quotes refuse dispatch; configured unknown prices remain explicit. |
| 12 | `review-import.test.mjs`: absolute upload origin, fresh original-film read, failed/wrong-film refresh; `review-store.test.mjs`: awaited preparation, async generic builder, newer preparation refusal, exact recovery-key settlement; `notes-command.test.mjs`: paid note continuation | `model/import-flight.ts`, `views/assets/{ImportSheet,upload}.ts[x]`, `store/{store,press-keys}.ts`, `model/note-command.ts`, `keyframes/useDirectorNotes.ts` freeze the origin through preparation/dispatch/reconciliation, fence screen updates, and turn failed reconciliation into a retryable refusal. A newer scene preparation cannot borrow the older displayed authorization. |
| 13 | `keyframes-review.test.mjs`: terminal failures (technical/nontechnical, charged/not charged), partial-scene make, unknown/speech/confirmation blockers | `model/{inspector,keyframes}.ts` distinguish automatic retry exhaustion from a fresh priced human request and prioritize missing frames in partial scenes. Unknown outcomes still require reconciliation. |
| 14 | `keyframes-review.test.mjs`: queued/running keyframe/video replacements, exposed narration work, released-attempt deduplication | `model/{director,shell-states}.ts` include replacement slots and narration work in Stop availability/counts. |
| 15 | `review-store.test.mjs`: late Director/proposal success, old read errors, A→B→A; resource-epoch regression above | `store/{state,reducer,store}.ts` carry film/selection identity on Director/proposal actions and reject superseded reads, errors, toasts and pending completions. |

## Tests

Pinned **Node 24.15.0**, **pnpm 10.33.0**, **FFmpeg/ffprobe 8.1.1**. `pnpm setup:test-media` and `pnpm check:toolchain` passed using installed binaries without a download.

| Check | Final result |
| --- | --- |
| `pnpm build` | All five package builds passed; final source rebuild passed |
| `node scripts/run-tests.mjs apps/web/test/*.test.mjs apps/web/test/next/*.test.mjs` | **610 passed**, zero failed/cancelled/skipped/todo |
| `cd apps/web && pnpm typecheck` | Passed, zero errors |
| `pnpm test` | **3,047 passed**, zero failed/cancelled/todo, **one optional native-probe skip**; **3,048 total** |
| `pnpm -r typecheck` | All five packages passed, zero errors |
| `git diff --check` | Passed |

The full suite took **230,027 ms** and included the final reconnect/cached-draft/gain regressions. The final source rebuild, complete web runner and package typechecks passed after the review follow-ups. The optional `opt-in native Codex probe never starts a model turn` remained skipped. The existing nonblocking Vite chunk-size warning remains.

Logs: `/tmp/b17-final-{build,web-tests,web-typecheck,test,typecheck}.log`; final source verification `/tmp/b17-final-source-{build,web-tests,web-typecheck,typecheck}.log`; targeted follow-up `/tmp/b17-final-review-tests.log`, `/tmp/b17-carry-green.log`. All final processes exited zero.

Independent review found and corrected background composer ownership, exact persistent-key settlement, reselected-film resource identity, motion/duration baseline renewal, failed import-refresh handling, delayed gain changes, narrator Undo and reopened Director form races. No outstanding must-fix finding remains. No browser launch/check, real provider/model call, external network request, credential read, production-state access/restart or port 3001 listener occurred.

Added **66 regression cases**. Tests-first development produced failing model/store tests before the corresponding fixes. The initial shared-store/composer run returned **6 passed / 9 failed**, the initial keyframe set **0 passed / 6 failed**, and extracted note continuations **0 passed / 4 failed**. New ownership/gain/Undo helpers initially failed because the test-required helper was absent; their assertions then exercise the actual helper used by the UI. The imported-path, newer-preparation, motion-form baseline and persistent-key reproductions failed with concrete wrong-path/value/write assertions. This evidence is separate from browser verification. Additional review regressions cover cancel/reopen ABA, motion/duration baseline renewal, delayed volume, narrator Undo, missing quote refusals, original-film reconciliation failures and persistent recovery-key races. All fixtures and requests are synthetic/offline; the upload test uses a fake XMLHttpRequest, not a browser.

Two existing assertions were rewritten because B17 replaces their behavior: `keyframes-notes.test.mjs` now expects the paid callout's price, and `keyframes-inspector.test.mjs` no longer infers a service refusal from exhausted automatic retries. No test was deleted or skipped to pass this card. Money, integrity, unknown-outcome and stale-write checks remain enabled.

## Contract changes

None. `packages/core/src/studio-api.ts` is unchanged. No server source, DDL/migration, frozen tool catalog or skill package changed.

## Files

Changed:

- `apps/web/src/next/app/NextApp.tsx`
- `apps/web/src/next/director/Composer.tsx`
- `apps/web/src/next/director/composer-draft.ts`
- `apps/web/src/next/director/useComposerDraft.ts`
- `apps/web/src/next/i18n/catalog/errors.ts`
- `apps/web/src/next/i18n/catalog/film.ts`
- `apps/web/src/next/i18n/catalog/keyframes.ts`
- `apps/web/src/next/i18n/catalog/notes.ts`
- `apps/web/src/next/i18n/catalog/settings.ts`
- `apps/web/src/next/keyframes/Inspector.tsx`
- `apps/web/src/next/keyframes/KeyframesView.tsx`
- `apps/web/src/next/keyframes/SceneHeader.tsx`
- `apps/web/src/next/keyframes/ShotCards.tsx`
- `apps/web/src/next/keyframes/keyframes.css`
- `apps/web/src/next/keyframes/useDirectorNotes.ts`
- `apps/web/src/next/model/director.ts`
- `apps/web/src/next/model/inspector.ts`
- `apps/web/src/next/model/keyframes.ts`
- `apps/web/src/next/model/note-banner.ts`
- `apps/web/src/next/model/plan-conflict.ts`
- `apps/web/src/next/model/price.ts`
- `apps/web/src/next/model/settings-director.ts`
- `apps/web/src/next/model/settings-voice.ts`
- `apps/web/src/next/model/shell-states.ts`
- `apps/web/src/next/store/press-keys.ts`
- `apps/web/src/next/store/reducer.ts`
- `apps/web/src/next/store/state.ts`
- `apps/web/src/next/store/store.ts`
- `apps/web/src/next/store/useResource.ts`
- `apps/web/src/next/views/assets/ImportSheet.tsx`
- `apps/web/src/next/views/assets/upload.ts`
- `apps/web/src/next/views/film/FilmView.tsx`
- `apps/web/src/next/views/film/Tools.tsx`
- `apps/web/src/next/views/plan/ImportSheet.tsx`
- `apps/web/src/next/views/plan/PlanView.tsx`
- `apps/web/src/next/views/plan/commands.ts`
- `apps/web/src/next/views/settings/DirectorPanel.tsx`
- `apps/web/src/next/views/settings/ModelsPanel.tsx`
- `apps/web/src/next/views/settings/SettingsView.tsx`
- `apps/web/src/next/views/settings/VoicePanel.tsx`
- `apps/web/src/next/views/settings/useRead.ts`
- `apps/web/test/next/composer-draft.test.mjs`
- `apps/web/test/next/keyframes-inspector.test.mjs`
- `apps/web/test/next/keyframes-notes.test.mjs`
- `apps/web/test/next/plan-conflict.test.mjs`
- `apps/web/test/next/settings-voice.test.mjs`
- `docs/implementation/STATUS.md`

Added:

- `apps/web/src/next/model/displayed-baseline.ts`
- `apps/web/src/next/model/film-gain.ts`
- `apps/web/src/next/model/import-flight.ts`
- `apps/web/src/next/model/note-command.ts`
- `apps/web/src/next/model/plan-session.ts`
- `apps/web/src/next/model/settings-ownership.ts`
- `apps/web/src/next/views/plan/usePlanSession.ts`
- `apps/web/src/next/views/settings/useProjectDraft.ts`
- `apps/web/test/next/displayed-baseline.test.mjs`
- `apps/web/test/next/film-gain.test.mjs`
- `apps/web/test/next/keyframes-review.test.mjs`
- `apps/web/test/next/notes-command.test.mjs`
- `apps/web/test/next/plan-review-fixes.test.mjs`
- `apps/web/test/next/review-import.test.mjs`
- `apps/web/test/next/review-store.test.mjs`
- `apps/web/test/next/settings-ownership.test.mjs`
- `docs/ai/uiux-plan/codex/reports/B17-web-review-fixes.md`

Deleted files: none. Generated build output and local logs are excluded from the source inventory.

## Commits

No commit, stash, checkout or reset was run. Proposed split for the lead:

1. `fix(web): repair film-bound drafts and paid review actions`
   - All `apps/web/` source and test files enumerated in Files above.
2. `docs: record B17 review fixes and verification`
   - `docs/ai/uiux-plan/codex/reports/B17-web-review-fixes.md`
   - `docs/implementation/STATUS.md`

The first commit keeps the shared store, ownership helpers and their consumers together; splitting those coupled changes would temporarily break imports and behavior.

## Open issues

- Browser replay is reserved for the lead by `codex/RULES.md` item 3. No browser was launched; there is no new rendered-browser acceptance count. Replay the fifteen review scenarios, conflict controls, wrapping prices, Plan retention and volume/narrator-Undo controls outside the sandbox.
- Decision: retain Plan, inspector, settings and volume drafts for the current store/page lifetime, keyed by film. General full-page reload persistence is outside these draft-retention findings. Existing inspector reconnect carries retain their original conflict baseline and duration text, and composer reload persistence keeps exact version removal.
- Decision: legacy inspector reconnect carries with no opening baseline remain visible but require explicit review before saving; their text cannot borrow the latest head.
- Decision: explicit inspector conflict choices rebase only after displaying current saved values; choosing Keep does not send a command. Mixed projections must finish loading before that choice can authorize a save.
- Decision: narration has `making`/`no_answer` in the existing contract, without a queue phase or attempt identifier. Stop includes all exposed narration work. Exact counts of speech preparation not exposed by the server require a later projection change; the UI does not invent them.
- Decision: regeneration without a quote is disabled/refused; a configured unknown-price quote remains available with “no price set.” Quotes use exact integer micros for expected totals and existing approximate currency formatting for display.
- No questions, provider credentials or external access were needed. The lead owns commits, merge and browser acceptance as required by the card rules.
