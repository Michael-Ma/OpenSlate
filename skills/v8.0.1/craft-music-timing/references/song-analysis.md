# Song analysis and fitting shots to a song

## What `analyze_music {audioId}` returns

Free and read-only in every turn; it never changes the film and never sends audio anywhere.

- **Measured** (always, from this computer): `tempo` (BPM, or null when no steady beat), `beats` (30 fps frames), `durationFrames`, local `sections` (start frames from loudness changes, snapped to beats), and suggested shot lengths per section. These are facts; plan on them.
- **`enrichment`** (song analysis by Gemini, only after the person's press):

| `enrichment.state` | Meaning | What to say or do |
|---|---|---|
| `ready` | Labelled sections (intro, verse, pre-chorus, chorus, bridge, solo, outro) with mood, energy and snapped start/end frames; vocal ranges; timed lyrics; `audioLeftMachine` | Use labels, energy and lyrics for the section map. The measured beats and duration stay authoritative. |
| `needs_confirmation` | A key is set and this recording has not been analysed; includes a quote | One line: "Assets › Analyze song gives section labels and lyrics; it sends the song to Google and costs about $0.02." Plan from the measured beats meanwhile. |
| `running` | The analysis is in progress | Plan from measured beats; offer to refine when it finishes. |
| `failed` | `code`, `reason`, `charged: "no" \| "maybe"` | Report it plainly; a retry is the person's press. |
| `unavailable` | No key, the song is too long, or no analyzer | Plan from measured beats; do not mention keys unless asked. |

You can never start song analysis, and a chat reply is not consent: it sends the person's song to Google, so only their press in Assets starts it.

## Without enrichment

Name sections from the measured section starts and their energy, and write the map in `story` as assumed: "intro 0:00–0:12, verse 0:12–0:40 (assumed), chorus 0:40–1:05 (assumed)". Never present assumed labels or lyric times as measured.

## Fitting the film to the song

When the film is a music video with a soundtrack, context `filmPlanning.musicVideo` carries the song's seconds, BPM, section starts and a fit: the `desiredFrames` per shot that matches the song's length with cuts snapped to beats and scene ends to sections, plus `shortfallFrames` (add shots) or `overflowFrames` (remove shots). Write the fitted lengths with `prepare_change` `updateShots[].desiredFrames` on shots without media; on shots with media, propose them. Never silently add or drop shots to absorb a shortfall; say what you will add.

## Lengths

- Beat in frames at 30 fps: `1800 / BPM`. At 120 BPM a beat is 15 frames, a 4/4 bar 60 frames.
- Shots are 90–450 frames (3–15 s). Round a planned length to whole bars where possible.
- A shot with a sung, lip-synced phrase needs at least 150 frames (5 s), the lip-sync minimum, and should start on a phrase boundary.

## Music for films that are not music videos

The soundtrack plays under the whole film at −18 dB by default, under narration and clip sound. Choose or change it with `set_soundtrack`; its start frame lets a swell or a drop land on the punch or the reveal. Ask before overriding a "No music" choice.
