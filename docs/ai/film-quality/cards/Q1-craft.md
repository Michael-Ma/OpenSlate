# Q1 · The Director learns to make a film

Read `docs/ai/uiux-plan/codex/RULES.md` first; its hard rules apply in full. This card may also edit `apps/web/src/next/app/useDefaultLimit.ts` and its test.

Then read `docs/ai/film-quality/PLAN.md`, `EVIDENCE.md`, `research-story.md`, `research-prompts.md`, the shot section of `research-continuity.md`, the editing sections of `research-editing.md`, and `cards/CONTRACT.md`. Look at `evidence/plan-v6.ts.txt`: that is the failure you are fixing. Then the craft material in `skills/v8.1.0/` and `docs/ai/skill-drafts/`.

## Problem

`skills/code-plan/SKILL.md` teaches the API and nothing about film. The Director wrote "normal speed, not exaggerated" and removed the only joke. Two independent models, shown the frames cold, thought the dog ate the broccoli. Prompts were 83–89% repeated template, mixed Chinese and English, timed to 0.7 s, full of physical sizes and "do not" lists. Models follow order and ignore seconds: only 2 of 8 clips finished on time.

## Change

1. **`skills/code-plan/references/film-craft.md`**, 6–7 KB, in English, written for the Director. Add it to `files` in `openslate.skill.json`. It is supplied in context every turn, so every line has to earn its place. Cover, in this order:
   - **Story before any plan.** One-line premise with a want and an obstacle; a beat sheet of setup, turn and payoff; for each beat, the one thing a viewer can see. Comedy needs visible contrast: exaggerate, do not normalise. The test: a stranger watching silently can say what happened and why it is funny.
   - **Shots.** 3–4 camera setups, not 8. Neighbouring shots differ by at least one shot size. Keep one screen direction. In vertical, prefer movement in depth.
   - **Continuity.** Make a character sheet first, then one empty set plate per camera setup, then every keyframe from those references (`ctx.image({references})`). Props are placed in the plate.
   - **Prompts.** English only, whatever language the person writes in. Keep the frame prompt and the motion prompt separate. 60–90 words for a clip. Describe subject, action in order, camera and the final pose. At most two beats per five seconds. No seconds, no physical sizes, no margins, no lists of what to avoid. Do not paste a shared template into every prompt: the reference pictures carry the look.
   - **Clip length.** Models spread an action across the whole clip and run late (1.33 s on average here), so ask for a clip longer than the beat, and cut it down after watching.
   - **References or frames.** References stay the default. Use `firstFrame`, with `lastFrame` if needed, without asking, only on a shot where the exact pose is the joke.
   - **Watching and cutting.** Finish every clip, then `ctx.review`. Use `read_clip_frames` to find where each action really starts and ends, then set `startFrame` and `durationFrames`. Cut after the action completes, enter on movement, and never end on a half-finished pose. A rubric of five items scored 0–2: readable action, the joke's contrast, character and prop continuity, cut and rhythm, picture integrity. At most one retake per shot and two per film, and only when the action is missing, the character drifted or no usable range exists. Then render and review the render once.
   - **Sound and words.** Every film has music unless the person says otherwise. Captions in the person's language, at most 8 characters a line in vertical Chinese and at most 7 characters a second. Sound effects on 3–4 joke points. Use `cover` for vertical so there are no bars.
   - **Money.** Before shooting, estimate the film and say the number in one line. A 30-second film is about $3 with room for two retakes.
2. **`SKILL.md`**: open with a pointer to `film-craft.md`. Replace the rule that `firstFrame` needs the person's request with the policy above. Remove anything `film-craft.md` now says better. Keep it no longer than it is today.
3. **`references/example-plan.ts`**: rewrite so `frame` and `motion` are separate and no prompt is built by template concatenation. It must keep running with the fake models and pass `demo:code`. Do not call anything in `CONTRACT.md` from it yet; the lead adds `review` and captions when Q3 and Q4 are merged.
4. **Default ceiling.** $1 cannot finish a 30-second film. Change the default to $4: `apps/server/src/code-plan/settings.ts`, `STANDARD_LIMIT_MICROS` in `useDefaultLimit.ts`, and any guidance or test that says $1. A stored limit stays as it is.
5. **Director reasoning effort.** `model_reasoning_effort` is pinned to `"low"` in `packages/director/src/runtime/codex.ts` and checked in `setup.ts`. Change it to `"high"`, keeping the setup check consistent, and say in your report what this affects.
6. **Pin** the guidance digest in `director-capabilities.ts`.

## Files you own

`skills/code-plan/**`, `apps/server/src/code-plan/settings.ts`, `apps/server/src/application/director-capabilities.ts`, `packages/director/src/runtime/codex.ts`, `packages/director/src/runtime/setup.ts`, `apps/web/src/next/app/useDefaultLimit.ts`, tests. Leave `skills/code-plan-v1` alone. Do not edit `docs/implementation/STATUS.md`.

## Acceptance

Take the original brief, "做一个 30s 的搞笑视频，主角是一只可爱的柯基，名字叫 Tofu，目的是发社交媒体，需要有配乐", and write in your report the premise, beat sheet and two clip prompts that following `film-craft.md` produces. Do not call any provider.

## Report

Write `docs/ai/film-quality/reports/Q1-report.md`.
