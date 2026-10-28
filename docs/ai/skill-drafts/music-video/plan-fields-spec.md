# Music video plan fields (spec only)

Status: proposal. Nothing here is implemented, and the 6.0.0 contract does not accept these fields. Other owners are responsible for lip-sync execution, soundtrack analysis (sections, tempo, beats) and code. This spec says only what the plan must carry so the Director's music-video guidance can be saved, checked and executed. Names are suggestions.

## Principles

- The song is the timeline. Shots refer to song positions; the application turns them into frames.
- Measured audio facts (section times, BPM, beat grid) come from soundtrack analysis or the person, never from the Director. The Director may record assumed structure and mark it `assumed`.
- Director-authored fields are creative intent. They do not grant lip-sync work, generation or acceptance.

## Project level: `musicVideo`

| Field | Type | Owner | Purpose |
|---|---|---|---|
| `songArtifactId` | artifact ID or null | person / app | The song the video is cut to. |
| `span` | `{startMs,endMs}` or `"full"` | person | Whole song or a cut (hook, vertical). |
| `tempo` | `{bpm, feltBpm?, timeSignature, source: "measured"\|"stated"\|"assumed"}` | audio / Director if assumed | Shot-length math (`1800 / feltBpm` frames per beat at 30 fps). |
| `sections` | `[{id, kind, occurrence, startMs?, endMs?, bars?, energy?, source}]` | audio / Director if assumed | `kind`: `intro`, `verse`, `pre_chorus`, `chorus`, `post_chorus`, `drop`, `bridge`, `break`, `solo`, `outro`. `occurrence` numbers repeats (chorus 1, 2, 3). |
| `lyrics` | `[{sectionId, lineIndex, text, startMs?, endMs?}]` | person / audio | Lip-sync ranges and lyric-led cuts. |
| `modeMix` | `{performance, narrative, concept}` percentages | Director, confirmed at intake | Target ratio; per-section overrides allowed. |
| `performers` | `[{id, name, role, performanceTypes[], referenceArtifactIds[], instrument?}]` | Director from brief | `role`: `lead_vocal`, `backing_vocal`, `rapper`, `dancer`, `instrumentalist`, `dj`. `instrument`: `{type, description, handedness: "right"\|"left", stringOrKeyCount?}`. |
| `stagePlot` | text | Director | Positions, facing, light source per setup (see band guide). |
| `moveVocabulary` | `[{id, name, description, use: "signature"\|"groove"\|"hit"}]` | Director | Named dance moves reused across choruses. |
| `escalation` | `[{sectionId, axes[], note}]` | Director | What changes from chorus to chorus. `axes`: `scale`, `proximity`, `light`, `cut_rate`, `camera_energy`, `location`, `narrative_stakes`. |

## Scene level

| Field | Type | Purpose |
|---|---|---|
| `songSectionIds` | section ID list | The section(s) the scene covers. Usually one. |
| `setupId` | string | Performance location and look shared across scenes (lets chorus 1 and 3 reuse a setup). |
| `modeMix` | optional override | Section-level ratio. |
| `lightState` | short text | Light look for the section; changes are escalations. |

## Shot level

| Field | Type | Purpose |
|---|---|---|
| `mode` | `"performance"\|"narrative"\|"concept"` | Required on every MV shot. |
| `performanceType` | `"singing"\|"rap"\|"dance_solo"\|"dance_group"\|"guitar"\|"bass"\|"drums"\|"keys"\|"strings"\|"brass_wind"\|"dj_electronic"\|"band"` or null | Required when `mode` is performance. Selects guidance and checks. |
| `performerIds` | performer ID list | Who is in frame; the first is the focus. |
| `songSectionId` | section ID | Section the shot plays in. |
| `songPosition` | `{bar, beat}` or `{startMs}` | Intended in-point. Resolved against the beat grid by the app. |
| `beats` | integer | Used length in beats; the app derives `desiredFrames` from tempo. |
| `cutOn` | `"downbeat"\|"beat"\|"lyric"\|"action"\|"free"` | What the in-cut aligns to. |
| `clipWindow` | `{startFrame, endFrame}` or list | Which part(s) of the ~6 s generated clip the edit uses; a list lets one clip serve several cuts. |
| `coverageRole` | `"master"\|"single"\|"two_shot"\|"insert"\|"cutaway"\|"atmosphere"\|"crowd"` | Lets the app check each section has at least two angles to cut between. |
| `lipSync` | `{need: "none"\|"sync"\|"mouth_closed", performerId?, lyricLineRefs[]?, framingOk?}` | `sync` asks the lip-sync owner to match the listed lines. `mouth_closed` tells generation to keep the mouth closed. `framingOk` is the Director's claim that the shot meets the singing framing rules (face size, unobstructed, frontal to three-quarter, steady). |
| `risk` | `"low"\|"medium"\|"high"` | High for hands on instruments, fast choreography, groups over three, crowds, partner contact. |
| `fallbackShotId` | shot ID or null | Planned cutaway to use if a high-risk shot fails review. Required when `risk` is high. |
| `intercutGroupId` | string | Shots that alternate as one edited passage (performance angles of one section, or a narrative thread). |
| `escalationLevel` | integer | 1 for chorus 1, rising for later repeats; supports the no-repeat check. |
| `playbackSpeed` | number, default 1 | Intended speed, for example 0.5 for slow-motion hits. |
| `moveId` | move ID or null | Named dance move from `moveVocabulary`. |

## Checks the application could run

- Every MV shot has `mode`; performance shots have `performanceType` and `performerIds`.
- Each `sync` shot has lyric lines inside its section and `framingOk: true`; at most one `sync` performer per shot.
- High-risk shots have a `fallbackShotId` in the same section.
- Each performance section has at least two `coverageRole` values to alternate.
- Repeated sections do not reuse identical prompts; `escalationLevel` rises.
- Section mode mix stays within an agreed tolerance of `modeMix`, reported as a gap rather than a refusal.
- Instrument `handedness` and description are consistent across a performer's shots.
- `beats` times frames per beat does not exceed the generated clip length unless the shot is planned as a loop or extension.

## Interim encoding before fields exist

Until the contract accepts these fields, the Director can write the same intent in existing text: section map, tempo, ratio, stage plot, move vocabulary and escalation in `story`; a short leading tag in each shot `purpose`, for example `[performance · singing · chorus 2 · 4 beats · sync L3–L4]`; fallbacks named in `purpose`. This keeps the intent visible in Plan without inventing schema fields in payloads.
