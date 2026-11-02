# Card R4: scene confirmation and voice-line runs never strand paid work and never stall silently

Read `_review-common.md` in this folder first. Files:
- `apps/server/src/scene-confirmations.ts`, `apps/server/src/scene-generation.ts`
- `apps/server/src/narration/narration-speech-service.ts`, `apps/server/src/narration-fit.ts`, `apps/server/src/scene-narration-view.ts`
- `apps/server/src/generation-quotes.ts`
- `apps/server/src/generation-overview.ts` (scene projections and quotes)
- tests

Card R2 also edits `scene-confirmation-state.ts` and the slot projection in generation-overview.ts.

1. **narration-speech-plan-stale.**
   - Speech composition must not fail because an unrelated saved node is stale after a motion, duration or prompt edit.
   - Either compose speech onto a plan rebased to the current project (run the scene composition or `prepareNarrationPlanRebase` first), or verify only the nodes the speech depends on.
   - The voice-only Make keyframes press needs the same fix.
   - If a stale plan can still occur, give it its own blocker with a working next step. Do not leave a generic "check the scene" message.
   - Tests: a motion edit and a duration edit on the same shot and on a sibling shot, then Confirm (or Make keyframes), buys and attaches the voice line and makes the clips.
2. **narration-orphaned-paid-voice.** A paid voice line that succeeded is never stranded, and the same unchanged line (segment revision, text, voice, profile) is never bought twice.
   - Scope the freshness check of the attach and accept steps to the stepped shot's own narration intent and voice. An edit to another shot in the scene must not strand it.
   - The Director-chat supersede case in the verifier's notes (ACTOR_DENIED at attach after spend) must not strand a paid take either. Decide which authority attach needs and explain it in the report.
   - When building steps, a succeeded unattached take that matches the current segment revision, text, voice and profile starts at "attach", not "speech", and is left out of every quote.
   - Tests:
     - edit a sibling shot while the voice job is out;
     - send a Director chat message while it is out;
     - a second press after a blocked run attaches the existing take with 0 new speech calls.
3. **narration-keyframes-run-invisible.**
   - Project the latest keyframes-kind run as `SceneOverview.keyframesRun`, in the same shape as `confirmation`. Add the `confirmation_running` blocker while it runs.
   - A shot whose accept is out of range (NARRATION_CUE_OUT_OF_RANGE) must not stop the other shots' voice lines. Run the other shots' steps, then end the run blocked, naming that shot.
   - Tests: the order.test scenario from the finding voices 2.2 on the first press; the overview shows the run and its blocker.
4. **video-03 (remainder after R2's root fix).**
   - `fresh()` also checks `confirmationFramesCurrent`, so a pin mismatch blocks the run instead of hanging at attach.
   - A per-shot keyframe regeneration in a scene whose video confirmation is running is refused with `CONFIRMATION_RUNNING`.
   - Confirm refuses a target whose frame pin does not resolve to the image binding's own outputs.
   - Tests for each.
5. **video-05.**
   - The runner's video step must not be fenced by the film-wide headVersion or revisionId. For a runner call (`options.actor`), recompute head, revision and hold tokens inside generateScene's transaction, and rely on the scene-scoped fences: sceneIntentDigest, frame pins and the guard.
   - Do not persist head tokens across restarts.
   - Test: an edit to another scene while the video step composes does not block the confirmation.
6. **Prices for remakes** (plan-impact-clip-unpriced and narration-voice-price-missing, server half).
   - Publish `SceneOverview.quotes.oneClip` and `quotes.oneVoice`: one unit at the scene's video and speech profiles, whether or not anything is pending (units 1, the same priceUnknown and subscription rules).
   - Omit a quote when the lock has no such profile.
7. **narration-fit-contract-drift (server half).**
   - Publish `ShotNarration.fitSeconds`: the server's own extend-fit length (narrationFitFrames rule, bounded by the locked profile) in whole seconds, for a measured line that does not fit.
   - Absent for an estimated line.
