# Application API and events

The Fastify service owns authenticated human commands and validated director tool mutations. Model arguments cannot mint an actor, request, epoch or human media review. The current routes in [app.ts](../../apps/server/src/app.ts) and component route registrations are authoritative; this page describes their groups rather than maintaining a second exhaustive schema.

## Trust and replay

The production server binds loopback. Host/Origin checks apply to the built UI and APIs. A short-lived launch code creates an HttpOnly browser session; manual bearer-token pairing remains a fallback. Director bridge routes use a separate epoch-scoped credential. Provider keys never enter the browser.

Human mutations carry revision/current-input checks and an idempotency identity. A command result is saved with its digest; exact replay recovers it, while changed input under the same key fails. Prepared model changes are also bound to the request/epoch and immutable payload, so a late proposal cannot borrow a later request's authority.

## Route groups

| Group | Behavior |
|---|---|
| Projects and context | Create/list/read saved projects and project-specific projections |
| Messages/director | Save a human request, scope/continuation/question reply and selected owned discussion images; supervise the configured director |
| Storyboard/imports | Revision-checked direct edits and proposed text/Markdown material import with human confirmation |
| Models/director setup | Read/preview/apply saved media choices; read actual native model choices and save Director selection separately; refresh compatible guidance before eligible fresh native input |
| Scene generation/reviews/controls | Scoped keyframe/video requests, exact returned-frame/motion/video-recipe review and pause/resume/Stop |
| Historical accounting | Retain earlier allowances, estimates and liabilities; these are absent from the active scene generation flow |
| Narration/media | Upload/import, audition, bind/accept audio, request speech/transcription and inspect owned artifacts |
| Recovery | Inspect quarantine and explicitly release a restored installation while preserving pauses/fences |
| Events | Authenticated replayable project stream with resync and bounded fallback refresh |

Saving model choices or writing narration is not a media submission. Scene actions request generation with configured models; the second decision reviews exact returned keyframes and their actual motion/video recipe. Returned videos are available to inspect without an additional acceptance gate. Requested speech/transcription needs no additional generation approval. A guidance-package update is application compatibility maintenance, not voice/audio consent or API-key approval.

## Events and browser state

[ProjectEventStream](../../apps/server/src/application/project-event-stream.ts) emits saved events and small invalidation/status controls. It revalidates the browser session and bounds frame/page/backpressure sizes; missing/oversized history requests a snapshot resync. The server does not push full histories continuously.

The [browser subscription](../../apps/web/src/project-subscription.ts) shares one visible-project stream, coalesces refreshes, disconnects in hidden tabs and retries with backoff. It uses a 30-second refresh fallback while streaming is unavailable. Domain GETs remain the source of each projection; SSE itself grants no authority.

October 3 browser integration retains same-project connected state/content during background projection reads and hides saved-edit Continue rows during running Director work. Their persisted holds/authority remain unchanged. Rapid synthetic-SSE verification passed; the final integrated gate and repaired bounded native guidance rerun passed. See [refinement evidence](../implementation/OCTOBER-3-REFINEMENT-REVIEW.md).

Tests cover authentication, wrong scope/epoch, stale preparation, replay/conflict, storyboard edits, model changes, event cursors, Stop and recovery. See [operations/testing](OPERATIONS-TESTING.md) for commands and [current evidence](../implementation/VALIDATION-EVIDENCE.md) for actual campaigns.

## Current scene generation

`GET /api/projects/:projectId/scenes/:sceneId/generation` returns the current project revision, control/hold review identities, authored-keyframe completeness and exact video preview rows. Rows identify the conditioning artifact/hash, motion, model/settings and generated duration (which can cover a shorter planned shot). Historical or ambiguous alternatives do not silently become the selected work.

`POST /api/projects/:projectId/scenes/:sceneId/generate` is an authenticated human command with an idempotency key. Its body is `{headVersion, revisionId, kind: "image" | "video", reviewedFrames, reviewedHoldDigest, reviewedControlAuthorityId}`. Video requires one `{shotId,artifactId,sha256}` per displayed unfinished shot. Keyframe requests send an empty frame list.

The application composes a scoped plan in an isolated worker before making any changes. A single transaction rechecks freshness, resolves only that scene’s planning holds, installs one-use generation identity and publishes its plan; video also accepts the exact frame/recipe review before dispatch. A whole-film planning hold becomes holds for the other scenes. Image changes leave dependent videos without a candidate until their separate video check. Same-command replay returns the original receipt; unknown jobs are reconciled under their original identity. No allowance command is required.
