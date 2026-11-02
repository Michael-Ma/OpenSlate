# K2 · A card lives in its reply and retires when what it depended on changes

Read `docs/ai/uiux-plan/codex/RULES.md` first; its hard rules apply in full. The lead is building the web in another worktree at the same time, so do not edit `apps/web/src/**`. You own `apps/server/**`, `skills/code-plan/**` and server tests. `packages/core/src/studio-api.ts` already has the two new view fields; do not change it. If you need a file that is not named here, edit it and say so in your report rather than stopping.

## Problem

The owner's film: four keyframe cards waiting, plan version 1. The owner said the story was too abstract and asked for other ideas. The Director answered twice in chat and left the plan alone, so the four cards stayed live and stayed at the foot of the thread under every later reply.

Three separate causes:

1. The web pins waiting cards to the foot. The lead fixes that, and needs to know when each card was asked.
2. Nothing retires a choice. `code_plan_choice` rows are listed forever (`view.ts`) and any row can be answered (`answerChoice`). A card whose picture no plan uses still asks. Reviews already avoid this through `run.reviewKeys`; choices have no equivalent.
3. The Director has no rule for a rejected story. Only it can tell what a sentence means.

The owner's rule: steps depend on each other. When an earlier step changes, what came after it stops being valid and stops asking.

## The dependency model

Step identity is already the digest of its inputs, and a keyframe's choice identity is the digest of its options, which carry the frame and the references. So a change upstream already gives everything downstream a new identity. What is missing is noticing that the old identity is gone. Do not add a dependency graph. A choice is current exactly when the latest finished pass of the current plan reached it.

Consequences, all intended:

- Changing shot 2's prompt or references retires shot 2's card. Shot 1's card and any answer on it are untouched.
- Changing a shared reference retires every card that used it.
- Replacing the story retires all of them.
- Going back to the earlier content reaches the same rows again: same pictures, same answers, nothing bought.

## Change

### 1. Records and view

`CodePlanChoice` in `apps/server/src/code-plan/records.ts` gains `askedAt?: string` and `stale?: true`. `view.ts` passes both to `CodePlanChoiceView`, omitting them when absent. Keep the existing sort.

### 2. Which choices a pass reached

`evaluate` collects the row ids it reaches, through both `ctx.choose` and `ctx.keyframe`, and returns them. `choose()` stamps `askedAt` on a new row when `!dry`.

### 3. Settling at the end of a pass

In `pass()`, after the `planVersion` check and next to the code that cancels unreached steps, and only when `outcome.state !== "error"` (an errored pass, a shutdown or a CPU limit says nothing about what the plan reaches), walk every `code_plan_choice` row of the film:

- **Reached:** clear `stale`. If it is unanswered and it was stale, set `askedAt` to now, so a card that comes back appears after the latest reply instead of far up the thread.
- **Not reached:** set `stale: true`.
- **Any row with no `askedAt`:** backfill, so existing films get their cards back in place. Use the `updatedAt` of the image step whose artifact equals the row's first option, when there is one. Otherwise, if the row is reached and unanswered, use now. Otherwise leave it absent. Do not backfill answered rows that have `answeredAt` and no matching step.

Write only rows that changed, so an idle pass does not rewrite them. Do not reset anything in `submitPlan`: a card that stays valid across a new version must not flicker, and `askedAt` must only move when a card really came back. A pass abandoned for a newer plan already returns before this point and must keep doing so.

### 4. Answers

`answerChoice`: refuse a stale row with `CODE_PLAN_CHOICE_STALE`, message "This card no longer applies". Keep idempotency: repeating the exact answer already stored on a stale row succeeds without changing it. Follow how `CODE_PLAN_CHOICE` reaches the client; say in your report which HTTP status it gets.

### 5. The Director

`readCodeFilm` in `apps/server/src/code-plan/director.ts` drops stale choices from `choices`, so the Director never treats one as waiting. `port.view` keeps them for the browser. Check `CodePlanPort` and the media failure lookup near line 216 of `director.ts`: a stale keyframe choice must not name a shot for a failure of a current step.

### 6. Assets

In `apps/server/src/code-plan/assets.ts`, `frameChoices` ignores stale rows. A picture whose card retired but which the plan still uses must not lose `current`. Say in your report if you find another reader of choices that needs the same.

### 7. The keyframe gate

`journalKeys` in `evaluate` exempts every journaled video step from the gate, including `absent` and `cancelled` rows that never ran. That lets a clip nobody paid for slip past after its keyframe retired. Count only steps that have an `attemptId` or a `result`.

### 8. Guidance

In `skills/code-plan/SKILL.md`, next to the keyframe rules. Keep this wording unless it does not fit, then keep the meaning:

> A card belongs to the plan that reached it. When the plan stops reaching a choice, because a prompt or a reference changed or a shot was removed, its card retires by itself, and shots you did not change keep their cards and answers. Never ask the person to confirm a retired card.
>
> While keyframe cards are waiting, if the person rejects the story or direction, or asks for other ideas instead of it, retire those cards first: submit the plan without the affected shots, then talk about ideas. If no shot survives, keep `ctx.scene` with the last agreed premise. This costs nothing, and the earlier source brings back the same pictures, cards and answers. Do it before you reply. A question about a card, or a request to change one picture, is not a rejection: change that shot instead.

Recompute `CODE_PLAN_GUIDANCE_DIGEST`. Update the `ctx.choose` line "A changed options digest asks the person again" only if it now reads wrongly. Archived 0.1.0 and 0.2.0 guidance stays untouched.

## Tests

Add `apps/server/test/code-plan-choice-retire.test.mjs`. Real plan submission and replay through `CodePlanRuntime`, as in `code-plan-keyframes.test.mjs`.

1. Two shots, both cards waiting. A new plan changes shot 2's prompt: shot 2's old card is stale, its new card is live with `askedAt`, shot 1's card is live with its original `askedAt`.
2. The same with shot 1 answered first: the answer survives, its clip is reused, nothing new is charged for it.
3. A shared reference changes: every card that used it is stale.
4. A `ctx.scene`-only plan: every card is stale, the run ends `done`, nothing is charged.
5. Going back to the original source reaches the same rows: no new attempt for any picture, `stale` cleared, an unanswered card has a later `askedAt`, an answered card keeps its answer and its clip is not bought again.
6. Answering a stale card is refused with `CODE_PLAN_CHOICE_STALE` and changes nothing. Repeating the stored answer on an answered stale card succeeds.
7. A plain `ctx.choose` text choice follows the same rule.
8. A pass ending in error marks nothing stale. A pass overtaken by a newer version marks nothing.
9. A new version that keeps a card does not change its `askedAt` and does not rewrite the row on an idle pass.
10. Backfill: a row with no `askedAt` takes its frame step's `updatedAt`; a reached unanswered text choice takes the pass time; an unreached text row stays undated.
11. `readCodeFilm` omits stale choices and `port.view` keeps them.
12. Assets: a retired card's picture still used as a reference stays `current`.
13. Gate: a `ctx.video` that was stopped by a hold before running, then cancelled by a new plan, is refused with `CODE_PLAN_KEYFRAME_REQUIRED` when a later plan calls it without `ctx.keyframe`.
14. A film holding the previous guidance digest still gets a working fresh turn.

## Finish

Run `pnpm test`, `pnpm typecheck` and `pnpm demo:code`. The web suite may fail where it pins the old thread order; say which and leave them, the lead is changing them. Write `docs/ai/film-quality/reports/K2-report.md`: what changed, the HTTP status of the refusal, what you could not cover, and anything in this card you decided against.
