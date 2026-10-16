# LIVE-2 real studio run — 2026-10-16

**The real film reached playback and MP4 export. Persistence passed after an interrupted shutdown; graceful restart did not pass cleanly.** The result is a 12.000-second silent film, two Codex keyframes and two successful Viggle jobs. Plan edit and Undo no longer cause `SCENE_REVIEW_STALE`. The test found two major issues: the normal keyframe preview obscures part of the conditioning image, and the first shutdown exceeded the 40-second wait while retaining the installation lock.

**Paid tally: 12 seconds submitted, approximately $0.12 at the card's rate; the studio displayed $0.20.** Actual provider billing was not inspected. Both estimates are below the $1.00 cap. There were no paid retries, unknown submissions, keyframe regenerations, speech, transcription or music calls.

The owned studio and automation browser are stopped, and ports 3001 and 3199 are free. Fresh data remains at `/Users/michael/openslate-live-test-20261016b`. No application source was changed and no git command was run.

## Scope and execution

- Main film: **Harbour LIVE-2**, project `fc557239-6519-4cf2-bda4-738c2c9543f2`; one scene, two 180-frame shots, 30 fps, explicit No narration on both, no music.
- Models: native Codex Director `gpt-6-astra`, automatically selected pinned Codex **0.153.4**; `codex-keyframes`; `viggle-live-six-seconds`. No Settings workaround was used.
- Node **24.15.0**, pnpm **10.33.0**, FFmpeg/ffprobe **8.1.1**. `pnpm setup:test-media` and `pnpm check:toolchain` passed. The prescribed launcher completed its builds on launch/relaunch. No full unit suite or typecheck run is claimed for this test-only task.
- Launch used the prescribed `node --env-file=/Users/michael/SideProject/OpenSlate/.env.live.local scripts/start-local.mjs --no-open` with `OPENSLATE_DATA_DIR=$HOME/openslate-live-test-20261016b`. There was no port-3001 listener and no existing b data directory before the first launch.
- System Chrome, headless, 1440×900, `playwright-core`, throwaway profile under `/tmp`. Pairing used the official `studio-launcher.js` flow in an unrecorded context. Pairing/session material stayed in memory. Logs were filtered before persistence; no HAR, trace or stored browser session was collected.
- Thirteen separate phase contexts produced short named WebMs. Contexts were closed for provider-only waits. API polling used bounded waits, ordinarily 1.5-second intervals. The 13 clips total **148.64 seconds**, longest **28.60 seconds**; all passed full decoding.
- Actual main-film native Director starts: **2** (`modelCalls`): the requested planning turn and the automatic read-only keyframe review. Two Codex image-worker attempts succeeded. Internal image-call count/subscription quota is unknown. No request timed out.

**Harness mistakes, separate from product findings:** I initially omitted the explicit “Talk to the Director” selection, making an empty film named Harbour test LIVE-2 (`49c4c9a0-3982-4fc2-a5c8-45924a674dd9`). I then created the main film with that option selected. The empty film remains for inspection; it received no media generation. Three selector waits used the wrong Stop action or expected a transient Open frame button after the frame had already loaded and marked itself opened; those waits were bounded at 1–15 seconds, corrected from the actual UI, and caused no repeat generation press. The first restart was attempted after the listener closed but before the original process exited; the installation lock correctly refused that premature relaunch. Future driver guards now require process exit and close the authentication context before shutdown. Those post-run safeguards passed syntax checking but were not live-replayed.

## Step table

| Step | Result | Time taken / observed behavior | Screenshots |
|---|---|---|---|
| 1. Start / New film / models | Pass, after harness correction | Correct Start phase 12.6 s; setup request 10.381 s. The sheet stayed present while checking, then opened the film. Defaults showed Codex plan wording and Viggle about $0.10/clip. API confirmed Codex 0.153.4, zero model calls at setup. | `01-new-film-sheet.png`–`06-director-ready.png` |
| 2. Director | Pass | One small request completed in **43.753 s**. Saved brief/story, one scene, close-up and wide shots, image/video/motion prompts, two six-second durations and explicit silence. No question or timeout. Automatic image review later took 22.547 s and left notes a–b recommending keeping both frames. | `07-director-request.png`, `08-director-progress.png`, `09-plan-saved.png`, `17-keyframe-two-opened.png` |
| 3. Plan / small edit / Undo | Pass | 14.7 s recorded phase. Edited shot 1.1 purpose to “Observe the paper boat quietly up close.” Save and Undo both returned 200; original purpose and prompts restored. Head 2 → 3 → 4; both shots remained six seconds and No narration. | `09-plan-saved.png`–`12-plan-undo.png` |
| 4. Keyframes / open frames | Partial: generation passed; review visibility issue | One scene-generation press returned 200. First frame directly observed ready by **58.3 s**; second attempt's start implies first completed by about 36.1 s. Both ready in about **67 s**. Both actual frames loaded and were recorded as opened. No stale refusal, failed image or regeneration. Originals are valid square boat images; the wide preview hides the subject under its caption. | `13-keyframes-price.png`–`17-keyframe-two-opened.png`; `keyframe-1.png`, `keyframe-2.png` |
| 5. Video / progress / reload | Pass | One confirm press; two sequential six-second submissions. Both ready by **129.9 s** after first submission. First running/second queued, Stop and per-card status visible. Reload at about 15 s preserved the same attempt and vendor job; no duplicate create. UI price: about $0.20, “2 clips at about $0.10”. | `18-video-price.png`–`21-video-saved.png` |
| 6. Film / playback / export | Pass | Played through the cut at six seconds and ended at 12 seconds. Timeline has two six-second picture cuts, empty narration/music. Local export finished in **2.924 s**. MP4 downloaded and probed: 12.000 s, 1280×720, 30 fps, H.264, no audio. | `22-film-ready.png`–`26-export-ready.png`; `export-shot-1.png`, `export-shot-2.png` |
| 7. Restart / persistence | Partial: graceful stop failed; recovered persistence passed | First stop exceeded 40 s; listener closed but original server retained the data lock. A second interrupt to that verified owned server ended it. The same command then reopened the film. Project, attempts, media slots, both keyframe take histories and export are exactly equal before/after; no new submission. | `27-restart-film-export.png`; `verification.json`, `events.jsonl`, redacted server log |
| 8. Assets / Settings / final stop | Pass, with copy confusion | About 26 s recorded. Assets lists two keyframes, two clips and one export. Settings shows the intended models, pinned binary path, automatic review on and credential presence only. Final shutdown, after closing browser/authentication contexts, completed normally; port 3001 free. | `28-assets.png`–`31-settings-computer.png` |

## Paid tally

| Shot | Submitted seconds | Vendor job ID | Outcome | Estimate at $0.01/s | Studio estimate |
|---|---:|---|---|---:|---:|
| 1.1 | 6 | `vid_8f504d6f-951c-48d3-a85b-eb99f25f3796` | Succeeded | $0.06 | $0.10 |
| 1.2 | 6 | `vid_4f4a13a2-bd9f-4dab-9bd2-411ecb053520` | Succeeded | $0.06 | $0.10 |
| **Total** | **12** | **2 submissions, 0 retries** | **Both succeeded** | **$0.12** | **$0.20** |

`paid-intents.json` records the single human video press; `paid-tally.json` reconciles the actual persisted attempts. The queue's second shot was not counted as a provider submission until its attempt appeared. No outcome was unknown and nothing was resubmitted. The API-image, speech and transcription routes were not exercised. Estimates are not a verified provider bill.

## Ranked problems

### 1. Major — keyframe review crops and overlays the actual image

**Steps:** Generate both frames; load shot 1.2 at 1440×900; inspect the wide frame before paid video confirmation. **Actual:** its 1254×1254 original clearly contains a white paper boat in the lower third. The normal preview center-crops the image and places its caption/dark playback band over the boat. In the review screenshot the subject is barely discernible, although Opened is green. **Expected:** inspect the complete, unobscured conditioning image before confirmation, with a whole-image view or separate controls.

**Evidence:** compare `keyframe-2.png` with `17-keyframe-two-opened.png`; `phase-09-keyframes-review.webm`, approximately 00:01. The first frame is also square. The exported film preserves square content with black side bars (`export-shot-1.png`, `export-shot-2.png`), unlike the cropped keyframe review. The images themselves are usable; no regeneration was warranted.

**Server excerpt:** normal authenticated artifact-content GET → 200; no server error or submission refusal. The successful generate request is `22:56:13.194Z req-b7 POST .../scenes/<scene>/generate -> 200 (67.18 ms)`.

**Likely cause, source-derived:** `apps/web/src/next/keyframes/keyframes.css:82` uses `object-fit: cover`; `apps/web/src/next/ui/studio.css:175` fills the preview, and line 179 overlays the caption/playback gradient. Whole-image `contain` and separate controls are limited to the narrow-container treatment at `keyframes.css:360–368`. This is a presentation/review problem, not proof of missing source-image content or an artifact-identity failure.

### 2. Major — first shutdown remained alive and prevented immediate restart

**Steps:** Finish export with no running attempts; close the recorded context; send SIGINT to the owned launcher; wait up to 40 s. **Actual:** port 3001 closed, but owned launcher 78677 and server 78882 remained alive. A premature same-command relaunch exited with `INSTALLATION_IN_USE`. **Expected:** shutdown completes, releases the lock and allows restart, or clearly reports what it is still waiting for.

**Evidence:** process identity was checked before escalation. `events.jsonl` records the refused relaunch and `shutdown-timeout-recovery` at `23:02:22.946Z`. This process-only failure happened outside recorded browser phases; there is no meaningful browser screenshot/video timestamp. Redacted server excerpt:

```text
DomainError: Another OpenSlate process is using this local data directory. Stop it before starting again.
code: 'INSTALLATION_IN_USE'
OpenSlate: .../node exited with code 1.
```

**Recovery:** a second SIGINT was sent only to the verified owned server, after confirming all four media attempts had succeeded. Both original processes exited; no lock file/database was deleted or repaired. The next same-command launch succeeded. Persistence comparisons all pass. Final shutdown, with browser/authentication contexts closed first, completed normally.

**Cause uncertain:** `apps/server/src/index.ts:93–101` awaits runtime/Director cleanup, HTTP closure and the reconcile loop before closing storage/installation ownership. The listener can close before those operations finish. An unrecorded authentication context still held pooled connections during the first stop; the later successful stop closed it first. This may be a harness connection interaction. The evidence does not identify the exact stalled operation or establish a reproducible app-only shutdown defect. The installation refusal was correct protection; attempting restart before process exit was a harness mistake. Do not label this a clean graceful-restart pass.

### 3. Minor — “Every frame is opened” while keyframes are still being made

**Steps:** Inspect status with shot 1.1 running and shot 1.2 queued. **Actual:** “0 of 2 frames opened” coexists with “Every frame is opened. Earlier keyframes are kept.” **Expected:** making-keyframes guidance until images exist. The disabled button correctly said both shots needed keyframes; it did not allow paid video.

**Evidence:** `15-keyframes-progress.png`; `phase-07-keyframes-progress.webm`, approximately 00:06.5. Server/API: first attempt `submitting`, second queued for capacity; normal 200 reads, no error.

**Likely cause:** `apps/web/src/next/model/keyframes.ts:452–483` falls through to the confirm panel when video targets are nonempty, then counts only ready/unopened frames. Running/queued images leave that list empty and select `panel.all_opened`.

### 4. Minor — completed planning is described as an authorization failure

**Steps:** Ask for saved writing and a generation plan without generating media. **Actual:** story and both shots saved, but the final response says “OpenSlate blocked saving the generation plan because keyframe generation authorization is required.” **Expected:** clearly separate the successfully saved writing from the next human keyframe action without implying the film setup failed. The subsequent keyframe press worked normally.

**Evidence:** `09-plan-saved.png` and later conversation captures, `phase-05-plan.webm` near 00:00–00:01. Director turn completed, no timeout. Server message request `22:54:55.361Z req-3l .../messages -> 200 (328.04 ms)`; no server exception was emitted for the narrated internal refusal.

**Likely cause, inference:** an unnecessary executable-plan preparation after saving writing encountered the correct human-generation guard in `apps/server/src/application/service.ts:368–375`. Actual model tool arguments were not inspected. This is confusing Director wording/follow-on behavior, not evidence that ordinary writing requires payment permission.

### 5. Polish — doubled punctuation and unexplained labels

- Preview captions show `Close-up at puddle level.. Close-up...` and `Wide view ... pavement.. Wide view...`. See screenshots 16–18, `phase-09-keyframes-review.webm` near 00:01. `apps/web/src/next/model/keyframes-stage.ts:75` passes existing punctuation into a catalog template that adds another full stop. Prompts in the saved Plan are clean. No server error.
- Assets labels each returned clip **6.6 s**, while the planned shot and used film segment are **6 s**. See `28-assets.png`, `phase-13-assets-settings.webm` around 00:16.5. The MP4 is correctly 12 seconds, but the UI does not explain source duration versus used duration. No server error.
- After restart, Settings says Director/Codex **Not checked** despite the successful earlier native turns and retained pinned binary/version. See screenshots 29–31, the same clip around 00:25. This reflects reset readiness metadata; it does not establish a broken provider or wrong pin. No Check again or extra model turn was started just to change this label.

## Export and ffprobe

Export: [harbour-test-b.mp4](harbour-test-b.mp4). Export ID `6655d9b0-7533-4eaa-9575-1e77bccab1b9`, head 6, done, not a demo, unchanged after restart. Downloaded bytes' SHA-256 matches the export artifact: `3d648ea5d62d4b75f49426af9742c0cae647c30d13819ddd3f7fe8c287096581`.

Full selected ffprobe output is [ffprobe-export.json](ffprobe-export.json):

```json
{
  "streams": [{
    "index": 0,
    "codec_name": "h264",
    "codec_type": "video",
    "width": 1280,
    "height": 720,
    "r_frame_rate": "30/1",
    "avg_frame_rate": "30/1",
    "duration": "12.000000"
  }],
  "format": {
    "duration": "12.000000",
    "size": "1706947"
  }
}
```

No audio stream exists, as requested. Browser playback crossed into shot 1.2 at six seconds and ended at twelve seconds. Decoded export frames at one and seven seconds show the expected boat close-up and wide scene, with square content letterboxed into 1280×720. The wide adds a riverside skyline beyond the simple prompt, also noted by the Director. This short run establishes functional export and recovery for this film; it does not establish broader media quality or provider reliability.

## Phase clips and evidence checks

| Clip | Seconds | Bytes |
|---|---:|---:|
| [phase-01-start.webm](phase-01-start.webm) | 11.64 | 813648 |
| [phase-02-start-director.webm](phase-02-start-director.webm) | 11.92 | 780752 |
| [phase-03-director-request.webm](phase-03-director-request.webm) | 1.20 | 79268 |
| [phase-04-director-progress.webm](phase-04-director-progress.webm) | 10.08 | 793747 |
| [phase-05-plan.webm](phase-05-plan.webm) | 15.20 | 1104009 |
| [phase-06-keyframes-submit.webm](phase-06-keyframes-submit.webm) | 1.28 | 148069 |
| [phase-07-keyframes-progress.webm](phase-07-keyframes-progress.webm) | 8.12 | 619413 |
| [phase-08-keyframe-one.webm](phase-08-keyframe-one.webm) | 15.04 | 1290457 |
| [phase-09-keyframes-review.webm](phase-09-keyframes-review.webm) | 1.60 | 201327 |
| [phase-10-video-submit-reload.webm](phase-10-video-submit-reload.webm) | 16.84 | 1672983 |
| [phase-11-film-export.webm](phase-11-film-export.webm) | 28.60 | 3156358 |
| [phase-12-restart.webm](phase-12-restart.webm) | 1.36 | 199084 |
| [phase-13-assets-settings.webm](phase-13-assets-settings.webm) | 25.76 | 2186538 |

All clips: VP8, 1440×900, 25 fps; independent full decoding returned zero errors. `clips.json` has context wall-clock bounds; `screenshots.json` has the 31 capture times and approximate offsets within each phase. Offsets cited above are approximate, not frame-exact encoder timestamps.

`verification.json` records exact before/after equality checks and the export hash. `http-observations.json` pairs selected requests with their actual response status/timing. `state-changes.jsonl`, selected diagnostic JSON and the redacted server log retain state/progress evidence without raw provider outputs or signed URLs.

The independent evidence audit scanned 32 JSON/JSONL/log files before this report was added: zero matches for the bounded launch-code, bearer, provider-key, studio-cookie, signed-query and JSON-secret patterns; no files skipped. The final scan covered 34 text evidence files including this report, found zero matches for its bounded patterns and found no missing report links; see `audit.json`. This is a bounded check, not proof against every possible secret form. Screenshots 30/31 were also visually checked and show presence/path information only.

Drivers added: `scripts/live/live-2-driver.mjs`, `live-2-client.mjs`, `live-2-images.mjs`; all passed `node --check`. Post-run driver safeguards were syntax-checked only. No application tests were added, rewritten or deleted. No git command, commit or push occurred. No owner's normal project database/media, environment-file contents, auth file, keychain or credential was inspected or copied. Node loaded settings through `--env-file` for official startup/pairing; their contents were never inspected. The retained fresh test directory and this evidence are ready for lead inspection; fixes require a separate source-change task.
