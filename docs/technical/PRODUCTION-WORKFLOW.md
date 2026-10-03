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
| Image/video generation | Current matching plan, human generation origin, allowance and no blocking controls/holds |
| Video dispatch | Actual exact frame/motion review and current timing/provider bindings |
| Local export | Resolved owned clips/audio and validated timeline within local bounds |

Preparation may represent pending outputs. Dispatch enforces the prerequisites that require actual returned media; requiring final audio before creating its own speech plan would deadlock the workflow.

## Editing and continuation

A human edit fences the older director epoch and holds affected work. Direct storyboard commands save intent without starting media. The next request reads the saved state, proposes relevant prompts/plan changes and clears only the holds it legitimately continues.

A covering request can continue multiple saved edits atomically. Scope, owner and revision-bound hold proof must match; partial or foreign coverage fails without transferring any hold. Other pauses/reviews remain active. Undo restores creative data, not spent grants or old approval authority.

Completion of a director turn is not creative acceptance. A valid stage proposal does not approve audio or video; actual human decisions and executor evidence remain distinct. Ordinary writing needs no spending permission. Narration guidance compatibility must not be presented as a user authorization requirement.

## Source and checks

- [Core stages/readiness](../../packages/core/src/workflow/index.ts) and [video timing](../../packages/core/src/video-timing.ts)
- [Request/change authority](../../apps/server/src/application/service.ts), [saved-edit continuation](../../apps/server/src/application/pending-edit-continuation.ts)
- [Generation review](../../apps/server/src/generation-permission.ts), [storyboard commands](../../apps/server/src/storyboard.ts)
- Tests: core workflow/video-timing suites; server service, continuation, generation-permission and shot-narration scope suites.

See [current studio](../design/STORYBOARD-STUDIO.md) and [generation/spending review](../implementation/SPENDING-REVIEW.md) for the human flow.
