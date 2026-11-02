# V1 — topical film and narrated making-of

Run date: November 2, 2026. Worktree: `codex-v1-demo`, baseline `c9c599ce`.
Completed live run: 18-second studio export, six narrated stages and an edited making-of. Side instance stopped after capture; artifact QA is recorded below.

## Topic, film and brief

**No Legs, No Problem** is an English, horizontal clay-animation comedy planned
as three six-second shots. Inspiration: [The Indian Express, “These tiny snakes
cartwheel at speeds of up to 13 Kmph,” November 2, 2026, 12:30 PM
IST](https://indianexpress.com/article/lifestyle/pets-animals/these-tiny-snakes-cartwheel-at-speeds-of-up-to-13-kmph-10936966/).
The news article is today's coverage of research published October 19; the film
is a fictional joke, with generic animal coworkers and no identifiable people,
brands or logos.

Brief sent through the studio, verbatim:

> Make an 18-second, horizontal English comedy called No Legs, No Problem. Today’s light news is about tiny snakes that cartwheel: https://indianexpress.com/article/lifestyle/pets-animals/these-tiny-snakes-cartwheel-at-speeds-of-up-to-13-kmph-10936966/ . Imagine a cute fictional clay snake proudly discovering that rolling is the ultimate shortcut for its morning commute. Give it a clear visual setup and a gentle surprise at the end; no danger, real people, logos or brands. You choose the story and cuts. Use three shots of about six seconds, consistent character references, readable English captions and playful sound. Keep costs low: Codex pictures and the cheapest six-second first-frame video option. The film limit is $2.40; at most two retakes total, and stop if any paid step fails twice. Please make it, ask me the keyframe choices, review the clips, cut and render the finished film.

The Director proposed: an earnest, slow slither to work; a rolling shortcut;
then a snail coworker passing on a leaf skateboard. It chose three shared
references (cast, garden, office entrance), three keyframes, Viggle H3
first-frame clips, a Lyria instrumental, English captions and local effects.
The operator supplied no program. The Director authored versions 1–3. Version 2 reused the first pending picture; version 3 reused all nine image/video steps, shifted the rolling source cut by 12 frames, and aligned the local effects. Both free reviews finished; no retakes were made.

## Isolation and authorization

- Only the approved side listener at `127.0.0.1:5173`, using
  `~/openslate-filmq-20261101`; new project
  `8a1a3b59-168d-4ad4-91a6-ffab99c164ee`.
- No connection to port 3001 and no access to
  `~/openslate-code-20261029-2351`. Listener inspection confirmed the side PID.
- Environment files and keys were never read, printed or copied. Node loaded
  the approved environment file for the studio and narration subprocess.
- English locale/UI, 1920×1080 Chrome-channel Playwright recording. Raw waits
  remain in the WebM; editorial cuts/speed changes use a local manifest.
- The film ceiling was saved and verified as `2400000` micros, with zero spent
  and reserved, before sending the brief. Every card selected first-frame input.
- No product/UI files changed, no other films edited, no commit or push.

## Spending

The studio's configured prices and spend line are the film accounting source,
not an independently checked vendor invoice. Codex picture/Director operations
use subscription allowance and show $0 incremental spend here.

| Operation | Calls | Price |
|---|---:|---:|
| Codex shared references | 3 | $0 recorded; subscription allowance |
| Codex shot keyframes | 3 | $0 recorded; subscription allowance |
| H3 first-frame clip: slow commute | 1 | $0.18 |
| H3 first-frame clip: rolling shortcut | 1 | $0.18 |
| H3 first-frame clip: snail coworker | 1 succeeded | $0.18 |
| Lyria instrumental | 1 succeeded | $0.08 |
| Local render and two Director reviews | 1 render, 2 reviews | $0 |
| OpenAI narration stages 01–06 | 6 succeeded | $0.021639 |

Narration used the requested `gpt-4o-mini-tts`, voice `cedar`, PCM at 24 kHz.
Six SSE usage receipts cover 71.4 seconds. **Final studio line: $0.62 of $2.40; narration: $0.021639; total: $0.641639 (about $0.64), below $3.** Reserved/unknown liability is zero. There were zero provider failures, zero retry calls and zero retakes. Per-call costs are $0.0039894,
$0.0037980, $0.0037416, $0.0036630, $0.0031692 and $0.0032778. Pricing is
computed from returned input/output token usage at [$0.60/M text input and
$12/M audio output](https://developers.openai.com/api/docs/models/gpt-4o-mini-tts).
The local ledger persists intent before each call and disables SDK retries.

## Timing, recordings and outputs

Raw recording starts at **18:02:12 UTC / 10:02:12 PST**. `recording.json`
contains exact relative markers. Stages overlap because keyframe choices and clip work can proceed while later frames are being made. Important checkpoints:

| Stage | UTC | Evidence |
|---|---|---|
| New film and Code plan selection | 18:02–18:03 | `01-code-plan-selected.png` |
| Brief sent | 18:03:09 | `02-brief-sent.png` |
| First plan submitted | 18:05:28 | Director version receipts |
| Shared cast returned | 18:06:17 | Code-plan step receipt |
| Garden returned | 18:07:31 | Code-plan step receipt |
| Office reference returned | 18:08:10 | Code-plan step receipt |
| First/second/third keyframes returned | 18:09:00 / 18:09:49 / 18:10:39 | Full-size inspection screenshots |
| First/second/third cards answered | 18:09:39 / 18:10:56 / 18:11:10 | Choice receipts; first-frame input |
| First/second/third clips saved | 18:11:32 / 18:13:24 / 18:14:45 | Film rows and step receipts |
| Clip review | 18:14:45–18:16:09 | Free review receipt; no retakes |
| Cut revision (version 3) | 18:15:59 | Nine reused image/video steps |
| Music returned | 18:16:36 | $0.08 succeeded |
| Render finished | 18:16:49 | 18-second export |
| Final review finished | 18:17:29 | Free review receipt, done |
| Finished film played in Film | 18:18:10–18:18:29 | Full-speed playback captured |
| Capture ended | 18:18:55 | 1002.894 seconds of raw recording |
| Side instance stopped | 18:19:18 | SIGTERM to owned PID 77929, exit 0; 5173 no longer listening |

Final paths:

- `data/test-runs/20261102-v1-demo/outputs/2026-11-02-making-of.mp4`
- `data/test-runs/20261102-v1-demo/outputs/2026-11-02-film.mp4` (downloaded studio export)
- `data/test-runs/20261102-v1-demo/raw/` (WebMs, screenshots, timing manifest,
  narration WAVs/usage ledger, edit manifest and validation logs)

## Problems and handling

1. **Wrong port in the launch link.** The approved preload moved the actual
   listener/bridge to 5173, but the printed pairing URL still said 3001. The
   driver extracts only the one-time code and constructs a 5173 URL. It never
   follows the printed origin. Only the owned side PID was restarted to obtain
   a fresh code.
2. **Progress appears late.** The first reference was in flight while Plan
   showed zero scenes/shots; later in-flight steps could remain unreached until
   a completed pass. Waiting allowed the References row, Making placeholders,
   queued rows and run-strip text to appear. No replacement requests or product
   changes were used to hide the delay. The recording preserves it.
3. **Initial estimates differ.** The new-film defaults described approximately
   $0.10 per clip, while actual Code plan choices priced first-frame H3 at $0.18
   and reference modes at $0.30. The run used the inspected card prices.
4. **Native runtime notice.** Startup reported the legacy 0.153.4 Codex path
   against expected 0.162.1 and a versioned fallback path. Planning and images
   subsequently succeeded; no runtime installation/configuration was changed.
5. **Requested versus returned clip length.** The first six-second request
   returned a 6.6-second clip according to the viewer. The Director's plan uses
   source-frame cuts rather than trusting the request duration. All three clips show 6.6 seconds; the music source shows 1:17 despite a 30-second request. The finished render correctly trims these to 18 seconds; no replacement media was purchased.
6. **Recording-driver setup corrections.** Initial closed stdin was corrected
   with an interactive PTY; SSE prevents network-idle readiness, so the driver
   now waits for a visible studio control. Tab buttons expose tab roles; actions
   use their observed selectors, and the inspector now includes explicit roles.
   A closed recording left its interactive stdin alive until EOF; explicit reader cleanup now fixes that, and an offline close smoke verifies process exit. These were automation errors, not paid provider failures.
7. **Minor generated-picture continuity/framing flaws.** The Director reported extra yellow spots during rolling and a cropped tail in the final closer shot. Contact-sheet inspection supports those limits. It judged the story readable, scored the visuals 8/10 and kept the takes. That is the Director’s rating, not a human quality score. No attempt was made to hide these defects.
8. **Audio observation limit.** Audio files and usage are real. This agent's
   audio-input tool cannot listen to them; subjective voice/music quality has
   not been verified by listening. Technical loudness/stream checks are separate.

## Scripts, tests and review

Reusable files are confined to `scripts/demo/`: recording driver, SDK narration
wrapper/worker, FFmpeg edit, typography cards, README and offline safety tests.
No browser contract changes, rewritten tests or deleted tests.

- `pnpm setup:test-media` / `pnpm check:toolchain`: passed; Node 24.15.0,
  pnpm 10.33.0, FFmpeg/ffprobe 8.1.1.
- `pnpm build`: passed, with existing Vite chunk/dynamic-import warnings.
- Focused runner: **1/1 Node test passed**, covering **7/7 Python offline money
  and failure cases**. No real calls occur in those tests.
- `pnpm -r typecheck`: **5/5 packages passed**.
- `pnpm test`: **5,222 passed, 0 failed, 2 skipped (5,224 total), exit 0**, 720.49 seconds. No timing-sensitive failure occurred, so no failed test file needed a retry. The final skills-release validation was CPU/I/O active for several minutes; it was allowed to finish.
- Local synthetic edit smoke: passed; 1920×1080 H.264, 30 fps, stereo AAC at
  48 kHz, measured master approximately -14.20 LUFS / -1.50 dBTP. Its fake film
  is explicitly under `offline-edit-smoke/`, separate from the live output.

Self-review found a possible stale-ledger race between reading it and acquiring
the process lock. The read now happens after acquisition; a regression test
simulates another process finishing just before acquisition and proves zero
additional calls. Readiness handling and screenshot-hold editing were also
checked. The reviewed code also explicitly closes the recorder’s stdin, so its video is flushed and the process exits. Source syntax checks and `git diff --check` pass. No important unresolved script issue was found in the final review.

## Final result

The film is complete (`done`, plan version 3), all 11 media steps succeeded, both reviews are done and no paid work remains pending. Assets shows three references, three keyframes, three clips, one music item and one export. The export was downloaded through Assets → Export → Download, then played in Film.

`2026-11-02-film.mp4` is exactly 18.000 seconds, 1920×1080, 30 fps, H.264 + stereo 48 kHz AAC, 13,922,947 bytes. Its SHA-256 matches the studio artifact: `152b7d50e86c6ee66e80e9cf7a3b2e1f9fb1486ddbb0cacaca1611b885daf15a`. Measured original export loudness is -14.13 LUFS / -1.44 dBTP. The downloaded export is unchanged.

The making-of has a title card with AI-voice disclosure, all six narrated stages, accelerated/cut waits and an “a few minutes later” card, the entire film at normal speed with its own sound, and an end card. One captured card screenshot is held briefly to make its three video-input prices readable; no simulated studio footage is used. The only fake media is the separate offline editor smoke fixture. The raw recording is `page@77f0e232017235c1d710c75d2f308acd.webm`; the two small earlier WebMs are aborted recorder setup attempts.

`2026-11-02-making-of.mp4` is **108.338 seconds**, 1920×1080, 30 fps, H.264 + stereo 48 kHz AAC, **24,479,513 bytes**. Two-pass mastering targets -14 LUFS / -1.50 dBTP; the **final encoded AAC measures -14.02 LUFS / -0.61 dBTP** (AAC encoding adds peak overshoot). Full decode completed without errors. The opening edit was adjusted after visual QA so it visibly ends with the saved $2.40 limit; the original film and completed output contact sheets were inspected. The recorder close smoke exited 0. No commits or pushes have been made. Source changes are the eight files in `scripts/demo/` and this report only; no files were rewritten or deleted outside that ownership.


## File inventory and proposed commit split

No commits were created. Proposed for the lead:

- `feat(demo): add recorded topical film workflow`: `scripts/demo/record.mjs`, `scripts/demo/narrate.mjs`, `scripts/demo/narrate.py`, `scripts/demo/edit.mjs`, `scripts/demo/cards.py`, `scripts/demo/README.md`, `scripts/demo/demo.test.mjs`, `scripts/demo/test_narrate.py`.
- `docs(demo): record V1 live production results`: `docs/ai/film-quality/reports/V1-report.md`.

No deletions, rewritten existing tests or changes to `packages/core/src/studio-api.ts`.
