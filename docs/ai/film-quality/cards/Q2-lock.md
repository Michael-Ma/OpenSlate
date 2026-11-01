# Q2 · Pictures made from pictures, so the room stays the same room

Read `docs/ai/uiux-plan/codex/RULES.md` first; its hard rules apply in full. Then `docs/ai/film-quality/research-continuity.md`, section 2 and section 5, and `cards/CONTRACT.md`.

## Problem

Background similarity is 0.886 inside a clip and 0.403 across a cut. The room changes because eight keyframes were generated independently. The fix belongs at the picture stage, and that stage costs $0.

`ctx.image` already passes `references` to Codex images by accident, and three things stop anyone relying on it:

| Item | Today | Where |
|---|---|---|
| API | `references` is not declared; it works through an index signature | `studio.d.ts:11` |
| Checks | Nine references, or a video artifact, pass the plan and fail at dispatch | `identity.ts` validates video only |
| Portrait | `width`/`height` must match the profile, so code mode always asks for 1024×1024 | `provider-input.ts` |

Graph mode already gets 1024×1536. The Tofu v6 keyframes came back 941×1672 because the Director asked for it in prompt text.

## Change

1. **Declare it.** Add `references` and `aspectRatio` to `image` in `studio.d.ts` exactly as `CONTRACT.md` says.
2. **Check at plan time.** In `identity.ts` and `provider-input.ts`: every reference is an owned image artifact, at most the model's limit (Codex 8), PNG; a plan breaking this is refused at dry run with a message naming the fix. Keep byte and size limits from `codex-image-authority.ts` in one place.
3. **Aspect ratio.** Find out what `codex-image` can really request. Map `aspectRatio` to its real sizes, and make `9:16` and `16:9` work, using the closest size the adapter can request if there is no exact one. Say in your report what a real call is expected to return. `aspectRatio` is part of step identity only when present, so an unchanged plan keeps its keys. `openai-image` and any other image model states what it accepts; an unsupported ratio is refused at plan time.
4. **`read_film.models`** lists `imageAspectRatios` and `maxReferences` for image models.
5. **`lastFrame` crop.** In `viggle-h3-execution.ts` the first frame is centre-cropped to the requested ratio and the last frame is not, so a first-and-last pair is misaligned. Crop both the same way and record both in the step's call facts. `firstFrameCrop` stays; add `lastFrameCrop`. Do not change what `references` do: they stay uncropped.
6. **Tests**, offline: portrait and landscape dry-runs and dispatch with the fake Codex image path; nine references, a video reference and a foreign artifact refused at dry run; an existing plan with `ctx.image({prompt})` keeps its step key; `read_film.models` facts; a first-and-last pair cropped alike.

## Files you own

`apps/server/src/code-plan/identity.ts`, `provider-input.ts`, `models.ts`, `apps/server/src/execution/codex-image*.ts`, `apps/server/src/execution/viggle-h3-execution.ts`, `skills/code-plan/references/studio.d.ts` (the `image` line only), tests.

Do not edit `SKILL.md`, `film-craft.md`, `example-plan.ts` or `docs/implementation/STATUS.md`. Put any guidance the Director needs in your report; the lead merges it.

If `studio.d.ts` changes the guidance digest, update the pin in `director-capabilities.ts`. The lead recomputes it at merge.

## Report

Write `docs/ai/film-quality/reports/Q2-report.md`.
