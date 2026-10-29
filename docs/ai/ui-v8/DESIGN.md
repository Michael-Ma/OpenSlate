# v8 UI (step 5): design notes

This is an extension of the Last Ferry system, not a new direction. It uses the existing tokens (`ui/studio.css`) and keeps their colour roles: amber belongs to the Director, white marks the chosen option or the primary action, green marks approved or opened, and app-computed facts are neutral with an icon. No new colours or fonts.

Audience: the person making the film. The primary tasks are to keep recurring people consistent, to decide on a look, and to confirm changes the Director asked for without being surprised by cost. The data is the Last Ferry fixture (fiction).

## Surfaces

| Surface | Where | What it decides | Screens (`screens/`) |
|---|---|---|---|
| Look | Plan, under Brief and Story | Shows the saved look, or "grounded realism by default". Change and Choose a look ask the Director in the composer. A film with a song links to Film › Fit shots to song. | `v8-plan-look-*`, `v8-plan-cast-*` |
| Cast | Plan, between the look and the scenes | One row per character: sheet thumbnail, state chip (Needs a sheet, No sheet, Making sheet…, Ready to review, Approved, May be out of date), looks, appearances, base outfit. Then the character × scene wardrobe: an outfit, the base outfit (italic), a missing outfit (neutral check), or not in this scene (dashed). On a phone the grid stacks per character. | `v8-plan-cast-{en,zh-CN}`, `v8-plan-cast-phone-*` |
| Shot cast | Each Plan shot row | Chips with a face (approved) or an initial on a dashed ring, and Cast… opens a checklist. Saving says the shot's keyframe goes out of date. | `v8-plan-shot-cast-*` |
| Sheet review | Right sheet over Plan | The 1:1 sheet large, its takes, and what it is made from. Before approval it lists which shots use the sheet, which keyframes go out of date, the price to remake them, and that approving is free. After approval it says which keyframes are now out of date, that nothing was remade, and offers Open Keyframes. Actions: Approve and use for keyframes, Make another (with price), Upload. | `v8-sheet-review-*`, `v8-sheet-approved-*` |
| Keyframes cast | Cards and the check banner | Small faces beside each card's length. A neutral cast check takes the check slot before Make keyframes when a recurring character has no approved (or bound, or current) sheet. Review sheet opens the sheet review in Plan. | `v8-keyframes-cast-check-*`, `v8-keyframes-cast-faces-*` |
| Style proposal | Director chat | An amber card with three looks. Each has a tier tag, why it fits, its risk and an optional cost, plus Choose. A footer line says what choosing changes. Once settled, the chosen look is marked and the others are dimmed. | `v8-style-card-*` |
| Confirmation cards | Director chat | An eyebrow ("Needs your confirm · 2.3 / Scene 3 / Whole film"), a question, the frames it touches (use_take shows Now → Earlier take), and a neutral facts inset: the change (→), the money ($) and what stays recoverable (↺). Then confirm (white) and keep. The resume card is anchored to the whole film. | `v8-card-delete-*`, `v8-card-use-take-*`, `v8-card-resume-*` |
| Singing | Shot inspector, under the rows | A switch with the lip-sync price for this shot's length, or the reason it would be an ordinary clip (no song, no lip-sync model). Shown when the film has a song or the shot already sings. | `v8-singing-on-*` |
| R1–R4 pass | Inspector and Needs attention | Each recovery block now has a head line naming what happened, a charge tag (May be charged / Charged), and, for a job still running, how long ago it was sent. Codex's reason is quoted with a rule. In Needs attention, Render again's acknowledgement spans the item. | `v8-recovery-*` |

## Decisions

- **The confirm button is white, even for a delete.** This matches Plan's DeleteDialog: the title and the facts say what happens. Nothing turns red.
- **Card text comes from the film, not the server's note text.** The server writes English. The card computes the same facts in the interface language (length now → after, paid media, the clip price for use_take, unsent jobs for resume).
- **The cast check yields to narration checks once keyframes exist.** It leads while a scene has no keyframes (when it matters most) or when no other app check is open. Not now hides it for that scene until the page reloads.
- **Change look never applies a look.** It puts the request in the composer, so the proposal flow and the person's choice stay the only way a look is saved (decision 7).
- **The face avatar crops the sheet's fourth panel.** Sheets are four views on one 1:1 canvas (§2.2). An uploaded picture would crop oddly. This is acceptable for now; an imported sheet can be shown whole later.

## Limits

- The fixture sheets are drawn SVGs, so real Codex sheets are not visually verified.
- The style proposal note shape is assumed (see `contracts.md`).
- The lip-sync price is an estimate from the published rate. The scene confirm keeps the exact quote.
- In the Vite dev page, the scripted Director's delayed reply did not arrive in headless runs. This also happens on the base commit (2004df3), so it is not caused by this work. `scripts/browser-check.mjs` runs against the built studio.
