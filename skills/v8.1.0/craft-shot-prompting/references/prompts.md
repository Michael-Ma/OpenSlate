# Keyframe and motion prompts

One file for both prompts of a shot: the keyframe prompt first, then the motion prompt.

## Keyframe prompts

The keyframe is the first frame of the clip and the strongest control over the shot: composition, identity, expression, light and look all come from it.

### Structure

`{framing and angle} of {subject, fixed wording} {held action or expression} in {setting}, {this shot's light}. {Composition for the aspect}. {Look image phrase}. {Positive constraints}.`

Order matters less than completeness; keep it to about 60–90 words. Name the camera relationship once ("low angle", "over the shoulder", "from directly above").

### Composition by aspect

| Aspect | Rules |
|---|---|
| 9:16 portrait | Subject centred in the middle band; keep the top 14 % and bottom 35 % free of faces, props and the punch, and the right edge below mid-height clear (platform buttons). Stack subject and context vertically. Close and medium frames read best; wides need one big, simple subject. |
| 16:9 landscape | Rule of thirds, lead room in the direction of movement, two-shots side by side. Leave clean space where finishing text will go. |
| 1:1 square | Centred, symmetrical or diagonal compositions; tighter than 16:9. |

### Expressions and reactions

- One big, readable expression per keyframe (shock, smug, deadpan stare, wide eyes). Describe the face concretely: "eyebrows raised, mouth slightly open, eyes on the lens".
- A reaction is often the beat: make it its own keyframe instead of hoping motion produces it.

### Continuity wording

- Describe a recurring subject with the same words every time: "a tired man in his thirties in a grey hoodie", "a large white domestic goose".
- Repeat the setting's key details per scene ("generic self-checkout, red indicator light").
- For cast characters, name them and let the application add identity and wardrobe; do not restate their outfit.

### Things models get wrong in stills

| Problem | Fix |
|---|---|
| Garbled text on signs, screens, labels | "blank screen", "unlabelled box", "signs too far to read" |
| Extra fingers, fused hands | Hands relaxed, at rest or out of frame; avoid gripping small objects |
| The punch subject leaks into the setup frame | Keep the setup framing tight; describe what is out of frame only by absence |
| Plastic "AI" skin and teal-orange grade | State texture positively ("visible skin texture, natural colour") |
| Busy backgrounds steal focus at phone size | One subject, simple background, shallow-to-moderate depth of field |
| Crowds and groups of identical people | Few people; give each a distinct, simple description |

### Examples (9:16)

- Setup: "Close-up of a young woman in her twenties with curly dark hair and a mustard cardigan at a small plant-shop counter, holding one tiny succulent in a terracotta pot near her face with both hands, solemn sincere expression; shelves of plants softly blurred behind; warm daylight; subject centred in the middle band."
- Punch: "Wide shot of a small living room overgrown like a rainforest, plants on every surface and vines from the ceiling; in the middle the same young woman with curly dark hair and a mustard cardigan sits deep in an armchair, nearly hidden, watering a tiny succulent with a tiny brass watering can; a ginger cat peers out between leaves; warm light through leaves."

## Motion prompts

Image-to-video models start from the keyframe and need only what moves. A clip is 3–15 s; Film uses its first `desiredFrames`.

### Structure

`{subject action, with speed}; {one camera move, with speed and direction}; ends {end state}. {Look motion reminder}.`

- "She lifts the succulent slightly and nods once; slow push-in; ends on her earnest face. Live action, 24 fps."
- "Leaves sway gently; the cat blinks; camera holds still; ends with her looking up at the lens."

### Rules

- One subject action and one camera move per clip. Two actions in one clip land at random times.
- State speed and direction: slow push-in, gentle pull-back, slow pan left to the cause, locked-off.
- Describe the end state when the next cut depends on it.
- Timing lives in the cut. A clip delivers a state; the beat (a punch, a reveal, a drop) lands on the cut between shots or on the end state of a fast move, never at an exact moment inside a clip.
- Write positively: "camera holds still", "the product stays still while light moves across it".
- Do not restate the look or the subject's appearance; the keyframe carries them.
- Sound: clips can carry their own sound. When a sound effect helps (a honk, a thud, a door), name it once ("the goose honks once"); never rely on its exact timing.

### Camera grammar

| Move | Use for |
|---|---|
| Locked-off, camera holds still | Deadpan, reactions, product beauty, stop-motion feel |
| Slow push-in | Building tension, the beat before, emphasising a face |
| Slow pull-back | Reveals: show the cause or the scale |
| Slow pan or tilt to | Reveal what the subject is looking at |
| Gentle orbit | Product or hero subject, one direction only |
| Subtle handheld drift | Documentary or native social feel; never "shaky" |
| Tracking alongside | Walking subjects, kept short |

### Fragile motion and fixes

| Fragile | Instead |
|---|---|
| Walk, then sit, then turn | Three shots, each with its own keyframe |
| Catching, pouring onto a target, typing | Crop to the result; keep hands at rest |
| Fast choreography or crowds in sync | Few performers, simple repeated moves, or a cutaway |
| A face changing through several expressions | One held expression; a blink or a slow turn |
| Liquids, fabric in strong wind, vehicles turning | Slow single-direction motion, environmental motion (steam, light, leaves) |
| Lip-synced speech | Off-face voice; visible singing uses the Singing switch |
