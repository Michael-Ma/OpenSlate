# Q3 · The Director watches its clips before it cuts them

Read `docs/ai/uiux-plan/codex/RULES.md` first; its hard rules apply in full. Then `docs/ai/film-quality/research-editing.md` section 3, `research-system-codex.md` section 2, and `cards/CONTRACT.md`.

## Problem

The worst failure in the Tofu film is blind cutting. The Director sees sizes and states, never pictures. Actions ran 1.33 s late on average and every plan cut was made in advance, so the lying-down, the refusal and the last look were all cut off.

## What is already proven

An MCP `image` block reaches the Director's model. On 2026-11-01 a small stdio MCP server returned a JPEG of four random colour stripes to `codex exec -m gpt-6.1-sol`, and the model named all four in order. So `read_clip_frames` should return a real image block, not a path. `packages/director/src/tools/stdio.ts` today wraps every result in one text block, and `BRIDGE_LIMITS.responseBytes` is 4 MiB.

## Change

1. **Contract 0.3.0.** Follow how 0.2.0 was added: `packages/core/src/tools.ts`, `CODE_PLAN_TOOL_CONTRACTS`, `tool-invocations.ts`, `skills/code-plan/openslate.skill.json` (`toolContract`, `requiredToolIds`). Copy the current `skills/code-plan` to `skills/code-plan-v2`, pinned for 0.2.0 films, the way `skills/code-plan-v1` serves 0.1.0. Only 0.3.0 films get `review` and `read_clip_frames`. Do not otherwise edit `skills/code-plan/` content except the `studio.d.ts` `review` line.
2. **`read_clip_frames`**, as `CONTRACT.md` says. Render frames with the media tools and `@napi-rs/canvas`, which is already a direct dependency of the server; there is no `drawtext`. Compute `motion` from frame differences. Bridge and stdio return the image block. **Never store image bytes in `tool_invocation` or any entity**: store the sheet's sha256 and byte count. The sheet may be rebuilt on replay. Keep to the bridge's 30-second timeout on a 15-second 768×1344 clip, and test that. Fixture clips must work so the demo path is covered.
3. **`ctx.review(id, {clips, note})`.** Add it to the sandbox. Its identity is `(id, digest of clip artifacts)`.
   - First reach: the run stops at this point with state `reviewing`, like a `choose` nobody can answer. In-flight work continues. Code after it is not run. `clips` must be owned video artifacts.
   - The application then starts one Director turn, the same way `triggerCodePlanRepairs` starts a failure turn, only when no other turn or pending question is active. The context has `review: { id, note, clips: [{ artifactId, stepKey, shot, prompt, durationFrames, width, height }], retakesLeft }`. Its message says to watch the clips, decide cut points, submit a changed plan if needed, and that this turn is not the person speaking.
   - The turn ends in any terminal state: the review is `done`, or `failed` if the turn failed. The run replays. A `ctx.review` that is done returns null at once, so replay goes straight on to the code after it, using whichever plan version is now current.
   - The same id with different clips is a new review (a retake happened). At most 3 review turns per film. Past that, `ctx.review` returns null at once and logs one line, and a failed review also logs one line. A review must never leave a film stuck.
   - The review turn may submit a plan and buy retakes under the film's ceiling, but it cannot change the ceiling or use `retry_step`, because those need the person's own words. This should already follow from the consent rule; prove it with a test.
   - Pausing and holds behave as they do for `choose`. If the person sends a message while a review waits, their turn goes first.
4. **View.** Add `CodePlanRunState` `"reviewing"` and `reviews` to `CodePlanView` in `packages/core/src/studio-api.ts`, as `CONTRACT.md` says. The lead builds the UI.
5. **Fake Director.** `apps/server/src/application/fake-director.ts` handles a review turn: it calls `read_clip_frames`, then submits a plan with trimmed cut points. This gives an offline end-to-end test.
6. **Tests**, offline:
   - stdio returns text plus image; sheet labels and limits; 37 cells refused; a foreign artifact refused; `tool_invocation` holds no image bytes;
   - a plan reaches review, the run stops, one turn starts, the fake Director trims, the run replays and renders with no second purchase;
   - a retake starts a second review; the fourth is skipped with a log line; a failed turn does not leave the film stuck;
   - a restart while waiting neither loses the review nor starts a second turn;
   - a 0.2.0 film has no `read_clip_frames` and no `ctx.review`, and keeps its guidance and step keys;
   - a review turn cannot change the ceiling or retry.

## Files you own

`packages/core/src/tools.ts`, `packages/core/src/studio-api.ts` (the code-plan view), `packages/director/src/tools/**`, `apps/server/src/application/tool-invocations.ts`, `fake-director.ts`, `director-capabilities.ts`, `apps/server/src/code-plan/director.ts`, `sandbox.ts`, `index.ts`, `view.ts`, `records.ts`, a new `apps/server/src/code-plan/clip-frames.ts`, `skills/code-plan-v2/**`, `skills/code-plan/openslate.skill.json`, `skills/code-plan/references/studio.d.ts` (the `review` line only), tests.

Do not edit `SKILL.md`, `film-craft.md`, `example-plan.ts` or `docs/implementation/STATUS.md`. Do not touch `apps/web/**`.

## Report

Write `docs/ai/film-quality/reports/Q3-report.md`, including how a real Director turn should be checked live, and anything in the native runtime (app-server permissions, tool result size) that differs from `codex exec`.
