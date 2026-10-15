# P5 validation

All six pages were rendered in headless Chrome (Playwright from the npx cache, `channel: 'chrome'`) and compared with `last-ferry.html` at the same sizes. Screenshots are in `/tmp/p5-shots/final/` (outside the repo):
- each page at 1440 × 900, 390 × 844, and full height at 390;
- the main states of each page;
- Chinese versions, prefixed `zh-`;
- `keyframes-1440.png` and `keyframes-390.png` for comparison.

## Automated sweep (every page × every state × two sizes × two languages)

Each page and each of its Prototype-menu states, plus the film-wide states (Offline, Stopped, Studio restarted, Jobs running), was checked in English and Chinese at 1440 × 900 and 390 × 844.

| Check | Result |
|---|---|
| Console errors and page errors | 0 |
| Network requests other than `file:` and `data:` | 0 (Inter comes from the repo's local copy) |
| Page scroll at 1440 × 900, as on the Keyframes page | None: scrollHeight is 900 on every page and state |
| Sideways scroll at 390 | None: scrollWidth is 390 on every page and state, including with the Director drawer open |
| Clipped `nowrap` labels (pills, tabs, status, badges, headings) | Only the Film narration lane. Those blocks are deliberately as wide as the voice line; the full text stays in the DOM and in a tooltip, and plays as a subtitle |
| Intermediate widths (900 / 1000 / 1100 / 1200 / 1280 / 1366, and 720 × 450 for about 200 % zoom) | No sideways scroll after the mid-width rules (see the fixes below). `last-ferry.html` itself scrolls sideways below about 1415 px |

## Click-through (88 assertions, all pass)

| Area | Checked |
|---|---|
| Plan | The impact line names the keyframe and clip for a purpose change, and only the clip for a motion change. Save, then a toast, then `Undo: edit 1.2`, and Undo restores. A scene move renumbers its shots (3.1 becomes 2.1). The delete-scene dialog deletes, focus lands on the view title, and Undo brings the scene back. Import: paste, then reading (with edits paused), then review, then confirm adds 2.4 |
| Film | Export is off until every shot is ready. Playback time advances. The ready state shows `changed since: shot order, music`. A length edit adds `shots` and Undo restores it. Export goes rendering, then done, then `matches the film`. Mute works. The demo state shows the DEMO mark and the demo label. Check again recovers without rendering again. Under reduced motion the picture transform stays `none` while time advances |
| Assets | The Voice lines filter shows 3. The detail shows the selection. Import adds an item (17). Point the Director adds a composer chip |
| Settings | The impact text shows before a switch, and Switch applies it. Add voice stays off until both consents are ticked, then adds the voice. Revoke marks it revoked |
| Start | New film is created and listed. Archive moves a film to Archived (2). The first run shows the demo path. Reconnect shows `Not connected`, fails once, then returns to Films |
| States | Give up is off until the acknowledgement is ticked; after it, `make 1 clip`, and the new clip is made. Stop: the strip counts 1 sent and 2 taken off, the sent clip still finishes, and Continue offers `make 2 clips`. Offline turns off the paid button and Send, and Try now reconnects. Session expired opens a modal that ignores Esc |
| Drawer at 390 (Plan, Film, Assets, Settings, States) | Hidden by default, opens, no sideways scroll, Esc closes it, focus returns to the toggle |

## Visual comparison with the Keyframes page

| Region | Expected (`last-ferry.html`) | Observed |
|---|---|---|
| Top bar | 52 px; logo, title and meta, tabs, right-hand group | Identical metrics and tab pill. The current tab uses the raised pill. `All prototypes` is replaced by the Settings icon and the dashed Prototype menu |
| Director column | 392 px; same thread, notes, composer | Identical. Resolved notes match the Keyframes "done" treatment |
| View header | Scene title row at y 62–98 | `Plan`, `Film`, `Assets` and `Settings` titles sit at the same position and size |
| Surfaces | Preview, inspector, cards, video panel | Panels reuse the same surface, hairline and radii. Film's player keeps the preview's height (392) |
| Colour roles | Amber only for the Director; white for chosen or primary; green for opened or done | Amber appears only in the notes, the Director's letters on Plan rows and Film blocks, and the thread. App checks and failures are neutral. Primary actions are white. Clips, Ready, Current and Found are green |
| States page | Keyframes grid at 1440 | Same grid; the quiet banner line replaces the recommendation, since both notes are handled |

## Fixed during review

1. **Top bar.** The film meta touched the first tab, in Chinese and with the system font. `.film` now has 12 px of right padding, and the meta truncates before the title does.
2. **Film export panel.** At 392 px tall it cut off the last export. The last export moved to the view header, and the duplicate reason under a disabled button was replaced with `Settle the shots above first`.
3. **Film timeline with a strip.** The timeline squeezed the music lane when a strip was shown. The stage now shrinks first, and the timeline keeps at least 340 px.
4. **Film narration blocks.** They showed only a clipped quote. They now lead with the shot label (`1.2 “One…`).
5. **Plan import sheet.** Proposed scene boxes shrank and clipped. Sheet children no longer shrink.
6. **Sheets on a phone.** They were limited by the native dialog's max-width; they now use the full width. The footer note takes its own line.
7. **Settings.** At 390 the model table put the status on its own row; each model is now a card. In the personal voice card, nested spans broke into lines.
8. **Focus after deleting.** It was lost when the dialog's opener (a menu item) had been removed. It now goes to the menu's button, or to the view title when the scene itself was deleted.
9. **Stopped film.** The composer implied that a message resumes a stopped film. It now says the Director waits for Continue, and the scripted reply says so too. The Stop strip omits a zero count.
10. **Mid widths (900 to 1366 px).** The top bar drops its counts, then the meta line. Plan rows, Film, Assets and Settings switch to intermediate layouts. States stacks the Keyframes context below 1366 px.
11. **Reconnect screen.** The top bar said `Saved locally`; it now says `Not connected`.

## Not checked

- Screen-reader output. Only names, roles, `aria-pressed`, `aria-current`, `role="switch"` and status regions were set and spot-checked.
- A full keyboard-only walkthrough. Focus visibility and dialog and drawer focus return were checked.
- Real touch scrolling of the timeline and the card rows; only scroll width was measured.
- Browsers other than Chrome, and real browser zoom (a narrower viewport was used instead).
- Light theme: there is none (D12).
- Copy review by a Chinese reader (plan risk register). The strings follow the catalogue terms, but they are mine.
