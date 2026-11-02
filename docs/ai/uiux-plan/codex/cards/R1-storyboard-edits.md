# Card R1: storyboard edits never throw away paid media by accident

Read `_review-common.md` in this folder first. Files: `apps/server/src/storyboard.ts`, `apps/server/src/storyboard-history.ts`, `apps/server/src/application/service.ts` (confirmPlanImport only), tests under `apps/server/test`.

1. **plan-undo-outdates-paid-media (blocker).**
   - Undo must decide its affected image and video bindings the way a forward edit does. Remove the blanket `input.kind === "undo" && (brief or story changed)` clause; timeline and render are already covered.
   - For undo, detach an image or video binding only when:
     - its shot intent digest for that kind changed;
     - its image or video prompt changed;
     - its shot is removed; or
     - the undone edit's own exclusions (narration, motion/frames/videoPrompt, prompt-only) say so.
   - Do not decide by raw shot-record difference: a cross-scene move changes only sceneId.
   - Regression tests: undo of treatment:brief, undo of treatment:story, and undo of a cross-scene moveShot each leave `engine.outputs` unchanged, with no binding outdated by "undo".
   - Keep the existing tests in which undo restores media the forward edit had outdated (restoreMediaUndo).
2. **plan-delete-shot-running-job.**
   - deleteShot refuses with `ATTEMPTS_RUNNING` while that shot has a non-terminal attempt of any kind (running, remote_pending, submission_unknown), the same way deleteScene does.
   - Test both cases: refused while running, allowed once the attempt is terminal or released.
3. **plan-import-confirm-project-hold.**
   - A confirmed plan import authorizes no generation, so its confirm request must not leave holds behind.
   - Release them on a successful confirm, or make the request alongside with no hold scopes while keeping the continuation lineage. Choose whichever is smaller and safer.
   - Test: queued generation elsewhere in the film dispatches after the confirm without any further press.
