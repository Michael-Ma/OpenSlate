Found 15 defects, ranked by your requested priorities. Read-only review completed; no browser launched or files changed. The main focused test run passed 84 tests; additional targeted suites also passed.

1. **High — A paid regeneration link has no visible price.** [keyframes/ShotCards.tsx:87](apps/web/src/next/keyframes/ShotCards.tsx:87)  
   The card renders “Regenerate 2.2” but drops its computed price. Another note can occupy the banner, leaving this purchase unpriced on screen. **Fix:** display the exact selected-shot quote beside every paid regeneration action.

2. **High — Sending in one tab deletes another tab’s unsent message.** [director/composer-draft.ts:39](apps/web/src/next/director/composer-draft.ts:39)  
   Tabs share one draft key per film. After B saves newer unsent words, A sending its message unconditionally removes that key. B’s words disappear on reload. Reproduced in memory. **Fix:** use tab-owned/versioned drafts and remove only the draft actually sent.

3. **High — Inspector drafts overwrite newer server edits.** [store/store.ts:297](apps/web/src/next/store/store.ts:297)  
   Open a prompt at head 12; another tab changes it at head 13. After refresh, Save submits the old draft with head 13, bypassing conflict detection. **Fix:** capture the draft’s original value/version and require explicit conflict resolution.

4. **High — Film controls authorize stale values with a newer head.** [views/film/FilmView.tsx:140](apps/web/src/next/views/film/FilmView.tsx:140)  
   Snapshot and overview refresh independently. If another tab changes 5 seconds to 8, the new snapshot can arrive while the overview still displays 5. Pressing “+” submits 6 with the latest head, overwriting 8. Plan has the same projection mismatch. **Fix:** bind commands to the displayed baseline; wait when projection versions disagree.

5. **High — An old Director form borrows a newer selection digest.** [views/settings/DirectorPanel.tsx:41](apps/web/src/next/views/settings/DirectorPanel.tsx:41)  
   Another tab changes Director settings while Change is open. Refresh updates `data`, but leaves the old draft. Save attaches the new digest to those old values, silently overwriting the newer selection. **Fix:** retain the opening digest with the draft and surface conflicts.

6. **High — Settings drafts cross film boundaries.** [views/settings/DirectorPanel.tsx:21](apps/web/src/next/views/settings/DirectorPanel.tsx:21), [views/settings/useRead.ts:63](apps/web/src/next/views/settings/useRead.ts:63)  
   Edit film A’s Director settings, switch to B, then Save after B loads: A’s draft is applied to B using B’s digest. Resource hooks also retain A’s displayed values while B loads or fails. **Fix:** partition drafts and resources by project identity and hide values belonging to another film.

7. **High — Leaving Plan silently discards drafts.** [views/plan/PlanView.tsx:104](apps/web/src/next/views/plan/PlanView.tsx:104)  
   Brief/shot drafts live inside the mounted workspace. Opening another tab, switching films, or entering recovery review destroys them without the internal discard confirmation. **Fix:** retain drafts above view mounts, keyed by film, and guard navigation that would discard them.

8. **High — Shot cards and scene pills discard inspector edits.** [keyframes/ShotCards.tsx:62](apps/web/src/next/keyframes/ShotCards.tsx:62), [keyframes/SceneHeader.tsx:21](apps/web/src/next/keyframes/SceneHeader.tsx:21)  
   Type an unsaved prompt, motion, or narration change, then select another card/scene. Selection clears `edit` immediately. Previous/Next already enforce an edit hold, but these paths bypass it. **Fix:** apply the same hold or preserve the draft with explicit discard.

9. **High — Late save replies erase newer typing or another film’s editor.** [store/store.ts:335](apps/web/src/next/store/store.ts:335)  
   Inspector fields remain editable during Save. Success clears any current draft; failure restores the older submitted draft. A response from film A can also clear an editor opened in B. Reproduced with a deferred response. **Fix:** fence completion by project and draft revision; preserve changes made after submission.

10. **Medium — Plan loses edits reverted to their original value during Save.** [model/plan-conflict.ts:81](apps/web/src/next/model/plan-conflict.ts:81)  
    Change “Original” to “B”, press Save, then type “Original” before the reply. `afterSave()` ignores fields equal to the original baseline and closes the editor, although the server saved “B”. **Fix:** compare every field against the submitted snapshot, including reverted fields.

11. **Medium — Multi-shot regeneration sends a one-shot expected price.** [store/store.ts:252](apps/web/src/next/store/store.ts:252)  
    A Director choice regenerating two $0.04 frames displays $0.08 but sends the common per-shot estimate, `"40000"`. The server rejects it as `ESTIMATE_CHANGED`. Heterogeneous quotes can instead omit the check. **Fix:** sum the exact selected-shot quotes used for the displayed total.

12. **High — Asynchronous continuations can target a newly selected film.** [views/assets/ImportSheet.tsx:182](apps/web/src/next/views/assets/ImportSheet.tsx:182), [store/store.ts:257](apps/web/src/next/store/store.ts:257)  
    Close an import after upload, switch A→B, then receive a revision conflict on an uncertain retry: its automatic fresh retry reads B’s head and uploads into B. Regeneration similarly constructs its POST using the current film after awaiting A’s scene read. **Fix:** freeze the originating project throughout preparation, dispatch, and reconciliation.

13. **Medium — Failed keyframes become unrecoverable in partial scenes.** [model/inspector.ts:155](apps/web/src/next/model/inspector.ts:155), [model/keyframes.ts:334](apps/web/src/next/model/keyframes.ts:334)  
    Real terminal failures have `retryAllowed:false` because automatic retries ended. The UI also disables a fresh human “Make again”. With another frame ready, the scene panel offers blocked video confirmation instead of missing-frame generation. **Fix:** distinguish automatic retries from a new priced human request and support partial-scene recovery.

14. **Medium — Stop disappears while replacement work is queued or running.** [model/director.ts:28](apps/web/src/next/model/director.ts:28), [model/shell-states.ts:213](apps/web/src/next/model/shell-states.ts:213)  
    Retained frames remain outer `ready`, with work under `replacement`. Stop availability and its counts ignore that work. Reproduced a queued replacement with `stopVisible:false` and zero queued jobs. **Fix:** include replacement states and narration work in availability/counting.

15. **Medium — Late Director responses populate the wrong film.** [store/store.ts:146](apps/web/src/next/store/store.ts:146), [store/reducer.ts:64](apps/web/src/next/store/reducer.ts:64)  
    Unlike snapshots/overviews, Director and proposal responses carry no project fence. Switch A→B during refresh: A’s late response installs its running/error state and proposals in B. If B’s Director read fails, A’s state persists. Reproduced in memory. **Fix:** attach project/request identity to these actions and reject responses from superseded selections.

