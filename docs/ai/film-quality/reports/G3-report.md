# G3 report · Beat-driven shot lengths

Resumed after the interrupted run on November 2, 2026; final verification completed November 3. The recovered source changes were reviewed against the full card, `RULES.md`, `CONTRACT.md` and the current implementation status before verification. Results below belong to this resumed run; the earlier draft's pending checks are not counted as completed.

## Done

G3 gives every shot a target on-screen length in the beat sheet, chosen by role/action: reactions/inserts 2–3 s, clear actions 4–6 s, breathing payoffs 5–8 s. Equal lengths need a reason. Requests use `ceil(targetSeconds + 1.5)`, clamped to the chosen model's `read_film.models[].durationSeconds` bounds, respecting discrete allowed values. The guidance explains the per-second cost and the 3 s beat → 5 s Viggle minimum. After review, observed action and the target determine the cut.

The offline example declares 5 s and 3 s targets and requests 7 s and 5 s. It uses the same computed length for keyframe pricing, the initial video and a consent retry. Its 150/90-position placeholder cuts total 8 s; review still replaces placeholders with observed ranges. The 30-position timebase and 1,600 samples per position stay unchanged; no frame indices were rescaled to 24 fps. No API shape changed.

Frame wording distinguishes 1/30-second positions from native clip rates and the 24 fps finished film. The old Seedance “normalized for the 30 fps film” sentence was corrected because it directly contradicted this wording. G2 owns the native-rate/24 fps runtime change and must merge before G3; this worktree does not implement or validate G2's runtime behavior.

## Files

Changed:

- `skills/code-plan/SKILL.md`
- `skills/code-plan/openslate.skill.json`
- `skills/code-plan/references/film-craft.md`
- `skills/code-plan/references/example-plan.ts`
- `skills/code-plan/references/studio.d.ts`
- `apps/server/src/application/director-capabilities.ts` (only the generated current code-plan digest)
- `apps/server/test/code-plan-director.test.mjs` (existing skill lock/snapshot and pinned-example tests)

Added: `docs/ai/film-quality/reports/G3-report.md`. Deleted: none.

## Release and visibility

`code-plan` is a schema 1 package outside the storyboard release automation (see `docs/technical/SKILLS-TOOLS.md`, “Code-plan mode”). Version **2.0.0 → 2.0.1**, still tool contract **0.3.0**, handler **code-plan-tools@3**. `CODE_PLAN_GUIDANCE_DIGEST` is recomputed using the repository's `skillPackageDigest(readSkillPackageFiles(...))`; only that current pin changes. `skills/shipped-releases.json` contains storyboard releases and remains byte-identical; no synthetic storyboard release is created.

- New code films use 2.0.1 on their first Director turn after this build is installed, for either Codex or Claude Code.
- Existing code films on contract 0.3.0 get a new `director_skill_lock` on their next fresh, unbound Director turn. Human, repair and review turns use that same input path. Existing source is not automatically rewritten or resubmitted, so saved media and step keys do not change just because guidance refreshed.
- Contract 0.1.0 and 0.2.0 films continue using `code-plan-v1` and `code-plan-v2`. Storyboard films keep their own shipped guidance.
- Recorded locks, context, guidance reads and immutable snapshots are retained. A bound epoch is not upgraded in place. A process restarted with a bound pre-update epoch may fail the existing strict current-digest check; this card does not change the runtime to resume that epoch under different guidance. A fresh turn can receive the successor. No old turn is claimed to have read new text.

Old digest: `1a3900cb45b263c96ea12a9f9a0ebc43b9666a36a64cfea62b9d511167964c26`.
New digest: `18e10aa56b6c1d2909595e33048507e8210d4782b86d4ee6dea569d4912a50f0`.

## Tests

Added two cases in the existing skill lock/snapshot and pinned-example suite:

- A fresh turn loads 2.0.1 while an older synthetic 2.0.0 package snapshot, saved lock and turn-read evidence remain unchanged; guidance refresh submits no plan/media. The synthetic package exercises preservation, not exact historical 2.0.0 byte reproduction.
- Requests clamp to both illustrative model bounds before keyframe confirmation.

Extended the existing package-pin assertion with the version and the full example sandbox test with unequal targets/requests, rounding, quote/video/retry agreement and target-based cuts. Updated expected music placement from 480,000 to 384,000 samples because the cut is 8 s rather than 10 s. No tests were deleted and no money/integrity behavior was relaxed. Existing 0.1.0/0.2.0 catalog/lock compatibility and offline example integration/dry-run coverage remain in the code-plan suites.

Verification uses Node 24.15.0, pnpm 10.33.0, FFmpeg/ffprobe 8.1.1 and the installed Hiragino Sans GB CJK font. `pnpm setup:test-media` found the matching tools already installed; `pnpm check:toolchain` passed. Neither command needed a download. Recomputing the package digest with the built repository helper exactly matched the current server pin.

Final verification results:

| Command | Result |
|---|---|
| `pnpm setup:test-media` | Exit 0; matching tools already installed, no download. |
| `pnpm check:toolchain` | Exit 0; exact Node/pnpm/media pins and CJK font verified. |
| `pnpm build` | Exit 0; all five workspace builds passed. Existing web bundle-size and mixed static/dynamic import warnings remain. |
| `node scripts/run-tests.mjs apps/server/test/code-plan-director.test.mjs` | Exit 0; **29 passed, 0 failed/skipped/cancelled/todo**; 5.904 s. |
| Skill/code-plan suites and catalogs (expanded command below) | Exit 0; **630 passed, 0 failed/skipped/cancelled/todo**; 681.812 s. |
| `pnpm test`, first attempt | Exit 1 after interruption during a long quiet interval. No assertion failure was reported before interruption; no final test counts were produced. This attempt is superseded by the completed full retry below. |
| Individual interrupted-file reruns | `lip-sync-seam.test.mjs`: exit 0, **6 passed**. The other 11 invocations exited 1 in toolchain preflight (`pnpm: expected 10.33.0, found unavailable`), before executing any tests. These are not reported as assertion failures. |
| `pnpm test`, completed full retry | Exit 1; **5,294 total: 5,278 passed, 14 failed, 1 cancelled, 1 skipped, 0 todo**; 1,620.960 s. All five workspace builds passed. Log: `/tmp/openslate-g3-pnpm-test-retry.log`. |
| All eight affected files, rerun with `--test-concurrency=1` (command below) | Exit 0; **114 passed, 0 failed/cancelled/skipped/todo**; 116.702 s. Every affected file and all its tests were rerun. Log: `/tmp/openslate-g3-affected-files-rerun.log`. |
| `pnpm typecheck` | Exit 0; all three package builds and all **five** workspace typechecks passed. |
| `pnpm -r typecheck` | Exit 0; all **five** workspace typechecks passed, including a final run after the full-suite retry and affected-file reruns. |

The focused skill/code-plan command was:

```sh
node scripts/run-tests.mjs scripts/test/skills-release.test.mjs packages/director/test/*skill*.test.mjs packages/director/test/tools.test.mjs apps/server/test/director-guidance-release.test.mjs apps/server/test/director-skills-v8*.test.mjs apps/server/test/provider-catalog.test.mjs apps/server/test/code-plan-*.test.mjs
```

This includes the example's existing real submission/dry-run integration coverage, archived code-contract catalogs, skill loader/snapshot locks, and every shipped storyboard release. The focused suite completed normally after a long quiet release-script tail, with no failures. The completed full retry also passed G3's snapshot-preservation, pinned-example and duration-clamp cases. Its one skip was the opt-in native Codex probe. Animated WebP passed its explicit unsupported-format refusal test; it was not skipped in this run.

The first full attempt stopped producing output after the installation-status tests, remained active for more than 15 further minutes, and was interrupted rather than counted as a pass or a product failure. Quiet output alone did not establish a hang: the following fixtures include substantial bounded work, including the 400-scene recovery test, which passed in the completed retry. The initial interruption was premature. Its log is `/tmp/openslate-g3-pnpm-test.log`. It listed these files as interrupted: `keyframe-blocker-recovery`, `keyframe-review`, `lip-sync-seam`, `local-director`, `local-execution`, `local-images`, `local-media-executor`, `local-timeline`, `m1-confirmation-recovery`, `managed-audio-cancellation`, `managed-video-cancellation` and `mapped-speech-intent` (all `apps/server/test/*.test.mjs`). Every listed file was invoked again separately; the individual results are retained in `/tmp/openslate-g3-interrupted-reruns.jsonl` and the table above. All twelve were subsequently included in the completed full retry and none appeared in its non-pass summary. No source was changed to hide or relax these outcomes.

The pnpm preflight uses a 5,000 ms subprocess deadline. Direct version probes still returned the exact installed **10.33.0**, including measured 4.395 s, 6.057 s and 4.196 s calls, but repeated preflights exceeded that deadline. The completed full retry and affected-file rerun use the already-cached 10.33.0 distribution through a task-local `/tmp` PATH entry and a task-local Node compile cache. Both passed the unchanged strict preflight. No version result was mocked, no package was downloaded, and no global setting or repository test harness was edited.

The completed full run's non-passing cases, all cleared by the required file reruns, were:

| File under `apps/server/test/` | Exact test names from the full summary |
|---|---|
| `claude-code-director.test.mjs` | Claude supervisor saves final text, native ids, runtime binding, holds and live thread classification; Claude fake traverses the real stdio/HTTP bridge and records a normal tool_invocation; a rejected Claude init never reaches application tool_invocations, even racing the real bridge; changing Claude back to Codex applies to the next turn without changing prior turns or guidance digests; Claude limit failures remain plain in Director status, and no completed turn is retried |
| `clip-audio.test.mjs` | File-level `test failed`; no more specific cause in the spec summary |
| `code-plan-choice-retire.test.mjs` | a retired card cannot make its still-used picture non-current or infer a current shot; a retired card keeps naming the shot of the frames and clips it made |
| `code-plan-e2e.test.mjs` | real HTTP code-plan stack goes from a human message to keyframe confirmation, motion edit and lookup recovery (cancelled after its 30,000 ms deadline) |
| `code-plan-image-continuity.test.mjs` | eight ordered owned PNG references reach the fake native turn as local images |
| `code-plan-keyframes.test.mjs` | confirmed references_only: one image, ordered flat options, actual model prices and exact video input |
| `code-plan-last-frame-crop.test.mjs` | 9:16 crops the same source for both frames and replays after restart; 16:9 crops the same source for both frames and replays after restart; 16:9 crops different source sizes independently and replays after restart |
| `code-plan-music.test.mjs` | code-plan Lyria LYRIA_BUSY retains honest retry and price evidence |

The rerun command was:

```sh
node scripts/run-tests.mjs --test-concurrency=1 --test-reporter=tap apps/server/test/claude-code-director.test.mjs apps/server/test/clip-audio.test.mjs apps/server/test/code-plan-choice-retire.test.mjs apps/server/test/code-plan-e2e.test.mjs apps/server/test/code-plan-image-continuity.test.mjs apps/server/test/code-plan-keyframes.test.mjs apps/server/test/code-plan-last-frame-crop.test.mjs apps/server/test/code-plan-music.test.mjs
```

The full run recorded explicit runtime/wall-time deadlines, dry-run rejection, a killed FFmpeg command and a music step still in flight. A diagnostic observed load averages of 20.47 / 20.72 / 30.07 on 10 CPUs. All eight files then passed with one file at a time, with no assertion or deadline changes. These results are consistent with contention; they do not prove the cause of every original result. The full command remains recorded as exit 1, separately from the passing 114-test rerun.

## Contract changes

None. `packages/core/src/studio-api.ts` and API signatures are unchanged. Only the render documentation comment in the supplied declaration file changes.

## Self-review

Reviewed the complete recovered diff for correctness, model-bound handling, callers, replay identity, retries and tests. The recovered work already corrected the contradictory Seedance frame-rate sentence. The resumed review found no additional source defect: quote/video/retry durations agree, target-based cuts and music both total 8 s, and the model limits are explicitly illustrative rather than invented installation capabilities. Checked the existing offline example submission/dry-run path and current fresh-turn lock selection against the visibility claims above. Found that the draft report quoted only the changed lines of one larger Markdown paragraph; expanded its before/after section to the complete paragraph and checked both versions against the source. Historical guidance and the storyboard registry are untouched. The server source change is solely G3's required generated digest; changes in `code-plan-director.test.mjs` are confined to its skill snapshot/lock and pinned-example tests. `git diff --check` passed.

## Proposed commits (not created)

One atomic release: `fix(skills): size generated shots to their story beats` — all eight files above, including this report, tests, manifest and matching digest. Keeping the instruction bytes, version and digest together avoids a package mismatch. No commit, push, browser, live provider or non-loopback network call was made in this resumed run.

## Open issues

Merge G2 before G3 for native clip rates and 24 fps final rendering. The concurrent full-suite gate was not green as one run; all eight affected files passed their complete reruns and no persistent failure was reproduced. Concurrent test stability remains an integration limitation, outside this guidance card. No real provider/media quality experiment was run; fake tests establish guidance loading and example behavior. Existing bound old-build epoch handling remains the strict behavior described above.

## Before / after: every changed guidance paragraph

The complete Markdown paragraphs are reproduced below, including adjacent unchanged lines in the same paragraph.

### `skills/code-plan/references/film-craft.md` · Beat sheet

Before:

Before writing a program, state a one-line premise: who wants what, and what obstacle gets in the way. Write a beat sheet with setup, turn and payoff. For each beat name the one thing a viewer can see and its resulting state. Remove shots that neither set up nor pay off. Respect the requested length and language.

After:

Before writing a program, state a one-line premise: who wants what, and what obstacle gets in the way. Write a beat sheet with setup, turn and payoff. For each beat name the one thing a viewer can see, its resulting state and the shot's target on-screen length: about 2–3 seconds for a quick reaction or insert, 4–6 for a clear action, 5–8 for a payoff that needs to breathe. Let lengths differ with the story; equal lengths need a reason. Remove shots that neither set up nor pay off. Respect the requested length and language.

### `skills/code-plan/references/film-craft.md` · Clip length

Before:

Models spread action across the whole clip and run late: 1.33 seconds on average in the Tofu sample, not a universal guarantee. Request a clip longer than the retained beat, within advertised durations, then cut it down after watching. Extra time provides handles, not proof of action. Never assume the first planned frames contain the payoff.

After:

Request `durationSeconds = ceil(targetSeconds + 1.5)`, clamped to the model's `durationSeconds {min, max}` in `read_film.models`. Use a listed `durationValuesSeconds` value when required. The late-start margin is about 1.5 seconds: the Tofu sample averaged 1.33 seconds late, not a universal guarantee. Viggle accepts 5–15 seconds, so a 3-second beat requests 5 seconds. Video is billed per second: asking for 8 seconds for a 3-second beat pays for about 2.5 times the footage used. Extra time provides handles, not proof of action. Never assume the first planned frames contain the payoff.

### `skills/code-plan/references/film-craft.md` · Watching and cutting

Before:

Finish every clip, then `await ctx.review(id, {clips, note})`. Use `read_clip_frames` to find each action's actual start and end. Inspect uncertain events closely; motion scores locate change, not meaning. Record usable ranges and visible proof. Set `startFrame` and `durationFrames` from observed source frames at 30 fps. Cut after completion, enter on movement, never end on a half-finished pose. Let the punch settle.

After:

Finish every clip, then `await ctx.review(id, {clips, note})`. Use `read_clip_frames` to find each action's actual start and end. Inspect uncertain events closely; motion scores locate change, not meaning. Record usable ranges and visible proof. Set `startFrame` and `durationFrames` from the observed action and the beat's target, not the requested clip length; frame numbers are 1/30-second positions. Cut after completion, enter on movement, never end on a half-finished pose. Let the punch settle.

### `skills/code-plan/SKILL.md` · Render and model guidance, including frame units

Before:

`render(timeline)` or `render({model?: "local-render", timeline, audio?, captions?, width?, height?})` returns local assembly.
For real projects, timeline contains video artifacts or `{artifact, startFrame?, durationFrames?, fit?: "contain" | "cover", speed?, holdFrames?, zoom?}` rows; a row lasts `round(durationFrames / speed) + holdFrames` frames. audio contains `{artifact, startSample?, durationSamples?, atSample?, gainMilliDb?, fadeInSamples?, fadeOutSamples?}` placements or free built-in sounds `{sound, atSample, gainMilliDb?}`. captions contains `{text, atFrame, durationFrames, position?}`. `atFrame` and `atSample` are positions in the finished film, after speed and hold. New films are mastered to -14 LUFS.
Only cuts, 30 fps, 48 kHz, up to 64 clips, 65 audio placements, eight simultaneous audio lanes and 360 seconds are supported. Frames/samples are integers. An audio placement must fit inside the picture; trim it explicitly when needed.
Real assembly uses measured owned media and returns a probed MP4. Demo projects retain the labeled fixture renderer.
A media result is `{ok:true, artifact, artifacts}` or `{ok:false, error:{code,message,retry,mayHaveCharged}}`. Branch on ok before using an artifact. Provider failure is data; programming errors throw.
`choose(id, {question, options})` accepts a nonempty array of JSON options and returns the chosen option exactly; execution waits until answered.
Finish shared character sheets and set plates first (see film craft). Then start independent shot pipelines (keyframe, clip) together with `Promise.all(shots.map(...))`. Each card appears as soon as its frame exists, and its clip can run while the person confirms another shot. Await picture dependencies. Codex images are made one at a time in request order; list shots in film order.
`review(id, {clips, note})` is free and stops the run until you have watched those clips. Put it after every clip has finished, before the cut, music and render. You then get a review turn, with `review` in your context; it comes from the application, not the person.
In a review turn call `read_clip_frames({artifactId, startFrame?, endFrame?, everyFrames?})` for each clip. It returns a labelled contact sheet of at most 36 frames and motion values, numbered as `render` numbers them; it also reads renders. Start at `everyFrames: 15`, then look closely around each event. Submit the whole plan with the real `startFrame` and `durationFrames`, or reply without submitting if nothing needs to change.
Keep the same `review` call in the plan: it returns at once for clips already watched, so the film carries on. Changing a clip opens a new review. A film gets four review turns; after that, and after a failed turn, reviews return without stopping. A review turn can buy a retake under the film's ceiling, but cannot change the limit or use retry_step.
`log(text)` returns null and records a bounded run-log line.
Use the exact ids in `read_film.models`: they come from the film's saved profiles and installed catalog. Explicit model names are recommended; never invent availability.
Each row gives kind, defaults, unitCostMicros, priceUnit and priceUnknown. MiniMax uses its configured per-call estimate. Viggle, Seedance and fal-video-i2v use priceUnit "input" and a priceBasis describing their duration/resolution-dependent rates; unitCostMicros is null. The application computes their exact known reservation before dispatch. These are host estimates, not verified vendor bills. Unknown prices stay unknown and contribute zero known dollars; they still consume the 200-step limit. Codex images use the ChatGPT subscription and count as $0; native authentication is checked before starting a turn.
Disabled, missing or uncredentialed models cannot dispatch. A real profile never falls back to a fake or a different vendor. Inputs must match the installed settings. For every video model, read_film.models gives aspectRatios, durationSeconds {min, max} and videoModes: this is the full truth about its supported ratios, lengths and modes, intersected with the film's saved profile. Use these facts before choosing a model or duration; video takes whole seconds. If durationValuesSeconds is present, choose one of those exact values. Null min/max means the saved profile has no duration in the vendor range; use another listed model for new work. Never ask the person or a maintainer to confirm a model's abilities. Explain a listed limit or use another listed model when the requested combination is unavailable.
Retakes reuse the shot's confirmed keyframe with a stable `variant`. When a subject was cut off and the person allowed the keyframe as input, `firstFrame: keyframe.frame` is the retake to use. After references only, reuse the chosen input. References can re-frame a shot; mention it only if asked. When the person asks to change a picture, change that shot's `prompt` or `variant` in `ctx.keyframe`; the card asks again. Tell the person nothing about step IDs or modes in chat; the card says it. Preserve unchanged saved calls to reuse media.
`read_film.models[].videoModes` lists each model's supported modes. References cannot combine with firstFrame/lastFrame; lastFrame needs firstFrame. Text-only video needs an explicit aspectRatio. Viggle supports all four modes and 1–4 references; Seedance 2.x supports all four and 1–9 references; Seedance 1.0, MiniMax and fal keep their listed frame modes. References are owned images, sent in order without cropping.
New code films use the built-in viggle-h3 model with 5–15 seconds in every mode; saved films keep their original profile limits. Code-plan Viggle always disables prompt enhancement; this is not a plan/profile option. Its price is ceil(seconds) × credits per five seconds ÷ 5 × $0.01. At 768p and 10 seconds: reference $0.50, first frame $0.30, first+last $0.50, text $0.30. Use priceBasis for other resolutions; history retains its saved estimate, and a new retry uses today's table.
For Seedance drafts prefer seedance-1-0-pro-fast-251015; normal shots use dreamina-seedance-2-0-mini-260615 (720p maximum); hero shots use dreamina-seedance-2-0-260128. Use a profile id from read_film that pins the desired modelId. Seedance defaults aspectRatio to "adaptive", preserving the first frame's aspect instead of forcing landscape. It accepts whole seconds: 1.0 Fast 2–12; 2.0/Mini 4–15. Its 24 fps output is normalized for the 30 fps film. 2.x refuses real-looking human faces in ordinary uploaded first frames: prefer stylized people, animals or scenery, or choose a different installed model. A face refusal is terminal; change the input/model rather than repeating it.
The fal-video-i2v choices are Kling 3.0 Standard (silent, 3–15 s), Veo 3.1 Fast (4/6/8 s), and Wan 3.0 (2–30 s). Defaults are silent. Optional video fields are resolution, aspectRatio, generateAudio, seed and lastFrame; model-specific combinations are validated. Kling derives aspect from its frame and has no seed; Veo accepts only auto/16:9/9:16 and no lastFrame. Seedance 1.0 Fast accepts only a first frame. Do not infer price from the profile's legacy flat estimate. The shared video normalization produces silent clips, even when vendor audio is requested and billed; use ctx.speech for audible narration.
Successful Seedance clips may return an owned last-frame image alongside the primary video in artifacts; select it by kind before reusing it as a firstFrame. Never put provider URLs in a plan.
The supplied two-shot example is an offline demo using fake-image, fake-video, fake-music and local-render. Adapt its model ids and durations from read_film before using a real installation. Fake models remain available on demo projects.

After:

`render(timeline)` or `render({model?: "local-render", timeline, audio?, captions?, width?, height?})` returns local assembly.
For real projects, timeline contains video artifacts or `{artifact, startFrame?, durationFrames?, fit?: "contain" | "cover", speed?, holdFrames?, zoom?}` rows; a row lasts `round(durationFrames / speed) + holdFrames` frames. audio contains `{artifact, startSample?, durationSamples?, atSample?, gainMilliDb?, fadeInSamples?, fadeOutSamples?}` placements or free built-in sounds `{sound, atSample, gainMilliDb?}`. captions contains `{text, atFrame, durationFrames, position?}`. `atFrame` and `atSample` are positions in the finished film, after speed and hold. New films are mastered to -14 LUFS.
Only cuts, 48 kHz, up to 64 clips, 65 audio placements, eight simultaneous audio lanes and 360 seconds are supported. Frame numbers are 1/30-second positions (30 per second); each clip keeps its own frame rate and the finished film plays at 24 fps. Frames/samples are integers. An audio placement must fit inside the picture; trim it explicitly when needed.
Real assembly uses measured owned media and returns a probed MP4. Demo projects retain the labeled fixture renderer.
A media result is `{ok:true, artifact, artifacts}` or `{ok:false, error:{code,message,retry,mayHaveCharged}}`. Branch on ok before using an artifact. Provider failure is data; programming errors throw.
`choose(id, {question, options})` accepts a nonempty array of JSON options and returns the chosen option exactly; execution waits until answered.
Finish shared character sheets and set plates first (see film craft). Then start independent shot pipelines (keyframe, clip) together with `Promise.all(shots.map(...))`. Each card appears as soon as its frame exists, and its clip can run while the person confirms another shot. Await picture dependencies. Codex images are made one at a time in request order; list shots in film order.
`review(id, {clips, note})` is free and stops the run until you have watched those clips. Put it after every clip has finished, before the cut, music and render. You then get a review turn, with `review` in your context; it comes from the application, not the person.
In a review turn call `read_clip_frames({artifactId, startFrame?, endFrame?, everyFrames?})` for each clip. It returns a labelled contact sheet of at most 36 frames and motion values, numbered as `render` numbers them; it also reads renders. Start at `everyFrames: 15`, then look closely around each event. Submit the whole plan with the real `startFrame` and `durationFrames`, or reply without submitting if nothing needs to change.
Keep the same `review` call in the plan: it returns at once for clips already watched, so the film carries on. Changing a clip opens a new review. A film gets four review turns; after that, and after a failed turn, reviews return without stopping. A review turn can buy a retake under the film's ceiling, but cannot change the limit or use retry_step.
`log(text)` returns null and records a bounded run-log line.
Use the exact ids in `read_film.models`: they come from the film's saved profiles and installed catalog. Explicit model names are recommended; never invent availability.
Each row gives kind, defaults, unitCostMicros, priceUnit and priceUnknown. MiniMax uses its configured per-call estimate. Viggle, Seedance and fal-video-i2v use priceUnit "input" and a priceBasis describing their duration/resolution-dependent rates; unitCostMicros is null. The application computes their exact known reservation before dispatch. These are host estimates, not verified vendor bills. Unknown prices stay unknown and contribute zero known dollars; they still consume the 200-step limit. Codex images use the ChatGPT subscription and count as $0; native authentication is checked before starting a turn.
Disabled, missing or uncredentialed models cannot dispatch. A real profile never falls back to a fake or a different vendor. Inputs must match the installed settings. For every video model, read_film.models gives aspectRatios, durationSeconds {min, max} and videoModes: this is the full truth about its supported ratios, lengths and modes, intersected with the film's saved profile. Use these facts before choosing a model or duration; video takes whole seconds. If durationValuesSeconds is present, choose one of those exact values. Null min/max means the saved profile has no duration in the vendor range; use another listed model for new work. Never ask the person or a maintainer to confirm a model's abilities. Explain a listed limit or use another listed model when the requested combination is unavailable.
Retakes reuse the shot's confirmed keyframe with a stable `variant`. When a subject was cut off and the person allowed the keyframe as input, `firstFrame: keyframe.frame` is the retake to use. After references only, reuse the chosen input. References can re-frame a shot; mention it only if asked. When the person asks to change a picture, change that shot's `prompt` or `variant` in `ctx.keyframe`; the card asks again. Tell the person nothing about step IDs or modes in chat; the card says it. Preserve unchanged saved calls to reuse media.
`read_film.models[].videoModes` lists each model's supported modes. References cannot combine with firstFrame/lastFrame; lastFrame needs firstFrame. Text-only video needs an explicit aspectRatio. Viggle supports all four modes and 1–4 references; Seedance 2.x supports all four and 1–9 references; Seedance 1.0, MiniMax and fal keep their listed frame modes. References are owned images, sent in order without cropping.
New code films use the built-in viggle-h3 model with 5–15 seconds in every mode; saved films keep their original profile limits. Code-plan Viggle always disables prompt enhancement; this is not a plan/profile option. Its price is ceil(seconds) × credits per five seconds ÷ 5 × $0.01. At 768p and 10 seconds: reference $0.50, first frame $0.30, first+last $0.50, text $0.30. Use priceBasis for other resolutions; history retains its saved estimate, and a new retry uses today's table.
For Seedance drafts prefer seedance-1-0-pro-fast-251015; normal shots use dreamina-seedance-2-0-mini-260615 (720p maximum); hero shots use dreamina-seedance-2-0-260128. Use a profile id from read_film that pins the desired modelId. Seedance defaults aspectRatio to "adaptive", preserving the first frame's aspect instead of forcing landscape. It accepts whole seconds: 1.0 Fast 2–12; 2.0/Mini 4–15. Its clips keep their native frame rate; the finished film plays at 24 fps. 2.x refuses real-looking human faces in ordinary uploaded first frames: prefer stylized people, animals or scenery, or choose a different installed model. A face refusal is terminal; change the input/model rather than repeating it.
The fal-video-i2v choices are Kling 3.0 Standard (silent, 3–15 s), Veo 3.1 Fast (4/6/8 s), and Wan 3.0 (2–30 s). Defaults are silent. Optional video fields are resolution, aspectRatio, generateAudio, seed and lastFrame; model-specific combinations are validated. Kling derives aspect from its frame and has no seed; Veo accepts only auto/16:9/9:16 and no lastFrame. Seedance 1.0 Fast accepts only a first frame. Do not infer price from the profile's legacy flat estimate. The shared video normalization produces silent clips, even when vendor audio is requested and billed; use ctx.speech for audible narration.
Successful Seedance clips may return an owned last-frame image alongside the primary video in artifacts; select it by kind before reusing it as a firstFrame. Never put provider URLs in a plan.
The supplied two-shot example is an offline demo using fake-image, fake-video, fake-music and local-render. Adapt its model ids and durations from read_film before using a real installation. Fake models remain available on demo projects.

### `skills/code-plan/references/studio.d.ts` · Render comment

Before:

```ts
  /** Owned video refs or timeline rows; 30 fps, 48 kHz, cuts only. Each row lasts
   * round(durationFrames / speed) + holdFrames. Zoom is a fixed punch-in, not camera motion.
   * Captions and audio positions address the finished film: at most 64 nonoverlapping captions,
   * 1–80 characters, two lines, bold white with outline/shadow; bottom sits at 78% height.
   * Mixed Chinese/English needs an installed CJK font. Audio fades are 1–min(240000,durationSamples).
   * Six free local sounds count toward 65 audio placements and eight simultaneous lanes, consume no step.
   * At most 64 clips and 360 seconds after edits. Contract 0.3.0 audio is mastered to -14 LUFS.
   * Omit unused fields to retain saved-plan identities. Demo output is a fixture. */
```

After:

```ts
  /** Owned video refs or timeline rows; 48 kHz, cuts only. Frame numbers are 1/30-second positions
   * (30 per second); each clip keeps its own frame rate and the finished film plays at 24 fps. Each row lasts
   * round(durationFrames / speed) + holdFrames. Zoom is a fixed punch-in, not camera motion.
   * Captions and audio positions address the finished film: at most 64 nonoverlapping captions,
   * 1–80 characters, two lines, bold white with outline/shadow; bottom sits at 78% height.
   * Mixed Chinese/English needs an installed CJK font. Audio fades are 1–min(240000,durationSamples).
   * Six free local sounds count toward 65 audio placements and eight simultaneous lanes, consume no step.
   * At most 64 clips and 360 seconds after edits. Contract 0.3.0 audio is mastered to -14 LUFS.
   * Omit unused fields to retain saved-plan identities. Demo output is a fixture. */
```

### `skills/code-plan/references/example-plan.ts` · Complete example

Before:

```ts
export default async function film(ctx: Studio): Promise<void> {
  await ctx.scene({ id: "scene-1", title: "A quiet morning" });
  const shots = [
    { id: "shot-1", title: "The room wakes",
      frame: "Wide view of a quiet kitchen at dawn. A misty window catches the first golden light, above a wooden sill with a white cup on its right end. A folded blue cloth rests beside the cup. The window and sill form a simple, still composition, with the pale sky visible through the glass.",
      motion: "Slow gentle push in toward a misty kitchen window as dawn light reaches the sill. A breeze lifts the curtain, revealing a clear patch of glass with the sunrise beyond. The white cup remains on the right end of the sill, catching the new light. End with the curtain resting beside the window and the golden sky clearly visible through the glass." },
    { id: "shot-2", title: "Tea is ready",
      frame: "Close-up of the white tea cup on the right end of the wooden window sill. The folded blue cloth sits behind it, and soft morning light catches the rim. A narrow curl of steam hangs above the tea. The misty glass is softly out of focus behind the cup, with the curtain resting at its side.",
      motion: "Locked camera beside a white cup of tea on a wooden window sill, framed in close-up. A curl of steam rises above the rim, then unfurls into the morning light. The blue cloth and softly blurred window stay still behind the cup. End with a thin trail of steam hanging over the tea and the bright rim remaining clearly visible in the foreground." },
  ];
  for (const { id, title } of shots) await ctx.shot({ id, sceneId: "scene-1", title });
  // Small offline fixture: a real recurring cast/set first needs the shared references in film-craft.md.
  // One keyframe per shot. All pipelines start together: a shot's card appears as soon as its frame exists,
  // and its clip runs while the person is still choosing for the next shot.
  const clips = await Promise.all(shots.map(async ({ id, frame: framePrompt, motion }) => {
    const keyframe = await ctx.keyframe(id, { model: "fake-image", prompt: framePrompt,
      video: { model: "fake-video", durationSeconds: 6, aspectRatio: "16:9" } });
    if (!keyframe.ok) { await ctx.log(`No frame for ${id}`); return null; }
    const clip = await ctx.video({ ...keyframe.input, model: "fake-video", shot: id, prompt: motion, durationSeconds: 6, aspectRatio: "16:9" });
    // Fake clips share their bytes. Retain the actual motion in the fixture timeline too.
    if (clip.ok) return { artifact: clip.artifact, motion };
    // In real films, fill these amounts from read_film.models (the fixture video costs $0).
    const cost = clip.error.mayHaveCharged ? "The earlier clip may already have charged. " : "The earlier clip did not charge. ";
    await ctx.log(`The clip for ${id} could not be completed. ${cost}`);
    if (clip.error.retry === "none") return null;
    const answer = await ctx.choose(`${id}-retry`, {
      question: `${cost}Retry this shot for an estimated additional $0.00 (offline fixture), or skip?`, options: ["retry", "skip"],
    });
    if (answer !== "retry") return null;
    const retried = await ctx.video({ ...keyframe.input, model: "fake-video", shot: id, prompt: motion, durationSeconds: 6, aspectRatio: "16:9", variant: "person-retry-1" });
    if (!retried.ok) { await ctx.log(`The retried clip for ${id} also failed. Please choose how to continue in chat.`); return null; }
    return { artifact: retried.artifact, motion };
  }));
  const ready = clips.filter((clip): clip is { artifact: Artifact; motion: string } => clip !== null);
  if (ready.length !== shots.length) return;
  // Watch before cutting. The run stops here and a review turn opens: it submits a new version with the ranges it saw
  // in place of these placeholders, and this review then returns at once.
  await ctx.review("first-cut", { clips: ready.map(clip => clip.artifact), note: "Does each clip finish its action?" });
  const cuts = [{ startFrame: 0, durationFrames: 150 }, { startFrame: 0, durationFrames: 150 }];
  const timeline = ready.map((clip, index) => ({ ...clip, ...cuts[index], fit: "cover" as const }));
  // Make the score once the final cut length is known; adapt fake-music to an installed model from read_film.
  const filmSamples = cuts.reduce((sum, cut) => sum + cut.durationFrames, 0) * 1600;
  const music = await ctx.music({ model: "fake-music", prompt: "Warm, reflective piano and soft strings at a slow tempo", durationSeconds: Math.ceil(filmSamples / 48000 / 30) * 30 });
  if (!music.ok) { await ctx.log("Music failed; choose how to continue before rendering."); return; }
  const leadIn = music.leadInSamples ?? 0;
  if ((music.durationSamples ?? 0) - leadIn < filmSamples) {
    await ctx.log("The music is shorter than the film. Tell the person and make another track with a stable variant."); return;
  }
  await ctx.log("Generated music carries an inaudible SynthID watermark (this demo uses placeholder audio).");
  const rendered = await ctx.render({ timeline,
    captions: [{ text: "Morning", atFrame: 0, durationFrames: 30 }],
    audio: [{ artifact: music.artifact, atSample: 0, startSample: leadIn, durationSamples: filmSamples, gainMilliDb: -6000,
      fadeInSamples: 4800, fadeOutSamples: Math.min(96000, filmSamples) }, { sound: "ding", atSample: 48000, gainMilliDb: -9000 }] });
  await ctx.log(rendered.ok ? "Film rendered" : `Render failed: ${rendered.error.code}`);
}
```

After:

```ts
export default async function film(ctx: Studio): Promise<void> {
  await ctx.scene({ id: "scene-1", title: "A quiet morning" });
  const shots = [
    { id: "shot-1", title: "The room wakes", targetSeconds: 5, // Clear action: the curtain reveals the sunrise.
      frame: "Wide view of a quiet kitchen at dawn. A misty window catches the first golden light, above a wooden sill with a white cup on its right end. A folded blue cloth rests beside the cup. The window and sill form a simple, still composition, with the pale sky visible through the glass.",
      motion: "Slow gentle push in toward a misty kitchen window as dawn light reaches the sill. A breeze lifts the curtain, revealing a clear patch of glass with the sunrise beyond. The white cup remains on the right end of the sill, catching the new light. End with the curtain resting beside the window and the golden sky clearly visible through the glass." },
    { id: "shot-2", title: "Tea is ready", targetSeconds: 3, // Quick insert: steam above the cup.
      frame: "Close-up of the white tea cup on the right end of the wooden window sill. The folded blue cloth sits behind it, and soft morning light catches the rim. A narrow curl of steam hangs above the tea. The misty glass is softly out of focus behind the cup, with the curtain resting at its side.",
      motion: "Locked camera beside a white cup of tea on a wooden window sill, framed in close-up. A curl of steam rises above the rim, then unfurls into the morning light. The blue cloth and softly blurred window stay still behind the cup. End with a thin trail of steam hanging over the tea and the bright rim remaining clearly visible in the foreground." },
  ];
  for (const { id, title, targetSeconds } of shots) await ctx.shot({ id, sceneId: "scene-1", title, targetSeconds });
  // Small offline fixture: a real recurring cast/set first needs the shared references in film-craft.md.
  // Illustrative 5–15 s range; copy the chosen model's id and durationSeconds bounds from read_film.models.
  const videoModel = { id: "fake-video", durationSeconds: { min: 5, max: 15 } };
  // One keyframe per shot. All pipelines start together: a shot's card appears as soon as its frame exists,
  // and its clip runs while the person is still choosing for the next shot.
  const clips = await Promise.all(shots.map(async ({ id, frame: framePrompt, motion, targetSeconds }) => {
    const durationSeconds = Math.min(videoModel.durationSeconds.max,
      Math.max(videoModel.durationSeconds.min, Math.ceil(targetSeconds + 1.5)));
    const keyframe = await ctx.keyframe(id, { model: "fake-image", prompt: framePrompt,
      video: { model: videoModel.id, durationSeconds, aspectRatio: "16:9" } });
    if (!keyframe.ok) { await ctx.log(`No frame for ${id}`); return null; }
    const clip = await ctx.video({ ...keyframe.input, model: videoModel.id, shot: id, prompt: motion, durationSeconds, aspectRatio: "16:9" });
    // Fake clips share their bytes. Retain the actual motion in the fixture timeline too.
    if (clip.ok) return { artifact: clip.artifact, motion };
    // In real films, fill these amounts from read_film.models (the fixture video costs $0).
    const cost = clip.error.mayHaveCharged ? "The earlier clip may already have charged. " : "The earlier clip did not charge. ";
    await ctx.log(`The clip for ${id} could not be completed. ${cost}`);
    if (clip.error.retry === "none") return null;
    const answer = await ctx.choose(`${id}-retry`, {
      question: `${cost}Retry this shot for an estimated additional $0.00 (offline fixture), or skip?`, options: ["retry", "skip"],
    });
    if (answer !== "retry") return null;
    const retried = await ctx.video({ ...keyframe.input, model: videoModel.id, shot: id, prompt: motion, durationSeconds, aspectRatio: "16:9", variant: "person-retry-1" });
    if (!retried.ok) { await ctx.log(`The retried clip for ${id} also failed. Please choose how to continue in chat.`); return null; }
    return { artifact: retried.artifact, motion };
  }));
  const ready = clips.filter((clip): clip is { artifact: Artifact; motion: string } => clip !== null);
  if (ready.length !== shots.length) return;
  // Watch before cutting. The run stops here and a review turn opens: it submits a new version with the ranges it saw
  // in place of these target-length placeholders (30 positions per second), and this review then returns at once.
  await ctx.review("first-cut", { clips: ready.map(clip => clip.artifact), note: "Does each clip finish its action?" });
  const cuts = shots.map(({ targetSeconds }) => ({ startFrame: 0, durationFrames: targetSeconds * 30 }));
  const timeline = ready.map((clip, index) => ({ ...clip, ...cuts[index], fit: "cover" as const }));
  // Make the score once the final cut length is known; adapt fake-music to an installed model from read_film.
  const filmSamples = cuts.reduce((sum, cut) => sum + cut.durationFrames, 0) * 1600;
  const music = await ctx.music({ model: "fake-music", prompt: "Warm, reflective piano and soft strings at a slow tempo", durationSeconds: Math.ceil(filmSamples / 48000 / 30) * 30 });
  if (!music.ok) { await ctx.log("Music failed; choose how to continue before rendering."); return; }
  const leadIn = music.leadInSamples ?? 0;
  if ((music.durationSamples ?? 0) - leadIn < filmSamples) {
    await ctx.log("The music is shorter than the film. Tell the person and make another track with a stable variant."); return;
  }
  await ctx.log("Generated music carries an inaudible SynthID watermark (this demo uses placeholder audio).");
  const rendered = await ctx.render({ timeline,
    captions: [{ text: "Morning", atFrame: 0, durationFrames: 30 }],
    audio: [{ artifact: music.artifact, atSample: 0, startSample: leadIn, durationSamples: filmSamples, gainMilliDb: -6000,
      fadeInSamples: 4800, fadeOutSamples: Math.min(96000, filmSamples) }, { sound: "ding", atSample: 48000, gainMilliDb: -9000 }] });
  await ctx.log(rendered.ok ? "Film rendered" : `Render failed: ${rendered.error.code}`);
}
```

### `skills/code-plan/openslate.skill.json` · Release identity

```diff
diff --git a/skills/code-plan/openslate.skill.json b/skills/code-plan/openslate.skill.json
index 2643c4a0..c8c38649 100644
--- a/skills/code-plan/openslate.skill.json
+++ b/skills/code-plan/openslate.skill.json
@@ -1,6 +1,6 @@
 {
   "id": "code-plan",
-  "version": "2.0.0",
+  "version": "2.0.1",
   "entry": "SKILL.md",
   "files": ["SKILL.md", "references/film-craft.md", "references/studio.d.ts", "references/example-plan.ts"],
   "compatibility": { "toolContract": "0.3.0", "planLanguage": "1.0.0", "workflowContract": "1.0.0" },
```

### `apps/server/src/application/director-capabilities.ts` · Release identity

```diff
diff --git a/apps/server/src/application/director-capabilities.ts b/apps/server/src/application/director-capabilities.ts
index 8ca48487..0e0a2e3e 100644
--- a/apps/server/src/application/director-capabilities.ts
+++ b/apps/server/src/application/director-capabilities.ts
@@ -7,7 +7,7 @@ import { join } from "node:path";
 /** Immutable code-mode instructions; independent of shipped graph releases. */
 export const CODE_PLAN_V1_GUIDANCE_DIGEST = "d3811c72395713445f2167bb281273de28b058098189f9d8bec441d7b3d0052e";
 export const CODE_PLAN_V2_GUIDANCE_DIGEST = "5a3a2ff56de93f43df6b15ba4c6d285264335b32e6bc2545e88fdb671c260c26";
-export const CODE_PLAN_GUIDANCE_DIGEST = "1a3900cb45b263c96ea12a9f9a0ebc43b9666a36a64cfea62b9d511167964c26";
+export const CODE_PLAN_GUIDANCE_DIGEST = "18e10aa56b6c1d2909595e33048507e8210d4782b86d4ee6dea569d4912a50f0";
 
 export interface DirectorSkillConfiguration { repositoryRoot: string; snapshotRoot: string; runtimeId?: string }
```
