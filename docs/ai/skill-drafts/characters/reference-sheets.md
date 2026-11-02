# Draft: character reference sheets (production skill reference)

Status: draft for a future `production` package version. Requires the `make_character_sheets` tool and the
`approve_character_sheet` / `regenerate_character_sheet` note choices specified in
`docs/ai/characters/wardrobe-and-reference-sheets.md`. Not shipped; do not copy into `skills/v7`.

Proposed file: `references/character-sheets.md`, loaded before `make_keyframes` and by the `storyboard` stage.

---

# Character sheets

A character who appears in more than one shot needs a character sheet: one image showing the same person as a
full-body front view, a full-body side view, a full-body back view and a face close-up. After the person approves
it, the application attaches it as a reference image to every keyframe of that character. Text alone does not
hold a face steady between keyframes; the approved sheet does.

## What you write

You do not write the sheet prompt. The application builds it from the character's `name`, `identity`,
`baseOutfit` and the film's visual style, with a fixed four-panel layout. Your job is a precise `identity` and a
plain `baseOutfit` (see the characters reference). If the person describes how someone should look, put it in
identity first, then offer the sheet.

## Starting sheets

Only a fresh human request starts sheet work. When the person asks for keyframes of shots that cast a recurring
character without an approved sheet, `make_keyframes` reports `CHARACTER_SHEET_REQUIRED` with those characters.
Say who needs a sheet and the returned price, and offer the sheet. When the person asks for sheets ("make Mara's
sheet", "做角色设定图"), call `make_character_sheets` with exactly those `characterIds`. A request for the whole cast
names every character that `read_context` lists as needing a sheet.

Use `regenerate: true` only when the person asks for a new sheet of named characters. Earlier takes stay in Assets.
Never regenerate because you dislike a result.

## Approval

The person approves a sheet; you never do. When a sheet take returns, record a character-anchored note with an
`approve_character_sheet` choice for that take and a `regenerate_character_sheet` choice, and say: "Approve it
in this chat or in Plan › Cast." Comment only on sheets in `attachedKeyframes` or ones the person has opened:
check that the four views show one consistent person, the face matches identity, the full-body views show head
to feet, and nothing from a scene outfit leaked in.

Approving a sheet rebinds every keyframe of that character. Shots with existing keyframes then need new takes;
the application reports how many and their price. Do not start them; offer `make_keyframes` for the affected shots
if the person wants them now.

## Keyframes and video

The application orders references: approved sheets first, in cast order, then other registered references, at
most eight. The prompt block tells the image model which reference shows whom and that clothing comes from the
scene's wardrobe, not the sheet. Video uses the keyframe only; identity in a clip comes from its keyframe.

## Price

Sheets are image work on the film's image model, quoted like keyframes. On the Codex image model they are
included with the person's plan and quoted as $0 with the subscription label; report the price the application
returns.
