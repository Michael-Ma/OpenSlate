# LIVE-1 real studio run — 2026-10-16

**Result: blocked at keyframe generation; no real media acceptance established.** The real Codex Director saved a two-shot, 12-second silent plan. Plan edit and Undo worked. All three subsequent keyframe commands were definitively refused with `409 SCENE_REVIEW_STALE`, including after reload and through the single-shot Inspector action. The final studio snapshot contains **zero media attempts**. Viggle submitted duration and estimated cost are **0 seconds / $0.00**.

The run stopped at that blocker, as the card directs. No application source was changed and no git command was run. The owned studio was gracefully stopped; port 3001 was checked free afterward. Fresh test data is retained at `/Users/michael/openslate-live-test-20261016` for the owner to inspect. Neither the owner's normal data nor its live-validation directory was accessed.

**Hard-rule deviation by the test harness:** a late cleanup check found that Playwright used macOS's default temporary profile directory, `/var/folders/th/qdj8_39j7wx062tcx9pvccb40000gn/T/playwright_chromiumdev_profile-sDe2hF`, rather than a path inside the worktree, fresh data directory or `/tmp`. This violated card rule 5. It was a fresh automation profile, not the owner's browser profile; no profile contents, cookies or credential files were inspected. On discovery, the owned Chrome process was stopped and no test resumed. The driver has been corrected to set its temporary environment to `/tmp` for any future run; that correction was syntax-checked but not browser-retested. This run must **not** be described as fully compliant with the card. The profile path was established from the owned Chrome process arguments only. No outside-directory cleanup command was run.

## Environment, scope, and evidence

- Worktree: `/Users/michael/SideProject/OpenSlate/.claude/worktrees/cx-live`; branch identity is the card's supplied context, not independently checked with git.
- Node `24.15.0`, pnpm `10.33.0`; the prescribed launcher completed locked installation/build and served the built UI at loopback port 3001. No listener existed before startup. Only processes spawned by this run were signaled.
- Launch: the exact card command, with fresh `OPENSLATE_DATA_DIR`, `--env-file` and `--no-open`, spawned with piped output. Pairing links and sensitive log lines were filtered in memory before persistence. Browser pairing used the official `studio-launcher.js` flow; no credential file was manually opened. No `.env` contents, authentication material, signed result URL, cookie or launch code is in the evidence.
- System Chrome, headless, viewport and recording 1440 × 900, driven with `playwright-core`. No HAR or trace was collected. Settings displayed credential presence only.
- Film: **Harbour test**, ID `740e060f-c6c9-49ac-9421-dfd87ae658fd`. One scene, two 180-frame shots at 30 fps; total 12 seconds. Explicit No narration on both, no music. No speech or transcription command was issued.
- Selected media profiles: Codex images (`codex-keyframes`), Viggle H3 (`viggle-live-six-seconds`). Native Director: `gpt-6-astra`, using the existing pinned Codex `0.153.4` after the UI setup workaround below.
- Actual native Director starts: **2**, from the studio's persisted `modelCalls`. The first timed out; the second completed. **0 image attempts, 0 image regenerations, 0 video attempts, 0 paid retries.** Three refused keyframe button presses did not create attempts.
- Test drivers only: `scripts/live/live-1-driver.mjs` and `scripts/live/live-1-read.mjs`. The latter performs read-only studio API diagnostics with pairing/session material kept in memory. Its initial missing client header caused one helper-only pairing refusal; that was corrected, is not an application finding, and started no generation.

Recording: `page@6eb9c8ad7f3f99089fd81268ef20f2a5.webm` in this directory. It includes the entire recorded browser session, including a long inactive interval. Screenshots are numbered 01–28. The encoder's recording creation time is **17:48:34.824 UTC**; `screenshot-timeline.json` contains exact UTC capture times and recording offsets against that origin. `ui-errors.jsonl.seconds` instead measures driver elapsed time and must not be mistaken for video time. Do not interpret the roughly four-hour inactive interval as provider latency: the first turn's persisted start/end prove its actual 180-second timeout, and the second turn took 33 seconds.

## Step table

| Card step | Result | Time taken / observation | Screenshots |
|---|---|---|---|
| 1. Start / New film / models | Partial | Film created in milliseconds; native setup required manual recovery, approximately 2 minutes. New film showed Codex checked on creation, Codex images ready/uses Codex plan, Viggle ready/about $0.10 per clip. No model chooser in the sheet; models can be changed later in Settings. | `01-start.png`–`12-director-ready-or-failed.png` |
| 2. Director | Partial | First live turn: 180.347 s, acknowledged but saved nothing, then timeout. One fresh shorter request: 33.268 s, saved brief/story, one scene, two six-second shots, image/motion prompts and explicit silence. No questions asked. | `13-director-request.png`–`17-plan-saved.png` |
| 3. Plan | Pass | Approximately 20 s to inspect/edit/Undo. Checked story, one scene, two shots, six-second durations, prompts and No narration. Changed shot 1.1 purpose by adding “quietly”, then Undo restored it. Head advanced 1 → 2 → 3. | `17-plan-saved.png`–`20-plan-undo.png` |
| 4. Keyframes | Fail | Approximately 67 s from first press to final evidence. Batch press, reload/fresh batch press, and Inspector single-shot press all returned `SCENE_REVIEW_STALE`. No provider start or first frame, so quality, opened counts, returned notes and take strip could not be assessed. | `21-keyframes-before.png`–`28-final-blocker.png` |
| 5. Video / progress / reload | Partial — blocked | Not submitted. Frame review/confirmation unavailable without keyframes. No video progress, Stop during paid work, vendor IDs, or paid-work reload/resubmission claim. Planned first pass: 12 s, approximately $0.12 by card rate; API displayed estimate $0.20 for two clips. | None; blocker in `28-final-blocker.png` |
| 6. Film / playback / export / ffprobe | Partial — blocked | Not executed. Read-only `/exports` confirmed 12-second plan, `no_clip` for both shots, `current: null`, empty history. No export exists. | None; `exports-final.json` |
| 7. Restart / persistence / no duplicates | Partial — blocked | Acceptance restart not executed because media/export never existed. Owned studio stopped gracefully and fresh data retained. Persistence across restart and absence of duplicate dispatch across restart are **unverified**. | None |
| 8. Assets and Settings | Partial | Settings inspected for models, Director, tool/key presence and language; no credential values shown. Assets not visited because the flow stopped at step 4. | `05-settings-director.png`–`12-director-ready-or-failed.png` |

## Paid tally

| Shot | Submitted seconds | Vendor job ID | Outcome | Estimated cost |
|---|---:|---|---|---:|
| None | 0 | None | No video submission; stopped before keyframes | $0.00 |
| **Total** | **0** | — | **$1.00 cap untouched** | **$0.00** |

The intended two six-second clips were never submitted. UI prices are host-configured estimates ($0.10 per clip) rather than a measured vendor charge. The independent card-rate estimate for the intended 12-second pass was $0.12. No unknown job was retried; there were no jobs to reconcile. See `paid-tally.json`, `diagnostic-final.json` (`attempts: []`), and `generation-final.json` (both slots remain `none`).

## Ranked problems

### 0. Blocker for card compliance — automation profile outside permitted write roots

The harness launched Chrome without first setting its temporary directory to `/tmp`. The resulting fresh automation profile was under `/var/folders/.../T/`, violating the card's machine rule. This is a test-engineer mistake, not an OpenSlate product defect. The profile path above was observed from the owned process arguments during cleanup, about 04:28 after driver start; there is no studio screen or server-log event for operating-system profile creation. No screenshot was needed or taken of profile contents. The owned Chrome was stopped immediately on discovery. The driver correction applies `/tmp` before future launches; no further browser validation or provider action was run. Other test findings remain evidence, but this report does not claim a fully rule-compliant execution.

The long static interval also made Playwright's single-thread video finalization take about 24 minutes. The pending local control client hit `UND_ERR_HEADERS_TIMEOUT`; this was a harness HTTP wait, not an OpenSlate/provider submission. The studio was stopped independently through its owned process before encoding finished. The recording ultimately finalized and passed ffprobe verification.

### 1. Blocker — generation stays stale after Plan edit and Undo

**Steps:** obtain the live two-shot plan; edit shot 1.1 purpose, Save, Undo; open Keyframes and press “Make 2 keyframes”. After refusal, reload and press again. Finally try Inspector “Make keyframe” for shot 1.1.

**Actual:** all three requests returned HTTP 409, code `SCENE_REVIEW_STALE`, with toast “The scene changed since you looked. Check it again.” A reload did not repair it. No attempt was created. **Expected:** a freshly loaded valid scene starts the explicitly requested Codex keyframes, or tells the person a concrete recoverable condition.

**Evidence:** `23-keyframe-scene-changed.png`, `26-keyframes-stale-after-reload.png`, `27-keyframe-single-fallback.png`, `28-final-blocker.png`; recording offsets approximately **04:06:29, 04:07:02, 04:07:26** for the three refusals. Browser response codes are in `ui-errors.jsonl`. Redacted server excerpts:

```text
21:55:03.451Z req-rb POST /api/projects/<test-film>/scenes/<test-scene>/generate -> 409 (3.98 ms)
21:55:37.199Z req-s6 POST /api/projects/<test-film>/scenes/<test-scene>/generate -> 409 (4.10 ms)
21:56:01.282Z req-sh POST /api/projects/<test-film>/scenes/<test-scene>/generate -> 409 (4.02 ms)
```

These are reduced excerpts of the paired request/response entries in `server-redacted.log`; full safe request IDs/times are in `http-failures.json`. The server request log records status rather than the DomainError body; the code comes from the browser's actual API response.

**Likely cause, inferred from source:** `apps/server/src/scene-generation.ts:177` excludes `concurrency: "alongside"` requests when returning the current request identity; `apps/web/src/next/model/commands.ts:33` echoes it. `apps/server/src/application/expected-human-request.ts:11` instead compares the latest active editing request including alongside ones. Plan edit/Undo creates alongside editing requests (`apps/server/src/storyboard.ts:397`). Fresh reads therefore cannot reconcile the two fences. Inspector generation uses the same route, explaining the identical fallback failure.

**Untested possible workaround:** source inspection suggests a fresh normal human Director message could supersede the alongside Undo request and realign the identities. No such third live turn was run after the repeated blocker; no hidden request override, direct database repair or application patch was attempted. This is not a verified recovery.

### 2. Major — failed first-film setup loses the recovery sheet

**Steps:** on the empty Start view create Harbour test with “Talk to the Director”. **Actual:** project creation succeeded; Codex setup returned `409 DIRECTOR_SETUP_REQUIRED`; the New film sheet disappeared and the UI remained “Loading the film…” with “No film open”. A manual reload selected the created film, exposing its scripted Director. **Expected:** remain in the created-film recovery sheet with the setup error and “Open the film” / check-again action, without needing reload.

**Evidence:** `03-film-created.png`, `04-create-stuck.png`, `06-director-setup-error.png`; recording approximately **00:10–00:30**. Server: `17:48:46.147Z req-g POST .../director/setup -> 409 (30.01 ms)`; see matching `DIRECTOR_SETUP_REQUIRED` in `ui-errors.jsonl`.

**Likely cause, inferred:** `model/start-commands.ts:161` calls `onMade` immediately after project creation; `views/start/StartView.tsx:100` updates the project list without selecting the project. `model/shell.ts:37` then stops forcing the Start view and `app/NextApp.tsx:221` unmounts its sheet before setup failure can render. `views/start/NewFilmSheet.tsx:105` consequently cannot present its intended failed phase. Reload selects the first film in `store/store.ts:119`. All browser paths are under `apps/web/src/next/`.

### 3. Major — incompatible Director default and unhelpful setup diagnosis

**Steps:** use the default Director setup; retry Save once in Settings with the same default. **Actual:** both failed with generic `DIRECTOR_SETUP_REQUIRED`. The default program shown in the UI was `/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex`. A credential-free `--version` check returned `codex-cli 0.162.0-alpha.17.2`. OpenSlate requires exactly `0.153.4`; “installed, up to date and signed in” advice did not disclose the mismatch. **Expected:** choose the supported existing installation or clearly show expected and observed versions.

**Working UI path:** set Codex program to the already-installed `/Users/michael/.local/share/openslate-codex/node_modules/.bin/codex` (verified `0.153.4`), Save, wait. Setup succeeded and the real Director became ready. No software was installed and no auth file was opened.

**Evidence:** `07-codex-setup-details.png`, `09-codex-setup-failed.png`, `10-pinned-codex-check.png`, `12-director-ready-or-failed.png`; recording approximately **00:35–02:14**. Server: `17:49:18.219Z req-17 POST .../director/setup -> 409 (33.17 ms)`. The successful selected model and two later real starts are in `diagnostic-final.json`.

**Likely cause:** `apps/server/src/application/local-director.ts` default binary discovery prefers bundled app binaries, independently of image-worker configuration; `packages/director/src/runtime/setup.ts:115` enforces the exact version. `local-director.ts:282` retains detailed readiness internally but throws the generic error; the settings projection omits those checks. UI copy in `apps/web/src/next/i18n/catalog/errors.ts:89` suggests updating without mentioning the pin.

### 4. Major — first real planning turn times out after acknowledgment

**Steps:** ask for one scene, three six-second silent paper-boat shots, with writing/prompts only. **Actual:** the Director replied “I’ll save…” then made no saved change and stopped for timeout. **Expected:** saved writing or a concrete question/error about why the tool operation cannot finish.

**Evidence:** `14-director-progress.png`, `15-director-timeout.png`; request at recording **02:29**, Working at **02:39**, timeout by approximately **05:29**, visibly captured much later after the inactive gap. First acknowledgment latency was not independently timed. Persisted first-turn timestamps: `17:51:03.551Z` → `17:54:03.898Z`, reason `timeout`, state `interrupted`. `diagnostic-final.json` is the safe studio-API evidence. **Server-log limitation:** no explicit timeout exception was emitted in the captured redacted server log; ordinary project/generation reads continued with HTTP 200 around `17:54:03`–`17:54:04`. The UI and persisted turn, not a fabricated log line, establish the failure.

**Recovery:** one shorter, fresh two-shot request completed `21:54:06.289Z` → `21:54:39.557Z` (33.268 s). No first-turn media existed or was resubmitted. **Cause uncertain:** `packages/director/src/runtime/policy.ts:44` sets a 180,000 ms run limit, consistent with the measured timeout, but the blocked operation is not identified by this evidence. The later roughly four-hour observation gap does not establish that sleep caused this timeout.

### 5. Minor — model choices and prices require interpretation

New film shows defaults rather than selectable models; it explicitly says changes are available later in Settings. This prevented literal model selection in the sheet requested by the card, though the image/video defaults were correct. The sheet also lists paid narration/transcription models in a silent-film setup; No narration is a per-shot decision later. Nothing was charged for those profiles.

Evidence: `02-new-film-models.png` (recording approximately **00:06**); no error response/server exception, only normal successful catalog/project requests. Source: `apps/web/src/next/views/start/NewFilmSheet.tsx`. The per-clip Viggle estimate is explicitly host-configured and independent of duration, so it cannot alone serve as the card's seconds-based cap tally.

### 6. Polish — green “Nothing to check” while no keyframes exist

The Keyframes view shows a green check and “Nothing to check in this scene” above an empty preview, 0 of 2 keyframes, and repeated generation refusal. A person can read this as an all-clear even though the film cannot proceed. Expected clearer scope such as no narration-fit items, or guidance toward the next pending action.

Evidence: `28-final-blocker.png`, recording approximately **04:07:34**. No separate server error; the synchronous 409 above coexists with this banner. `apps/web/src/next/keyframes/CheckBanner.tsx:86` uses `check.all_handled` when checks are empty; `model/checks.ts:35` only covers overlong narration. This is a copy/scope ambiguity, not evidence the server falsely marked media complete.

## Export and ffprobe

**No MP4 export exists.** `/exports` returned `ready: false`, `seconds: 12`, two `no_clip` blockers, `current: null`, `history: []`. See `exports-final.json`.

Export ffprobe output: **not available; ffprobe was not run against a nonexistent export.** Export duration, bytes, frame rate, audio-track absence, playback quality and under-30-second rendered acceptance remain unverified. The 12 seconds / 30 fps above describe the saved plan only.

The **session recording**, separately, was verified with ffprobe: VP8, 1440 × 900, 25 fps, duration **14,857.480 seconds (4:07:37.48)**, size **736,504,167 bytes**. See `ffprobe-recording.json`. This long WebM is browser evidence, not a film export. `recording-final-frame.png` is a decoded end-frame QA artifact, separate from the 28 step screenshots.

## Verification boundaries and handoff

- The launcher build succeeded. Both test drivers passed `node --check`. A bounded scan of saved text evidence found zero matches for launch-code, bearer-credential, provider-key and signed-query patterns; visible captured Settings showed presence rather than credential values. No application source tests were added/rewritten/deleted; this was a live test card with test-driver/evidence additions only, not a code-fix task. No full unit suite or typecheck was claimed.
- No keyframe arrived, no video was submitted, no export was rendered, no paid retry was made and no take/restart acceptance was established. Do not treat this as a successful production end-to-end run.
- The owner can inspect the retained fresh data and the safe API projections. Repair/review the request-fence mismatch before repeating the paid flow. The existing pinned Director path provides a verified setup workaround; the fresh-Director-message workaround for generation is only source-derived and untested.
- No commit or push was made. No application source, owner media/database, secret file or credential was modified by the test engineer.
