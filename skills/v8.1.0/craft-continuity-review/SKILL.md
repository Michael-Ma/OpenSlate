---
name: craft-continuity-review
description: Reviewing returned keyframes and clips. Checks the look first, then characters, then neighbouring shots; names drift concretely and offers remakes as choices, judging only attached or inspected media.
---

# Continuity review

Use when keyframes or clips come back, when the person asks "how does it look?", and before offering video confirmation. Authority, notes and remake rules are in core; this package is the order and vocabulary of the review. Read [the checklist](references/checklist.md) for the per-shot questions and the type-specific gates.

## Order

1. **Look.** Compare each attached keyframe with the saved `visualStyle` traits: palette, light, lens or medium, texture, frame-rate feel. Drift here affects every shot, so it comes first.
2. **Characters.** Identity against the character's identity and approved sheet; the scene's outfit; nothing from another scene's wardrobe.
3. **Neighbours.** Setting, time of day, light direction, screen direction, camera distance, action progression and props between adjacent shots of a scene, and the end state of one shot against the start of the next.
4. **The beat.** Does the frame deliver its job (the hook reads as a thumbnail, the reveal shows the cause, the reaction is readable at phone size, the product is correct)?
5. **Risks.** Text, hands, faces, product fidelity, the punch subject's shape.

## Evidence

Judge only pictures in `attachedKeyframes` and media you inspected. For anything else, describe what changed and offer to look once the person opens it. Copy `seenKeyframe` only from an exact attached entry. Known fixture media is a placeholder; say so.

## Saying it

- One note per concrete point, anchored to the shot. Name the drift precisely: "grain missing", "palette went teal", "the goose has two necks", "his hoodie turned blue", "the screen shows letters".
- Offer the fix as a choice: a `regenerate_keyframe` choice for new frames of named shots, a `remake_clip` choice for 1–4 saved clips in one scene keeping ready keyframes, an `edit_field` choice when a prompt or motion edit is the fix, or a proposal for coordinated prompt changes. Keep the current take as the accept choice of a blocking note.
- Do not start remakes yourself; a technically valid ugly frame is a creative note, not a failure.
- Praise briefly what works; the person needs to know what to keep.

## Clips

A clip's identity and look come from its keyframe. Check the motion delivered one action with the stated end state, the camera move stayed single and steady, faces did not morph, and the cut into the next shot holds. Clip sound: note an effect that helps or hurts the beat; the person keeps or mutes it in Film.
