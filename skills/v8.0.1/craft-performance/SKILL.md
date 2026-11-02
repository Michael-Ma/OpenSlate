---
name: craft-performance
description: Performance coverage on camera, mainly for music videos. Singing and lip sync, dance, instruments and full bands, with framing, motion vocabulary, model failure modes and the Singing switch.
---

# Performance

Use when shots show someone singing, rapping, dancing or playing. Read the guide for each performance type the plan uses: [singing](references/singing.md), [dance](references/dance.md), [instruments](references/instruments.md), [full band](references/band.md).

## Singing and lip sync

- Two kinds of sung shot: **sync shots** (the mouth is visible and must match a lyric range) and **non-sync shots** (mouth closed, turned away, wide, or hidden).
- A sync shot is made by the lip-sync model from its keyframe and that stretch of the song, when the person turns on the shot's **Singing** switch in Plan. You cannot set it: name the shots and lyric lines that should sing and ask the person to switch them on. It costs more than a normal clip (about $0.08 per second at 768p); the scene's confirmation shows the exact price.
- Sync shots: face large and steady, frontal or three-quarter, mouth closed or softly parted in the keyframe, simple background, at least 5 s, starting on a phrase. Keep camera motion slow.
- Everything else: write "mouth closed" or frame away from the mouth; the image-to-video model cannot produce correct mouth shapes for a song.
- Plan sync shots only for the hook and a few key lines; the rest is non-sync coverage.

## Dance, instruments and bands

- Dance: design a small vocabulary of simple, repeatable moves first; wide for shape, medium for energy; few dancers; cut on the move's hit.
- Instruments are the highest-risk content: hands, fingering and strings break. Prefer wides, the performer's face and body, and cutaways over hand close-ups; describe handedness consistently.
- Bands: a stage plot first (who stands where), then coverage per player; keep the plot identical across shots.

## Planning fields today

Write the performance type, performer, section and length in beats as a short tag at the start of each shot's `purpose`, for example `[performance · singing · chorus 2 · 8 beats · sync L3–L4]`; see `craft-music-timing` `references/plan-fields.md`.
