# Music video

Read when the brief is a music video, a performance clip, a lyric or visualizer piece, or any film cut to a song. A music video is not a short film with a soundtrack. The song is the timeline: its sections, tempo and hooks decide scene boundaries, shot lengths and where the strongest images land. Plan from the song first, then fit story and performance into it.

Section mapping and beat cutting are in `craft-music-timing` (`references/cutting.md`); performance coverage is in `craft-performance` (`references/singing.md`, `dance.md`, `instruments.md`, `band.md`). Visual style belongs to `craft-visual-style`; this file covers only music-video structure.

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
- Instrument-heavy performance is the highest-risk content for image and video models. When the song is band-led but accuracy matters more than presence, keep the ratio but spend it on wides, singer coverage and cutaways rather than hand close-ups (see instruments).
- Short delivery (vertical, under 30 s): one mode, maybe two. Use the hook only, mostly performance.

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
- Lip-sync shots meet the framing rules in singing and are flagged.
- Choruses escalate; the bridge breaks the pattern; the final image is held.
