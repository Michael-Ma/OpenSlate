# Card B13: server gaps found by the classic-UI parity audit

Read `docs/ai/uiux-plan/codex/RULES.md` first and follow it. All earlier cards (B1 to B12) are merged in your tree. The classic UI (apps/web/src/legacy) will be deleted soon; the next UI (apps/web/src/next) must be able to do everything that matters. These are the server parts.

## Items
1. **Unfinished Director edits must not hold scenes forever.** Every editing message places holds on its scope (`ProductionService.beginRequest`), released only on a compiled publish, a scene keyframe press, `continueEdits` or a resume. The next UI sends editing messages for ordinary conversation, so a Director turn that ends without publishing leaves holds that block video confirm (`waiting.code: "edit_pending"`). Change it so that:
   - a request's holds are released when its Director turn ends (completed, failed, interrupted, timed out) with no held proposal and no prepared change of that request still pending; also when the request is superseded;
   - `POST /api/projects/:projectId/requests/:requestId/release-holds` (Idempotency-Key, no body) lets a person let an unfinished edit go; it refuses while that request's Director turn is still running (`DIRECTOR_WORKING`);
   - the overview's `waiting` for `edit_pending` carries `requestId` (add `requestId?: string` to `WaitingReason` in `packages/core/src/studio-api.ts`) so the UI can offer "Let it go".
   Keep the existing integrity rules: holds still fence stale prepared changes; never release another request's holds.
2. **Recovery read-only mode lets the next UI read.** While an installation is quarantined after a restore (`recovery-routes.ts`, `INSPECTION_ROUTES`), every GET the next UI uses must be allowed so the person can inspect the restored work before releasing: the project snapshot, `/generation`, `/director`, `/director/proposals`, `/assets`, `/exports`, `/media`, `/settings/*` reads, `/shots/:id/takes`, artifact and narration audio content, `/api/installation/status`, `/api/projects`. Writes stay refused with the existing code. Add the recovery status fields the UI needs if missing (backup time, counts of projects, known pending jobs, uncertain jobs, local preparations not submitted, saved Director requests) to the status read.
3. **A recording as a shot's narration, in one route.** `POST /api/projects/:projectId/shots/:shotId/narration/recording?expectedHeadVersion=N` (raw audio body, Idempotency-Key, the same size and type limits as the existing audio import) imports the recording, sets the shot's narration mode to uploaded, attaches it and accepts it when it fits the shot (or reports `fits: false` with the measured length, the same way a generated voice line does, so narration-fit applies). Reuse the existing narration session, import and accept internals; free; runs alongside the Director; one Undo restores the previous narration. Also allow choosing a stock voice per shot for generated lines through the storyboard narration `voice` field if that is not already possible, and list the stock voices in a small read (`GET /api/narration/voices`) with the default narrator voice marked.
4. **Cross-scene shot moves**: storyboard `moveShot` with a `sceneId` of another scene; verify it works, outdates only what it must (timeline, not keyframes or clips), and add a test.

## Out of scope
Anything in apps/web. Removing routes the classic UI uses (a later card).

## Tests (at least)
Holds release on turn end and on supersede, the release route and its refusal while working, the overview requestId; every listed GET answers during quarantine and a write is refused; recording route fits, too long, undo, idempotent replay, wrong type; stock voices read; cross-scene move.
