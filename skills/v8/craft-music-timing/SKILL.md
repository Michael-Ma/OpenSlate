---
name: craft-music-timing
description: Planning picture to music. Reading analyze_music (measured beats and sections, optional Gemini labels and lyrics after the person's press), mapping sections to scenes, cutting on the beat, fitting shot lengths to the song, and setting the soundtrack.
---

# Music timing

Use whenever a film is cut to a song or its music must hit a moment. Read [song analysis](references/song-analysis.md) before planning to a song, [sections and cutting](references/cutting.md) when writing the section map and shot lengths, and [plan fields](references/plan-fields.md) for how to write music-video intent into today's fields.

## Steps

1. **Find the song.** `read_context` `audio_library` lists owned recordings with role, length and cached timing; a chat attachment counts. If several could be the song, ask which.
2. **Set it.** A music video whose soundtrack was never chosen: `set_soundtrack {audioId, gainMilliDb: 0}`. Other films: `set_soundtrack {audioId}` keeps −18 dB. If the person chose "No music", ask first.
3. **Analyse.** `analyze_music {audioId}`. Plan on the measured tempo, beats, sections and duration. Use `enrichment` section labels, energy and lyrics only when its state is `ready`; when it is `needs_confirmation`, say in one line that Assets › Analyze song sends the song to Google for labels and lyrics, and continue on measured beats.
4. **Map.** One scene per section (merge very short ones); repeated sections are separate scenes so they can escalate. Write the map, felt tempo and assumptions in `story`.
5. **Lengths.** Shot lengths in whole beats or bars at 30 fps (`1800 / BPM` frames per beat), 90–450 frames each. When context `filmPlanning.musicVideo.fit` is present, use its `desiredFrames` and add or remove the shots it reports.
6. **Hits.** Put the strongest image on the first downbeat of a chorus or drop; let a motion peak (a push-in arriving, a turn) land where the cut sits. The video model does not hear the song; the edit makes the sync.

## Never

Present assumed section labels or lyric times as measured; claim you can run song analysis; cut inside a sung word on a singing shot; rely on the model to move in time with the music.
