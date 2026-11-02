---
name: craft-comedy
description: Comedy craft for any type when the goal is to make people laugh (tones include comedy, or the brief says funny, skit, meme, gag, 搞笑, 段子). Premise method, beat maps, timing in the cut, and the checklist before keyframes.
---

# Comedy

Use when `filmKind.tones` includes `comedy` or the brief asks for laughs. This package decides what the joke is and how it is built. Look comes from `craft-visual-style`, prompt wording from `craft-shot-prompting`, authority and tools from core.

## Read at each stage

| Stage | Read with `read_guidance {package: "craft-comedy", path}` |
|---|---|
| Story, before writing any beat | `references/premises-and-beats.md`: premise generators, scoring, the beat map and three worked 20 s examples |
| Story, for a social post | `references/short-form.md`: what the feed rewards, the first second, the 20 s beat map, sound, what AI video does well and badly |
| Any doubt about the joke or its target | `references/comedy.md`: mechanisms, timing, deadpan, who the joke hurts |
| Before saving prompts and before asking for keyframes; again when clips return | `references/review-checklist.md` |

## The method in short

1. **Fixed points** from the brief: audience (default general adult), length, platform, any required subject, family-friendly by default.
2. **Generate 8–12 premises**, one line each, target + violation, from at least three mechanisms (annoyance pushed to the extreme, what-if X were Y, status swap, tone mismatch, scale shift, literalised phrase, misdirection). Drop any that needs on-screen text, lip-synced dialogue, a real person or brand, or a group as the butt.
3. **Score** recognition, surprise, wordless, send-ability, feasibility, fit and safety; zero on surprise, wordless or safety is out. Offer the best two or three as lettered options in the reply, recommend one and draft it; the person can switch.
4. **Write the punch image first**, then the shortest setup that hides it, one build, a beat before (a held look or a music cut), the punch on a cut, and a button that loops to frame 1.
5. **Assign beats to shots.** 20 s: four 5 s shots (rule of three) or three shots of 6 + 6 + 8 s. The punch image is a keyframe; every key expression is a keyframe; one action and one camera move per clip.
6. **Sound.** Works muted; at most one 3–8-word voice line, off-face, in the setup; music with a planned change at the punch. Clip sound is kept for comedy films: name a helpful sound effect in the motion prompt, but never make the joke depend on its exact timing.
7. **Run the checklist** before keyframes. After clips return, judge only inspected media; offer a fix as a choice, never remake on your own.

## Never

Explain the joke; stack two premises; telegraph the punch in frame 1; punch down at a group; depict a real person, voice, brand or logo; stage harm, cruelty or a copyable stunt as funny; rely on readable text.

## Style tendency

`grounded-realism` or `documentary-handheld` for relatable comedy (the absurd element is the only unreal thing); `stylized-3d-feature` or `claymation-stop-motion` for animal, object and cartoon-physics gags; `glossy-commercial` for mock-epic parodies. Avoid looks that blur faces at phone size when the punch is an expression.
