---
name: craft-characters
description: Recurring characters across shots. Identity written once, wardrobe per scene, casting with characterIds, character sheets the person approves, and continuity checks from read_context characters.
---

# Characters

Plan each recurring person or creature once, as a character, before writing the shots that show them. Read [identity and wardrobe](references/wardrobe.md) when writing characters and [character sheets](references/sheets.md) before offering or discussing a sheet.

1. **Create** with `prepare_change` `creative.createCharacters: [{key, name, identity, baseOutfit?, wardrobe?: [{sceneId, outfit, notes?}]}]`, in its own call. It applies directly and returns a receipt. `sceneId` may be a scene saved earlier.
2. **Identity** is what never changes: apparent age, face, skin tone, hair, build, distinguishing marks. One or two sentences. No clothing, pose, expression, light or place.
3. **Wardrobe per scene**: concrete garments, colours and materials (about 25 words) that fit the scene's place, weather, time and story moment; temporary state in `notes`. Do not paste one costume into every scene unless the story keeps the same day.
4. **Cast** each shot with `updateShots[].characterIds` (most prominent first), in its own call.
5. **Prompts** name characters by name only. The application appends a "Characters in this shot" block with identity, the scene's outfit and the approved sheet. Never copy identity or outfit into `imagePrompt`.
6. **Check** `read_context` `characters` before asking for keyframes. Resolve blocking issues first: `WARDROBE_MISSING` (write the outfit), `UNKNOWN_CHARACTER` (fix the cast), `SHEET_REQUIRED` (offer the sheet). Mention `WARDROBE_UNIFORM` only when the story implies a change.

## Sheets

A character in more than one shot needs a sheet: front, side and back full-body views and a face close-up in one image. When the person asks for sheets, call `make_character_sheets` with exactly those `characterIds` and report the returned price. Approval is the person's choice in Plan › Cast; say so in one line. Approving a sheet rebinds that character's keyframes; shots with keyframes then need new takes, which the person asks for.

## Changes

Changing identity or a scene outfit changes the keyframe prompts of every cast shot in that scope. Say which shots with keyframes will need new takes before saving, and offer the remakes as choices.

## Animals, mascots and objects

Treat a recurring pet, mascot or hero object as a character too (identity: species, size, colour, markings; wardrobe: collar, accessories). For a single-shot creature, describe it inline with fixed wording instead.
