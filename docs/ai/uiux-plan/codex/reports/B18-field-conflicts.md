# B18 field conflicts

Implemented in the supplied worktree after the lead committed B17. This task used **no Git commands**, browser launch or browser checks. The lead's plain Inspector regeneration button/descriptive price note and the card's “New take · about …” presentation are preserved. No browser-facing contract changed.

## Done

### Rules 1–3: compare edited values, then silently rebase equal fields

`model/edit-conflict.ts` is the shared pure comparison used by the store and Inspector. A prompt compares its original raw prompt, narration compares its original text, and the motion form compares both motion and duration frames. Project head changes do not produce a conflict. Missing historical baselines still require explicit review; a saved head is only a recovery/replay hint.

When the edited values match, Save captures the current consistent `displayedHead` in the request. Different edited values preserve the draft, show the saved value and disable new writes until Keep my text / Use saved text. Motion conflicts display both motion and duration, including a changed duration when motion itself stayed equal. An unfinished save does not display a misleading conflict against its own arriving result.

Tests: `edit-conflict.test.mjs` covers a 2.3 prompt at head 12 with another shot's frame landing at 13, a changed 2.3 prompt, explicit Keep followed by a head-13 Save, changed duration in the motion form, unchanged motion despite new narration, and narration text independent of other fields. `review-store.test.mjs` retains field-overwrite, form-grouping, navigation, late-reply and revision protections.

Files: `model/edit-conflict.ts`, `store/{store,state}.ts`, `keyframes/{Inspector,NarrationPanel}.tsx`, `test/next/{edit-conflict,review-store}.test.mjs` under `apps/web/`.

### Rule 4: inconsistent projections wait neutrally

A null `displayedHead` yields `waiting`, never a field conflict. Inspector shows the existing updating guidance in a status line, disables Save with the same reason and sends no POST or refusal toast. Conflict decisions also wait quietly. Film and music use the same coherent projection rule; cursor-only refreshes do not disable instant Film controls.

Tests: the mixed-projection case checks no POST, no error toast, a `waiting` comparison and a successful Save after projections agree. Film/gain and audit tests verify cursor-only refreshes remain writable and real head/revision disagreement temporarily waits.

Files: shared comparison/store/Inspector files above, `model/film-gain.ts`, `views/film/{FilmView,Tools}.tsx`, `test/next/{film-gain,displayed-baseline,b18-baseline-audit}.test.mjs`.

### Rule 5: stale refusal keeps text; the next human press rechecks values

An actual server `REVISION_CONFLICT` keeps the draft and refreshes. If its field is unchanged, the next human press silently uses the fresh displayed head. If the field changed, that next press remains blocked until explicit review. No automatic write retry was added.

Unknown outcomes are distinct from stale refusals: an exact pending request can be explicitly checked with its original key/body/head, even if its own save landed and therefore differs from the opening value. Inspector exposes the existing localized same-request recovery control. Checking an old request preserves newer typing and a newer saved field change; it cannot turn the old receipt into overwrite authority. A subtitle/composite pre-save retains its original `keepOpen` intent during reconciliation so pending recording or voice choices remain mounted, with no automatic continuation.

Tests: unchanged/changed-field stale refusals; before-commit and applied-but-lost replies; exact key/body replay; newer typing; a later saved field after an old receipt; no replacement of an unanswered request by a newer draft; and retained narration pre-save forms. Existing B17 epoch, request-key and late-revision tests still pass.

Files: `store/{store,state}.ts`, `keyframes/Inspector.tsx`, `test/next/edit-conflict.test.mjs`.

### Narration composite and recording paths

The audit found two alternative text writers that needed the same field rule. `model/narration-edits.ts` sends a composite narration text save through the common store comparison, keeps its editor open for subsequent voice/mode settings and stops the old continuation if the person types or changes film. `model/recording-words.ts` applies the same retained-baseline save to recording subtitles. Its exact Undo verifies the original project/epoch/revision, coherent saved text and restored original text before updating only the baseline; it preserves local words/file state and newer edits.

Tests cover a text-plus-voice save using successive owned heads, changed narration refusing before any POST, new typing stopping subsequent settings, no self-conflict after recording word save, exact rollback and newer draft/server/film boundaries. These are ordinary local metadata/audio-fixture tests, with no real model/media purchase.

Files: `model/{narration-edits,recording-words}.ts`, `keyframes/NarrationPanel.tsx`, `test/next/{edit-conflict,recording-words}.test.mjs`.

### Music values and the other B17 baseline audit

| Area | Finding and action | Evidence/tests |
| --- | --- | --- |
| Music level | Compare only soundtrack `audioId` and `gainDb`. Equal values use the current consistent head; different values keep the explicit conflict choice. In-flight saves do not show their own arriving value as a conflict. Definite refusals wait for another human press; unknown results retain the exact actual sent request, including a last-moment rebase. An old receipt cannot erase a draft after a newer saved gain change. | `model/film-gain.ts`, `views/film/{FilmView,Tools}.tsx`; 14 new gain/displayed-baseline cases, including landed-but-lost reconciliation and older receipts. |
| Plan | Confirmed already field-level. Held/base/live field comparisons do not compare project head. Mixed projections only prevent authorizing an instant command; they do not erase the held draft. | `model/plan-conflict.ts` (`conflicts`, `shown`) and `views/plan/PlanView.tsx`; `b18-baseline-audit.test.mjs`. No Plan implementation change. |
| Director settings | Confirmed per-selection digest. Server `local-director.ts` computes `digest(selection)`, persists that digest and returns it from settings. Frontend checks that digest plus the setup/change lifecycle flag, without comparing project head. | `apps/server/src/local-director.ts` selection-digest producers; `model/settings-director.ts`; audit changes another shot's motion, checks unchanged digest/no conflict, then changes selection and verifies conflict. No Director implementation change. |
| Instant Film controls | Accept the head shown at the press. `writable` depends only on actual project/head/revision agreement, connection and recovery state, not resource loading or cursor refreshes. A stale callback/projection waits without a false refusal toast. | `views/film/FilmView.tsx`, `model/displayed-baseline.ts`; displayed-baseline/audit tests. |
| Add voice | Found another opening-head-only false conflict. New registration has no existing shared field to compare; it now uses the current coherent head, keeps all words/IDs/consents and waits on mixed projections. Exact unknown registrations keep their actual submitted request/key; definite refusals can use a fresh head on the next press. | `model/settings-voice.ts`, `views/settings/VoicePanel.tsx`; audit tests, including a landed unknown reply with explicit fake receipt replay. |
| Narrator Undo | Fresh narrator/eligibility reads at different heads are now a waiting result, not a changed-value error. Quietly refresh and reoffer the same Undo callback; only another human press can write. Actual changed narrator or revoked eligibility remains a refusal. | Same voice files; replaced mismatch expectation and new waiting/reoffer/epoch tests. |
| Model-switch impact previews | Kept the existing whole-impact/head CAS. A preview represents the entire proposed media/configuration impact, not a single-field editor. Expiration still requires checking the live impact under the existing server contract. | `model/settings.ts` preview freshness checks; no preview-contract change. |

### Required browser scenario

Added `next-keyframes-edit-while-generating` in `scripts/browser/next-keyframes.mjs`. It uses the existing React-provider bridge to the actual fixture store and its storyboard route, with actual project/shot IDs. It edits 2.3, advances the head with an unrelated 2.1 edit and requires Saved/no conflict. Then it changes 2.3's own prompt, checks the saved-text conflict and unchanged head/value before a choice, requires Keep alone to make no write, and finally saves the person's text.

The fixture transport is private to the store; the scenario checks canonical fixture head/value instead of pretending that browser network interception observes fixture POSTs. No global test hook was added. The scenario was syntax checked and **not executed**.

## Files

Modified:

- `apps/web/src/next/store/store.ts`
- `apps/web/src/next/store/state.ts`
- `apps/web/src/next/keyframes/Inspector.tsx`
- `apps/web/src/next/keyframes/NarrationPanel.tsx`
- `apps/web/src/next/model/film-gain.ts`
- `apps/web/src/next/views/film/FilmView.tsx`
- `apps/web/src/next/views/film/Tools.tsx`
- `apps/web/src/next/model/settings-voice.ts`
- `apps/web/src/next/views/settings/VoicePanel.tsx`
- `apps/web/test/next/review-store.test.mjs`
- `apps/web/test/next/film-gain.test.mjs`
- `apps/web/test/next/displayed-baseline.test.mjs`
- `apps/web/test/next/settings-voice.test.mjs`
- `scripts/browser/next-keyframes.mjs`
- `docs/implementation/STATUS.md`

Added:

- `apps/web/src/next/model/edit-conflict.ts`
- `apps/web/src/next/model/narration-edits.ts`
- `apps/web/src/next/model/recording-words.ts`
- `apps/web/test/next/edit-conflict.test.mjs`
- `apps/web/test/next/recording-words.test.mjs`
- `apps/web/test/next/b18-baseline-audit.test.mjs`
- `docs/ai/uiux-plan/codex/reports/B18-field-conflicts.md`

Deleted: none. No generated output, local database, media, credential or dependency files were added.

## Tests

Pinned **Node 24.15.0**, **pnpm 10.33.0**, **FFmpeg/ffprobe 8.1.1**. `pnpm setup:test-media` and `pnpm check:toolchain` passed using installed binaries without a download.

Final required sequence:

| Check | Result |
| --- | --- |
| `pnpm build` | All five package builds passed |
| `node scripts/run-tests.mjs apps/web/test/*.test.mjs apps/web/test/next/*.test.mjs` | **661 passed**, zero failures/cancelled/skipped/todo |
| `cd apps/web && pnpm typecheck` | Passed, zero errors |
| `node --check scripts/browser/next-keyframes.mjs` | Passed; scenario not executed |
| `pnpm test` | **3,098 passed**, zero failures/cancelled/todo, **one optional native-probe skip**; **3,099 total** |
| `pnpm -r typecheck` | All five packages passed, zero errors |

The full suite took **226,511 ms**. The optional `opt-in native Codex probe never starts a model turn` remained skipped. The existing nonblocking Vite chunk-size warning remains. All final processes exited zero.

Independent reviews reproduced and corrected applied-but-lost reconciliation, retained narration pre-save intent, own recording word-save baselines and old music receipts arriving after newer saved gains. Final review found no outstanding must-fix issue. Direct comparisons against pre-task file copies confirmed the plain Inspector regeneration label, price-note construction, entire card model and `studio-api.ts` are unchanged. Source line-ending checks passed. Git-based checks were not run because the user prohibited every Git command.

Logs: `/tmp/b18-{build,web-tests,web-typecheck-final,full-test,typecheck}.log`; tests-first logs include `/tmp/b18-inspector-red.log`, `/tmp/b18-applied-unknown-red.log`, `/tmp/b18-retain-replay-red.log`; targeted final log `/tmp/b18-root-final-targeted.log`.

Added **46 cases**: 18 inspector/composite/reconciliation, four recording-word, ten baseline-audit/voice and 14 gain/displayed-baseline cases. Three old store cases were rewritten: mixed reads now wait before declaring a real changed field; motion form grouping uses a real duration change rather than a moved head; a recovered draft with unchanged values silently rebases and saves. One existing narrator-Undo mismatch expectation now requires a waiting result. No test was deleted or disabled; money, stale-field, exact-request, epoch and late-reply protections remain.

Tests were written before their corresponding fixes. Initial inspector tests returned **0 passed / 8 failed**, including concrete wrong-head, missing POST and false-toast failures as well as imports of the not-yet-created comparison helper. The recording helper initially failed four missing-module tests before implementation. Applied-lost request and retained narration-reconciliation regressions were added during review; the latter reproduced an actual closed-editor assertion (**17 passed / 1 failed**) before its fix. Other follow-up passing cases strengthen those same boundaries. Unknown-outcome integration tests explicitly emulate server keyed receipt replay where the fixture route lacks production idempotency; they make no claim about a real provider or browser.

## Contract changes

None. `packages/core/src/studio-api.ts`, server source, schema, frozen tool catalogs and skill packages are unchanged.

## Commits

No Git command or commit was run. Proposed split for the lead:

1. `fix(web): compare inspector fields instead of project heads`
   - `apps/web/src/next/model/{edit-conflict,narration-edits,recording-words}.ts`
   - `apps/web/src/next/store/{store,state}.ts`
   - `apps/web/src/next/keyframes/{Inspector,NarrationPanel}.tsx`
   - `apps/web/test/next/{edit-conflict,recording-words,review-store}.test.mjs`
2. `fix(web): rebase music level saves on equal displayed values`
   - `apps/web/src/next/model/film-gain.ts`
   - `apps/web/src/next/views/film/{FilmView,Tools}.tsx`
   - `apps/web/test/next/{film-gain,displayed-baseline}.test.mjs`
3. `fix(web): wait quietly for coherent voice settings`
   - `apps/web/src/next/model/settings-voice.ts`
   - `apps/web/src/next/views/settings/VoicePanel.tsx`
   - `apps/web/test/next/{settings-voice,b18-baseline-audit}.test.mjs`
4. `test(browser): cover inspector saves during generation`
   - `scripts/browser/next-keyframes.mjs`
5. `docs: record B18 field conflict verification`
   - `docs/implementation/STATUS.md`
   - `docs/ai/uiux-plan/codex/reports/B18-field-conflicts.md`

## Open issues

- The required browser scenario is written and syntax checked; the lead must run it outside the sandbox. No new rendered-browser pass count is claimed.
- Decision: preserve unknown-request reconciliation as a separate explicit operation. It reuses the original request and can never become a new write against a newer baseline; narration pre-saves retain the form for later human continuation.
- Decision: legacy drafts without an original field baseline still require a choice. Their missing evidence is not treated as an unchanged field.
- Decision: retain whole-impact model-switch preview CAS, while single-field editors silently rebase equal values.
- No questions or unavailable credentials were needed. No Git, browser launch/check, real provider/model call, external network request, credential read, production-state access/restart or port 3001 listener occurred.
