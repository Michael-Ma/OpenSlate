# The pigeon film: what held it back, and a plan for the Director

Film: 鸽子偷可颂 (`47bc6166`), made 2026-11-16 by Codex · gpt-6.1-sol with code-plan skill 2.0.1, Viggle H3 at 1080p. Evidence: the saved plan (three versions), the Director's seven messages, every clip and the finished film, read from a copy of the studio database. Nothing in the studio was changed.

## What the film is

| | Planned on screen | Requested | Used |
|---|---|---|---|
| 1 Croissant push-in | 4 s | 6 s | 4 s |
| 2 Pigeon checks the chair | 4 s | 7 s, then a 7 s retake | 6 s at 1.5× (retake) |
| 3 Grab and escape | 9 s | 11 s | 9 s |
| 4 Smug on the lamp post | 8 s | 9 s | 8 s |

25.0 s, 1920×1080, 24 fps, four shots, three cuts. Spent $2.48 of $3: 40 s of video at $0.06 a second plus $0.08 of music. 27 of the 40 seconds bought are on screen.

What worked: shot lengths now differ with the story (G3), the picture is clean at 1080p and 24 fps with no repeated frames (G1, G2), the four keyframes are good and consistent, the review notes are honest, and the budget held.

## What held it back, in order of effect

1. **One generated clip per beat, so the gag the brief asked for never appears.** The brief asked for "a series of very quick sideways glances between the pigeon and the empty chair". That is an editing pattern: looker, what it sees, looker. The plan asked the video model for it inside one 7-second take (two head snaps, a freeze and a stretch). The model gave slow head dips. The film averages 6.25 s a shot, slow for a comedy.
2. **None of the four confirmed keyframes was used.** "References only" was chosen on all four cards, so the model framed every shot itself. The pigeon moved from the right of the table (facing the croissant, chair behind its shoulder) to the left, with croissant and chair in the same direction, so a glance at the chair cannot read. Shot 3 starts with the pigeon on the ground, which puts a continuity error in the film at 8 s: the bird is on the table, then flies onto it. Plumage, croissant size and the awning text ("de la Place", "de le Place") change between shots. The skill tells the Director not to advise on this choice, and the card suggests nothing. See `data/test-runs/20261116-pigeon-recut/keyframes-vs-clips.png` (top row: confirmed pictures; below: what each clip shows).
3. **The key action is too small to see.** The grab happens in a wide shot with the bird about a tenth of the frame height. The brief's "hit on the grab" lands on an action a viewer can barely find.
4. **Motion prompts carry too many actions.** The skill says at most two visible beats per five seconds. Shot 2 asks for five small actions in 7 s; shot 3 asks for six in 11 s. Nothing checks this before money is spent.
5. **The retake repeated the failed approach.** Same keyframe, same input, reworded prompt, $0.42, same result. After the retake limit the Director stopped ("No further edit or retake") although a free re-edit could build the gag.
6. **The payoff holds 8 s on a nearly still pose**, and the croissant changes shape at 22 s. There is no closing button.
7. **The review scored continuity 2 of 2** and missed the landing error, the plumage change and the sign. It reads each clip alone and never compares the two sides of a cut.

## Proof that the cut is the main lever

`data/test-runs/20261116-pigeon-recut/pigeon-recut.mp4` is the same footage re-edited locally, with no generation: 13 cuts in 18.7 s. The glance gag is built from pigeon, chair, pigeon, croissant, pigeon, chair; the grab is punched in; the escape runs at 1.5×; the payoff is cut to its two live moments and ends on a punch-in. It reads as the film the brief described.

Two limits it shows honestly. The chair and grab inserts use a 2.2× punch-in, above today's 1.4× limit, and look soft: a planned close-up clip is the real fix. It is 18.7 s, not 25, and has music only, no sound effects.

## Plan

Updated the same day: the owner's reply put the idea itself first. [DIRECTOR-IDEATION-AND-CUT-PLAN.md](DIRECTOR-IDEATION-AND-CUT-PLAN.md) replaces the scope and order below; the findings above stand.

### Phase 1: teach the Director to shoot for the cut (skill 2.1.0)

Rewrite parts of `skills/code-plan/references/film-craft.md`, keeping its length about the same by replacing text:

- **Beats are not shots.** A beat is built from several cuts made out of one or two generated clips: reuse a clip in several timeline rows, punch in, hold, change speed. Give a cut count by kind of film: comedy and action about one cut every 2–3 s; calm or atmospheric films keep long takes.
- **What the video model does badly goes into the cut**: looks between two things, fast repeated small motions, counted repetitions, small contacts, readable text. A look is three cuts: the looker, what it sees, the looker.
- **One clip, one continuous action.** Before submitting, list each motion prompt's actions; more than two per five seconds means split the shot or build it in the cut.
- **The action that carries the joke gets its own close shot**, the subject at least a third of the frame height.
- **Stage looks**: the two things looked at sit on opposite sides of the looker.
- **No readable text in sets** (signs, menus).
- **A fix ladder at review**: new range, then re-order or intercut existing clips, then zoom, speed or hold, then drop the beat, and only then a retake that changes the approach (shot size, simpler action, first-frame input). Never re-roll the same setup.
- **Check every cut**: compare the last frame before it with the first frame after it for position, facing, prop state and look, and score continuity from that.
- **Payoff**: hold no longer than about 5 s unless something changes; end on a button.
- **Buying**: about 1.2–1.4× the film's length in generated seconds; inserts come from reuse.

### Phase 1: let the Director suggest the clip input, and make the card say what each choice does

- Plan API: `ctx.keyframe(shot, { …, suggest?: "first_frame" | "keyframe_and_references" | "references_only", why?: string })`. Optional; the person still chooses. This reverses the current rule that the Director stays silent on the input, so it needs the owner's yes.
- Card: the suggested option comes first with "Director suggests" and its reason. Without a suggestion, "Keyframe as first frame" comes first. Hints say the outcome: first frame "starts from exactly this picture"; references only "this picture is not used; the model frames the shot".
- Skill: suggest first frame when the keyframe is the planned composition and start pose (the usual case); keyframe and references when the subject must show sides the keyframe lacks; references only rarely, with the reason.

### Phase 1: two small tools for the cut

- **Punch-in up to 2×** (from 1.4×), with a dry-run note when the punched-in picture falls below 720 on its short side. With G1's 2K setting a 1.33× punch-in loses nothing at 1080p.
- **Cut pairs in review**: `read_clip_frames` on a render can return, for each cut, the frame before and the frame after, side by side.

### Phase 2: measure it on the same brief

Re-run the pigeon brief with skill 2.1.0 and compare: timeline rows (target 9 or more for 25 s), generated seconds over film seconds (1.4 or less), the glance gag readable in a silent viewing, grab subject at least a third of the frame, retakes 0–1, continuity errors at cuts 0, cost $2.20 or less. Then run one calm brief (the night platform) to check the Director does not over-cut it. About $2–2.50 a run, so each run needs approval.

### Phase 3, optional

- **Animatic before video**: let the render take keyframe stills as timed rows, so the Director and the person can watch the story's rhythm with music for $0 before buying clips.
- **Sound the Director can read**: loudness and onsets of music and effects, so hits can be placed on beats and checked.

## Work split

Three parallel streams with separate files, as before:

| Stream | Who | Files |
|---|---|---|
| S1 skill 2.1.0 text and release | Lead writes the text in the card; Codex applies and releases | `skills/code-plan/**` |
| S2 `suggest`, option order, 2× punch-in, cut pairs | Codex | `apps/server/src/code-plan/**`, `apps/server/src/media/**` |
| S3 keyframe card: suggestion, order, hints | Lead (UI) | `apps/web/**` |

Tests: unit tests per stream, a fixture card scenario for the suggestion, full `pnpm check` through Codex, browser scenarios by the lead.

## Risks

- More cuts with soft punch-ins can look worse than fewer clean shots. The zoom note, the 2K setting and "plan the close-up" guard against it; Phase 2 measures it.
- A wrong suggestion steers the person. It is one line with a reason, and the choice stays theirs.
- The guidance could over-cut calm films. The wording is by kind of film, and Phase 2 tests a calm brief.
- The skill is already 1,290 words. New text replaces old text rather than adding to it.
- `suggest` is a new optional plan field: old plans and films are unaffected, and the tool contract version must be bumped as the release rules require.
