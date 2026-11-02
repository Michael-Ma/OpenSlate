# The Last Ferry: validation

Independent review of `last-ferry.html` against the brief, image 1 (`refs/layout-reference.png`, layout) and image 2 (`refs/components-reference.png`, components and colour). The page was rendered in headless Chrome through Playwright at 1440 × 900 and 390 × 844. The scripted click-through ran 50 assertions plus extra cases. All pass after the fixes listed below. There were 0 console errors, 0 page errors and 0 failed requests.

## Layout and look (1440 × 900)

| Region | Expected (image 1 / image 2) | Observed | Status |
|---|---|---|---|
| Top bar | 52 px; logo, title, meta, tabs in the bar, `3 scenes · 8 shots` | 0–52; tabs drawn as image 2 pills, Saved locally pill, gallery link | Pass |
| Director column | 392 px, thread anchored to the bottom, notes a/b, composer | 0–392; amber note cards, bubble with @ chip, round white send | Pass |
| Scene header | title, status line, 3 scene pills at the right | y 62–98; the selected pill is white | Pass |
| Banner | full width, ~111–264, Now / After, 3 stacked actions | 112–266; amber only for the Director; the chosen action is white | Pass |
| Preview / inspector | 738 × 392 + 250 px | 414–1152 × 280–672; inspector 1168–1418 | Pass |
| Bottom row | 3 cards of 246 px + 230 px panel, y 686–882 | identical | Pass |
| Colour roles | no image 1 yellow; white = selected, green = opened | as specified; tokens on `:root` | Pass |
| Page scroll | none | scrollWidth 1440, scrollHeight 900 | Pass |

## Behaviour

| View or action | Expected | Observed | Status |
|---|---|---|---|
| Open a frame (card or Open 2.2) | preview + inspector switch, green Opened, count rises | 2.2 opened, `2 of 3`, segments turn green | Pass |
| Confirm button rule | disabled until all 3 opened and b resolved; reason under it | `Open 2.2 and 2.3 and settle b first` → `Open 2.3 first` → enabled `· about $1.50`, `3 clips at about $0.50` | Pass |
| Make 2.3 8 s | 2.3 = 8 s, film 50 s, Scene 3 2 s later, toast with Undo | meta 50 s, card 8 s, banner timeline new state, Scene 3 from 0:34 | Pass |
| Undo (toast / banner) | restores 6 s and 48 s | restored; the banner shows b again | Pass |
| Keep 6 s | resolves b, says the line is cut at 6 s | `2.3 stays 6 seconds; the line will be cut at 6 s` | Pass |
| Edit narration | inline editor, live estimate, a shorter line resolves b | estimate updates (0.55 s/word, see DESIGN.md); a 7-word line resolves b; Undo works | Pass |
| Keep maroon | resolves a | resolved; Undo works | Pass |
| Regenerate 2.2 (card link) | ~3 s making, red-coat take 2, Not opened, earlier take kept | making state, then red coat, `Takes 2`, Not opened | Pass |
| Banner order | b → a → quiet "both handled" line; notes and callouts match | as expected | Pass |
| Generate video | per-card progress, then header and pill say video saved | `making video` → `video saved` on both | Pass |
| Inspector edit prompt | saving marks keyframe out of date; `Regenerate keyframe · about $0.04` | as expected; saved scene video cleared | Pass |
| Inspector edit motion & duration | saves; durations update | 2.1 → 7 s, film 52 s | Pass |
| Regenerate from the inspector | new take, Not opened | 2.1 take 2, Not opened | Pass |
| Motion preview | scale or translate over the duration, scrubber moves; reduced motion = still | moves; with reduced motion the transform stays `none` and the scrubber still moves | Pass |
| Scene 1 | 3 opened, Video saved, play action | `▶ Play Scene 1` plays each shot in turn | Pass |
| Scene 3 | dashed text frames, `Make 2 keyframes · about $0.08`, simulated | both keyframes back, Not opened | Pass |
| Composer | `@` picker inserts a chip; Send → Working → scripted reply | chip `@2.2`; Working; reply ends with the scripted-replies line | Pass |
| Plan / Assets / Film | present, "Not in this prototype" | toast; Keyframes stays selected | Pass |
| Keyboard focus | visible outline; Enter activates | 2 px #ececee outline on pills | Pass (spot check) |
| Narrow 390 × 844 | workspace first, Director toggle, cards scroll inside, no sideways scroll | scrollWidth 390 in all tested states (start, Director open, after 8 s, note a, edit prompt, Scene 3); the drawer closes on Open 2.3 | Pass |

## Fixed in this review

1. **Narrow top bar:** `All prototypes` overlapped the meta line (`30 fps`). The top bar now lays out as title row + Director toggle, then tabs + gallery link on the second row. Tab padding is tighter so `Film` is not clipped.
2. **Regenerating a frame:** it kept counting as opened while it was being remade. The panel showed `2 of 3` and the scene could still read Video saved. The frame now drops its Opened state and the scene's saved video as soon as making starts.
3. **Card badge while making:** the shot badge was hidden under the "Making…" overlay. It now sits above it.
4. **Video progress bar on the card:** it ran through the prompt text. The text is lifted while the bar shows.
5. **Undo after paying for video:** a pending Undo for note b (in the toast or the banner) stayed live after Confirm & generate video. Using it would undo the fix the video relied on. Starting video now clears the pending undo and the toast.

## Not checked

- Screen-reader output and a full keyboard-only walkthrough (only focus outline and Enter on a pill were checked).
- Real touch scrolling of the card row on a phone (scroll width was measured, not swiped).
- Edge cases outside the brief, such as editing a shot while its scene's video is being made. The run still ends as video saved.
- Browsers other than Chrome.
- On Scene 1 or 3, the Director's banner still shows the Scene 2 note. This is left as is, since the notes belong to the film.
