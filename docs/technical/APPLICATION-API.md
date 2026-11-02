# Application API and events

The Fastify service owns authenticated human commands and validated Director mutations. Model arguments cannot mint an actor, request, epoch or human media review. [app.ts](../../apps/server/src/app.ts) and component registrations are authoritative; this is a current route guide, not a stable public SDK. Browser-facing shapes live in [studio-api.ts](../../packages/core/src/studio-api.ts).

## Trust and replay

The server binds loopback. Host/Origin checks apply to UI and APIs. A short-lived launch code creates an HttpOnly browser session; Director tools use a separate epoch-scoped credential. Provider keys stay on the server.

State-changing commands require an `Idempotency-Key` and their route's freshness/input checks. Exact replay recovers the saved result; changed input under the same key fails. Prepared changes remain bound to the original request/epoch. A late model result cannot borrow later human authority. Configured providers need no separate key approval or usage allowance.

## Current studio routes

Below, `P` means `/api/projects/:projectId`. All listed reads require the applicable browser authentication; content and diagnostic reads grant no execution authority.

| Route | Use and boundary |
|---|---|
| `GET /api/projects`, `POST /api/projects` | Film list/create; optional `planMode: "graph" \| "code"` selects the code-plan path; omitted/graph leaves the legacy record unchanged. Saved models are validated against the installed catalog |
| `GET P`, `POST P/storyboard` | Snapshot and revision-checked brief/story/scene/shot, music and Undo commands |
| `POST P/rename`, `POST P/archive`, `POST P/unarchive` | Keyed film management without detaching owned media; archive refuses running/unknown attempts |
| `GET P/plan-imports`, `POST P/plan-imports`, `POST P/plan-imports/:requestId/confirm` or `/discard` | Text/Markdown proposal review and canonical publication |
| `POST P/messages`, `GET P/director` | Explicit human words/scope, structured answers, request/runtime status |
| `GET P/generation` | One scene/shot overview with states, target sets, blockers, estimates, current/previous media and viewing state |
| `POST P/shots/:shotId/frame-views` | Save `{artifactId, sha256}` for the actual current displayed image; no hold, chat message or generation authority |
| `GET P/scenes/:sceneId/generation`, `POST P/scenes/:sceneId/generate` | Exact recipe/freshness read and scoped keyframe generation, including selected-shot regeneration and missing voice lines |
| `POST P/scenes/:sceneId/confirm` | Durable scene-video command with `confirmationDigest`, exact `reviewedFrames` and optional `expectedEstimateMicros` |
| `POST P/shots/:shotId/narration-fit` | Free `{fit: "extend_shot" \| "cut_to_shot", expectedHeadVersion}` command; validates measured audio and returns an Undo command |
| `GET P/shots/:shotId/takes`, `POST P/shots/:shotId/takes/:artifactId/use` | Owned keyframe history and free eligible take selection; bytes/intent are checked and dependent video is outdated as needed |
| `POST P/director/notes/:noteId/resolve` | Resolve a versioned typed note choice with actual result evidence; notes are read in the project snapshot |
| `GET P/director/proposals`, `POST P/director/proposals/:proposalId/accept`, `/reject`, `/undo` | App-computed Now/After preview and keyed decisions; accept rechecks `previewDigest`, Undo protects newer fields |
| `GET P/exports`, `POST P/exports`, `POST P/exports/:exportId/cancel` or `/recover` | Storyboard-order readiness/history and durable local rendering; start echoes `expectedHeadVersion` |
| `GET P/assets?sceneId=&shotId=&role=` | Owned keyframe, clip, voice, music, upload and export library with source/current identity |
| `POST P/shots/:shotId/narration/recording?expectedHeadVersion=N` | Raw `application/octet-stream` audio under one idempotent command; import, measure, attach and accept when it fits, otherwise leave narration-fit pending |
| `GET P/narration/shots/:shotId`, `GET P/narration/playback`, `GET P/narration/audio/:audioId/content` | Current shot audio projection, accepted playback placements and owned audio bytes |
| `GET /api/narration/voices?projectId=…`, `GET/POST P/settings/voice`, `GET/POST P/narration/personal-voices` | Stock/default and consent-bound existing personal voice identities; revocation has its own keyed route |
| `GET /api/providers`, `GET P/settings/models`, `POST P/settings/models/preview` or `/apply` | Installed choices and exact per-film impact preview/save |
| `GET/POST P/director/setup`, `GET P/director/models`, `POST P/director/change`, `GET/POST P/settings/director-review` | Codex/Claude/fake setup and saved selection, actual Codex model list and default-on storyboard picture review; Claude requires code mode |
| `GET /api/installation/status` | Authenticated version-only Codex/FFmpeg/ffprobe status and provider-configuration flag, without a film, paths or secrets; sign-in may be unknown |
| `POST P/controls` | Stop or explicit resume with `expectedAuthorityId`; detached unsent work needs a new generation press |
| `POST P/attempts/:attemptId/release` | Give up on `submission_unknown` with double-charge acknowledgement; continue reconciliation and retain late output as an earlier take |
| `POST P/requests/:requestId/release-holds` | Release only the named unfinished request's eligible holds; refuses running Director work |
| `GET /api/installation/recovery`, `POST /api/installation/recovery/release` | Restore-quarantine inspection and exact reviewed release; projects remain stopped |
| `GET P/artifacts/:artifactId/content` | Owned artifact bytes, including completed export downloads |
| `GET P/events` | Authenticated bounded cursor replay/invalidation; SSE grants no authority |
| `GET P/code-plan` | Experimental `CodePlanView`: current run, steps, choice history/liveness, shared references, reviews, versions and accounting |
| `GET P/code-plan/versions/:version` | Stored `CodePlanSourceView` for a positive integer version |
| `POST P/code-plan/choices` | Keyed `{choiceId, optionsDigest, answer}`; exact JSON option identity and current reachability are checked; stale rows return `CODE_PLAN_CHOICE_STALE` (409); returns `CodePlanReceipt` |
| `POST P/code-plan/ceiling` | Keyed `{ceilingMicros}` sets the integer-micro ceiling, refusing a value below charged/unknown/in-flight liability; returns `CodePlanReceipt` |
| `GET P/code-plan/steps/:stepKey`, `POST P/code-plan/steps/:stepKey/retry` | Read filtered prompt/input/output detail, or schedule a keyed consent retry of a reached retryable step; old liability remains |
| `POST P/code-plan/source` | Keyed `{source, basedOnVersion}` with a positive version or `null` before the first plan; submits with author `user`, returning `CodePlanReceipt` with the dry-run diff |

Asset import/media processing routes remain in [media/routes.ts](../../apps/server/src/media/routes.ts) and [media/image-routes.ts](../../apps/server/src/media/image-routes.ts). Narration reads, owned transcription and voice routes remain in [narration/routes.ts](../../apps/server/src/narration/routes.ts). Their presence does not authorize a live experiment.

## Code-plan boundary

Code-plan routes register when the host supplies `AppOptions.codePlans`; normal startup supplies the real `CodePlanRuntime` implementing `CodePlanPort`. They use the ordinary studio session/CSRF and quarantine checks. Every code-plan POST requires one nonblank `Idempotency-Key` of at most 160 characters. Its completed receipt is saved, so replay returns that receipt even if the run has advanced; changed input under the same route/project/key is refused. Source submission binds its body durably before awaiting the port, shares simultaneous identical calls and uses the key as `invocationId` so interrupted submissions recover through the runtime's idempotent submit. Source is limited to 256 KiB of UTF-8; versions must be positive safe integers. The HTTP layer does not run or compile source.

The port reports graph projects as `409 CODE_PLAN_MODE`, missing projects/versions as `404 NOT_FOUND`, stale bases as `409 REVISION_CONFLICT`, and rejected source as `409 CODE_PLAN_REJECTED` with `error.details.diff`. There is no additional generation approval in these HTTP adapters. Version publication, current-choice validation, liability-floor enforcement and dispatch belong to the runtime. During installation quarantine code-plan writes/replays and the view/version-source reads are blocked; the step-detail read is explicitly allowlisted. Offline HTTP/runtime integration is separate from native/provider acceptance.

For a `CodePlanStepView.artifact` (or an artifact inside a choice), the web should use **`GET P/artifacts/:artifactId/content`** with the usual session cookie. This existing route looks up the owned `ArtifactRecord` directly; no graph binding, selected shot or `project.artifacts` entry is required. It checks project ownership, resolved media-root containment, non-symlink file opening, size and SHA-256 before returning the recorded supported content type with private/no-store and nosniff headers. It serves image, MP4 video and supported audio bytes. This preview route returns a full `200` response, including when a Range header is supplied; it does not implement partial content. No additional code-plan artifact route is needed.

## Scene confirmation and compatibility

The next UI reads `GET P/generation`; it does not fetch the old review projection. A scene confirm captures exact opened frame identities, narration/recipe freshness and the estimate. The persisted server runner derives step identities from the confirmation, follows existing speech outcomes, attaches/accepts exact measured audio and publishes the reviewed video request. Unknown paid outcomes are reconciled under their original identities. It does not blindly purchase replacement speech after a restart or browser disconnect.

Keyframe/voice generation and video confirmation are separate human decisions. Returned clips need no further acceptance gate. Narration-fit operates on already measured audio without a provider call. `engine.approve` remains an internal integrity operation used by scene confirmation; it is not a standalone browser action.

B14 removes `POST P/approvals`, the generation-permission HTTP routes, `GET P/providers`, `GET P/director/tools` and `POST P/director/tools/upgrade` after the repository caller audit. Provider projection, tool upgrade and automatic compatible-upgrade services remain internal. The old narration workspace/session, script-initialize/accept, proposal/review and browser prepare/apply HTTP adapters are also retired. Current shot reads/playback, direct audio generation/transcription, owned audio content/library and stock/personal voice routes remain; the server confirmation runner retains its shared narration internals. `GET P/review` remains a read-only historical-plan diagnostic through `engine.inspectReview`: its response has no persisted snapshot identity (`id: null`) and the GET creates no `review_snapshot` or other state. It cannot be used as a generation approval. `/media/renders` remains available for old Director-authored plans; the current Film view starts storyboard exports through `/exports`.

## Events and checks

The [event stream](../../apps/server/src/application/project-event-stream.ts) validates browser sessions and bounds pages/backpressure, requesting resync when necessary. The [next client](../../apps/web/src/next/api/client.ts) and [store](../../apps/web/src/next/store/store.ts) refresh projections and keep exact pending command identities across connection failures. Domain reads remain authoritative.

Tests protect wrong scope/epoch, stale preparation, replay/conflict, exact reviews, unknown outcomes, Stop and quarantine. B14's review regression proves repeated diagnostic GETs write nothing. See [operations/testing](OPERATIONS-TESTING.md) and [status](../implementation/STATUS.md) for actual gates and remaining browser/live acceptance.
