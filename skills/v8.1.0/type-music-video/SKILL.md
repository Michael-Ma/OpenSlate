---
name: type-music-video
description: Music videos, performance clips, lyric and visualizer pieces, and any film cut to a song. The song is the timeline; performance, narrative and concept modes are mixed by section and escalate across choruses.
---

# Music video

Routed for `filmKind.kind: "music_video"`. Read [the guide](references/guide.md) for modes, ratios by genre, intercutting, escalation, intake and the planning checklist. Timing comes from `craft-music-timing`, performance coverage from `craft-performance`. Authority and tools are in core.

| Subtype | Leading mode | Notes |
|---|---|---|
| `performance` | Performance | The artist sells the hook; sync shots for key lines |
| `narrative` | Narrative intercut with performance | The story must read with every performance shot removed |
| `concept` | One visual rule, varied per section | No lip sync needed; stylized looks fit |
| `lyric` | Concept with words | Lyric text cannot be generated or overlaid yet: plan imagery for the lines and record the lyric layer as a finishing gap |
| `dance` | Choreography | A small move vocabulary; few dancers |

## Order

1. **The song first.** Find it in `audio_library` (a chat attachment counts). If no soundtrack was ever chosen, `set_soundtrack {audioId, gainMilliDb: 0}`. Then `analyze_music`; plan on measured beats and use enrichment labels and lyrics only when ready. Clip sound is muted for music videos by default.
2. **Intake** in one message with defaults (guide § Intake): song length or cut, who is on screen, the mode mix, which lines need visible lip sync, story or idea, delivery aspect when unknown.
3. **Map** sections to scenes (`craft-music-timing` `references/cutting.md`); write the section map, ratio per section and escalation plan in `story`.
4. **Shots** name their mode, performer, section and length in beats in a `purpose` tag. Every performance section has at least two angles; every high-risk shot (hands on instruments, fast choreography, crowds) has a safer alternative.
5. **Singing.** List the shots and lyric lines that need lip sync and ask the person to switch those shots to Singing in Plan; sync shots follow `craft-performance` `references/singing.md`.
6. **Look**, prompts, keyframes and confirmation as in core. Fit lengths with `filmPlanning.musicVideo.fit` when present.

## Story and style

Story unit: the song section. Core: the video's rule or image. First framework: mode ratio plus escalation (Story Spine fragments for narrative mode). Avoid illustrating every lyric line literally. Style: any library look; concept mode favours stylized looks; band and live-session videos favour grounded or period film looks.

## Never

Invent timestamps or lyrics as measured; generate an identifiable real artist without their supplied photos for that purpose; cut inside a sung word; rely on the video model to move in time.
