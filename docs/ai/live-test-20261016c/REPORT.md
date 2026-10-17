# LIVE-3 real studio run — 2026-10-16

**All eight LIVE-3 fix checks passed. The 12-second silent film reached playback, MP4 export and clean restart.** One interrupt exited the original launcher in **204 ms with the browser/SSE open**. The same launch command reopened the exact film, attempts, takes and export without another submission. Settings retained its original successful Codex check. The new finding is an automatic review that reports a note-save failure and leaves no structured notes, plus a misleading clean-check banner around that review; neither blocked generation or export.

**Paid tally: two successful six-second Viggle jobs, approximately $0.12 at the card's rate; the studio displayed $0.20.** No paid retry, unknown-outcome retry, keyframe regeneration, speech, transcription or music call occurred. The card-rate remaining cap is **about $0.76** from the authorized $0.88. Actual billing was not inspected.

The studio, automation browser and loopback control driver are stopped. Fresh test data remains at `/Users/michael/openslate-live-test-20261016c`. No application source was changed and no git command was run.

## Scope and setup

- Main film **Harbour film LIVE-3**, project `7c55faa2-cbe7-4ab3-9f6a-2d908b8c5921`: one scene, two 180-frame shots at 30 fps, explicit No narration, no music. Scene **Paper Boat at Dusk**, framing **Close-up** and **Wide**.
- Native subscription Director **gpt-6-astra**, automatically selected pinned Codex **0.153.4**. Keyframes **codex-keyframes**; video **viggle-live-six-seconds**. No Settings workaround or model switch was applied.
- Node **24.15.0**, pnpm **10.33.0**, FFmpeg/ffprobe **8.1.1**. `pnpm setup:test-media` and `pnpm check:toolchain` passed. The prescribed launcher built the app on each start. Driver/audit syntax checks passed. No full unit-test/typecheck gate is claimed for this test-only task.
- Initial port 3001 was free, and the c data/evidence directories did not exist. Launch used `OPENSLATE_DATA_DIR=$HOME/openslate-live-test-20261016c node --env-file=/Users/michael/SideProject/OpenSlate/.env.live.local scripts/start-local.mjs --no-open`. Only that fresh installation was used. The owner settings were loaded by Node, never opened by the test engineer.
- System Chrome, headless `playwright-core`, default viewport 1440 x 900 and required preview checks at 1366 x 768. Official `studio-launcher.js` pairing ran in an unrecorded context. Pairing material and cookies stayed in memory; no HAR, trace or stored browser session was collected. Logs were filtered before persistence; credential/launch lines were omitted and non-loopback URLs redacted.
- **Actual native starts:** two Director model calls: one planning turn and one automatic read-only keyframe review. Both completed. Two Codex image-worker attempts succeeded. Internal image-call count/subscription quota is unknown.
- [16 short phase clips](CLIPS.md), 203.32 seconds total, longest 34.40 seconds, all fully decoded. Contexts were closed during provider-only waits. Short clips include active UI checks, bounded selector waits and the shutdown test.

## Step table

| Step | Result | Time taken / observed behavior | Screenshots |
|---|---|---|---|
| 1. Start / New film / models | Pass after harness correction | Main creation/setup 10.4 s. Pinned native Codex selected automatically; zero model calls at setup. Keyframes uses your Codex plan; Viggle about $0.10 per clip. | `01`–`06` |
| 2. Director | Pass | **40.022 s**. Saved brief/story, one scene, two six-second shots, prompts and explicit silence. No question, timeout or saving-blocked wording. | `07`–`10` |
| 3. Plan / small edit / Undo | Pass | Actual Save/Undo sequence about 0.5 s inside recorded 17.7 s phase. Edited shot 1.1 purpose, saved, then Undo restored original purpose and prompts; head 2 → 3 → 4. Both shots remained six seconds and No narration. | `10`–`14` |
| 4. Keyframes / inspection | Partial: generation and fix checks pass; review reports a note-save failure | One scene press, no stale refusal. First frame completed by **41.14 s** (second worker start), directly displayed at **57.62 s**. Both ready directly observed by **71.07 s**. Both square frames opened; no regeneration. Automatic review completed in **35.790 s** but created zero notes. | `14`–`22`, `25`; originals `keyframe-1.png`, `keyframe-2.png` |
| 5. Video / progress / reload | Partial: generation/no duplicates pass; active-job reload unexercised | One human confirmation, two sequential six-second jobs, both ready observed by **166.32 s** after first attempt. Stop, per-shot progress and queued capacity shown. One reload preserved the exact confirmation; no repeated press or extra attempt. Reload preceded the first persisted vendor job, so already-remote-job reload recovery was not exercised. | `21`–`25`; `reload-verification.json` |
| 6. Film / playback / export | Pass | Played through the six-second cut and ended at twelve seconds. Whole first-shot poster before play. Export completed in **3.405 s**; download/hash/ffprobe passed. Timeline has two six-second picture cuts and empty narration/music lanes. | `26`–`31`, export frames |
| 7. Restart / persistence | Pass | Exactly one SIGINT with browser/SSE open. Launcher exit **204 ms**; server cleanup log **106 ms**. Same-command relaunch initiated about 6.8 s later and was ready in about 4.3 s, with no installation-lock refusal. Exact film/attempts/media/takes/export/model-call identities preserved. | `32`–`34`; `shutdown.json`, `verification.json` |
| 8. Assets / Settings / final stop | Pass | 24.7 s active phase plus 1.3 s evidence-only reopen. Both 6.6 s source clips explain the six-second used range. Settings shows original successful check and pin. All owned processes stopped normally; no new media/model start. | `35`–`42` |

Screenshot numbers above refer to the full filenames in [screenshots.json](screenshots.json), which records UTC time, phase and clip offset. Media/provider latency is separate from human/driver inspection time.

## Per-fix results

| LIVE-3 check | Result | Evidence | Screenshots |
|---|---|---|---|
| 1. Whole square Keyframes preview at both sizes | **Pass** | Both 1254 x 1254 frames use contain, with side bars. Caption and scrubber are below the image at 1440 x 900 and 1366 x 768. | [17-keyframe-one-1440.png](17-keyframe-one-1440.png), [18-keyframe-one-1366.png](18-keyframe-one-1366.png), [19-keyframe-two-1440.png](19-keyframe-two-1440.png), [20-keyframe-two-1366.png](20-keyframe-two-1366.png) |
| 2. Panel while making keyframes | **Pass** | Making-keyframes wording with 0/2 and 1/2 ready; confirmation disabled. No premature Every frame is opened. | [16-keyframes-progress.png](16-keyframes-progress.png), [17-keyframe-one-1440.png](17-keyframe-one-1440.png) |
| 3. Director after saving the plan | **Pass** | Final planning reply confirms the saved story, scene, shots and prompts, then directs the human to the keyframe button. No saving-blocked claim. | [10-plan-saved-labels.png](10-plan-saved-labels.png) |
| 4. Short framing labels and scene title | **Pass** | Close-up; Wide; Paper Boat at Dusk. | [10-plan-saved-labels.png](10-plan-saved-labels.png), [19-keyframe-two-1440.png](19-keyframe-two-1440.png) |
| 5. Film poster before playing | **Pass** | First-shot frame shown whole with side bars at time zero before the first play press, matching export composition. | [26-film-poster-before-play.png](26-film-poster-before-play.png), [export-shot-1.png](export-shot-1.png) |
| 6. Assets explains used clip duration | **Pass** | Each 6.6-second source clip detail says the film uses 6 seconds, the shot length. | [36-assets-clip-one-used-duration.png](36-assets-clip-one-used-duration.png), [37-assets-clip-two-used-duration.png](37-assets-clip-two-used-duration.png) |
| 7. One-interrupt shutdown and immediate same-command restart | **Pass** | Browser/SSE left open. One SIGINT; launcher exited in 204 ms. Same-command relaunch succeeded without INSTALLATION_IN_USE; exact saved identities and counts preserved. | [32-before-shutdown.png](32-before-shutdown.png), [33-studio-stopped.png](33-studio-stopped.png), [34-restart-film-export.png](34-restart-film-export.png) |
| 8. Settings retains last successful Director check | **Pass** | Checked, Codex 0.153.4, original 2026-10-16T23:36:13.369Z timestamp. No Check again press; API metadata unchanged. | [42-settings-retained-check-visible.png](42-settings-retained-check-visible.png) |

Geometry evidence: [1440](geometry-preview-1440.json), [1366](geometry-preview-1366.json), [Film poster](geometry-film-poster.json), [visible retained check](geometry-settings-check.json). At 1440, the picture bottom is y=585 and caption top y=594.56; at 1366 they are y=453 and y=462.56. Scrubbers begin at y=637 and y=505 respectively. Both real keyframes are 1254 x 1254 and the preview image uses `contain`. Cropped thumbnail treatment does not change the whole-image review preview.

## Paid tally

| Shot | Submitted seconds | Vendor job ID | Outcome | Estimate at $0.01/s | Studio estimate |
|---|---:|---|---|---:|---:|
| 1.1 | 6 | `vid_af346239-e052-4d1f-9efd-54bed8aef874` | Succeeded | $0.06 | $0.10 |
| 1.2 | 6 | `vid_b33d5967-b46e-4d35-82ca-c85c346668db` | Succeeded | $0.06 | $0.10 |
| **Total** | **12** | **2 jobs, 0 retries** | **Both succeeded** | **$0.12** | **$0.20** |

[paid-intents.json](paid-intents.json) records the single human press. [state-changes.jsonl](state-changes.jsonl), the dated diagnostics and [paid-tally.json](paid-tally.json) reconcile actual persisted attempts/vendor jobs. Each has ordinal 1; there is no unresolved outcome or extra image/video attempt. The queue's second shot became a submission only when its own attempt/job appeared. The returned source clips measure 6.6 seconds; submitted/planned duration is six seconds per job. These estimates are not a verified provider bill. Including the card's prior approximately $0.12, the cumulative card-rate estimate is approximately $0.24 against the original $1.00 cap.

## Ranked problems

### 1. Minor — automatic review reports a note-save failure and leaves no structured notes

**Steps:** Generate both Codex frames, open both, and let the default automatic Director review finish. **Actual:** the review recommends keeping both frames but ends, “Notes could not be saved because the application rejected the note payload.” The snapshot has `notes: []`; the completed `keyframe_review` turn reports `notesCreated: 0`. Its tool-call list contains only two successful `read_context` calls and no `record_notes` invocation. **Expected:** persist the supported review notes, or show a clear actionable unavailable/error state. The conversation text remains readable; the human generation decision, clips and export worked. No extra review/model turn was started to repair it.

**Evidence:** [22-video-before-confirm.png](22-video-before-confirm.png), [25-video-running-note-refusal.png](25-video-running-note-refusal.png), [26-film-poster-before-play.png](26-film-poster-before-play.png). `phase-10-video.webm` around 00:00.6, `phase-11-video-progress.webm` around 00:00.6. [snapshot-review-diagnostic.json](snapshot-review-diagnostic.json) records zero saved notes and the scoped tool-call evidence.

**Error code:** not surfaced by the UI/read API or captured server log; do not infer a particular code. **Redacted server excerpt:** the automatic review's visible requests are normal reads, for example:

```text
2026-10-16T23:39:27.709Z req-lg POST /internal/projects/<test-film>/tools/read_context
2026-10-16T23:39:27.721Z req-lh POST /internal/projects/<test-film>/tools/read_context
No record_notes request/error was present in this review's captured HTTP log.
```

**Cause hypothesis, unconfirmed:** `packages/director/src/tools/bridge.ts:53` validates tool arguments before HTTP, against strict `recordNotesSchema` in `packages/core/src/tools.ts:93–104`. Invalid arguments can therefore leave no server invocation. The server repeats validation in `apps/server/src/application/tool-invocations.ts:150`. Later scope/exact-frame checks are in `apps/server/src/application/director-notes.ts:49–69`; automatic reviews have shot scope in `keyframe-review.ts:42`. The rejected payload was not exposed by the public evidence. The statement about rejection is the model's report; no captured record_notes invocation independently proves an application rejection. Neither schema mismatch nor a specific scope error is established. No state repair or source change was attempted.

### 2. Polish — green “Nothing to check” while review is running or failed

**Steps:** View the scene while the automatic review is running, then after the notes refusal. **Actual:** a green “Nothing to check in this scene” banner appears while the Director says “Reviewing the new keyframes,” and remains after it reports rejected notes. **Expected:** wording that distinguishes no recorded checks from a pending or unavailable review. The making-keyframes scene panel itself is fixed and honest; this is the separate review banner.

**Evidence:** [19-keyframe-two-1440.png](19-keyframe-two-1440.png), [20-keyframe-two-1366.png](20-keyframe-two-1366.png) and screenshot 25. `phase-09-keyframes-review.webm` around 00:05.6; `phase-11-video-progress.webm` around 00:00.6. **Server excerpt:** normal reads above, no banner-specific server failure. **Likely presentation cause:** `apps/web/src/next/keyframes/CheckBanner.tsx:98` uses the clean default when there are no checks/attention/quiet messages; this does not prove review-note persistence. A person's uncertainty here is reinforced by problem 1.

No blocker or major defect was observed. The previous doubled punctuation was absent from the new `Close-up. ...` and `Wide. ...` captions. The configured $0.20 video quote differs from the card-rate $0.12 estimate; Settings correctly explains host-configured per-clip estimates rather than a provider bill.

## Harness corrections and limitations

- I closed the first creation context immediately after pressing Create, before setup finished, then interpreted its transient Scripted Director display too early. By the later Settings read, that film had automatically selected native Codex 0.153.4 and recorded a successful check. I unnecessarily created the main film with a proper completion wait. The empty **Harbour LIVE-3** (`e618468c-de37-44a3-9b70-a9bc4a9e5331`) remains for inspection and received no Director turn or media generation. This is a harness correction, not evidence of a B22.3 regression. The phase-03 filename says setup-workaround, but no Settings model change/save was made.
- Some bounded selector waits used a button role for tab controls, a guessed Stop selector, an exact Play label instead of “Play the film,” a multi-match locator, or a curly apostrophe instead of the Assets text's straight apostrophe. They were corrected from actual UI/source observations. They caused no extra generation, model turn or canonical edit. Plan edit/Undo was executed only once.
- The one video reload happened during the accepted scene-confirmation pipeline, about 0.4 seconds after the press and before the first provider attempt was persisted. Confirmation identity survived; exactly two vendor jobs ultimately appeared. This verifies queued-intent persistence and no duplicate work here, and does not establish an already-remote-job reload test. No extra paid run was started to broaden that evidence.
- The first Settings screenshot after selecting This computer caught the prior scroll position. A short evidence-only same-command reopen captured screenshot 42 with the Checked row visibly in the viewport. No Check again, model turn or media generation occurred; final diagnostics still contain exactly four media attempts and two Director model calls. This extra reopen is separate from the first one-interrupt restart test.
- Playback, sampled first/second frames and export integrity passed. This 12-second film does not establish broader model quality, reliability or longer-film acceptance. No application-source, frozen schema/catalog or configuration changes were made to fix findings.

## Export, persistence and ffprobe

[harbour-test-c.mp4](harbour-test-c.mp4), export `4a321790-0f81-4a32-9b8d-535a8dcf8f40`, head 6, done, not a demo. Downloaded SHA-256 **9d5bdf149312d6bbcdc7bae0eb55a4eee7c290c192c663fb81b2fb1a7fa1f5be** matches the saved artifact. [Export frame 1](export-shot-1.png) and [frame 2 at seven seconds](export-shot-2.png) preserve the square picture with side bars in the 1280 x 720 output.

[ffprobe-export.json](ffprobe-export.json):

```json
{
    "programs": [

    ],
    "stream_groups": [

    ],
    "streams": [
        {
            "index": 0,
            "codec_name": "h264",
            "codec_type": "video",
            "width": 1280,
            "height": 720,
            "r_frame_rate": "30/1",
            "avg_frame_rate": "30/1",
            "duration": "12.000000"
        }
    ],
    "format": {
        "duration": "12.000000",
        "size": "1862194"
    }
}
```

No audio stream exists. [verification.json](verification.json) passes all 23 named checks: exact project/plan/attempts/media slots/takes/export, unchanged Director turns/model-call count, retained original successful check, no new work during Assets/Settings or the evidence-only reopen, and cap/outcome checks. Before/after/final: **four media attempts, two Director model calls**. All four attempts succeeded.

Shutdown evidence with the browser still open:

```text
One SIGINT to owned launcher 27460; exited in 204 ms; port 3001 free.
Waiting for OpenSlate shutdown cleanup (connections: 12)
OpenSlate shutdown complete; installation ownership released (elapsedMs: 106)
Stopped. Saved projects are preserved. (launcher exit 130)
```

The immediate prescribed relaunch succeeded without `INSTALLATION_IN_USE`. Later normal stops took 12 ms and 14 ms after browser closure. No process not started by this test was signaled; no lock file or database was deleted or repaired.

## Evidence and changed files

- Full report: `docs/ai/live-test-20261016c/REPORT.md`.
- All named recordings and exact durations: [CLIPS.md](CLIPS.md), [clips.json](clips.json), [ffprobe-phase-clips.json](ffprobe-phase-clips.json). All 16 fully decode; [evidence-audit.json](evidence-audit.json) records export hash and zero credential/launch/signed-URL pattern hits in saved text evidence. No raw secret file was searched.
- Screenshots/timestamps: [screenshots.json](screenshots.json); fix mapping: [per-fix-results.json](per-fix-results.json).
- Process/HTTP/UI observations: [events.jsonl](events.jsonl), [server-redacted.log](server-redacted.log); paid reconciliation and before/after snapshots remain beside this report.
- Added test-only drivers: `scripts/live/live-3-driver.mjs`, `live-3-client.mjs`, `live-3-stop.mjs`, `live-3-audit.mjs`. Evidence/report files are under this c directory. Application source unchanged by this test. No git operation, commit or push was performed.
- Final cleanup: the studio, Chrome automation instance and control listener were stopped; ports 3001 and 3199 are free. Data is retained at `/Users/michael/openslate-live-test-20261016c`. No user action is needed to inspect these files; the lead can investigate the optional notes failure from the recorded request identity and source boundaries.
