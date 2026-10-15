# P5 design: the rest of the studio in the Last Ferry system

The Keyframes view (`last-ferry.html`, `DESIGN.md`) fixed the system. This round adds the other views in that system so they can be built in `apps/web/src/next/`. It is an extension, not a new direction, so there was no direction round.

## Files

| File | View | Opens on |
|---|---|---|
| `system.css` | Shared tokens and components | Linked by every P5 page |
| `plan.html` | Plan | The outline as it is now |
| `film.html` | Film | Only Scene 1 has clips, so export is not ready |
| `assets.html` | Assets | Everything in the film, grouped by scene and shot |
| `settings.html` | Settings | Models, Director, Voice, This computer, Language |
| `start.html` | Start (films) | The films on this computer |
| `states.html` | Job and connection states, in the Keyframes view | 2.2's clip failed and was counted as spent |

Open the files directly. They make no network requests. If the page is opened inside the repository, Inter loads from `apps/web/public/fonts/InterVariable.woff2`. Otherwise the system font is used. `last-ferry.html` is unchanged.

**Prototype menu.** The dashed `Prototype ▾` button sits in the top bar where `All prototypes` was. It holds:
- this page's states;
- film-wide states that apply on every page: Normal, Jobs running (Stop shows), Stopped, Offline, Studio restarted, Session expired;
- a "Scene 3 keyframe problems" toggle;
- English or 中文.

The menu is drawn dashed so it never reads as product UI. Hashes such as `states.html#no-answer`, `plan.html#import`, `assets.html#exports` and `settings.html#voice` open a state directly.

**How the pages are built.** One shell script is inlined into every page: the sample film, the illustrations, the top bar, the Director column and composer, the strip states, dialogs, toast and the Prototype menu. Each page's script starts with the same block, marked `Shell: identical in every P5 page`. When you change that block, change it in all six pages.

## What stays fixed (from DESIGN.md)

- **Colours.** Amber is only for the Director's content. Greys are neutral. White marks the chosen option and the primary action. Green marks an opened frame or a done state.
- **Type.** Inter with the same type sizes.
- **Top bar.** 52 px, with the view tabs.
- **Director column.** 392 px, with the same thread. The notes and the @ composer work in every view.
- **Components.** Pills, status pills, cards, banner, toast.

## Shell changes

1. **Tabs are links.** Plan, Keyframes (→ `last-ferry.html`), Assets and Film navigate. The current one uses the same raised pill, set with `aria-current="page"`.
2. **Settings.** A round icon button at the right of the top bar.
3. **All films.** The OpenSlate mark links to Start.
4. **Stop.** A `■ Stop` pill appears in the top bar only while something is running (the canStop rule in GR-13). It asks first, and the dialog says what happens:
   - jobs already sent finish and are charged;
   - queued jobs are taken off and need a new confirm;
   - the Director stops.
5. **Film-wide strip.** Offline, Stopped and Studio restarted each show as one strip at the top of the workspace. Each strip has a neutral surface, a white icon and its action: Try now, Continue, or Review them. The strip appears the same way in every view.
6. **Session expired.** This is a modal dialog that Esc cannot dismiss. Its action is `Try again`, and it tells you to run `pnpm studio` and open the link it prints. The unsent message is kept.
7. **Saved locally pill.** It reads `Reconnecting…` when offline and `Not connected` on the reconnect screen.
8. **Guards.** Every control that writes carries `data-needs="server"`, and every control that starts work also carries `data-needs="run"`. Offline or expired turns off every write. Stopped turns off what would start work, and the button's title says why.
9. **Director column per view.**
   - The header label follows the view: `Whole film` on Plan and Film, `Assets`, `Settings`, `Scene 2`, or `No film open` on Start.
   - `Open 2.2` / `Open 2.3` act in the current view: Plan scrolls to the row, Film selects and seeks the shot, Assets scrolls to the shot's set, States selects the card.
   - Notes show as resolved (grey, with a green `✓` line) when the page's state says so.
   - While stopped, the composer hint says `the Director waits for Continue`. A message sent then does not resume the film.
10. **The @ picker.** Scenes and shots everywhere. Film adds the music. Assets adds the selected asset.

## Components added to the system (`system.css` section 8)

| Component | Use | Rule |
|---|---|---|
| `.view-head` | View title, count line, actions | Same metrics as the scene header (20 px title, 13.5 px line) |
| `.panel` / `.panel-head` | Brief, story, scene, export, timeline, settings sections | The inspector's surface: `--surface`, hairline, 16 px radius, 11 px uppercase eyebrow |
| `.field`, `.input`, `.textarea`, `.select`, `.stepper`, `.range` | Every editor | The inspector's edit fields (`--raised` fill, `--track` border, 10 px radius) |
| `.segctl` | Role filters, narration None/Line, provider, language | The tab pill: the active option is `--raised-2` (selection inside a group, not the primary action) |
| `.switch` | Director review, music mute | On is white with a dark knob (the chosen option); off is a track |
| `dialog.dialog` / `dialog.sheet` | Confirms; import, new film, asset detail on phone | Native `<dialog>`: focus containment, Esc, focus returns to the opener, or to the view title if the opener was deleted. The primary action is white even when it is destructive; the title and bullets say what happens |
| `.ack` | A checkbox that must be ticked before money or consent | The pay-twice acknowledgement; the two personal-voice consents |
| `.impact` | What a save outdates or a switch affects, shown before acting | Neutral; `✓` in green when nothing goes out of date, `!` when something costs money |
| `.status.fail` / `.status.warn`, `.check` | Failed, no answer, app checks | Neutral, with an icon and words; never amber and never red |
| `.strip` | Film-wide state | See the shell changes above |
| `.progress` | Rendering, retrying, making | Indeterminate unless a real fraction exists (GR-17). Under reduced motion it is a still bar |
| `.thumb`, `.wave`, `.ticks` | Shot thumbnails, audio tiles, clips-made meter | `.ticks` is green for made, track for not |
| `.menu` + `openMenu` | `•••` menus, music picker | Fixed position; Esc or an outside click closes it and focus returns |
| `.icon-btn` | Settings, mute, reorder arrows | 30 px round |
| `.demo-mark` | `DEMO` on the player and the demo card | An outlined white stamp, the same mark a demo export carries |
| `.review-btn`, `.review-menu` | Prototype chrome only | Dashed |

**No red.** Nothing in the system is red, and amber belongs to the Director. A failure is therefore shown with a filled white `!` in its pill, plain words, and the inspector box that explains it. This is open question 1.

## Decisions per view

### Plan (SB-20, SB-13, SB-9, SB-12)

- **Layout.** A document-like outline. Brief and Story sit side by side on top, then one panel per scene.
  - Scene header: number, title, `3 shots · 17 s · video saved`, ↑ ↓, `@ Scene n`, and `•••` (Rename, Edit direction, Delete scene and its shots…).
  - Shot row: thumbnail with its label; purpose (bold), then framing · length · motion, then the picture prompt in muted text; narration (the line plus `2.1 s voice line`, `no voice yet · about 1.2 s (estimate)`, or `No narration`); status pills; and `Edit` and `•••` (Move earlier/later, point the Director, open in Keyframes, Delete…).
- **Director notes in the rows.** The Director's lettered notes repeat on their shots as the same amber chips the Keyframes cards use. App-derived facts stay neutral.
- **The editor opens in place.** Fields: Purpose, Framing, Length (stepper), Picture prompt, Motion, Narration (None / A line) and the line itself. The impact line updates as you type. It mirrors the server's per-field rule (SB-10 `outdatedBy`):
  - purpose and framing are written into the picture prompt, so they outdate the keyframe and the clip;
  - a prompt change outdates the keyframe and the clip;
  - motion or length outdates only the clip;
  - a new line outdates the voice line, while the clip stays;
  - when nothing has been made, it says so in green.
- **Costs and takes.** Costs are about $0.04 per keyframe, $0.50 per clip and $0.01 per voice line. Outdated media stays in Assets as earlier takes.
- **Length floor.** Length has a floor at the accepted voice line (SB-8). 1.2's line is 2.1 s, so 1.2 can go no shorter than 3 s.
- **Line length.** While the words are unchanged, the line shows its measured length. Once they change it shows a labelled estimate (0.3 s a word, per the contract) and says it is `measured once the voice line is made` (SB-4).
- **Brief, story, scene direction and title edits** say `Nothing made goes out of date`. This is the SB-12 target behaviour (D16).
- **Undo.** One step (D9). The header pill names the change, for example `Undo: edit 1.2` or `Undo: delete Scene 1`. Toasts carry the same Undo.
- **Delete scene.** A dialog lists what stays in Assets, the new film length, and that later scenes renumber.
- **Reorder.** Scenes and shots renumber, for example `3.1` becomes `2.1`, and the toast says so.
- **Add shot.** It creates a `Needs direction` shot (no paid action can start) and opens its editor.
- **Import a written plan.** It opens in a right-hand sheet with four steps: paste or choose a .txt/.md file (12,000-character counter), the Director reading it, a review, then Confirm or Discard.
  - The review shows Now vs proposed counts, each shot tagged Same / Changed / New, a cost line, and the Director's suggestions listed separately and not applied.
  - While an import is pending, plan edits are paused, with a strip that names the reason (IMPORT_PENDING).
  - There are states for no Codex Director (with a link to Director settings) and for a review that went out of date.

### Film (SB-19, SB-15, SB-16, SB-17, SB-18, SB-24)

- **Layout.** The player (the Keyframes preview size) sits beside a 300 px export panel, with the timeline below. At 1440 × 900 the page does not scroll.
- **Playback.** One clock drives everything, in storyboard order:
  - a clip plays with its keyword motion;
  - a keyframe-only shot shows a dimmed still with `Keyframe only · no clip yet`;
  - a shot with nothing made shows a dashed prompt frame;
  - a settled narration line shows as a subtitle;
  - the music indicator shows from its start time unless muted;
  - the playhead moves across the lanes.
  
  The line `Browser preview; the exported MP4 is exact` sits by the scrubber (SB-19 risk).
- **Timeline lanes.**
  - Scenes.
  - Picture: blocks sized by length, with the picture, label, length, what is missing (`no clip`, `nothing yet`, `failed`, `no answer`) and the Director's letter.
  - Narration: an unsettled line is a dashed block, `7.4 s, too long · not placed`, because it is not placed until it is settled.
  - Music: one track.
- **Selecting a shot or the music.** The tool row below the timeline changes with the selection.
  - Shot: a length stepper with the voice floor; Move earlier/later within its scene (scenes reorder in Plan); Open in Keyframes.
  - Music: start time, volume (−60 to 0 dB), a mute switch, and `Change music`, which lists only music-role audio (SB-24).
- **Free edits.** Edits are free and take effect at once, with Undo. Each edit marks the last export as changed: `changed since: shot order, music`.
- **Export panel.** It reads the ExportView fields.
  - Readiness per shot: Clip and Voice columns, plus the length against the 6:00 limit.
  - One `Export MP4` button. When it is off, the summary above it says why.
  - Rendering shows elapsed time and an indeterminate bar, since there is no percentage, plus `Cancel export`.
  - `Check again` appears for an export interrupted by a restart. It finds the file and never renders again.
  - There are failed and cancelled states.
  - The last export stays in the view header with Download and `n earlier in Assets`.
- **Demo film.** Every clip is a demo stand-in. The player shows the `DEMO` mark, and the panel says the export is stamped Demo (D11, SB-18).

### Assets (SB-21)

- **Filters.** Role (All, Keyframes, Clips, Voice lines, Music, Uploads, Exports, each with a count), and a scene select that includes `Whole film only`.
- **Groups.** Whole film comes first (music, uploads, and exports, or an empty state that points to Film). Then each scene, then each shot with its purpose. A shot with nothing made says `Nothing made yet`.
- **Tiles.** Each tile shows only AssetItem fields: picture, waveform or clip still with its length, the label, and `✓ Current` / `Earlier` (`✓ In use` / `Not in use` for music and uploads) · Generated / Imported / Demo.
- **Detail panel.** Preview, with simulated play for clips and audio (`No sound in this prototype`); Kind, Shot, Take, In use, Source, Made, Length. Actions: Download, Point the Director at it, and Open in Keyframes or Film. On a phone the detail opens as a full-screen sheet.
- **Import.** Image, video or audio. Audio is imported as Music or Other audio. Imports are not put on a shot until used. Voice lines are made or uploaded on a shot, in Keyframes.

### Settings (SB-23, SB-24, D4)

- **Scope.** The page says which sections apply to this film (Models, Director, Voice) and which to every film on this computer (This computer, Language). A section index sits on the left.
- **Models.** One row per job (Director, Keyframes, Video, Narration, Transcription), each with its model select, a host-configured estimate (`about $0.04 a keyframe`, `no price set (Codex plan)`, `free stand-in`) and readiness. A model that is not ready is listed but disabled, with its reason.
- **Switching a model** first shows its impact, for example `5 clips not made yet would use it; the 3 already made stay` (preview, then apply). A note says prices are estimates, a failed try can be charged, and video is priced per clip.
- **Director.** Program path, model and Codex home, with `Change…`. Saving checks that Codex runs. A switch, `The Director reviews new keyframes`, explains the extra Codex use. It is turned off, with its reason, when there is no Codex Director.
- **Voice.**
  - Default narrator voice: stock voices plus ready personal voices. It applies only to new lines.
  - Personal voices: provider, voice ID and consent date, with `Revoke…`. The revoke dialog says it is per film, that existing lines keep their audio, and that using the voice again needs a newly created provider voice (PERSONAL_VOICE_REVOKED).
  - Add a personal voice: name, provider, voice ID, and the two consents (own voice, permit synthesis). `Add voice` stays off until both are ticked. The form states that OpenSlate does not make voices from a recording.
- **This computer.** Codex, FFmpeg, and each key (set or not set, and what it is for), with `Check again`. Keys are explained, not fixed: `./start.sh --restart` and `--doctor`.
- **Language.** English or 中文. The setting is kept in this browser. Dark only (D12).

### Start (SB-22, SB-14)

- **Film list.** Each film shows only ProjectListItem fields: name, scenes · shots · seconds · changed, a clips-made meter, `Open`, and `•••` (Rename inline, Archive…). The archive dialog warns when jobs are still running. Archived films sit under a collapsed `Archived (n)`. There are no thumbnails, because the list item has none.
- **First run with no keys.** Two cards:
  - **Try the demo film** (primary): free, no keys, nothing sent, the export is stamped Demo, and a demo stays a demo.
  - **Make your own film:** setup status for Codex, FFmpeg and keys, how keys are set, `New film anyway`, and a written plan, which is off until the Codex Director is set up.
- **New film sheet.** A name and a first step: Talk to the Director, Bring a written plan, or Start an empty outline. The first two are off without Codex. Models show as this computer's defaults, with each one's readiness on request.
- **Reconnect after a restart.** The workspace says the films are saved, gives the `pnpm studio` link instructions with `Try again`, and explains that jobs mid-send will show as no answer and are never resent by themselves (GR-14).
- **Director column.** It is in a `No film open` state. The Director only works inside a film, so its composer is off and says why. This is a deliberate exception to "same thread".

### States (GR-9, GR-10, GR-13, GR-14), in the Keyframes view

The view is Scene 2 after both notes were handled (the quiet line in the banner row, and resolved notes in the thread), with the Keyframes layout and components. Each scenario changes what the card, preview pill, inspector box and SCENE 2 VIDEO panel say:

| State | Card / preview pill | Inspector | Video panel |
|---|---|---|---|
| Failed, counted as spent | `! Clip failed · counted as spent` | When it failed, the automatic retry, that both tries are counted as spent, and that the keyframe is unchanged. `Make 2.2's clip again · about $0.50` | `Confirm frames & make 1 clip · about $0.50` |
| Failed, refused, not charged | `! Clip failed · not charged` | The service refused it and did not charge, and the same prompt would likely be refused again. `Edit prompt or motion` (white); `Make again` is off, with its reason | Off: `Change 2.2 first` |
| Retrying by itself | `Retrying by itself · 1 of 2` | Nothing to do; a failed try can be charged; elapsed time and an indeterminate bar | `Generating…` |
| No answer | `? No answer from the service` | It was never confirmed, may still arrive and be charged, and holds the scene's video. `Give up and allow a new try…`; keep waiting means doing nothing | Off: `A job in this scene has no answer yet` |
| Give up | Dialog: the first clip may arrive and be charged and is then kept as an earlier take; a new try is a new paid clip. A tick for `I understand I may pay for both clips` enables the button | Back to no clip | `Confirm frames & make 1 clip` |
| Stop and Continue | `Making clip…`, `Queued · 1 ahead`, then `Taken off · needs a new confirm` | Sent: it finishes and is charged. Queued: Stop takes it off | Off: `Stopped. Continue to make video`, then `make 2 clips · about $1.00` after Continue |
| Restart casualties | `? No answer` plus a `since the restart` tag | Same as no answer, and says it was mid-send at the restart | Off |
| Offline | Unchanged | Paid and edit buttons off; the composer says your draft is kept | Off |
| Session expired | Modal over the view | | |

Phone width: below 1366 px the Keyframes context stacks (`last-ferry.html` scrolls sideways there), and the cards scroll inside their own row.

### Where each state appears

| State | Keyframes | Plan | Film | Assets | Settings | Start |
|---|---|---|---|---|---|---|
| Failed / no answer / retrying | Card, preview pill, inspector box, panel blocker | Status pill in the shot row | Block label `failed` / `no answer`; counts as `no clip` in readiness | Nothing (a failed try makes no asset); a late no-answer result arrives as an earlier take | — | — |
| Stopped | Strip, cards, panel | Strip; paid controls (import) off | Strip; Export stays available (it is local and free) | Strip | Strip | — |
| Offline | Strip and guards | Strip and guards | Strip and guards | Strip and guards | Strip and guards | Strip and guards |
| Restart casualties | Strip with `Show 2.1`, plus cards | Strip with `Review them` | Strip and block labels | Strip | Strip | Reconnect screen first |
| Session expired | Modal | Modal | Modal | Modal | Modal | Modal |

Use the Prototype menu's Anywhere section to see the film-wide states on each page. "Scene 3 keyframe problems" puts a failed and a no-answer keyframe into Plan and Film.

## Phone (390 px)

- **Shell.** The same as Keyframes: a sticky top bar with a title row (Settings icon and Director toggle) and a tab row (with Prototype). The Director is a full-height drawer that Esc or Close shuts.
- **Plan.** Shot rows become a thumbnail and text, with narration and status below and actions on their own row. The editor fields stack.
- **Film.** The player sits on top, then export, then the timeline, which scrolls sideways inside itself at 14 px a second, then the tool row, which wraps.
- **Assets.** The filters scroll inside their own row. Tiles sit in two columns. The detail is a sheet.
- **Settings.** The index becomes a row of pills, and each model becomes a stacked card.
- **Start.** Rows and welcome cards stack.
- **Between 900 and 1366 px:**
  - the top bar drops the scene and shot counts, then the meta line;
  - Plan rows, Film, Assets and Settings use intermediate layouts.

## Chinese strings checked for layout

Catalogue terms are reused from `apps/web/src/next/i18n/catalog` (计划, 关键帧, 素材, 成片, 已查看, 版本, 导演). Content stays in its own language: prompts, lines, scene titles, framing, and the Director's words. The longest strings, all checked at 1440 and 390 with no clipping or sideways scroll:

| Where | String |
|---|---|
| Stopped strip | 已停止，不会再发送新任务。已发送的 1 个任务会完成并计费。2 个排队中的任务已撤下，需要重新确认。 |
| Offline strip | 连不上工作室。恢复连接前，修改不会保存，付费按钮不可用。每 5 秒自动重试。 |
| Plan impact line | 目的和景别会写进画面描述。保存后，1.2 的关键帧和视频会过期，重做两者约 $0.54。现有的会作为旧版本保留在素材里。 |
| Line estimate | 约 3.3 秒（估算，每词或每字 0.3 秒；生成配音后才有实测长度） · 能放进 5 秒 |
| Give-up dialog | 不再等待 2.2 的视频？ · 我明白可能两段视频都会计费。 · 放弃并允许重新生成 |
| Video panel button | 确认画面并生成 1 段视频 · 约 $0.50 |
| Film header | 上次导出 今天 14:02 · 之后有改动：镜头顺序、音乐 · 下载 MP4 · 素材里还有 2 个 |
| Film tool row | 至少 8 秒（配音） · 改时长会让视频过期 · 往前移 · 往后移 · 在关键帧里打开 |
| Card status | 视频失败 · 已计费 · 已撤下 · 需要重新确认 · 自动重试 · 第 1/2 次 |
| Settings scope line | 前三项只对《The Last Ferry》生效；后两项对本机所有影片生效。 |
| Settings consent | 我允许 OpenSlate 用它为这部影片生成旁白，并可随时撤回。 |
| Start / new film | 打开示例影片 · 从书面计划新建 · 仍然新建影片 · 说说影片讲什么，导演会起草场景和镜头，你再修改。 |
| Top bar meta | 48 秒 · 16:9 · 1920 × 1080 · 30 帧/秒 (needed 12 px of right padding on `.film` before the tabs) |

Most Chinese strings are narrower than the English ones. The tightest places are the top bar meta and the Film tool row; the tool row wraps on a phone, as intended.

## What is simulated

- **No server.** Nothing is generated, charged, saved or downloaded. Every result comes from local state in the page and resets when you switch state or reload.
- **Language.** The language choice is kept in `localStorage`.
- **Director.** Replies are scripted and say so.
- **Timing.** Import reading takes 2.6 s. An export renders in 6 s, and a clip is made in about 2.2 s. Check again finds the file. Reconnect fails once, then succeeds.
- **Media.** Playback is a browser clock with keyword motion and no sound. The music meter and audio play are visual only.
- **Downloads.** Download, Open (other films) and Open the demo film show a toast that says what the studio would do.
- **Sample files.** Choosing a file uses sample files, and the import is local.
- **Session expired.** The dialog has a dashed `Prototype: back to normal` exit.

## Open questions

1. **No error colour.** Failures are neutral, with a filled `!` and words. Is that enough, or should the system gain a muted red role for "failed"?
2. **Demo flag.** ProjectListItem has no `demo` flag and no picture. The list can tell the demo film only by its name. Add `demo: boolean`, and a poster artifact?
3. **Restoring archived films.** There is no restore route, so archived films are shown read-only. Is restore needed?
4. **Export resolution.** SB-16 defaults to 1280 × 720, while the film meta says 1920 × 1080. Which does the export use? The panel currently says 1280 × 720.
5. **Export progress.** ExportRecord has no fraction, so the design shows elapsed time and an indeterminate bar. Is that acceptable, or should the server report one?
6. **Import draft effects.** A plan-import draft carries no media-effect preview. The review shows per-shot Same / Changed / New and a hand-written cost line. Should the import draft return something like `ProposalPreview.effects`?
7. **Pointing at an asset.** The message contract points at scenes and shots. Pointing at an asset needs an asset reference; the legacy app had `Reference in conversation`.
8. **Film reorder scope.** Reordering in Film is limited to within a scene, and scenes reorder in Plan. Is that right, or should a shot move across scenes in Film?
9. **Stop placement.** Stop is in the top bar only while something runs. Should it also sit in the Director column while the Director works?
10. **Keyframes between 900 and 1366 px.** The Keyframes layout needs about 1366 px; `last-ferry.html` scrolls sideways below that. States stacks instead. Which should the built view do: stack, or narrow the Director column?
11. **Opening a film.** `Open` on The Last Ferry goes to Keyframes, as "where you left off". Should the studio remember the last view per film?
12. **Transcription.** It has a model row but no surface in these views. Is it only used inside narration upload?

## Lead decisions on the open questions (2026-10-15)

1. Failures stay neutral (icon and words, no red). Amber stays the Director's only colour.
2. The films list shows name, length, scene and shot counts, clips made and last change; no poster or demo flag until the server provides them.
3. Archived films can be restored: the Start view has an "Archived" filter with Restore (the server has `unarchive`).
4. Export renders 1280 × 720 (the server default from card B6); the Export panel says so.
5. A plan-import draft does not preview media effects in this version.
6. "Point the Director" on an asset points at the asset's shot, or its scene; assets cannot be referenced in a message yet.
7. Film reorders shots within a scene; moving a shot to another scene happens in Plan.
8. Between 900 and 1366 px the built Keyframes view narrows the Director column (320 px below 1280 px) and lets the workspace shrink; nothing scrolls sideways at any width from 900 px up.
- The top bar shows "48 s · 30 fps": the overview does not report aspect ratio or resolution, so the studies' "16:9 · 1920 × 1080" is left out.
- The "Prototype ▾" state menu is a study tool only; the built views have no such menu.
