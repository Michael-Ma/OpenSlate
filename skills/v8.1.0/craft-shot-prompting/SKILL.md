---
name: craft-shot-prompting
description: How to write each shot's keyframe and motion prompts so the image model and the image-to-video model deliver the beat. One frozen state per keyframe, one action and one camera move per clip, composed for the film aspect.
---

# Shot prompting

Use when writing or revising `imagePrompt`, `videoPrompt`, `motion` and `framing`. The look's wording comes from `craft-style-prompting`; read [keyframe and motion prompts](references/prompts.md) (one file) for the full patterns and failure fixes.

## Keyframe prompt (`imagePrompt`)

Write the frozen state of the beat, not a sequence:

1. Framing and angle ("Medium-wide, eye level").
2. The subject, described with the same words in every shot it appears in.
3. The action as a held state ("holds the empty bag upside down, staring into the lens").
4. Setting and this shot's light.
5. Composition for the aspect: for 9:16, the subject centred in the middle band, top and bottom kept clear; for 16:9, rule-of-thirds with room in the direction of movement.
6. The look's image phrase, then positive constraints ("blank unlit screen").

The most important image of the beat (a reveal, a reaction face, the product hero) is always the keyframe itself; motion only reveals or holds it. Never ask the keyframe for readable text.

## Motion prompt (`videoPrompt`, `motion`)

One subject action, then one camera move with speed and direction, then the end state, then the look's motion reminder: "He shakes the bag once, then freezes and stares into the lens; slow push-in; ends on his still face. Live action, 30 fps." Use positive words ("camera holds still"). Match the action to the clip length; split multi-step action across shots. The end state should match the next shot's start.

## Shot fields

- `framing`: a 1–3-word label (Close-up, Medium, Medium wide, Wide, Low-angle medium).
- `purpose`: the beat's job ("Punch: the cause is a goose") plus composition notes.
- `action`: the visible action in plain words.
- `desiredFrames`: the cut length at 30 fps (90–450).
- Characters: name them in prompts by name only when they are cast with `characterIds`; the application adds their identity, wardrobe and sheet (see `craft-characters`).

## Before saving

Every shot: one action, one camera move, a stated end state; the beat's key image in the keyframe; no readable text; hands kept out of the critical moment; the recurring subject worded identically; the look's wording identical across shots.
