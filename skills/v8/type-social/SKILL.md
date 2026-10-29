---
name: type-social
description: "Native social posts for a feed (Reels, TikTok, Shorts, Douyin, Xiaohongshu) made to entertain, be sent and rewatched: skits, POV, memes, trends, day in the life, storytime, tips, before and after."
---

# Social post

Routed for `filmKind.kind: "social"`. Success is a laugh, a send to a friend or a rewatch, not a sale (that is `commercial`). Vertical format rules come from `format-social-vertical`; this package is the structure. Authority and tools are in core.

## Engine

Pick one by the goal, then read its guidance with `read_guidance`:

| Goal | Engine | Read |
|---|---|---|
| Make people laugh (`tones` includes `comedy`; `skit`, `meme`, `pov`, `trend`) | Premise + beat map | `craft-comedy` (already in context when routed) and its `references/premises-and-beats.md` at the story stage |
| Wow or satisfy (`before_after`, reveals) | Hook → promise → payoff | `craft-story` |
| Teach a tip (`tips`) | List of three | [formats](references/formats.md), and `type-explainer` `references/tutorial.md` for steps |
| Relate or feel (`day_in_the_life`, `storytime`) | Mini-story with one turn | [formats](references/formats.md), `craft-story` frameworks |

## Path for a funny post (for example "a 20 s funny social video for IG")

1. **Intake.** Save `filmKind` `{kind: "social", subtype: "skit", tones: ["comedy"], format: {platform: "ig_reels", aspect: "9:16", targetSeconds: 20}}` with `basis` per field; no question when nothing is missing. Say the inference in one line ("Skit for Reels, 9:16, 20 s; say if you want a POV instead").
2. **Premise.** Read `craft-comedy` `references/premises-and-beats.md`. Generate, score, and offer the best two or three premises as lettered options with one line each; recommend one and continue with it.
3. **Beat map.** Write it in `story`: hook/setup, build, beat before, punch, button/loop. Save one scene per beat or one scene with 3–4 shots: four 5 s shots (150 frames) for a rule of three, or three shots of 180, 180 and 240 frames. The punch shot keeps at least 150 frames.
4. **Look.** Offer two or three looks with `propose_visual_style` (`craft-visual-style`): usually `grounded-realism` (safe), `documentary-handheld` (native phone feel) and `stylized-3d-feature` for animal or cartoon-physics gags.
5. **Prompts.** Keyframe = the frozen state of each beat, the punch image itself in the last keyframe, one big held expression per face, 9:16 composition in the middle band, blank screens and signs. Motion = one action, one camera move, the end state. Carry the look's wording (`craft-style-prompting`).
6. **Sound.** Clip sound is kept by default for social films: name a sound effect that helps a beat in its motion prompt. Music with a change at the punch (set its start with `set_soundtrack` when a track is supplied). At most one 3–8-word voice line, off-face, in the setup.
7. **Check.** Run `craft-comedy` `references/review-checklist.md` sections 1–6 before asking for keyframes. Then keyframes when the person asks, review, the `confirm_video` card per scene, and `start_export` when they ask for the export. Remind once that realistic synthetic video should carry the platform's AI label.

## Shape of every post

- Frame 1 is the hook: subject, situation and one odd detail, readable as a thumbnail; no title, no fade-in, no establishing wide. Do not spend the payoff on frame 1.
- The game is clear by 3 s; the payoff lands on a cut; the last frame cuts back to the first or ends on a button.
- 15–20 s by default; one idea per post; text-free (Film has no captions yet), so reject premises that need "POV:" or "me when…" captions or turn the caption into one voice line.
- Original: never copy a living creator's bit, a real person, a real brand or logo, a fake news or prank framing, or a dangerous challenge.

## Story and style

Story unit: the beat. Core: the premise (target + violation) or the promise. Style tendency: grounded or handheld realism for relatable posts, stylized 3D or claymation for cartoon physics; avoid looks that blur faces at phone size.
