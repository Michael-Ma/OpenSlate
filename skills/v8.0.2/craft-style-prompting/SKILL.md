---
name: craft-style-prompting
description: Turns the film's chosen look into prompt wording. Per-family image templates, negatives, motion grammar and consistency rules for every library style, and how to carry the look in keyframe and motion prompts.
---

# Style prompting

Read the chosen style's family file before writing a look's record or any prompt:

| Family | File | Styles |
|---|---|---|
| Realism | [realism](references/realism.md) | `grounded-realism`, `documentary-handheld`, `glossy-commercial`, `fashion-editorial` |
| Film and period | [film-and-period](references/film-and-period.md) | `noir-bw`, `vintage-film-16mm`, `vintage-film-35mm`, `period-70s`, `period-80s`, `period-90s`, `vhs-camcorder` |
| Stylized live action | [stylized-live-action](references/stylized-live-action.md) | `neon-cyberpunk`, `pastel-storybook`, `dreamy-soft-focus`, `surreal-dreamcore` |
| 2D illustrated | [2d-illustrated](references/2d-illustrated.md) | `anime-2d`, `cel-flat`, `watercolor-ink`, `paper-cutout`, `pixel-art`, `comic-graphic-novel` |
| 3D and tactile | [3d-and-tactile](references/3d-and-tactile.md) | `stylized-3d-feature`, `claymation-stop-motion` |
| Motion graphics | [motion-graphics](references/motion-graphics.md) | `minimal-motion-graphics` |

## Carrying the look today

The application sends prompts to the models exactly as written; it does not add the saved look yet. So:

- **Keyframe prompt** = shot content (subject, action, framing, this shot's light and setting) + the look's `imageBlock` wording, the same words in every shot + positive constraints.
- **Motion prompt** = subject action + one camera move with speed and direction + end state + the look's `motionBlock` reminder (medium and frame-rate feel), nothing more.

## Rules for every style

- The keyframe carries the look. Image-to-video models take the look from the first frame; long appearance text in a motion prompt causes drift and jump cuts.
- At most two or three style descriptors per prompt. Conflicting ones ("photoreal" with "cel-shaded") average into mush.
- Write constraints positively: "camera holds still", "clean flat colour", "blank screens". Most video models ignore negation.
- One camera move and one main subject action per clip.
- Describe looks by traits (palette, light, lens or medium, texture, composition, production design). Never name a living artist, studio or franchise, and never write "in the style of" a person.
- Keep the fixed words fixed: the lens phrase, medium, texture and frame-rate feel appear identically in every shot. Only the scene's allowed variation (time of day, weather, palette shift, lighting key) changes.
- Write prompts in the project's working language; technical terms (35mm, f/2, 12 fps, cel-shaded) may stay in English.
- For animation and stop-motion looks, ask for the frame-rate feel in the motion prompt ("on twos", "stepped stop-motion movement"); models smooth it away otherwise, and these looks usually need more takes.

## Example

Look `grounded-realism`, shot content "the tired man holds one banana over the scanner, red light":

- Keyframe: "Close-up of a tired man in his thirties in a grey hoodie holding one banana over a generic self-checkout scanner, its light glowing red, eyebrows raised; vertical 9:16, centred in the middle band. Natural slightly desaturated colour, flat overhead fluorescent light, 28mm phone-like lens at eye level, visible skin and fabric texture, blank screens."
- Motion: "He lowers the banana and glances down at the bagging area; the red light pulses; camera holds still; ends on his raised eyebrows. Live action, 30 fps phone-video feel."
