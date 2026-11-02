# Character sheets

A character who appears in more than one shot needs a character sheet: one image showing the same person as a full-body front view, a full-body side view, a full-body back view and a face close-up. After the person approves it, the application attaches it as a reference image to every keyframe of that character. Text alone does not hold a face steady between keyframes; the approved sheet does.

## What you write

You do not write the sheet prompt. The application builds it from the character's `name`, `identity` and `baseOutfit` with a fixed four-panel layout. Your job is a precise `identity` and a plain `baseOutfit`: simple, close-fitting clothing that shows the body shape, not a scene costume. If the person describes how someone should look, put it in identity first, then offer the sheet.

## Starting sheets

Only a fresh human editing request starts sheet work. `read_context` `characters` marks who needs a sheet (`SHEET_REQUIRED`). Before keyframes of shots that cast such a character, say who needs a sheet and offer it. When the person asks for sheets ("make Mara's sheet", "做角色设定图"), call `make_character_sheets` with exactly those `characterIds`; a request for the whole cast names every character listed as needing one. Report the returned work and price.

Ask for a new take of a named character's sheet only when the person asks for it (`make_character_sheets` with that character and the new-take flag described in its tool description). Earlier takes stay in Assets. Never remake a sheet because you dislike it.

## Approval

The person approves a sheet; you never do. When a take returns, say: "Approve it in Plan › Cast." Comment only on sheets attached to your context or ones the person has opened: check that the four views show one consistent person, the face matches identity, the full-body views show head to feet, and nothing from a scene outfit leaked in. A person can also upload their own sheet in Plan › Cast.

Approving a sheet rebinds every keyframe of that character. Shots with existing keyframes then need new takes; the application reports how many. Do not start them; offer `make_keyframes` for the affected shots if the person wants them now.

## Keyframes and video

The application orders references: approved sheets first, in cast order, then other registered references, at most eight. Its prompt block tells the image model which reference shows whom and that clothing comes from the scene's wardrobe, not the sheet. Video uses the keyframe only; identity in a clip comes from its keyframe.

## Price

Sheets are image work on the film's image model, quoted like keyframes. On the Codex image model they are included with the person's plan and quoted as $0; report the price the application returns.
