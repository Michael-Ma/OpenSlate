---
name: craft-visual-style
description: Choosing and keeping one look for the film. Shortlists two or three styles from the library, offers them as a style card with propose_visual_style, saves the chosen visualStyle and keeps scenes and shots on it.
---

# Visual style

One look per film, saved as `project.visualStyle`. This package chooses and keeps it; `craft-style-prompting` turns it into prompt wording. Authority and tools are in core.

## When

After the beat map is saved and before keyframe prompts are final. If the person already named a look ("make it claymation", "like old home movies"), map it to the nearest style ID plus overrides, save it, and confirm in one line. Never name a living artist, studio or franchise; translate a named one into traits and say so.

## Shortlist and offer

1. Read the brief, story, supplied references and the type package's style tendency. Note hard constraints: real product photos (photographic styles only), a real person's supplied photos, readable logos, kids, platform.
2. Pick 2–3 from [the library](references/library.md): the **safe** best fit, a **distinct** alternative, optionally a **bold** one. Drop any whose failure modes collide with the brief (readable text with `pixel-art`, a real product with `watercolor-ink`, phone-size faces with `surreal-dreamcore`).
3. Call `propose_visual_style` with one complete look per option ([the record](references/record.md) shows every field), plus `fits` (one line, why it suits this brief), `risk` (one line, the main risk with current models), `cost` when it usually needs more takes (animation, stop-motion), and `tier`. Keep `text` to one sentence.
4. Say in one line that the card is in the chat and nothing changes until they choose. If they answer in chat instead ("B"), save that option's look with `prepare_change` `creative.project.visualStyle`, using the same record.
5. With no reply and work waiting, continue writing prompts in the safe option's wording; they are text and change cheaply.

## After a look is chosen

- The application does not add the look to prompts yet. Every keyframe prompt carries the look's image phrase and every motion prompt its short motion reminder, with identical wording in every shot (see `craft-style-prompting`).
- Changing the look later means rewriting every prompt. When shots have media, offer the rewrite as one `propose_change` and offer remakes as choices; earlier takes stay in history.

## Variation between scenes

A scene may vary only along the saved `variationAxes`: time of day, weather, a warmer or cooler palette, high or low lighting key. Medium, lens family, texture and frame-rate feel never change. A `treatment` (flashback in monochrome, a dream) needs the person's choice and is still one look. Write the scene's variation in its `purpose` and in its shots' prompts.

## Drift

In continuity review, compare each attached keyframe with the look's traits before comparing neighbours. Name the drift concretely ("grain missing", "palette went teal", "faces turned glossy") and offer a remake choice; never remake on your own.

## Defaults by type

Commercial and showcase: `glossy-commercial` or `grounded-realism`. Social and comedy: `grounded-realism`, `documentary-handheld`, or `stylized-3d-feature` for cartoon physics. Kids: `pastel-storybook`, `stylized-3d-feature`, `paper-cutout`. Documentary: `documentary-handheld`, no stylization. Explainer: `cel-flat`, `minimal-motion-graphics`. Music video: any; concept mode favours stylized looks.
