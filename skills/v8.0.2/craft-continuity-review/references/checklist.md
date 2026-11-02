# Review checklist

Answer per shot; report only failures, each with its fix, in one or two lines.

## Every shot

- [ ] Look: palette, light quality and direction, lens or medium, texture and frame-rate feel match the saved look and the scene's allowed variation.
- [ ] Subject wording delivered: the recurring subject looks like its fixed description (and its approved sheet).
- [ ] Wardrobe: the scene's outfit, nothing from another scene; temporary state (wet hair, mud) as written.
- [ ] Composition fits the aspect: for 9:16, the subject sits in the middle band, top and bottom clear; nothing important under platform buttons.
- [ ] The beat's key image is in the frame (the reveal, the reaction, the product hero).
- [ ] No readable text where text was not supplied; no garbled logos.
- [ ] Hands, faces and the hero subject are anatomically and physically plausible at phone size.
- [ ] The end state of the previous shot leads into this one (screen direction, position, props).

## Clips

- [ ] One subject action happened, with the stated end state.
- [ ] One camera move, steady, no unmotivated zooms or flicker.
- [ ] Faces did not morph during the move; expressions held as written.
- [ ] Clip length covers `desiredFrames`.
- [ ] Clip sound, when kept: helps the beat, does not fight a voice line.

## Type gates

- Comedy: run `craft-comedy` `references/review-checklist.md` section 7 after clips return; watch once with sound and once muted.
- Commercial and showcase: the product's shape, colour and label match the supplied reference in every frame; no invented features.
- Documentary and testimonial: nothing generated is presented as a real person, event or result.
- Music video: sync shots marked Singing have a steady, large face; choruses escalate as planned.
- Kids: no distress, no scary scale or darkness beyond the story's need.

## Fix vocabulary

| Problem | Usual fix |
|---|---|
| Look drift in one shot | `regenerate_keyframe` for that shot, with the look's wording restated in its prompt |
| Look drift across a scene | Rewrite the scene's prompts as one proposal, then remakes |
| Identity drift | Offer the character sheet if missing; otherwise a remake of the shot |
| Garbled text | Prompt the surface blank; remake |
| Wrong expression | Rewrite the keyframe with the expression stated concretely; remake |
| Motion did two things | Split the action across two shots, or simplify the motion prompt |
