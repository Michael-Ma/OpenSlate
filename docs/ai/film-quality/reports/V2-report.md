# V2 — Claude Code · Opus 5.5 topical demo

Run date: November 2, 2026. Worktree: `codex-v2-opus`, baseline `34073712`.
Completed: **Rolling Start**, a 17.1-second film independently written and
directed by Claude Code · Opus 5.5, plus a six-stage narrated making-of.
Recorded total: **$1.1399584**, about **$1.14**, below the $3 cap. The side
instance and recorder have stopped.

## Brief and independent story

Topic supplied by the card: [The Indian Express, tiny snakes that cartwheel at
up to 13 km/h](https://indianexpress.com/article/lifestyle/pets-animals/these-tiny-snakes-cartwheel-at-speeds-of-up-to-13-kmph-10936966/),
November 2, 2026. The article could not be opened by this run's web tool or by
the Director. Its headline is the source of the speed claim; the film is a
fictional animal comedy, not a reconstruction of the research.

Brief sent through OpenSlate, verbatim:

> Make a new English light-comedy film inspired by today's Indian Express item about tiny snakes that cartwheel at up to 13 km/h: https://indianexpress.com/article/lifestyle/pets-animals/these-tiny-snakes-cartwheel-at-speeds-of-up-to-13-kmph-10936966/ . Choose your own original idea, characters, title, orientation and shots. No real people, logos or brands. Aim for 15–25 seconds, with two or three shots of about six seconds. Keep the studio's total at or below its $2.40 spend limit; use keyframes as first-frame video inputs and at most two retakes overall. Music is optional. Please make the film in OpenSlate, asking me to review the keyframes and answer any creative questions you need. Everything, including captions, should be English.

Opus chose **Rolling Start**. In its proposed story, Shelby, a desert tortoise in a red sweatband,
strains to take one racing step while Pip, a sleepy sand snake, barely reacts.
Pip curls into a hoop and cartwheels down the dune, spraying Shelby with sand.
The final close-up shows a stunned Shelby, with Pip already relaxing beside
the finish flag. Opus chose the characters, title, prompts, cuts, captions and
sound. V1's story, title, characters, shots and captions were not supplied to it.
The operator supplied no program.

Version 1 chose landscape 16:9, two shared references, three six-second shots,
free clip review, Lyria music, captions and local thud/whoosh/ding sounds.
After the picture-runtime problem described below, version 2 deliberately
switched all pictures to GPT Image 2 medium and made the film square to match
that configured model's picture shape. It preserved the story and removed
in-program retries. The replacement character sheet counts against the
two-retake maximum.

Version 3 followed Opus's free clip review. It reused all eight completed
picture/video steps and kept source ranges `0 + 168`, `30 + 165`, and
`15 + 180` frames, for **513 frames / 17.1 seconds**. This removes a late
facial glitch in shot 1 and aligns the effects with Shelby's step, Pip's
launch and arrival. No clip retake was made. The final human-requested visual
check used existing media and changed nothing.

## Isolation and authority

- The existing, clean `codex/v2-opus` worktree was used throughout. No commit,
  push, branch switch, stash, reset, web edit or other card's file edit.
- The side instance used only `127.0.0.1:5173` and
  `/Users/michael/SideProject/OpenSlate/data/test-runs/20261102-v2-opus/studio`.
  Its owned listener PID is 9779. No connection to or operation on port 3001.
- New project: `6786ab3d-fc9b-4c1c-8f66-340ef3e62cf9`. No other film was opened
  or changed. All media and raw evidence stay in the mandated ignored run
  folder, with no home-directory data folder.
- Environment files and keys were never read, printed or copied. The studio
  loaded the approved environment file through Node's `--env-file`.
- Chrome-channel Playwright recording uses English locale and a 1920×1080
  viewport and video size. The recorder permits only the side origin and
  local blob/data URLs. The V1/V2 card authorizes this recording and live scope.
- Before the brief or any paid media, Settings → Models selected **Claude Code
  · Opus 5.5**. The Director panel showed `/Users/michael/.local/bin/claude`,
  the requested model, and **uses your Claude plan**; status was Ready. The
  selected executable reports **2.1.312**. The unrelated PATH executable is
  older, 2.1.292, and was not selected by the studio.
- The saved film limit was **$2.40**, with zero spent and pending, before the
  first message. Every keyframe was inspected larger and confirmed with the
  **$0.18 Keyframe as first frame** option.

## Problems and recovery

1. **Codex picture instructions refused after dispatch marking.** The first
   character sheet became `submission_unknown` after about five seconds.
   Saved evidence reports `native_instructions_unexpected`; the image step
   remains unknown, with one attempt and $0 configured price. There is no
   proof of a returned picture or of zero subscription usage. No retry,
   restart, cancellation, release, database edit or receipt rewrite was used.
   The UI showed “Waiting for results” and dropped its Making reference tile;
   it did not expose this diagnostic. The operator read the run's own
   allowlisted diagnostic from its SQLite evidence.
2. **Deliberate provider replacement.** Through Settings, the operator chose
   GPT Image 2 medium, then sent a new human message explicitly acknowledging
   replacement-picture spending, preserving the unknown original, requiring
   no further Codex image calls, and stopping on another generation failure.
   Opus authored version 2. This is a different, authorized provider operation,
   not a blind retry of the unknown native request. The budget stayed $2.40.
3. **Duplicate Claude replies.** Each completed human turn displayed the same
   long reply twice. The stored outputs contain both `commentary` and `final`
   copies. The duplicate UI rows do not mean two Director turns or purchases.
   No out-of-scope runtime or UI fix was attempted.
4. **Claude settings copy.** The Director panel correctly said Claude plan,
   while its “Set up Codex…” button and keyframe-review help still named
   Codex. The selected model and billing line were verified independently in
   Settings and captured in `01-claude-ready-limit.png`.
5. **Default price copy.** The new-film dialog described an approximately
   $0.10 video default; the actual first-frame cards priced six seconds at
   $0.18. Only inspected card prices were used.
6. **Recorder read endpoint.** The existing driver's advertised
   `/conversation` read returned HTTP 404. It made no mutation. Code-plan and
   version reads worked; a read-only extraction of the run's own stored
   Director outputs preserves conversation evidence instead.
7. **PTY flow control.** Recorder output paused until XON was sent. The owned
   recorder terminal then disabled software flow control and echo; the
   browser, recording and provider requests were not restarted.
8. **Generated-motion limits.** Opus reported an unrequested camera push-in,
   a small tortoise step, a smeared/double-ring snake while spinning, changed
   dunes/clouds, no visible sand spray onto Shelby in shot 2, and a sweatband
   that never slips over his eye. The final shot's falling sand communicates
   the gag. The coil by the flag is small. Operator contact-sheet inspection
   confirms the main ring deformation and setting/framing differences.
   These limitations remain in the delivered film; no quality score or human
   acceptance claim is inferred from Opus's review.
9. **Six seconds requested, 6.6 returned.** The first clip's inspector reported
   768×768 and 6.6 seconds. The finished film uses explicit source-frame cuts
   and is exactly 17.1 seconds. The 1080-square export is an upscale of the
   generated clip geometry, not evidence of native 1080p clip generation.
10. **Audio observation boundary.** Neither this operator nor the Director's
    frame-viewing tool listened to the soundtrack or narration. Stream,
    duration, decode and loudness checks passed; subjective voice/music
    quality is unverified. Opus explicitly disclosed that its final review
    could inspect pictures but could not listen.

## Every paid step and final accounting

The studio's configured prices/spend line are the film accounting source,
not an independently reconciled provider invoice. Claude Director turns use
the owner's subscription. The original unresolved Codex image can have used
subscription allowance even though its configured incremental price is $0.

| Operation | Calls | Recorded cost |
| --- | ---: | ---: |
| Original Codex character sheet, unresolved and never retried | 1 | $0 configured; subscription outcome unknown |
| GPT Image 2 replacement character sheet | 1 | $0.10 |
| GPT Image 2 dune backdrop | 1 | $0.10 |
| GPT Image 2 keyframe, On your marks | 1 | $0.10 |
| GPT Image 2 keyframe, The rolling start | 1 | $0.10 |
| GPT Image 2 keyframe, Photo finish | 1 | $0.10 |
| H3 first-frame clip, On your marks | 1 | $0.18 |
| H3 first-frame clip, The rolling start | 1 | $0.18 |
| H3 first-frame clip, Photo finish | 1 | $0.18 |
| Lyria music | 1 | $0.08 |
| Local render; eight free frame-viewing tool calls | 1 render | $0 |
| Narration 01 | 1 | $0.0032046 |
| Narration 02 | 1 | $0.0033246 |
| Narration 03 | 1 | $0.0039168 |
| Narration 04 | 1 | $0.0029370 |
| Narration 05 | 1 | $0.0030588 |
| Narration 06 | 1 | $0.0035166 |

**Final studio line: $1.12 of $2.40; pending/reserved dollars: $0. Narration:
$0.0199584. Total: $1.1399584.** All ten reached media steps succeeded; the
separate, unreached original native image remains unknown in history. No
unknown request was blindly replayed. One deliberate picture replacement
used one of the two allowed retakes; the second remained unused.

Narration uses the requested `gpt-4o-mini-tts`, `cedar`, PCM at 24 kHz, six
successful calls and **65.7 seconds** of returned speech. The worker persisted
intent before each call, disabled SDK retries and retained SSE token usage
and request IDs in `raw/narration/ledger.json`. Costs use the verified
[$0.60/M input and $12/M output token rates](https://developers.openai.com/api/docs/models/gpt-4o-mini-tts).
No narration request was retried. The first passage states once, early, that
Claude Code runs Opus 5.5 on the owner's Claude plan; later passages describe
the brief, references/recovery, keyframe decisions, clip review/render and
finished Film/Assets views. Title and end cards disclose AI-generated voice.

## Timing and recorded stages

UTC below; local time was PST (UTC−8). `raw/recording.json` retains exact
relative markers and `raw/final-run-evidence.json` retains version, step and
Director-turn timestamps.

| Checkpoint | UTC |
| --- | --- |
| Recording starts | 19:30:22.825 |
| Claude selection/limit recorded before first message | 19:30:49–19:31:06 |
| Initial brief sent | 19:31:06.974 |
| Version 1 saved | 19:32:29.510 |
| Original image becomes unknown | 19:32:34.611 |
| Explicit provider-replacement message | 19:34:11.918 |
| Version 2 saved | 19:34:56.511 |
| Replacement character sheet / dune return | 19:35:44.910 / 19:36:16.526 |
| Keyframes 1 / 2 / 3 return | 19:36:49.114 / 19:37:22.142 / 19:37:56.163 |
| First-frame choices 1 / 2 / 3 recorded | 19:37:26.283 / 19:37:44.228 / 19:38:13.039 |
| Clips 1 / 2 / 3 saved | 19:39:52.745 / 19:40:47.599 / 19:42:24.403 |
| Opus clip-review turn | 19:42:24.865–19:43:48.912 |
| Version 3, free recut | 19:43:37.977 |
| Music returned | 19:44:16.368 |
| Render finished | 19:44:40.452 |
| Full-speed playback captured in Film | 19:45:08.077–19:45:26.082 |
| Final visual-check turn | 19:45:28.914–19:46:22.125 |
| Final Plan/Assets capture and recording close | 19:46:35–19:46:37.555 |
| Owned side instance stopped, exit 0; 5173 no listener | 19:47:03 |

Brief to rendered film: **13 min 33.478 s**. Brief to completed final visual
check: **15 min 15.151 s**. The raw recording is **974.730 seconds by its
closing marker**; waits remain in it. The edit uses captured screenshots,
shortened/accelerated waits and a “few minutes later” card. No studio footage
was simulated and no Director program was written by the operator.

## Outputs and technical QA

Run root: `/Users/michael/SideProject/OpenSlate/data/test-runs/20261102-v2-opus/`.

- `outputs/2026-11-02-opus-film.mp4`: **17.100 seconds**, 1080×1080,
  H.264, 30 fps, stereo AAC at 48 kHz, **10,142,944 bytes**. Downloaded through
  Assets → Exports → Download. SHA-256
  `0bcf56c970f32bffcf5d3ecad1505df1b2933f3200273a622f55d9e1901d9dc0`
  exactly matches the studio artifact. The downloaded export is unchanged.
- `outputs/2026-11-02-opus-making-of.mp4`: **109.734 seconds**, 1920×1080,
  H.264, 30 fps, stereo AAC at 48 kHz, **19,814,322 bytes**. SHA-256
  `38f347da60f79e45525bb3a443ab9a68746300aabfd5f6fd9efb8795cffb0302`.
  It includes the title, six narrated stages, the entire finished film at
  normal speed with its own sound, and the end card. Square footage is
  contained inside the 1080p frame, preserving its full picture.
- `raw/page@39b9213ce65a6a5cd799ea6cb18979cb.webm`: the complete browser
  recording. `raw/demo.json` is the exact edit/narration manifest;
  `raw/narration/ledger.json` is the six-call usage ledger. Screenshots,
  code-plan versions, sanitized run evidence, intermediate edits, tool-call
  summary and QA results remain under `raw/`. Studio state stays in `studio/`.

Both videos fully decode without errors. The unchanged film measures
**−14.24 LUFS / −0.96 dBTP**. The making-of's two-pass master targets −14 LUFS
and −1.5 dBTP; the final encoded AAC measures **−13.80 LUFS / −0.96 dBTP**.
Actual encoded measurements are reported rather than substituted with the
filter's requested target. The original film contact sheet, its end title,
and exact-time making-of samples covering the opening, settings, generation,
choices, playback and end card were inspected.

## Comparison with V1

V1 figures come from the existing [V1 report](V1-report.md), not a new V1 run
or access to another film's data. That report was read after Opus had already
chosen its independent story, and none of its creative material was relayed.

| Measure | V1 | V2 |
| --- | --- | --- |
| Story | Clay snake's morning commute, then a snail coworker on a leaf skateboard | Tortoise–snake dune race and sand-covered reaction |
| Creative brief | Included a title, clay snake and commute premise | News topic and production constraints; Opus chose the film |
| Format / length | 16:9, 1920×1080, 18 seconds | 1:1, 1080×1080, 17.1 seconds |
| Plan versions | 3 | 3 |
| Director turns | Total not recorded in V1 report | 4 completed Claude turns: 3 human messages and 1 app-started clip review |
| Visual checks | 2 reported reviews | 1 persisted plan review plus 1 human-requested final check; 8 free frame calls |
| Brief to render | 13 min 40 s | 13 min 33.478 s |
| Studio / narration / total | $0.62 / $0.021639 / $0.641639 | $1.12 / $0.0199584 / $1.1399584 |
| Picture operations | 6 subscription pictures | 5 paid pictures plus 1 unresolved subscription request |
| Retakes/replacements | 0 | 1 deliberate picture-provider replacement; 0 clip retakes |

V2's recorded total is **$0.4983194 higher**, chiefly the $0.50 picture
substitution. The different briefs, picture providers, formats and recovery
path prevent treating this as a controlled Director-model benchmark. The
V1 report does not give a total turn count, so that comparison remains
explicitly unavailable rather than estimated.

## Verification and self-review

No tests were added, rewritten, deleted or weakened. The existing reusable
scripts were sufficient for recording, narration and editing; no source or
test files were changed. Verification uses Node 24.15.0, pnpm 10.33.0 and
FFmpeg/ffprobe 8.1.1.

| Command/check | Result |
| --- | --- |
| `pnpm setup:test-media` | Exit 0; matching installed binaries reused |
| `pnpm check:toolchain` | Exit 0; exact pins, encoders, decoders and demuxers pass |
| `pnpm build` | Exit 0; all five workspace builds pass; existing Vite chunk/dynamic-import warnings |
| `node scripts/run-tests.mjs scripts/demo/demo.test.mjs` | Exit 0; **1 passed, 0 failed, 0 skipped**, covering **7 Python offline cases** |
| `pnpm test` | Exit 1; **5,246 passed, 2 failed, 1 skipped; 5,249 total**; **1,351,130.769375 ms** |
| Complete launcher-file rerun after side shutdown | Exit 0; **4 passed, 0 failed, 0 skipped**, **5,213.807792 ms** |
| `pnpm -r typecheck` before final suite completion | Exit 0; **5/5 packages**, zero errors |
| Final `pnpm -r typecheck` after suite completion | Exit 0; **5/5 packages**, zero errors |
| Both delivered MP4 full decodes and stream/loudness probes | Exit 0; no decode errors |
| Report diff/whitespace check | Passed |

The full run's only failures were both in
`apps/server/test/studio-launcher.test.mjs`:

- `a studio bound to 5173 prints its actual readiness address and a working pairing link`
- `automatic browser opening receives the bound 5173 URL without launching a browser`

Both failures explicitly report `EADDRINUSE` on `127.0.0.1:5173`: the full
suite overlapped this run's own live side instance. After that instance
stopped, the **entire file** was rerun, and all four tests passed. This is
the requested file-level rerun before classifying the result. The full
suite itself still has exit 1; it is not reported as a clean full-suite
pass. No implementation was changed to hide or weaken the collision.
The one optional skip is `opt-in native Codex probe never starts a model turn`.

The final quiet portion of the suite was active skills-release validation;
the owned child process was observed using CPU and was allowed to finish.
No other engineer's test process was stopped.

Verification logs: `/tmp/openslate-v2-opus-build.log`,
`/tmp/openslate-v2-opus-targeted.log`, `/tmp/openslate-v2-opus-full-test.log`,
`/tmp/openslate-v2-opus-launcher-rerun.log`,
`/tmp/openslate-v2-opus-typecheck.log`, and
`/tmp/openslate-v2-opus-final-typecheck.log`. Media receipts/probes and both
edit/mastering measurements remain in the ignored run folder.

Self-review cross-checked the report against actual step/turn/version
receipts, paid-call ledgers, chosen first-frame inputs, source cuts, media
hashes, output formats, captions, recorded stages, shutdown evidence and
the complete test failure diagnostics. The review retained the distinction
between ten successful **reached** steps and the historical unknown image,
and between configured $0 and unknown subscription usage. It also clarified
that the sand spray belongs to the proposed story; the delivered motion's
different result is documented above. V1's missing
turn count and the listening limitation remain explicit. No important
unresolved issue was found in the report or delivered-file assembly.

## Open issues for the lead

The outputs are complete and require no owner action. The historical native
image still needs separate instruction-source investigation/reconciliation;
do not erase its unknown receipt or blindly restart it. The duplicate Claude
commentary/final replies and Codex-specific settings copy remain product
issues outside this card's implementation scope. The recorder's unsupported
conversation endpoint remains a documented helper limitation. V1's total
Director-turn count and subjective listening quality were unavailable in
this run. None of these is represented as having been fixed.

## Contract changes and proposed commit

None to `packages/core/src/studio-api.ts` or any runtime/tool contract. No
source or test implementation has been changed. The only repository-file
addition is this report. No commit or push has been made. Proposed for the lead:

`docs(demo): record Opus topical film production results`

Files: `docs/ai/film-quality/reports/V2-report.md`.
