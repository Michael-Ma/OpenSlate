# Shared planning rules

These apply to every type. Type packages add their own structure and risks; they never relax these.

## Where decisions go in the plan

- `brief`: the type line (kind, format, length), audience, required facts and supplied assets. `project.filmKind` holds the structured version.
- `story`: the beats, timing assumptions, narration coverage, the recurring visual idea, and any text or caption needs that finishing must supply.
- Scenes: `title` is the short name; `purpose` is the scene's job in the type's structure ("Hook: the spill nobody can clean").
- Shots: `framing` is a 1–3-word label; put the beat, composition and safe space in `purpose`, `action` and `imagePrompt`; one action and one camera move in `motion`/`videoPrompt`; the used length in `desiredFrames` (30 fps).

## Shot budget

Each shot costs one keyframe and one clip. A clip is 3–15 s (90–450 frames); Film uses the first `desiredFrames` of it, so a shot's planned length is its cut length.

- Plan the used length per shot from the type's pacing, then derive the count. Short cuts (3–4 s) suit ads, social and trailers; 5–8 s suits story, explainer and showcase.
- Rough counts: 15 s → 3–4 shots; 20 s → 3–4; 30 s → 5–8; 60 s → 10–15; 90 s → 15–22; 3 min → 30–45.
- Spend the count on must-have shots first; cut decorative coverage before a must-have.
- Clips shorter than 3 s are not available. For faster rhythm, put the change inside the clip (a reveal, a cut-on-action at its end) rather than adding shots.

## Aspect

Keyframes, clips and the export follow the film's aspect from `filmKind.format`: 9:16 portrait, 16:9 landscape or 1:1. Compose every keyframe for that frame from the start; changing the aspect later outdates every keyframe. Portrait frames are tall: stack subject and context vertically, keep the subject in the middle band, and avoid wide two-shots that need horizontal room.

## Narration

- Budget about 2.5 words per second for adult narration and about 2 for children's or instructional narration (Chinese: about 4 characters per second). One 6 s shot holds 12–15 adult words.
- Write narration to cover the planned duration; cut words rather than stretch shots.
- Words and picture say different things: narration gives meaning, the frame gives evidence.

## On-screen text, logos and captions

Film assembles clips in storyboard order with narration, music and clip sound; overlays, captions and transitions are not available yet. Image and video models render text unreliably.

- Never rely on generated pixels for copy that must be correct: prices, URLs, legal lines, product names, step numbers, captions.
- Plan such text as a finishing requirement in `story`, and leave clean space where it will sit.
- When a frame must show a brand mark, condition on the supplied logo or product image, keep it large, flat-on and still, and inspect the result.
- Prompt signs, screens, packaging and books as blank or illegible when the words do not matter.

## Supplied media

Testimonials, mini-docs, event recaps, real listings, app promos and tributes depend on the person's own photos, footage and recordings. Use supplied images as registered references and animate them with restrained camera motion. Where a type needs footage or screen recordings placed as-is and Film cannot do that, record it as a gap in `story` and plan generated shots around it rather than inventing replacements.

## Generation risks and default mitigations

- **Product fidelity.** Condition every product shot on a supplied image; keep silhouette, colour and label facing camera; prefer camera, light or environment motion over handling. Never invent features, variants or claims.
- **Real people.** Never generate an identifiable real person, public figure, testimony or endorsement. Use invented characters, backs, silhouettes, hands, or the person's own supplied footage. Realistic synthetic people and events need the platform's AI label; mention it once.
- **Hands.** Keep hands out of the critical moment or make the action simple (hold, rest, single press, pour). Avoid typing, tying, instrument fingering and small-object manipulation.
- **Speech on camera.** Lip sync from image-to-video is unreliable. Stage dialogue off-face (backs, wides, over-shoulder) or carry words in voiceover. Visible singing uses the shot's Singing switch (see `craft-performance`).
- **One action per clip.** A clip carries one action with one start and end state. Split multi-step action across shots.
- **Identity and continuity.** Reuse the same character, product, wardrobe and location wording and references across shots. Cut between angles rather than long reveals of unplanned geometry.
- **Physics.** Liquids, fabric in motion, crowds, turning vehicles and contact are fragile; prefer slow, single-direction motion and environmental motion (light, steam, wind, parallax).
- **Claims.** Generated visuals are depictions, not evidence of real results, customers, events or places.
- **Copyright and likeness.** Never name a living artist, studio or franchise in prompts; translate a requested look into traits. No real brands or logos the person did not supply.

## Sound

- Music: the film's soundtrack (`set_soundtrack`), −18 dB under narration by default, 0 dB for a music video.
- Clip sound: clips can carry their own sound effects and ambience. Social and comedy films keep clip sound by default (about −6 dB, lowered under narration); music videos mute it. The person changes one clip with Film › Keep clip sound. When a sound effect carries a beat, say so in `story` and in the shot's motion prompt ("the goose honks once").
- Narration and clip sound share the mix; keep voice lines away from a clip whose sound is the punch.
