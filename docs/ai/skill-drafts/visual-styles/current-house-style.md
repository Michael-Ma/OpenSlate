# Where the current house style comes from

Draft for v8. Code references are to `feature/last-ferry-ui` at `78aac6e`.

## Finding

No shipped file holds the look. The phrase "现场壁灯或顶灯提供有来源的侧光，肤色中性，保留墙地磨损、衣料褶皱和皮肤纹理；不使用蓝橙整体染色、浓雾、泛光或磨皮" does not appear in any skill, server module, provider adapter or fixture. I checked these places:

- `git grep` on every local branch (`feature/last-ferry-ui`, `cx/*`, `fix/*`, `main`) for 蓝橙, 磨皮, 壁灯, "skin texture" and "teal-orange". Nothing matched.
- A filesystem grep over every worktree, `skills/`, `apps/` and `../OpenProducer`. Nothing matched.
- `skills/v7/production/**` has no palette, grade, grain or lens guidance at all.

The Director writes the house style itself each time, from the model's own default sense of what keeps AI frames from looking fake. The text below lets that default appear and then keeps it alive.

| Where | file:line | Effect |
|---|---|---|
| Story stage asks for a "recurring visual idea" but gives it no structure | `skills/v7/production/references/stages/story.md:5` | The model makes up a look, in free prose. |
| Storyboard stage says to choose "lighting" | `skills/v7/production/references/stages/storyboard.md:3` | The model falls back on motivated practical light, the "有来源的侧光" in the example. |
| Continuity tells it to match lighting with neighbouring shots | `skills/v7/production/references/continuity-review.md:3` | Whatever one prompt says gets copied into every shot. |
| Planning guidance says long visual descriptions go in prompts | `apps/server/src/application/film-planning-guidance.ts:27` | The look ends up as loose prose inside every `imagePrompt`/`videoPrompt`, not as a single field. |
| Prompt edits keep the earlier prompt text | `apps/server/src/application/shot-prompts.ts:5-16` (`editedPrompt` keeps the old text under "Reference details (retain only where consistent)") | Once a style line is in a prompt, it survives every later edit. |
| Prompts go to the provider exactly as written | `apps/server/src/scene-generation.ts:180-184`, `apps/server/src/execution/engine.ts:949`, `apps/server/src/execution/codex-image-authority.ts:145`, `packages/director/src/media/codex-image.ts:40` | No layer adds or removes style. Whatever the Director wrote is what gets rendered. |
| Data model has no style field | `packages/core/src/contracts.ts` (`ShotRecord`; project `brief`, `story`, `scenes[]`) | The look has nowhere to live except inside each prompt. |

I did not read the live project data. A brief or story that asked for realism would push the model the same way.

## How to make it selectable

1. Name the current look `grounded-realism` (see [realism.md](realism.md#grounded-realism)) and make it the default only when the brief says nothing about look and the person accepts it. Never apply it silently.
2. Store the chosen style once in the plan, as `project.visualStyle` (spec in [index.md](index.md#plan-field-spec)). Shot prompts then hold only shot content: subject, action, framing, light direction for this shot, and camera move.
3. Have the application put prompts together as `shot direction + scene variation + style block + negatives`, at compile time. Include the style revision in `shotIntentDigest` and in the scene intent digest (`scene-generation.ts:180`), so that changing the style marks existing media stale and goes through `propose_change` like any other media input.
4. Change `editedPrompt` so it removes the compiled style block before carrying text forward. Otherwise old and new styles pile up across edits.
5. In v8 skills:
   - Replace "recurring visual idea" in `story.md` with "propose 2–3 styles from the library; save the chosen style in `visualStyle`".
   - In `storyboard.md`, add "write shot content only; never restate the global style".
   - In `continuity-review.md`, add "check each frame against the `visualStyle` anchors".
6. Migration: for an existing project with no `visualStyle`, offer `grounded-realism` with the negatives the model already uses, and leave existing prompts alone until the person accepts.
