# G2 · Native clip rates and 24 fps code-film output

Worktree: `codex/g2-frame-rate`. No commits, branch changes, stashes, browser launches, real-provider calls, external downloads, protected-state reads or port-3001 listeners. Production changes stay within G2 ownership, including the requested report. A minimal normalization-assertion update in the mixed `video-models.test.mjs` integration file is called out below. G1/G3 files, skills, web code and the browser contract are untouched.

## Implemented

- Video normalization now describes `silent-h264-native-fps-v2`. Constant 24/1, 25/1, 30/1, 24000/1001 and 30000/1001 retain their rates and decoded frame counts. The normalizer verifies every decoded presentation timestamp before retaining the rate; variable or unsupported rates fall back to 30 fps, including a VFR stream advertising exactly 24 fps on a coarse 1/48-second clock. Existing even-size, square-pixel, H.264/yuv420p, rotation, silent-output, byte and duration bounds remain. Conforming H.264 is silently remuxed, preserving decoded pictures exactly.
- `frame-rate.ts` separates measured picture counts/rates from plan ticks. Import metadata, generated-video derivations, whole-clip defaults, source range checks, storyboard readiness and original clip audio use physical duration correctly. Graph capture accepts native sources and still renders at 30 fps.
- New code-film render intents freeze 24 fps output. Plan values, journal input/step keys, timeline documents, purchases and the tool contract stay in their existing units. Manifest `totalFrames` is the actual output count, `round(totalTicks * 24 / 30)`. Row ends, speed-adjusted moving ends, hold ends and captions round on the cumulative timeline. Source cuts select the nearest native picture; FFmpeg selects pictures without blending or motion synthesis. Audio stays at 48 kHz and is padded/trimmed to the rounded output length before AAC encoding.
- Single-picture code rows use explicit output positions and `interleave`; FFmpeg `concat` otherwise gives these rows zero duration. Zero-picture rows after rounding are skipped. Graph films retain their existing concat path. A whole unedited 24 fps clip at matching dimensions can be remuxed; resized/edited renders use the existing lossy H.264 recipe.
- `read_clip_frames` still reports `fps: 30` and labels plan ticks. It now samples from the original timeline before selecting requested positions, avoiding a second rounding caused by seeking to a non-native frame boundary.
- Completed old normalizations/renders and immutable manifests replay as recorded, including old 30 fps renders. New free render variants reuse finished clips; they cannot submit, poll or download provider jobs. An incomplete v1 normalization intent remains pinned and refuses recipe drift. There is no automatic rewrite of old media, render receipts or paid step identities.

## Measured frame evidence

Pinned tools: Node 24.15.0, pnpm 10.33.0, FFmpeg/ffprobe 8.1.1. No tool download was needed.

The regression encodes an actual 160×90 H.264 file from three seconds of `testsrc2`, with a binary frame counter across eight bars. It reproduces the former `fps=30` conversion locally, then imports and renders with the new code. These are measured decoded files, not fake media descriptors.

| File/path through the pipeline | Measured rate | Decoded pictures | Identity/order evidence |
| --- | --- | --- | --- |
| Source fixture, 3.000 s | 24/1 | 72 | 72 distinct decoded frame hashes |
| Former `fps=30` normalization reproduced locally | 30/1 | 90 | 18 consecutive repeated counter values |
| Current normalization | 24/1 | 72 | All decoded frame hashes equal the source, in order |
| Whole speed-one code render | 24/1 | 72 | All decoded frame hashes equal the source, in order |
| Two contiguous code rows, forcing re-encoding | 24/1 | 72 | Counter values 0–71 in order; 72 distinct decoded hashes |
| 30 fps, 90-picture source rendered as code | 24/1 | 72 | 72 distinct pictures; source increments 1 or 2, one drop every four output transitions |
| Former 30 fps normalized clip rendered again as code | 24/1 | 72 | Counter values 0–71 in order; local conversion only |
| Native 24 fps source rendered as graph | 30/1 | 90 | Existing graph output rate/length retained |

Additional checks measure 31 plan ticks as 25 output pictures (1.041667 s), ten 3-tick rows as 24 pictures, and ten 1-tick rows as eight pictures. Caption ticks 7–19 occupy output frames 6–15. A cue at sample 12,000 remains there, with the final audio stream within one output frame of the 25-picture film. Every supported speed, holds and zoom retain the rounded expected length. A saved code plan with a completed video step survives a SQLite reopen and runtime restart and two local render variants with zero provider submit/poll/lookup calls and one unchanged video key.

The owner's Viggle clip is described by the card as 768×1344, 24/1, 8.000 s (192 pictures; the former conversion produces 240). Those are supplied baseline facts, not a fresh measurement in this worktree. No original provider clip is available in the card-owned tree; RULES.md forbids reading `.openslate` or fetching a provider output. The fresh measured comparison above uses an encoded synthetic clip. Applying the same check to an owner-provided copy outside protected state remains a lead-side acceptance check; no provider purchase is needed.

## Tests and verification

Continuation completed November 2–3, 2026. These are fresh results from this continuation, not counts copied from the interrupted run. No source or test deadline was loosened for host contention.

| Check | Actual result |
| --- | --- |
| `pnpm setup:test-media` | Exit 0; installed FFmpeg/ffprobe 8.1.1 matched, no download |
| `pnpm check:toolchain` | Exit 0; exact Node/pnpm, media codecs/demuxers and CJK font passed |
| `pnpm build` | Exit 0; all five packages built; existing web chunk/dynamic-import warnings |
| Six initially changed test files via `node scripts/run-tests.mjs` | 138 passed, 0 failed, 0 skipped |
| Final `native-frame-rate.test.mjs` rerun | 8 passed, 0 failed, 0 skipped, including whole-clip audio and old-normalizer local rerender |
| Explicit legacy recovery `video-derivation.test.mjs` rerun | 10 passed, 0 failed, 0 skipped |
| Media/render/code-plan/execution suites | 66 files; 1,116 passed, 0 failed, 0 skipped; exit 0; 339.574 s |
| Final `video-models.test.mjs` after replacing its obsolete normalization expectation | 21 passed, 0 failed, 0 skipped; exit 0 |
| Final per-file serial results for the full-run failure/interruption files | 23 files; 391 passed, 0 failed, 0 cancelled, 0 skipped |
| `pnpm -r typecheck` | Exit 0; 5 package typechecks passed, 0 failed |
| Final `pnpm typecheck` (package builds, then recursive typecheck) | Exit 0; 5 package typechecks passed, 0 failed |
| `git diff --check` | Exit 0 |

The 66-file selection included server/package test filenames containing media, render, code-plan, execution, derivation, timeline, storyboard-export or native-frame-rate. The initially changed six files were `native-frame-rate`, `media-rendering`, `video-derivation`, `film-quality-render`, `code-plan-providers` and `minimax-h3-execution`. The seven changed test files have 159 distinct tests in their final passing file results; the extra native-file rerun above is overlapping verification, not eight additional distinct tests.

### Full `pnpm test`: incomplete, not green

The command built successfully and ran tests, but emitted **71 failing test/file records** during severe host contention. It then produced no new output for more than ten minutes while a worker remained active. I interrupted only this run; it exited 1 and printed ten interrupted filenames. **Node emitted no final summary, so complete full-run pass/fail/skip counts are unavailable.** The 71 records are not presented as a final full-suite failure count.

Measured host load during that period was 31.91 / 40.00 / 90.92, later 29.16 / 36.93 / 84.89. Ordinary pnpm version probes also exceeded their five-second preflight limit, despite direct checks eventually confirming pnpm 10.33.0 and Node 24.15.0. Host pressure is a plausible contributor, not proof of every failure's cause.

All 13 files containing those reported failures then passed in completed serial reruns, with the original test deadlines and normal pinned-toolchain preflight. All ten interrupted files were also run serially. That uncovered one genuine obsolete expectation in the Seedance fixture: five seconds of native 24 fps had been expected to become 30/1 and 150 pictures. Its normalization assertion now expects 24/1 and 120; all price, charge, provenance, last-frame, one-create/two-download and restart assertions remain. The first 23-file serial pass was 390 passed / 1 failed; after that correction, `video-models.test.mjs` passed 21/21. The final per-file aggregate is 391/391.

The full parallel gate still needs a completed run on a quieter machine. The serial results do not replace its missing summary.

### Final serial file results

Each file ran through `node scripts/run-tests.mjs --test-reporter=tap <file>`; the corrected video-models file also ran through the normal reporter. All final exits were 0, with zero failures, cancellations or skips. This table uses the corrected final video-models result rather than silently rewriting the original controller log.

| File under `apps/server/test/` | Passed |
| --- | ---: |
| `scene-confirmations.test.mjs` | 29 |
| `scene-cross-scene-grants.test.mjs` | 14 |
| `scene-generation.test.mjs` | 36 |
| `scene-keyframe-run-identity.test.mjs` | 6 |
| `scene-plan-speech.test.mjs` | 5 |
| `schema.test.mjs` | 10 |
| `scoped-assembly.test.mjs` | 2 |
| `server-shutdown.test.mjs` | 3 |
| `service.test.mjs` | 19 |
| `shot-audio-http.test.mjs` | 26 |
| `shot-narration-scope.test.mjs` | 5 |
| `shot-recording-http.test.mjs` | 17 |
| `storyboard-export.test.mjs` | 19 |
| `transcription-preparation-engine.test.mjs` | 24 |
| `transcription-preparation-port.test.mjs` | 16 |
| `transcription-preparation-storage.test.mjs` | 9 |
| `upload-formats.test.mjs` | 47 |
| `video-derivation.test.mjs` | 10 |
| `video-download.test.mjs` | 14 |
| `video-models.test.mjs` | 21 |
| `viggle-backup.test.mjs` | 4 |
| `viggle-h3-execution.test.mjs` | 42 |
| `viggle-h3-frame-crop.test.mjs` | 13 |

Two early scene-confirmation retry attempts exited 1 at pnpm preflight before running tests. A further attempt used a bounded 60-second actual pnpm version probe, passed preflight, then was interrupted with SIGINT (exit 130) to remove competing load. An early root typecheck attempt was also interrupted (exit 143) after package builds. These attempts are superseded by the completed normal serial checks and final typecheck above; they are not counted as passes. No serial per-file timeout fired.

Temporary evidence logs: `/tmp/openslate-g2-build.log`, `/tmp/openslate-g2-touched-final.log`, `/tmp/openslate-g2-native-final.log`, `/tmp/openslate-g2-suites.log`, `/tmp/openslate-g2-full-test.log`, `/tmp/openslate-g2-serial-controller.log`, `/tmp/openslate-g2-serial-results.json`, `/tmp/openslate-g2-video-models-final.log`, `/tmp/openslate-g2-typecheck-final.log`. Detailed per-file TAP logs are named in the serial-results JSON.

### Test changes

Added eight native-rate tests and one explicit legacy-v1 recovery test. Native coverage includes decoded hashes/order, all retained rates, VFR/unsupported fallback, odd-size/4:4:4/audio/rotation normalization, code-vs-graph rates, cumulative cuts, disappearing rows, caption pixels/audio positions, every speed/hold/zoom, saved completed-video replay after SQLite reopen, contact-sheet positions and locally repairing an old 30 fps converted clip. Whole-clip picture-copy rendering also measures its 48 kHz audio boundary.

Replaced obsolete expectations in six existing files:

- `media-rendering.test.mjs`: its 24 fps source stays 24 fps/24 pictures; existing graph-render assertions remain.
- `video-derivation.test.mjs`: six-/two-second fixtures measure 144/48 native pictures. Existing charge, short-output, provenance, cancellation, corruption and recovery assertions remain. Extended incomplete-recipe coverage to legacy v1 and added durable completed-v1 recovery.
- `film-quality-render.test.mjs`: the real code executor produces 48 output pictures from 60 plan ticks; graph/default-render assertions remain.
- `code-plan-providers.test.mjs`: its offline two-clip six-second code render is 24 fps/144 pictures; provider counts, liability and recovery assertions remain.
- `minimax-h3-execution.test.mjs`: its offline six-second source retains 144 native pictures; raw hash, charge and one submit/poll/download checks remain.
- `video-models.test.mjs`: one assertion line now expects native 24/1 and 120 pictures for its five-second Seedance fixture; all transport, pricing and restart checks remain.

No tests deleted, disabled or weakened to discard money/integrity behavior.

<details>
<summary>Exact initial full-run failing test/file records; all containing files passed their completed serial rerun</summary>

`apps/server/test/scene-confirmations.test.mjs`

- legacy missing line confirm resumes after speech/attach across restart with one paid speech attempt
- Stop after speech publication cancels unsent voice/video without resubmission
- failed voice blocks confirm before video and never retries a paid step
- unknown voice blocks confirm before video and never retries a paid step
- an edit between paid speech publication and dispatch fences the old confirm before any spend
- mixed none, uploaded and generated narration confirms to video with exact owned audio
- restart after speech publication but before its checkpoint replays that exact operation
- an unknown voice cannot be bought again by a new confirmation key
- editing narration outdates only its voice; the next keyframe press buys only the missing line
- Stop while speech is already sent retains the result but cancels later acceptance and video
- restart after canonical acceptance before checkpoint replays the exact acceptance
- targeted keyframes buy only the named shot and its missing voice; regeneration re-quotes voice
- server-owned voice writing derives Chinese language from CJK text
- durable runner sessions run alongside an independent Director and retain its holds across restart
- a queued B7 voice line keeps the B11 default captured at its human press
- keyframes with a pinned personal voice keep the ready identity over the project default
- keyframes with a pinned personal voice refuse revoked consent without buying speech
- personal voice consent revoked after a keyframe press fences its queued speech without substituting a default
- a personal project default preserves the authored voice tag during keyframes confirmation
- a personal project default preserves the authored voice tag during video confirmation
- failed confirmed video projects no forbidden automatic retry or perpetual making_video
- released unknown speech keeps liability evidence and no longer blocks a new confirmation

`apps/server/test/scene-cross-scene-grants.test.mjs`

- human: a new script with failed sibling keyframes generates each scene with only its exact grants
- human: a selected shot leaves failed same-scene and cross-scene siblings untouched
- director: a new script with detached sibling keyframes generates each scene with only its exact grants
- director: a selected shot leaves detached same-scene and cross-scene siblings untouched
- human: a new script with detached sibling keyframes generates each scene with only its exact grants
- human: a selected shot leaves detached same-scene and cross-scene siblings untouched
- Director: one whole-film call starts all three scenes with failed old candidates exactly once
- Director: one whole-film call starts all three scenes with detached old candidates exactly once
- Director: the snapshot whole-film explicit regeneration call buys only one fresh take per requested shot
- human: a stale scene review after a script edit creates no grants, candidates or attempts
- Director: a later human request fences keyframe generation without granting sibling work
- trusted scene publication refuses missing, widened, wrong-kind and foreign-scope operation lists without paid work

`apps/server/test/scene-generation.test.mjs`

- one scene can generate while another scene keeps an unchanged deferred video
- direct camera and framing edits reauthor their exact prompts and need only the scene generation check
- duration-only edits retain the exact completed keyframe and require only a fresh video check
- explicit shot regeneration retains siblings and old receipts, then needs the new exact scene video review
- a shot keyframe action retires superseded film holds and preserves active sibling holds without widening generation scope
- shot regeneration rejects ambiguous scope, video shortcuts, missing identity and unsupported hold ownership without writes
- detached uncertain keyframes block regeneration until a charged lost reply allows a new human press
- a selected frame can regenerate beside a pending sibling without replacing or dispatching that sibling twice
- failed same-spec regeneration publication rolls back the frame, candidate and narrowed holds
- targeted regeneration replaces the exact owned conditioning and defers only its video until new frame review
- targeted regeneration replaces the exact shared conditioning and defers only its video until new frame review
- prompt writing leaves unrelated scene pauses with their original request and does not widen generation
- scene press preserves an unrelated queued and its request, epoch and hold
- a shot press does not block on or supersede a sibling shot question inside the same scene
- a question arriving during scene compilation is rechecked before publication without releasing holds

`apps/server/test/scene-keyframe-run-identity.test.mjs`

- director keyframe images retain their voice run's mutation fence before admission
- director keyframe voice-run images never acquire automatic paid technical retries
- a Director scene without a voice runner preserves ordinary image retry behavior

`apps/server/test/scene-plan-speech.test.mjs`

- requested voice can append after scene keyframes preserve historical picture branches
- requested voice can append after scene keyframes preserve versioned historical picture branches
- mixed picture speech still requires the exact immutable source revision

`apps/server/test/schema.test.mjs`

- two independent Store processes safely recheck concurrent fresh creation after waiting for a writer

`apps/server/test/scoped-assembly.test.mjs`

- a scoped silent shot duration rebuilds its derived cut total while preserving the other take and both frames
- the duration exception cannot reorder cuts or change export geometry through a shot request

`apps/server/test/server-shutdown.test.mjs`

- shutdown closes a held keep-alive socket and an unending hijacked stream before storage and ownership
- a process with hanging cleanup exits within its deadline and permits immediate installation reacquisition

`apps/server/test/service.test.mjs`

- an alongside request cannot release a previous active hold without explicit human continuation
- same-input extra take requires a new user-change grant and renews only the requested candidate
- restart constructor changes cannot change the project compilation capability lock
- negative, conditional, quoted and unscoped review replies cannot approve

`apps/server/test/shot-audio-http.test.mjs`

- editing and accepting one shot preserves another cue while its lost video reply is charged once
- uploaded-to-generated writing updates the card and preserves visual revisions while blocking old video until acceptance

`apps/server/test/shot-narration-scope.test.mjs`

- scoped speech preparation and exact human review create only the pinned operation; generic plans cannot borrow it
- restored scoped sessions cannot write or regrant old speech; explicit continuation stays scoped and paused
- opening a compact edit also holds its legacy project-authored speech while another exact speech job stays eligible

`apps/server/test/shot-recording-http.test.mjs`

- recording Undo retains unrelated narration edits completed while local import was running

`apps/server/test/storyboard-export.test.mjs`

- apps/server/test/storyboard-export.test.mjs

</details>

## Self-review

Reviewed the complete diff, callers, cross-file effects, saved recipes and failure boundaries. Corrected native-picture comparisons in graph readiness/capture, physical duration in imports/derivations/clip audio, cumulative rounding drift, zero-duration one-picture concat rows, prematurely rounded exclusive source ends, final audio padding/trimming, and coarse-clock CFR detection (each timestamp gap must also fit the nominal clock step). A fractional 7..38-tick trim now yields 25 distinct consecutive source pictures. Retaining a native rate now additionally requires retaining the exact decoded picture count, preventing a bounded-output prefix from being accepted as a complete native clip. The continuation reviewed these fixes and the complete final diff again; its findings were test-coverage gaps for whole-clip audio and explicit legacy v1 recovery, plus the obsolete Seedance 30 fps expectation discovered in the interrupted-file reruns. All are addressed above. No unresolved production implementation finding remains from that review.

## Remaining 30 fps assumptions

- Intentional API units: all plan frame fields, row-length arithmetic, caption validation, local timeline documents (`frameRate: 30`), song/beat timing, narration/clip-audio tick-to-sample conversion (`1600` samples/tick), project limits and the core/skill contract. These are time positions, not output picture counts.
- Intentional output: graph/storyboard films, unsupported/VFR normalization fallback, trusted `importFixture` demo material and old completed render manifests. `toolchain-probe.ts` still checks a six-picture 30 fps graph/toolchain fixture.
- Intentional tool view: `read_clip_frames`/`clipDescription` duration and labels remain 30 ticks per second, including owned 24 fps renders. Media-source routes expose measured decoded picture counts.
- Unedited adjacent documentation: `docs/implementation/STATUS.md` and `docs/technical/TIMELINE-RENDERING.md` still summarize local output as 30 fps; they are outside G2's documentation ownership. The lead should reconcile those summaries when merging. No skill text or shared contract was changed.

## Files / contract / proposed commit

Added: `apps/server/src/media/frame-rate.ts`, `apps/server/test/native-frame-rate.test.mjs`, this report.

Changed: `apps/server/src/media/{types,local-media,local-timeline,timeline-capture,storyboard-capture,application}.ts`; `apps/server/src/execution/{video-derivation,spool-video-ingester,local-media-executor}.ts`; `apps/server/src/code-plan/clip-frames.ts`; `apps/server/test/{media-rendering,video-derivation,film-quality-render,code-plan-providers,minimax-h3-execution,video-models}.test.mjs`; render/normalization sections of `docs/technical/EXECUTION-ENGINE.md`.

Deleted: none. Minimal extra mixed integration test: `apps/server/test/video-models.test.mjs`, one line of G2 normalization expectations, required by RULES.md rule 6 when the card replaces old behavior. No provider implementation/catalog/pricing or G1/G3 file was changed. Contract changes to `packages/core/src/studio-api.ts`: none. No schema, tool-contract or step-key change.

Proposed conventional commit (lead only): `fix(media): preserve native clip rates and render code films at 24 fps` — all files above. No commit made here.

## Open verification limits

- A complete green `pnpm test` summary is unavailable: the full run stalled after load-associated failures and was interrupted. All reported-failure and interrupted files subsequently passed their final serial file checks; root typechecking passed. A quiet-machine full run remains the lead-side integration gate.
- The actual owner-provided Viggle clip was not accessible outside protected state. Fresh quantitative evidence uses a real encoded synthetic H.264 fixture, as explicitly distinguished above. An owner-provided copy can be checked locally without any provider purchase.
- The adjacent STATUS/TIMELINE documentation summaries noted above remain outside this card's documentation ownership.
