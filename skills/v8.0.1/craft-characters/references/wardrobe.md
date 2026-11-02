# Characters and wardrobe

Plan each recurring person once, as a character, before writing shots that show them. A character has a short
`name`, an `identity` and a `wardrobe` with one entry per scene they appear in. Cast each shot with `characterIds`
in the order the person reads them in the frame (most prominent first).

## Identity

`identity` is what stays the same in every scene: apparent age, face shape, skin tone, hair colour, length and
style, build and height, distinguishing marks (freckles, a scar, glasses they always wear). Write it in one or two
sentences. Never put clothing, pose, expression, lighting or location in identity. Example: "Woman in her early
thirties, short black bob, freckles across the nose, slim and tall, a small scar through the left eyebrow."

## Wardrobe per scene

Give each character an outfit that fits each scene's place, weather, time and story moment. Read the scene
purpose and the story's timeline: a character who walks through rain arrives wet; a night shift calls for work
clothes; a time jump can change everything. Write `outfit` as concrete garments, colours and materials, at most
about 25 words: "rain-dark trench coat over a navy jumper, grey trousers, black ankle boots". Put temporary state
in `notes`: "hair wet, collar turned up".

Keep the same outfit across consecutive scenes only when the story keeps the same day and nothing changes it; say
so in the story. Do not paste one costume into every scene by default. If a character changes clothes within a
scene, split the scene or name the change in the shot's action.

`baseOutfit` is the plain clothing shown on the character sheet and used only where a scene has no entry. Choose
simple, close-fitting clothing that shows the body shape; it is not a scene costume.

## Prompts

Do not copy identity or outfit text into `imagePrompt`. The application appends a "Characters in this shot"
block to each keyframe prompt from the cast, the approved sheet and that scene's wardrobe, and keeps it current
when wardrobe or sheets change. Write `imagePrompt` about composition, action, setting and light, naming
characters by name only.

## Changes with media impact

Changing a character's identity or a scene's outfit changes every keyframe prompt of the cast shots in that
scope. In contract 7.0.0, character writing (`createCharacters`, `updateCharacters`, `deleteCharacterIds`,
`updateShots[].characterIds`) goes in its own `prepare_change` call and applies directly with a receipt. When any of
those shots already has keyframes, tell the person first which shots will need new takes, and offer the remakes as
choices after saving.

## Continuity

Before asking for keyframes, read the `characters` section of `read_context`. Resolve blocking issues first:
`WARDROBE_MISSING` (write the scene's outfit), `UNKNOWN_CHARACTER` (fix the cast) and `SHEET_REQUIRED` (offer the
sheet, see the character sheet reference). Mention `WARDROBE_UNIFORM` only if the story implies a change.
