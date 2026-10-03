# Application API and events

The Fastify service owns authenticated human commands and validated director tool mutations. Model arguments cannot mint an actor, request, epoch, grant or spending allowance. The current routes in [app.ts](../../apps/server/src/app.ts) and component route registrations are authoritative; this page describes their groups rather than maintaining a second exhaustive schema.

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
| Generation/reviews/controls | Human creative permission, exact returned-frame/motion approval and pause/resume/Stop |
| Allowances/budget | Inspect/review finite operation usage and update the project cap through trusted human commands |
| Narration/media | Upload/import, audition, bind/accept audio, prepare reviewed speech/transcription and inspect owned artifacts |
| Recovery | Inspect quarantine and explicitly release a restored installation while preserving pauses/fences |
| Events | Authenticated replayable project stream with resync and bounded fallback refresh |

Saving model choices or writing narration is not a billable media submission. Exact app review is required only where the implementation creates generation authority or consumes usage. A narration tool-version update is a configuration compatibility change, not voice/audio consent.

## Events and browser state

[ProjectEventStream](../../apps/server/src/application/project-event-stream.ts) emits saved events and small invalidation/status controls. It revalidates the browser session and bounds frame/page/backpressure sizes; missing/oversized history requests a snapshot resync. The server does not push full histories continuously.

The [browser subscription](../../apps/web/src/project-subscription.ts) shares one visible-project stream, coalesces refreshes, disconnects in hidden tabs and retries with backoff. It uses a 30-second refresh fallback while streaming is unavailable. Domain GETs remain the source of each projection; SSE itself grants no authority.

October 3 browser integration retains same-project connected state/content during background projection reads and hides saved-edit Continue rows during running Director work. Their persisted holds/authority remain unchanged. Rapid synthetic-SSE verification passed; the final integrated gate and repaired bounded native guidance rerun passed. See [refinement evidence](../implementation/OCTOBER-3-REFINEMENT-REVIEW.md).

Tests cover authentication, wrong scope/epoch, stale preparation, replay/conflict, storyboard edits, model changes, event cursors, Stop and recovery. See [operations/testing](OPERATIONS-TESTING.md) for commands and [current evidence](../implementation/VALIDATION-EVIDENCE.md) for actual campaigns.
