# LIVE-4 — Director review notes, 2026-10-16

**Partial; blocked before actual image review.** The real Director saved a structured, lettered note successfully, and the pending-review line and open-note banner behaved correctly. However, neither Codex keyframe was produced: all four bounded image attempts ended before dispatch with `LOCAL_NATIVE_UNAVAILABLE`. This run therefore does **not** establish review of actual generated keyframes or exact-frame evidence acceptance.

**Viggle: 0 submissions, 0 seconds, $0.00.** No video confirmation, retry, vendor video job, speech, transcription, music generation or export occurred. The studio, automation Chrome and control driver are stopped. The fresh data remains at `/Users/michael/openslate-live-test-20261016d`. No application source changed and no git command ran.

## Step table

| LIVE-4 step | Result | Time / observed behavior | Screenshots |
|---|---|---|---|
| 1. New film and setup | Partial, recovered | New-film Codex setup returned 409 after 15.46 s. Settings Save later succeeded in 0.735 s with the same pinned Codex 0.153.4 and gpt-6-astra. | `01-new-film-sheet.png`, `02-new-film-models.png`, `03-director-first-step.png`, `04-director-setup-refused.png`, `05-settings-pinned-setup.png`, `06-settings-ready.png` |
| 2. Ask for two silent six-second shots | Pass | One native planning turn, **32.331 s**. Saved brief, story, one scene, Close-up and Wide shots, 180 frames each at 30 fps, explicit No narration, no music. | `07-director-request.png`, `08-plan-saved.png` |
| 3. Make both keyframes | **Fail** | First batch failed after **16.080 / 16.039 s** per attempt. One new human scene press retried both known failures; both again failed after **16.051 / 16.043 s**. Zero outputs, zero image-turn dispatches, no unknown outcome. Two keyframe regenerations total, below the inherited cap of three. | `09-keyframes-price.png`, `10-keyframes-submitted.png`, `13-notes-saved-first-batch.png`, `14-keyframes-retry-submitted.png`, `16-final-notes-banner.png` |
| 4. Wait for automatic review | Partial: note saving/UI pass; real-frame review blocked | First review **15.096 s**: saved note a explaining that neither frame was available. Second review **8.633 s**: retained existing note a without duplicating it and plainly said visual review remained unavailable. | `11-review-running-from-clip.png`, `12-review-first-ended.png`, `13-notes-saved-first-batch.png`, `15-review-second-batch.png`, `16-final-notes-banner.png` |
| 5. Stop studio | Pass | Final owned launcher exited **22 ms** after one SIGINT, with port 3001 free. Browser closed and owned control driver stopped. Data retained. | `16-final-notes-banner.png` immediately before shutdown; `shutdown.json`, `events.jsonl` |

Times above use persisted turn/attempt timestamps or server response timing, rather than driver inspection delays. UTC evidence is October 17, 00:16–00:22; local run date is October 16, PDT. [screenshots.json](screenshots.json) provides the screenshot/phase mapping. [clips.json](clips.json) lists nine short phase recordings; [CLIPS.md](CLIPS.md) links them.

## Per-check results

| Card check | Result | Evidence and boundary | Screenshot |
|---|---|---|---|
| 1. During review, neutral Director-review line with no green check | **Pass for the observed failed-image batch** | The first automatic review showed “The Director is reviewing these keyframes; its notes will appear here.” with a neutral dot. No green all-clear. The recording also shows “Reviewing the new keyframes · 2s elapsed.” No actual image was available. | [11-review-running-from-clip.png](11-review-running-from-clip.png), exact frame at 00:02 of `phase-05-review-running.webm` |
| 2. Notes saved and visible | **Pass for structured note persistence; visual-evidence case unverified** | One successful `record_notes` receipt, HTTP 200, zero refused saves. Snapshot `notes` contains open note **a**, anchored using **`shotIds`** to both shots. The Director column, amber banner and both shot chips display it. The reply says “Note a saved,” without a save-failure claim. | [13-notes-saved-first-batch.png](13-notes-saved-first-batch.png), [16-final-notes-banner.png](16-final-notes-banner.png); [snapshot-final.json](snapshot-final.json), [evidence-audit.json](evidence-audit.json) |
| 3. Refused-save line and same-turn correction, if any | **N/A — no refusal occurred** | The single `record_notes` call succeeded on its first attempt. All turn `notesSaveFailure` fields are null; the read-only receipt audit found no failed note call. There is no refusal reason to report and no correction case was injected. This conditional recovery path remains unexercised. | [13-notes-saved-first-batch.png](13-notes-saved-first-batch.png), [16-final-notes-banner.png](16-final-notes-banner.png) show the successful result; [evidence-audit.json](evidence-audit.json) supplies the receipt |
| 4. After notes, check row/banner agree; no green all-clear with an open note | **Pass for observed state** | Open note a replaces the check row with an amber Director’s-note banner; matching chips appear on shots 1.1 and 1.2. Scene says needs attention, both cards say keyframe failed/not charged, and no green “Nothing to check” appears. | [13-notes-saved-first-batch.png](13-notes-saved-first-batch.png), [16-final-notes-banner.png](16-final-notes-banner.png); [final-ui.json](final-ui.json) |

The first review’s saved note says:

> No current keyframe is available for either shot in this review, so I cannot assess the boat's appearance, composition or visual continuity. The saved close-up and wide-shot directions remain intact. Review the actual frames when available before deciding on visual changes.

The second review plainly said: “Neither shot has a current keyframe available to inspect. Existing note a already records this limitation; no duplicate note added.” This is an unavailable visual review, **not** a judgment that the frames are fine.

First review identity: turn `52b8396d-d2be-48d9-86cb-a6b8fb13f66a`, request `064676e1-b755-436b-84ed-0e1f1c63dd64`; its successful receipt has the same request and epoch. Second review: turn `bca973ad-26d9-4d62-94a4-39f7a296d871`, request `3261e17d-27d9-4805-9889-3ba3f836e188`. [batch-1-review-final.json](batch-1-review-final.json), [review-final.json](review-final.json) and the final snapshot preserve these identities.

## Viggle tally and actual calls

| Shot | Video submissions | Seconds submitted | Vendor video job | Outcome | Viggle cost |
|---|---:|---:|---|---|---:|
| 1.1 | 0 | 0 | None | No video action | $0.00 |
| 1.2 | 0 | 0 | None | No video action | $0.00 |
| **Total** | **0** | **0** | **None** | **No video confirmation or retry** | **$0.00** |

[paid-tally.json](paid-tally.json) and [evidence-audit.json](evidence-audit.json) reconcile zero video attempts, zero confirmation POSTs and zero unknown outcomes. The UI and route guards blocked the video paths in the driver; no video action was attempted, so no guard interception was needed. The UI’s configured video quote, approximately $0.10 per clip / $0.20 for the scene, was never accepted or spent.

Actual native Director model starts: **3** — one planning turn and two automatic read-only reviews, all completed. Image execution attempts: **4**, all `not_dispatched / LOCAL_NATIVE_UNAVAILABLE`; **0** `codex_image_execution_dispatch` records. These are local preparation failures, not four successful image-model calls. No provider billing/account screen was inspected. Internal subscription quota was not measured.

| Image attempt | Shot | Batch | Outcome | Safe reason |
|---|---|---|---|---|
| `7a01e19c-826c-4314-8b46-516b8f26ae44` | 1.1 | Initial | not_dispatched | LOCAL_NATIVE_UNAVAILABLE |
| `08b52306-30c5-46f0-a22d-896b42d3d481` | 1.2 | Initial | not_dispatched | LOCAL_NATIVE_UNAVAILABLE |
| `9cfc4af4-b497-4477-bc2c-58615f4fad15` | 1.1 | One bounded retry batch | not_dispatched | LOCAL_NATIVE_UNAVAILABLE |
| `ad2945b1-76f5-46b5-9842-e263201fca43` | 1.2 | One bounded retry batch | not_dispatched | LOCAL_NATIVE_UNAVAILABLE |

Each attempt is terminal failed, has no task ID, is reported not charged, and permits no automatic retry. The separate human retry press was made only after both earlier outcomes were known. No third batch was started.

## Ranked problems

### 1. Blocker for LIVE-4 acceptance — Codex images cannot prepare a native run

**Steps:** Save the two-shot plan, press Make 2 keyframes, await both terminal outcomes; make one bounded new press for the two known failed frames. **Actual:** all four attempts fail in about 16 seconds each. The studio shows “Keyframe failed · not charged,” zero takes and no frame. **Expected:** two returned Codex keyframes for actual visual review.

**Evidence:** screenshots 13 and 16; `phase-07-keyframe-retry.webm` at about 00:00.8 shows the first failures, and `phase-09-final-notes.webm` shows the same failure state after retry. [image-failure-codes-batch-1.json](image-failure-codes-batch-1.json) and [evidence-audit.json](evidence-audit.json) contain only safe structured failure projections from this run’s fresh database. Public failure IDs are `codex-image-b777d688b894e796a8926f8eb4ab7f47`, `codex-image-d1365532fda7bd12fcc3b60a26d25794`, `codex-image-7bca3409508d80922a0c5123ab439bff` and `codex-image-ffe866df9a14f766dab4ddfe78da8b12`.

**Redacted server evidence:** scene-generation requests were accepted, rather than refused as stale:

```text
00:20:42.939Z POST /api/projects/<test-film>/scenes/<scene>/generate -> 200
00:22:03.146Z POST /api/projects/<test-film>/scenes/<scene>/generate -> 200
Persisted execution observations: 4 x not_dispatched / LOCAL_NATIVE_UNAVAILABLE
```

**Cause boundary:** `apps/server/src/execution/codex-image-execution.ts:54` catches failure in native preparation/mapping and persists `LOCAL_NATIVE_UNAVAILABLE`; `:128` converts it to the public hashed failure. This identifies the failure phase, not its underlying cause. The catch discards the original exception. Authentication, runtime setup, permissions, transport and mapping cannot be distinguished from this evidence. No auth file, personal native log, credential, configuration or application source was inspected or changed to repair it. The lead needs to diagnose native image preparation, then repeat LIVE-4 with real frames.

### 2. Minor, recovered — New-film Director setup fails with a generic message

**Steps:** Create a film with Talk to the Director selected. **Actual:** the selected binary is pinned Codex 0.153.4, but after 15.46 seconds setup returns `409 DIRECTOR_SETUP_REQUIRED`. The sheet correctly retains the created film and explains that setup failed. Opening the film, then Settings → Director → Set up Codex → Save succeeds with the same binary/model, without changing the auth home or signing in. **Expected:** successful first-film setup, or enough safe detail to understand the failed check.

**Evidence:** [04-director-setup-refused.png](04-director-setup-refused.png), [05-settings-pinned-setup.png](05-settings-pinned-setup.png), [06-settings-ready.png](06-settings-ready.png); `phase-02-director-setup.webm` around 00:20.7 onward, `phase-03-settings-diagnostic.webm` around 00:33.5–00:50.4. [setup-refused.json](setup-refused.json) records the pin and blocked catalog; [setup-final.json](setup-final.json) records native mode and the successful retained check.

```text
00:17:48.805Z POST /api/projects/<test-film>/director/setup -> 409
DIRECTOR_SETUP_REQUIRED: Codex setup checks did not pass. Verify the selected binary, model and existing Codex sign-in.
00:19:05.935Z POST /api/projects/<test-film>/director/setup -> 200
```

**Cause boundary:** `apps/server/src/application/local-director.ts:349` wraps blocked readiness in this generic error, except version mismatches. More specific safe readiness issues are not retained in the public setup result here. The actual initial failure cause is unconfirmed; recovery does not establish whether it was transient or code-related. The pinned runtime was selected correctly, but the automatic setup path did not pass this run. The launcher’s prescribed `--doctor` returned “Local setup checks passed”; it does not establish native Director or image readiness.

No note-save or green-all-clear regression was observed in the exercised failed-image review. Automatically reviewing a terminal failed batch was recorded as a scope limitation, not treated as proof of visual inspection.

## Setup, verification and limitations

- Only this worktree and fresh `d` data were used. Port 3001 was checked free before both owned starts. The prescribed launch command loaded the owner’s settings through Node `--env-file`; those files were never opened, printed, copied or searched. The owner’s `.openslate` data was not touched.
- Node **24.15.0**, pnpm **10.33.0**, FFmpeg/ffprobe **8.1.1**. `pnpm setup:test-media` and `pnpm check:toolchain` passed without a download. The prescribed launcher built the app. Both added driver files pass `node --check`. No application unit-test/typecheck acceptance is claimed for this test-only task.
- System Chrome, headless `playwright-core`, 1440 × 900, throwaway profiles under `/tmp`. Official studio-launcher pairing was unrecorded; session material stayed in memory. No HAR, trace, saved browser state or auth output was persisted. Logs were filtered before writing; credentials/launch lines were omitted and external URLs redacted.
- Nine recorded phase clips, **172.40 seconds total**, longest **50.88 seconds**, all decoded completely with FFmpeg and probed with ffprobe. Setup clips include bounded local setup waits. Provider-only waits otherwise ran with recording contexts closed. The first review recording remained open after the strict-selector harness error, so it includes the short review progressing while the capture was corrected. The neutral-row screenshot is transparently an exact frame extracted at 00:02 of that recording.
- Harness corrections: the initial sheet used its default empty-outline first step. An unused empty **Paper boat LIVE-4** (`c92bc45e-7df2-4b8f-98d5-47ee8e8aa271`) remains with no model/media work. The main film was explicitly created using Talk to the Director. This mistake does not explain the main film’s independently captured setup refusal. A later failure-specific selector was still waiting after Settings had actually succeeded; the harness prematurely stopped the studio while collecting that result. The same fresh installation was reopened before any model or media work. No unknown outcome was retried.
- Other harness selector corrections involved a nonexistent phase-name suffix, an absent version string, an obsolete Open-the-film button, a guessed Director-mode label, ambiguous Plan text, and `[data-view=keyframes]` matching the app, tab and main simultaneously. They caused no extra model turn, canonical edit or media request. The last issue was corrected to `main[data-view=keyframes]` in the delivered driver; that correction was syntax-checked, not replayed with additional providers. Screenshot 12 was taken after the first review ended and is named accordingly; screenshot 11 supplies the during-review evidence.
- The shorter LIVE-4 sequence did not exercise the inherited full-run Plan edit/Undo, video, export, restart-persistence acceptance or Assets tour. The setup-related reopen is documented above and is not a completed media-persistence test. There is no export MP4 or export ffprobe output because LIVE-4 explicitly prohibits video.
- Changes added only `scripts/live/live-4-driver.mjs`, `scripts/live/live-4-client.mjs` and this evidence directory. No application source, test suite, settings file, catalog or owner data was changed. No git command or commit occurred.

Final evidence: [snapshot-final.json](snapshot-final.json) includes one open saved note; [evidence-audit.json](evidence-audit.json) includes safe read-only receipt/failure projections, exact call counts and the zero-spend checks; [server-excerpts.json](server-excerpts.json) maps relevant requests to responses; [shutdown.json](shutdown.json) confirms the final stop. [artifact-verification.json](artifact-verification.json) records clip decoding and the credential-pattern audit.
