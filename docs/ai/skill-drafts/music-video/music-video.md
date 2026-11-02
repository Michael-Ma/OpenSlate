# Music video

Read when the brief is a music video, a performance clip, a lyric or visualizer piece, or any film cut to a song. A music video is not a short film with a soundtrack. The song is the timeline: its sections, tempo and hooks decide scene boundaries, shot lengths and where the strongest images land. Plan from the song first, then fit story and performance into it.

Load the performance guide for each performance type the plan uses: [singing](performance-singing.md), [dance](performance-dance.md), [instruments](performance-instruments.md), [full band](performance-band.md). Plan fields the application needs are in [plan fields](plan-fields-spec.md). Visual style belongs to the visual-style guidance; this file covers only MV-specific structure.

## Three modes

Every shot is one of three modes. Name the mode of each shot before writing prompts.

- **Performance.** The artist sings, raps, dances or plays to the song. It sells the artist and the hook. Its truth is sync: mouth to lyric, body to beat, hands to instrument.
- **Narrative.** Characters act out a story with cause and effect, told without dialogue. It gives the viewer a reason to keep watching through verses. The story can be partial or fragmented; it only needs a clear situation, a turn and an ending image.
- **Concept.** One governing visual idea, rule or metaphor, repeated and varied: a world, a transformation, a graphic device, a single continuous gesture. It has no plot and no lip sync requirement. Lyric videos and visualizers are concept videos.

Hybrids are the norm. The usual hybrid is performance plus narrative, with the artist sometimes entering the story world. A concept video may include performance inside its rule (the artist sings while the room floods).

## Choosing the ratio

Pick a performance / narrative / concept split by screen time, write it in `story`, and keep each section close to it. These ranges are working defaults, not industry rules; the brief overrides them.

| Genre or brief | Performance | Narrative | Concept | Notes |
|---|---|---|---|---|
| Pop, dance-pop | 50–70% | 20–40% | 0–20% | Performance includes choreography. Hook gets performance. |
| K-pop, J-pop idol | 55–75% | 0–20% | 20–40% | Choreography sets plus concept sets; member singles rotate. |
| Hip-hop, rap | 60–85% | 10–30% | 0–20% | To-camera lip sync carries it; lifestyle cutaways count as narrative. |
| R&B, soul, ballad | 40–60% | 30–60% | 0–20% | Intimate singing coverage; slow narrative. |
| Singer-songwriter, acoustic | 50–80% | 20–50% | 0–10% | One performer, one or two locations. |
| Rock, punk, metal | 60–90% | 10–40% | 0–20% | Band performance is the identity of the genre. |
| Indie, alternative | 20–50% | 20–50% | 20–60% | Concept-heavy is common and expected. |
| Country, folk | 30–50% | 40–60% | 0–10% | Story songs follow the lyric literally. |
| EDM, electronic, instrumental | 0–30% | 30–70% | 30–70% | Often no vocalist; DJ or producer performance is a seasoning. |
| Jazz, classical, live session | 80–100% | 0–10% | 0–20% | Musicianship is the content; instrument accuracy matters most. |
| Lyric video, visualizer | 0–10% | 0–20% | 80–100% | Typography or abstract motion; text is owned by the edit, not the image model. |

Adjust for the brief:

- Artist launch, fan-facing, "show the artist": raise performance. Recognizable face and voice matter more than plot.
- Campaign, brand partnership, story-driven song, or "make it cinematic": raise narrative.
- No artist on screen, no supplied likeness, or a virtual character: concept or narrative with a recurring avatar; drop lip-sync shots or keep them few.
- Instrument-heavy performance is the highest-risk content for image and video models. When the song is band-led but accuracy matters more than presence, keep the ratio but spend it on wides, singer coverage and cutaways rather than hand close-ups (see [instruments](performance-instruments.md)).
- Short delivery (vertical, under 30 s): one mode, maybe two. Use the hook only, mostly performance.

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

The clip model returns about 6 s per shot. The edit uses only part of most clips. Plan each shot's used length in beats, then let `desiredFrames` reflect the used length.

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

Fast cutting multiplies generated shots. Instead of one new clip per cut, generate two or three performance angles for a section (wide, single, close) and alternate windows from them across the section, as a live edit alternates cameras. Use a 6 s clip for up to three cuts when the action loops cleanly. Mark which window of the clip each cut uses (see [plan fields](plan-fields-spec.md)).

Choose the motion so its peak lands where the cut will sit: a push-in that arrives at the downbeat, a hair flip at the hit, a stick strike in the first half second. The video model does not hear the song; the edit makes the sync. Prefer motion that reads at any tempo (sway, slow push, held pose, drift) over motion with its own rhythm (fast steps, strumming at a visible speed) unless the shot is short.

## Intercutting

- Default pattern: verses carry narrative intercut with close performance; choruses carry performance intercut with narrative peaks.
- Cut between modes on phrase boundaries (end of a 2- or 4-bar line), not mid-line. Within a line, stay in one mode.
- Link the modes visually: match a shape, a movement direction, a color or an eyeline across the cut. The performer can look toward where the story character is.
- Let the lyric choose the narrative beat: when a line names an action or object, cut to it on that word. Do this a few times per song, not every line.
- Give the narrative continuity across its interruptions: the story must read if every performance shot is removed.
- Cross-pollinate once or twice: the performer appears inside the narrative world, or a story character mouths the hook. This ties the threads and is a strong final-chorus device.
- Keep performance locations few (one to three) and recognizable so the viewer reorients instantly after each narrative stretch.

## Escalation across choruses

Repeated sections must not repeat shots. Plan each chorus as a step up and write the steps in `story`.

- **Chorus 1:** establish the performance look in its simplest form. One location, the artist, clear framing.
- **Chorus 2:** add one dimension: more dancers or band members, a second location, a wider lens, a lighting change, faster cutting, a narrative complication cut in.
- **Bridge:** change the rules. Strip back, move somewhere new, slow down. This makes the last chorus land.
- **Final chorus:** the largest scale and fastest rhythm of the video. Bring back every location or thread, resolve the narrative inside the chorus, and use the strongest image of the video on its first downbeat. Hold the last shot.

Escalate along one or two axes, not all: scale (people, space), proximity (wider to closer, or the reverse), light (day to night, practical to strobe), cut rate, camera energy (locked to moving), and narrative stakes. Reuse the chorus's signature image each time, changed: same pose, new location.

## Intake

Infer what you can from the brief, the attached audio and its metadata, genre and any supplied references before asking. Then ask one compact message with defaults so the person can answer "yes" or change one item. Ask only questions whose answers change the plan:

1. **Song and length.** Whole song or a cut (hook only, 30 s vertical)? Section map and tempo if no audio is attached.
2. **Who is on screen.** The artist with supplied photos, an invented character, a band (how many, which instruments), dancers, or no performer.
3. **Mix.** Offer the genre default as a ratio and one alternative: "Mostly performance with a light story (≈70/30), or story-led with performance in the choruses (≈40/60)?"
4. **Performance types.** Singing to camera, choreography, instruments. Ask which lines or sections need visible lip sync.
5. **Story or idea.** One sentence if they have one; otherwise offer two short options drawn from the lyric.
6. **Delivery.** Aspect ratio and platform when not stated.

Do not ask about lenses, shot lists or cutting; those are the Director's job. Save the answers in `brief` (who, mix, delivery) and `story` (section map, ratio per section, escalation plan, story or concept) before drafting scenes. If the person wants to skip questions, draft with stated assumptions.

## Planning checklist

- Section map, felt tempo and ratio are in `story`.
- Every scene sits on a section; repeated sections are separate scenes with different shots.
- Every shot names its mode, performance type, performer, section and used length in beats.
- Each section with performance has at least two angles to cut between.
- Every high-risk shot (hands on instruments, fast choreography, groups, crowds) has a planned cutaway or safer alternative.
- Lip-sync shots meet the framing rules in [singing](performance-singing.md) and are flagged.
- Choruses escalate; the bridge breaks the pattern; the final image is held.
