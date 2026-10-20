# Card R3: a Codex keyframe that provably failed, or never started, is not "no answer"

Read `_review-common.md` in this folder first. Files: `apps/server/src/execution/codex-image-execution.ts`, `apps/server/src/execution/codex-image-authority.ts`, `apps/server/src/execution/codex-image-receipts.ts`, `packages/director/src/media/codex-image.ts`, and engine outcome handling in `apps/server/src/execution/engine.ts` only where needed. Card R2 also edits engine.ts; keep your engine change to the failed-outcome mapping.

1. **keyframes-codex-known-failure-reported-unknown.**
   - A saved native failure is a definite failure: phase failed, technical false, retryAllowed false, and reservation charged, because usage was consumed. It must not be submission_unknown.
   - A saved native failure covers: usage limit, image tool failure or refusal, the worker's own 180 s interrupt, and a completed turn with no image.
   - This needs a failed outcome that does not require a vendor taskId for codex-image (for example the turn id as the receipt identity); relax the receipt invariant only for that case.
   - Keep "unknown" only when there is no saved native evidence.
   - Map the failure codes so the web can say what happened. Existing nativeDiagnostic categories cover rate and usage limits; add a sanitized failure code for an image refusal or failure if needed, and list it.
   - Tests:
     - USAGE_LIMIT, IMAGE_FAILED, an interrupted turn and a completion with no image each end failed and charged, with no double-charge release offered;
     - the Codex capacity slot is freed;
     - "unknown" without saved evidence still stays unknown.
2. **keyframes-codex-prepare-fence-unknown.**
   - Separate "lease lost" from "selection, pause or hold changed".
   - While this worker still owns the unexpired submitting lease and no dispatch marker exists, record a not_dispatched result (LOCAL_CANCELLED or a new SELECTION_CHANGED). The attempt then ends rejected and released, not charged.
   - Apply the same rule to the claim-transaction failure.
   - In recover(): an attempt with no dispatch marker that a new lease owner reconciles is a provable no-start, because the marker always precedes turn/start. Record it the same way.
   - Rewrite the existing test at codex-image-execution.test.mjs:75-84, which asserts "unknown", for the modes where the lease is still owned. Keep "unknown" for a genuinely lost lease with no way to prove the absence of a start, if such a mode remains. Explain your reasoning in the report.
   - Tests: Stop, a prompt edit and a Director message during preparation each end not charged and pressable again; the scene is not blocked.
