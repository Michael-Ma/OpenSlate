# October 5: post-migration review and cleanup

A separate review after the Radix migration found and repaired recovery/guidance edge cases. The Light workspace appearance is preserved. This follows the original [migration evidence](OCTOBER-5-LIGHT-WORKSPACE.md), rather than replacing its dated result.

## Findings repaired

| Finding | Result |
|---|---|
| Full attempt history could replace the current edit/review action, including an old candidate at the same node ID | The server supplies read-only `currentAttemptIds` from exact active bindings, candidates/specs and local input/capture identity. Current guidance uses that evidence. Raw history remains intact and unfinished earlier work has a separate history view. |
| A narrow discussion could imply that a wider held edit was saved/continuable; removed scope IDs could offer Resume | The card explains the wider/changed scope. Viewing a whole-film edit clears selection only after an explicit click; it does not transfer authority or start a Director request. Removed scopes never offer Resume. |
| Recording focus could override Stop/questions/running work or current uncertain video, and stale costs could affect guidance | A single pure focus/priority selector checks project, head, revision, plan and current candidate. Existing-job recovery precedes new permission. Stale focus is dropped from the costs view while pending commands keep their external registry. Unknown current submissions do not offer new-take selection. |
| Approval could return keyboard focus to a temporarily disabled Review action | The review dialog returns to the same shot's inspectable image. The controlled dialog supports an explicit return target while retaining ordinary launcher focus for other callers. |

## Refactoring

- `useKeyframeReview.ts` and `keyframe-review-model.ts` own the one inspection/approval path. Inspection captures project/revision/review identity and compiled motion/duration; submissions retain the existing displayed-image hash and application review guards. Removed the obsolete batch selection/approval state and alternate inline approval path.
- `WorkspaceNavigation.tsx` owns the shared rail/tab definitions. App and storyboard markup are formatted for review instead of dense single-line rendering.
- Removed unused ShotCard, standalone Director settings wrapper, the retired Activity implementation/styles/tests, and unused film progress/narration/status helpers. Still-relevant state regressions exercise the current model.
- Current Director/film/Assets styles live with their component/theme owners. Owned CSS blocks fell from 300 to 265; six duplicate selector blocks were consolidated. Shared shape, control sizing, media and shadow tokens replace duplicate literals. Explicit import ordering is documented in the [design contract](../design/OPENSLATE-LIGHT.md). Live legacy skins remain where they still supply layout.

## Executed checks

- `pnpm check`, Node 24.15.0 / pnpm 10.33.0: **2,232 passed, zero failed, one optional native skip** (2,233 total), including project build/typecheck. The final focus change also passed the frontend build/typecheck and **192 frontend tests**.
- `pnpm demo:headless` passed: labeled fake media, four initial and two edited acceptances, **zero duplicates after restart**, unchanged shot preserved, no model or network calls.
- Read-only backend tests cover exact candidate replacement at a reused node ID, unchanged plan reuse, retirement/missing plans, changed intent, local captures, unavailable local inputs and no persisted metadata-read effects.
- Independent reviewers checked shared controls, dialogs, settings, exact review identity, current-job metadata and scope/guidance. Root verified integration callbacks and the final focus change. No unresolved blocking review finding remains.
- CUA actual-component fixtures verified current unknown video taking priority over recording focus; Stop/running work preserving their own actions; wider scope requiring an explicit click with focus on the new card title; earlier unknown jobs remaining inspectable without hiding Resume. Those fixtures made zero creative/media calls.
- A separate fake-provider installation verified the consolidated modal approval path. Approving from the Review action succeeded and returned focus to `Inspect shot 1.1 keyframe`. Ordinary inspection and approval eligibility still require the exact frame.
- Live read-only before/after comparison matched all eight sampled desktop element rectangles, fonts, padding, background and border colors. Phone 390×844 Director-card/composer rectangles matched exactly, and document width stayed 390. Source screenshots/geometry are in the task's `outputs/openslate-radix-review/` artifact folder outside Git.
- Saved live project and authority digests/counts stayed unchanged, with zero active turns/attempts. No paid media call or new creative native turn was run.

## Limits

The optional native creative probe was not rerun. The earlier runtime/media/voice-enrollment/packaging acceptance boundaries remain in [status](STATUS.md). Render checks do not certify screen-reader behavior or 200% zoom. Vite's existing large JavaScript chunk warning remains; the component library CSS is included. This review did not change application generation, spending, receipt, hold-transfer or worker-reconciliation authority.
