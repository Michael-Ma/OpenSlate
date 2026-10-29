# Card B4 (phase P1): Stop and Continue that tell the truth, and giving up on a job with no answer

Read `docs/ai/uiux-plan/codex/RULES.md` first and follow it.

## Goal
Stop never lets unsent paid work go out later without a new press. Continue exists. A job whose submission was never confirmed can be released so the shot, the scene and the model's capacity slot are free again.

## Items (spec = the item's Change in gap-generation.md)
1. **GR-13 (decision D6)**: `POST /api/projects/:projectId/controls` takes `ControlInput` and returns `ControlReceipt` (contract in `packages/core/src/studio-api.ts`). Stop pauses the film and also detaches bound candidates that have no non-terminal attempt (binding.candidateId = null, outdated reason "stopped"), counting them in `detachedJobs`; already sent jobs finish (`sentJobs`). Resume requires `expectedAuthorityId` and dispatches nothing by itself. A generate while stopped is refused with `EXECUTION_PAUSED` (a new distinct code). Store the stop record so the overview can read `StopView` (expose a small read function the overview card can call; name it and document it in your report).
2. **GR-10 (decision D7)**: `POST /api/projects/:projectId/attempts/:attemptId/release` with `ReleaseAttemptInput` and an Idempotency-Key. Only a `submission_unknown` attempt can be released (`ATTEMPT_NOT_RELEASABLE` otherwise); `acknowledgeDoubleCharge` must be true (`DOUBLE_CHARGE_NOT_ACKNOWLEDGED`). The released attempt keeps being polled, is excluded from the ATTEMPT_EXISTS guards, from the capacity count and from currentAttemptIds, and its candidate is detached so the shot needs a new paid press. A late result is stored as an earlier take and never becomes current by itself. The reservation stays committed. Record an audit event.

## Out of scope
The overview read (B2) beyond the small stop-read function. Request source and Idempotency-Key enforcement on other routes (B1; you require the key on your own routes). Scene confirmation records (a later card adds cancelling their unsent steps on Stop). Anything in apps/web.

## Tests (at least)
- Stop with one queued and one submitted keyframe: the queued one detaches, the submitted one finishes and is charged; resume dispatches nothing; generate while stopped gives EXECUTION_PAUSED; resume with a wrong expectedAuthorityId is refused.
- The fake provider returns unknown: release it, generate again; the old attempt still reconciles, its late success lands as history, the binding keeps the new take, and the capacity count excludes the released attempt.
- Release without the acknowledgement, of a non-unknown attempt, and without a key are all refused; replay with the same key returns the same receipt.
