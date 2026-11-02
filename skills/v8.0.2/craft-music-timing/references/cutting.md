# Song sections and cutting on the beat

Use with the song's measured timing from `analyze_music` (see [song analysis](song-analysis.md)).

## Mapping song sections

Plan scenes on section boundaries. One scene per section is the default; merge short sections (a 4-bar pre-chorus) into the next scene, and split a long section only when the location or mode changes. Repeated sections (chorus 1, 2, 3) are separate scenes so each can escalate.

| Section | Job in the edit | Default mode | Shot rhythm |
|---|---|---|---|
| Intro | Establish world, artist and the rule of the video. Can start before the music. | Concept or narrative; performance reveal at the downbeat of the first vocal. | Longest holds. 1–3 shots. |
| Verse | Develop the story or the idea; let the lyric breathe. | Narrative or concept, intercut with verse performance (singles, close). | Medium. Cut on phrase ends (2–4 bars). |
| Pre-chorus | Build tension; signal the turn. | Mixed; tighten framing, add movement toward the subject. | Accelerating; cuts every bar, then every 2 beats. |
| Chorus | Pay off. Biggest, clearest, most repeatable image. The hook's lyric gets the face. | Performance first; narrative peaks intercut. | Fastest on-beat cutting of the song. |
| Post-chorus, drop | Physical release: dance, crowd, instrument hits. | Performance or concept. | On-beat or half-beat; slow motion on the hit. |
| Bridge, middle 8 | Break the pattern: new location, light, mode, or a narrative turn. | Narrative or concept; often the only place without performance. | Slower than chorus; longer held shots. |
| Instrumental break, solo | Feature the instrument or the dance. | Performance of the featured part. | Follows the solo's phrasing. |
| Final chorus | Climax. All threads converge. | Performance and narrative resolution intercut. | Fastest cutting, widest scale, most energy. |
| Outro | Release and an ending image the viewer remembers. | Narrative resolution or concept final state. | Long holds; last shot outlasts the music by a beat or two. |

If the song's sections are not known, ask for them or for the audio, or state the assumed structure (for example "intro 8 bars, verse 16, pre 8, chorus 16") in `story`. Never invent timestamps as measured facts.

## Cutting on the beat

Each shot is one clip of 3–15 s, and Film plays its first `desiredFrames`. Plan each shot's used length in beats, then set `desiredFrames` to it.

- Beat length in frames at 30 fps is `1800 / BPM`. At 120 BPM a beat is 15 frames, a bar of 4/4 is 60 frames (2 s), and a 6 s clip holds 3 bars.
- At double-time tempos (drum and bass at 170+, trap with half-time drums) count the felt pulse, usually half the BPM.
- Cut on the downbeat or 1–2 frames before it; a cut that lands late reads as off-beat. Big changes (location, mode, wardrobe) go on bar 1 of a section.
- Do not cut on every beat. Cut on the beat where the music changes, on a lyric word, or on a visible action hit. Constant cutting tires the viewer and hides the performance.
- Never cut inside a sung word on a lip-sync shot; cut between phrases or on a breath.

Working shot-length defaults:

| Tempo (felt) | Verse | Chorus | Bridge, outro |
|---|---|---|---|
| Under 80 BPM | 2–4 bars (often the full clip) | 1–2 bars | Full clip, slow move |
| 80–110 BPM | 1–2 bars | 2 beats–1 bar | 2 bars |
| 110–140 BPM | 1 bar | 1–2 beats | 1–2 bars |
| Over 140 BPM, or high-energy drop | 2 beats–1 bar | 1 beat; half-beat flashes on hits | 1 bar |

Fast cutting multiplies generated shots, and a cut shorter than 3 s is not available: each shot plays its own clip from its start, and one clip cannot yet supply several cuts. So cut on bars rather than beats at high tempos, put the beat-level energy inside the clip (a hit, a turn, a light change), and alternate two or three performance angles (wide, single, close) across a section as a live edit alternates cameras.

Choose the motion so its peak lands where the cut will sit: a push-in that arrives at the downbeat, a hair flip at the hit, a stick strike in the first half second. The video model does not hear the song; the edit makes the sync. Prefer motion that reads at any tempo (sway, slow push, held pose, drift) over motion with its own rhythm (fast steps, strumming at a visible speed) unless the shot is short.

