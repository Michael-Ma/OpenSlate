# Card R2: the engine reports paid outcomes truthfully and never strands a confirmed clip

Read `_review-common.md` in this folder first. Files: `apps/server/src/execution/engine.ts`, `apps/server/src/execution/output-store.ts`, `apps/server/src/execution/viggle-h3-execution.ts`, `apps/server/src/execution/openai-speech-execution.ts`, `apps/server/src/scene-confirmation-state.ts`, and `apps/server/src/generation-overview.ts` (slot projection only: `takenOff` and `ingestionIssue`). Card R4 also edits `generation-overview.ts` (the scene projections) and `scene-confirmations.ts`. Keep your edits there small; if you change the signature of `sceneConfirmationGuard`, update its call sites in `scene-confirmations.ts` in the smallest way.

1. **video-01 (blocker).**
   - Local capacity errors, `OUTPUT_STORE_BUSY` and similar, are never an unknown provider outcome.
   - In reconcile, recoverCompletion, Viggle poll's spool path and speech submit: skip the attempt for this cycle, restore its lease, and leave phase and evidence unchanged. Better still, queue writers so the third waits for a slot instead of failing.
   - Speech submit must not drop returned, charged bytes because the spool is busy.
   - Released attempts keep being polled (a late result becomes a take), but they must not starve unreleased accepted jobs. Process unreleased attempts first, or make sure released ones cannot hold every writer slot each cycle.
   - Tests:
     - three accepted jobs reconciled in one cycle all stay remote_pending and are all polled;
     - two released old unknowns do not stop a newer accepted job from being polled and completed;
     - a busy spool in speech submit does not turn a charged result into unknown.
2. **keyframes-retained-take-blocks-video, and the root of video-03.**
   - When a replacement keyframe ends without output, put the retained take back as the binding's real selection (outputs and candidate) and drop retainedTake.
   - "Ends without output" covers three cases: a terminal failure with no automatic retries left (failed or rejected); Stop detaching a queued, unsent replacement; and a person releasing a no-answer replacement. For the release case, keep the existing rule that a late result arrives as an earlier take.
   - Tests, one per case: a scene confirm afterwards publishes the clip, and using the old take is not refused.
3. **video-02.**
   - Narrow the confirmation guard to what conditions each clip: that shot's own intent, prompts and frame pin, plus the lock. Do not include the scene title or sibling shots, so harmless edits do not fence clips that are already confirmed.
   - If admission still refuses a candidate because its confirmation no longer matches, take the binding off with `takenOff: "confirmation_stale"`:
     - candidate detached;
     - the shot back in videoTargets, so Confirm is offered again;
     - any stale node_wait cleared.
   - Never leave it "queued" forever.
   - Tests:
     - a scene title edit and a sibling prompt edit after confirm do not block the remaining clips;
     - a real change to the shot itself ends as `takenOff: "confirmation_stale"` with Confirm available.
4. **video-04.**
   - A finished Viggle task whose download is refused or fails stays running with phase "ingesting", never unknown.
   - Record the sanitized code (OUTPUT_DOWNLOAD_LOCATOR, OUTPUT_DOWNLOAD_EXPIRED, OUTPUT_DOWNLOAD_ADDRESS, or a generic one) and project it as `MediaSlot.ingestionIssue {code, at}`.
   - No give-up or double-charge path is offered for it.
   - Tests: a host refused by the allowlist, an expired locator, and a transient failure that heals on the next poll (the issue clears).
