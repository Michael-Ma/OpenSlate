# The Last Ferry: keyframe review prototype

File: `last-ferry.html` (one self-contained page, inline CSS, JS and SVG; only Google Fonts is fetched).

## Audience and task

A person making a short film in OpenSlate, a local AI video studio. They are in the Keyframes step of Scene 2 of *The Last Ferry*. The Director (the AI) has sent back three keyframes and two notes. The person needs to:

1. open each frame to confirm it,
2. settle the Director's two notes (coat colour in 2.2, narration length in 2.3),
3. then pay for video.

## References and their roles

| Reference | Role | What was taken |
|---|---|---|
| `refs/layout-reference.png` (image 1) | The exact target for structure and proportions | Region placement and sizes at 1440 × 900: the 52 px top bar with the view tabs in it; the 392 px Director column with the thread anchored to the bottom; the scene header row with the scene pills at the right; the full-width DIRECTOR RECOMMENDS banner with the Now / After timeline and three stacked actions; the 738 × 392 preview beside the 250 px inspector; the bottom row of three shot cards plus the SCENE 2 VIDEO panel. Also the callouts attached to the 2.2 and 2.3 cards, and the Regenerate 2.2 callout link. |
| `refs/components-reference.png` (image 2) | A fixed constraint for every component and colour | All colours (sampled from the image), the segmented tab pills, outline pill buttons, amber note cards with lettered circles, the user bubble with its @ chip, bylines, the composer with its round send button, the green ✓ Opened pill and the grey Not opened pill, amber annotation chips, decision chips where the chosen option is white, the Saved locally pill, the keyframe preview's play button and scrubber, the inspector's title/framing/rows, and the disabled primary button with its reason under it. |

Measured result at 1440 × 900 (image 1 in brackets): top bar 0–52 (0–52); Director column 392 wide (392); banner top 112 (111); preview 414–1152 × 280–672 (414–1152 × 278–672); inspector 1168–1418 (1168–1418); bottom row 686–882 (686–882); cards 246 wide, panel 230 (246, 230). No page scroll.

## Colour roles (all on `:root`, single dark look, `color-scheme: dark`)

| Token | Value | Role |
|---|---|---|
| `--bar` | `#1c1d20` | Top bar, Director column |
| `--ground` | `#141517` | Workspace ground |
| `--surface` | `#1d1f23` | Preview, inspector, shot cards, video panel |
| `--surface-stripe` | `#202226` | Placeholder stripes while a keyframe is being made |
| `--raised` | `#24262a` | Outline-pill fill, composer, resolved note cards, toast |
| `--raised-2` | `#2c2e33` | User bubble, active tab pill, disabled primary |
| `--chip` | `#3a3d44` | @ chip inside a message |
| `--track` | `#3c3e42` | Timeline segments, scrubber track, progress tracks, strong hairline |
| `--hairline` | `#33363c` | Borders |
| `--sunken` | `#17191b` | Not opened pill |
| `--text` / `--text-2` / `--muted` | `#ececee` / `#a3a6ad` / `#7d8088` | Primary, secondary, muted text |
| `--amber` | `#f0b24a` | The Director only: lettered circles, annotation chips, the recommendation eyebrow, the After segment |
| `--amber-ink` | `#241a06` | Text on amber |
| `--amber-line` | `#896a34` | Hairline of recommendation cards and the banner |
| `--amber-surface` | `#362f25` | Recommendation surface (notes, banner) |
| `--green` / `--green-surface` / `--green-line` | `#5fc48a` / `#253430` / `#417b5c` | Opened: pill text, fill, border; opened progress segments |
| `--select` / `--select-ink` | `#ececee` / `#141517` | Selected scene pill, selected card border, chosen option, primary action, send button |
| `--coat-red` / `--coat-maroon` | `#c8102e` / `#6e1423` | Swatches in the coat decision |

Image 1's yellow is not used anywhere: selection is white, opened is green, amber is only the Director.

## Type

Inter (Google Fonts), fallbacks `-apple-system, "Segoe UI", sans-serif`. 14 px body. Titles 20 px (scene), 18 px (banner), 21 px (inspector "Shot 2.1"), all 700. Tabs and pills 600. Eyebrows 11–11.5 px uppercase, letter-spaced. Tabular figures on the scrubber clock.

## Components

- **Top bar:** neutral logo mark (white square, no yellow), film title and live meta line (duration updates), segmented tabs (active = `--raised-2` pill, bold white), `3 scenes · 8 shots`, Saved locally outline pill, the `All prototypes` gallery link.
- **Director column:** header (avatar D, Director, current scene), bottom-anchored thread with the bylines `You · 10:42` and `Director · 10:44`, the user bubble with the `@Scene 2` chip, the Director's text without a bubble, notes (a) and (b) as amber cards with `Open 2.2` / `Open 2.3` pills. A resolved note turns neutral (`--raised`, hairline, grey letter) and shows a green "✓ …" line saying how it was settled.
- **Composer:** rounded box, `Reply to the Director…`, chips row for pointed-at scenes and shots, the `@ a scene or shot to point at it` hint, round light send button.
- **Scene header:** title, status line, three scene pills (selected pill white).
- **Banner:** amber-tinted card with lettered circle, `DIRECTOR RECOMMENDS`, title, sub-line, Now / After timeline (segments in `--track`, width 15 px per second, Scene 3 dashed, the After 2.3 · 8 s segment amber because it is the Director's recommendation), and stacked actions: chosen option white, the alternative an outline pill, Edit narration a ghost pill.
- **Preview:** rounded card with the illustration, the shot badge and the ✓ Opened pill top-left, the 画面 caption, and the play button with scrubber (0:00 to the shot's duration).
- **Inspector:** `Shot 2.1`, framing in grey, status pill, Motion / Duration / Narration (and Takes once there are two) rows, `@ 2.1` pill, and the three stacked pill buttons from image 1.
- **Shot cards:** picture with badge and prompt text, title and seconds, status pill plus motion. Callouts are image 2's amber annotation chips (`a Coat came out maroon` with a `Regenerate 2.2` link; `b Narration 7.4 s, shot 6 s`); once settled they become grey chips with a check.
- **SCENE 2 VIDEO panel:** opened-frame segments (green when opened), `1 of 3 frames opened`, the note from image 1, and the primary button, disabled as drawn in image 2 with its reason under it.
- **Toast:** an outline pill over the top of the preview (bottom of the screen on narrow) with Undo where an action can be undone.

## Behaviour (all simulated in the page; nothing is generated or saved)

- **Opening a frame:** clicking a card (or Open 2.2 / Open 2.3) shows it in the preview and inspector and marks it Opened; the panel counts and colours the segments.
- **Note (b):** `Make 2.3 8 s` sets 2.3 to 8 s (free, no clip exists), every duration updates, the film becomes 50 s, the banner switches to a "done" view whose timeline shows the new state (Scene 3 from 0:34), and a toast offers Undo. `Keep 6 s` resolves it and the inspector says the line will be cut at 6 s. `Edit narration` opens the line inline with a live length estimate; saving a line that fits resolves the note.
- **Note (a):** `Keep maroon` resolves it. `Regenerate 2.2` (banner, card callout or inspector) shows the keyframe being made for 3 s, then the red-coat picture as take 2; 2.2 goes back to Not opened and the inspector shows `Takes 2`.
- **Banner order:** (b) first, then (a); after an action the banner shows that note's resolved view with `Next` and `Undo`; when both are handled it becomes one quiet line. Notes and card callouts show the same state.
- **Confirm frames & generate video:** enabled only when all Scene 2 frames are opened and (b) is resolved; the reason under it names what is missing. When enabled it reads `Confirm frames & generate video · about $1.50` with `3 clips at about $0.50` under it. Clicking runs a simulated clip per shot (progress bar on each card), then the header and Scene 2 pill read video saved.
- **Inspector:** Edit prompt and Edit motion & duration edit inline with Save / Cancel. A changed prompt marks the keyframe out of date and the button becomes `Regenerate keyframe · about $0.04` (white). Editing a shot in a scene that already has video clears that scene's saved video.
- **Preview play:** a motion preview over the shot's duration (push-in = slow scale up, pull-back = scale down, pan = translate, tilt = vertical translate, breath = tiny pulse) with the scrubber moving. Under `prefers-reduced-motion` the picture stays still and only the scrubber moves.
- **Scenes:** Scene 1 shows three opened frames, Video saved and `▶ Play Scene 1` (plays each shot's motion in turn). Scene 3 shows its two shots as dashed prompt frames and `Make 2 keyframes · about $0.08`, which simulates making them.
- **Composer:** typing `@` (or the @ button) opens a picker of scenes and shots that inserts a chip; `@ 2.1` in the inspector does the same. Send adds the message; the Director shows "Working…" and replies with a line plus "Replies in this prototype are scripted; nothing in the film was changed."
- **Tabs:** Plan, Assets and Film are present; clicking one says it is not in this prototype.
- **Narrow (< 900 px):** sticky top bar with the tabs on their own row and a `Director` toggle; the Director opens as a full-height drawer (Esc or Close shuts it; opening a shot from a note closes it). Workspace order: scene header, scene pills (scroll inside), banner (actions in a row), preview, inspector, shot cards in a horizontal row that scrolls by itself, video panel. At 390 px the page has no sideways scroll.
- **Testing hooks:** `window.LastFerry = { state, actions, render }` and `data-act` attributes on every main control.

## Deviations, with reasons

1. **Amber value:** the brief's table gives `#d9a142`; the pixels in image 2 are `#f0b24a` (fills) and `#896a34` (card hairlines). I used the sampled values because image 2 is the colour authority.
2. **Logo mark:** image 1 has a yellow logo, and image 2 has no mark at all. I drew a neutral white mark so yellow does not come back in as an accent.
3. **Inspector layout:** image 2 puts Edit shot / Regenerate keyframe / @ 2.1 inline, while image 1 stacks Edit prompt / Edit motion & duration / Regenerate keyframe at the bottom. I kept image 1's stack (layout) in image 2's pill style, and moved `@ 2.1` next to the title. The Prompt row from image 2 is left out because image 1 shows the prompt as the preview caption.
4. **Card callouts:** image 1 draws them as boxed notes, and image 2 as solid amber chips. I used image 2's chip, and placed the Regenerate 2.2 link under it as a small amber underlined link.
5. **Video panel copy:** image 1 puts the reason above the button, and image 2 puts it below. I kept image 1's sentence above the button and added image 2's short reason below it, so the disabled state always says what is missing.
6. **Narration estimate:** the brief suggests about 0.3 s per word. At that rate the recorded 13-word line (7.4 s) would estimate at 3.9 s and "fit" without any change. I used 0.55 s per word, calibrated to that recorded line, and the page states the rate next to the estimate.
7. **Banner "done" view:** the brief says the timeline "becomes the new state", but also that the banner moves on to the next note. The banner therefore shows a resolved view of the note just handled (new timeline, Undo, `Next: note a`) before moving on. The toast also offers Undo.
8. **Regenerate keyframe price:** the normal label matches the image (`Regenerate keyframe`). The cost shows when the keyframe is out of date or missing (`· about $0.04`), as the brief describes. The banner's `Regenerate 2.2 · about $0.04` shows its cost because it is the suggested paid action.
9. **Scene 3 card row:** Scene 3 has two shots, so the third card slot shows a dashed "No more shots in this scene" placeholder. This keeps image 1's four-column grid.
10. **Prompt text over pictures:** image 1 shows the prompt text on a flat placeholder. Over real illustrations it sits on a dark gradient scrim so it stays legible.
11. **Scene 2 / 3 pill labels:** the current scene's pill drops its status suffix (as in image 1's `2 Harbour at dawn`), except for "video saved" or "making video".
