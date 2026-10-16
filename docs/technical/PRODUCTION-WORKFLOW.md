# Production workflow

The director interprets a request and proposes creative work. Trusted workflow predicates derive requirements from the actual proposed mutation and saved evidence, so a model cannot label a video mutation as intake to bypass its rules.

## Scoped guidance

Registered stages are `intake`, `story`, `scene_plan`, `shot_plan`, `narration`, `storyboard`, `video`, `assembly` and `review`. Their instructions guide reasoning; they are not a mandatory global wizard or one model call per stage. A shot may be ready while another waits for narration or review.

The [core workflow](../../packages/core/src/workflow/index.ts) parses typed creative proposals, validates scopes, derives required stages and hashes their relevant inputs. The [production service](../../apps/server/src/application/service.ts) combines these checks with request authority, change preparation and atomic publication.

| Work | Required evidence |
|---|---|
| Story/scene/shot development | Saved brief or narration, owned scope and valid scene links |
| Shot prompt change | Actual changed fields and explicit prompt reauthoring/reconfirmation |
| Silent video timing | Explicit `none`, no attached cue and a valid planned duration |
| Spoken video timing | Current accepted measured audio; within-shot overlays may be shorter than picture |
| Image/video generation | Current matching plan, scoped scene request, configured provider readiness and no blocking controls/holds |
| Video dispatch | Actual exact frame/motion review and current timing/provider bindings |
| Scene completion | Current requested media is saved; returned videos remain available to inspect, without another acceptance gate |
| Local export | Resolved owned clips/audio and validated timeline within local bounds |

Preparation may represent pending outputs. Dispatch enforces the prerequisites that require actual returned media; requiring final audio before creating its own speech plan would deadlock the workflow.

## Editing and continuation

Typed new direction fences the older Director epoch. Direct storyboard edits, narration fitting and note/proposal decisions use alongside requests: they preserve the running Director and hold only their own affected scope until publication. Human field evidence, including an edit back to its former value, still prevents an older turn from overwriting the person's work.

Request-owned holds transfer only through explicit valid continuation. Scope, owner and revision-bound proof must match; foreign or partial coverage fails. Terminal/superseded requests retire their unneeded holds, while pending preparations, questions and valid proposals remain protected. Human release names one eligible unfinished request and refuses active Director work. Undo restores compatible creative data/media, not spent grants or old authority.

The scene overview supplies exact targets and review blockers. Durable `POST /scenes/:sceneId/confirm` binds opened frames and the current recipe; its server runner settles narration and publishes video. Stop detaches unsent work, Continue does not resend it, and release of an unknown submission keeps reconciliation active. See [current routes](APPLICATION-API.md).

Completion of a director turn is not creative acceptance. A valid stage proposal does not review keyframes or actual video; saved human decisions and executor evidence remain distinct. Ordinary writing and configured-provider usage require no separate approval. Narration guidance compatibility must not be presented as a user authorization requirement. Requested audio proceeds without another generation-approval step; returned words/recordings are still content evidence rather than automatic acceptance.

## Source and checks

- [Core stages/readiness](../../packages/core/src/workflow/index.ts) and [video timing](../../packages/core/src/video-timing.ts)
- [Request/change authority](../../apps/server/src/application/service.ts), [saved-edit continuation](../../apps/server/src/application/pending-edit-continuation.ts)
- [Scene generation](../../apps/server/src/scene-generation.ts), [confirmation](../../apps/server/src/scene-confirmations.ts), [storyboard commands](../../apps/server/src/storyboard.ts)
- Tests: core workflow/video-timing suites; server service, continuation, scene-generation/confirmation, alongside-request and shot-narration scope suites.

See [current studio](../design/STORYBOARD-STUDIO.md) for the human flow. [Spending review](../implementation/SPENDING-REVIEW.md) describes the retained historical accounting implementation rather than current scene controls.
