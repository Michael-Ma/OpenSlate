# Q1 report — Director film craft

2026-11-01. Worktree: `codex/q1-craft`, baseline `1819760f`. No commits.

## Done

1. Added `skills/code-plan/references/film-craft.md` (6,878 UTF-8 bytes), declared in the manifest and delivered with the other verified references every turn. It covers story, shots, continuity, separate English prompts, source handles, reference/frame policy, review/cutting and bounded retakes, sound/captions, and estimates in the card's order. The five-item 0–2 rubric judges observed media, not prompt intentions. Failed/unknown submissions retain their separate retry/consent rules.
2. `SKILL.md` opens with the craft reference, permits pose-specific frame control without another question, and finishes shared reference assets before concurrent independent shot pipelines. It is 13,512 bytes, below the original 13,631. Removed duplicated craft wording while retaining API, identity, liability and consent details.
3. The two-shot offline example has independent English `frame` and `motion` strings. Image calls receive the frame string and initial/retry video calls receive only motion, with no shared prompt concatenation. Existing choices, shot ids, stable variants, consent fallback, parallel pipelines, measured music placement and fake render metadata remain. No new CONTRACT.md API is called by this example.
4. Server fallback and browser standard ceiling are $4. Saved run/settings ceilings and browser preferences keep their values, including an existing $1 film and a server-side zero limit. No migration or persisted-state rewrite.
5. Director launch configuration and `turn/start` both request `high`; setup creates and verifies that setting and only offers text models advertising high effort. The low-only-model refusal remains, now testing the new requirement, and a new regression refuses effective-config drift back to low.
6. Guidance package digest pinned in `director-capabilities.ts`: `ffe429380a422b961518f85e0022623c6ec7800d378b6f5b557847d2b1b73bd6`.

### Reasoning effort scope

This changes all turns using `CodexDirectorRuntime`, including graph and code-plan films, and the setup model selector/readiness check. It asks the native model for more reasoning during planning, repair and review; it may consume more model time/quota and take longer. It does not change video-provider quality, prices, durations or enhancement, and does not prove better films. The separate Codex image runtime's generation effort is unchanged; its synthetic readiness catalog was updated because it shares setup. No live call was made to measure latency or quality.

## Acceptance: the original brief, without generation

Brief: “做一个 30s 的搞笑视频，主角是一只可爱的柯基，名字叫 Tofu，目的是发社交媒体，需要有配乐”.

**Premise:** Tofu 想认真减肥，却敌不过食欲：碰一下哑铃就瘫倒的柯基，一见狗粮立刻变成短跑冠军。

The want is to train; the obstacle is appetite. The proof of the joke is the same dog collapsing after a tiny effort and then racing toward food. This is a written application of the guidance, not a generated-film or cold-viewer result.

**Before-shooting estimate:** 预计约 $3.08，含配乐和两次补拍预留，低于新片默认 $4 上限。

Calculation using the baseline rates in the supplied evidence: eight six-second 768p reference/first+last-frame clips at $0.30 = $2.40, one music call $0.08, two retakes at $0.30 = $0.60. Character/set/keyframe images use the subscription. Actual planning must recalculate from `read_film.models` and the film's stored limit.

### Continuity and shots

First make Tofu's sheet: tan-and-white corgi, white forehead blaze, teal bandana. Make three empty set plates of the same room: A low wide view down the mat-to-food path, B dog-eye close view beside the bowls, C high medium view over the mat/bowl area. All cameras stay on the same side of that axis. The mint mat, yellow foam weight, full white broccoli bowl and blue kibble bowl have fixed positions in the plates. Place food toward camera so the sprint travels in depth. Every keyframe takes the sheet and its plate as references. Track the blue bowl becoming empty and keep the broccoli untouched.

### Beat sheet

Times are intended finished-film allocations, not video-prompt timing promises. Source ranges must be chosen after watching; they are deliberately not invented here. Eight shots reuse three setups and alternate wide, medium and close sizes.

| Intended cut | Beat | Setup/size | One visible proof | Sound/Chinese caption |
|---|---|---|---|---|
| 0–3 s | Setup: serious athlete | A / wide | Tofu braces over the tiny weight with solemn concentration. | Earnest marching music; “减肥第一天”. |
| 3–7 s | Setup broken: one effort | C / medium | A nose nudge ends in an enormous side-on sprawl beside the barely moved weight. | Thud at the observed landing; “今日训练完成”. |
| 7–11 s | Build: healthy lunch | B / close | Nose hovers over one broccoli floret; the full white bowl is unmistakable. | Music continues seriously; “健康午餐”. |
| 11–14 s | Turn: refusal | C / medium | Tofu's back faces the still-full broccoli bowl. | Music pauses; “告辞”. |
| 14–17 s | Turn: a better offer | B / close | The limp dog's head rises toward the visible blue food bowl, ears suddenly alert. | Ding at the head lift; “等等”. |
| 17–22 s | Payoff: sprint champion | A / wide | Tofu races from the mat toward the blue bowl, past the same weight that exhausted him. | March returns with energy; whoosh at the sprint; “这才叫有氧”. |
| 22–26 s | Proof: selective energy | C / medium | Tofu eats the kibble, leaving the blue bowl empty and the broccoli bowl full. | Music carries the cut; “光盘行动”. |
| 26–30 s | Button/loop | A / wide | The dog lies satisfied beside the empty bowl, with untouched exercise gear and broccoli behind. | Music ends cleanly; “减肥明天再说”. |

The three sound effects are thud, ding and whoosh, placed from observed frames. Captions are each no more than eight Chinese characters and stay below seven characters per second at these allocations. Render vertical with `cover` and inspect the crop. For the collapse, first/last-frame control is justified by the exact landing pose; ordinary shots keep references. Request longer sources than their retained beats, inspect all clips, then score, trim and assemble. At most one quality retake per shot and two total; review the final render once.

### Two clip prompts

Separate still prompts would establish each keyframe's composition. These are motion prompts only, in English, with action order and a final pose. Neither includes timestamps, physical measurements, margins or negative lists.

**Shot 2 — collapse (71 words):**

> Medium view from above the mint exercise mat. Tofu, the corgi in the supplied frames, stands beside the yellow foam weight with a solemn face. He nudges it with his nose, then flops dramatically onto his side as though the tiny effort exhausted him. The camera stays fixed, keeping his whole body and the weight visible. He ends sprawled with his legs stretched out, eyes resting on the barely shifted weight.

**Shot 6 — sprint (75 words):**

> Wide shot from beside the blue food bowl, looking down the room toward Tofu on his exercise mat. The corgi follows the reference picture. He springs forward and races toward the bowl with eager, exaggerated energy, then plants his paws beside it. The camera holds steady as he grows larger in the picture, passing the yellow weight on his way. He ends standing over the bowl, ears alert and eyes fixed eagerly on the kibble.

## Verification

All checks used Node 24.15.0, pnpm 10.33.0 and FFmpeg/ffprobe 8.1.1. `pnpm setup:test-media` found the already matching local binaries; no download was needed. No browser, real provider/native model call, external request, protected state/credential read or port-3001 listener was part of this task. Native API calls in tests are synthetic fixtures; video transports use fake responses or loopback.

| Command/check | Actual result |
|---|---|
| `pnpm setup:test-media`, `pnpm check:toolchain` | Passed exact version and codec checks. |
| `pnpm build` | All five workspace builds passed; Vite retained its bundle-size warning. |
| Initial eight-file `node scripts/run-tests.mjs …` gate | 272 passed / 2 failed / 0 skipped (274 total). Both failures were obsolete port-test ceiling raises; corrected port file passed 28/28. |
| Final nine-file touched-test gate | **295 passed / 0 failed / 0 skipped**, exit 0 (117.14 seconds). Includes the corrected video-ceiling file and all eight original focused files. |
| `pnpm test` | **Did not finish cleanly.** Its captured output contained 4,865 passing results, 2 failing results and 1 optional native-probe skip. It produced no aggregate summary and remained running with no further output for more than three minutes; it was interrupted through the task's own execution session. The runner listed `scripts/test/skills-release.test.mjs` and `scripts/test/test-toolchain.test.mjs` as unfinished. These are observed output counts, not invented final suite totals. |
| `node scripts/run-tests.mjs apps/server/test/transcription-preparation-engine.test.mjs` | 24 passed / 0 failed / 0 skipped. Repeated the full unchanged file after its 150 ms lease case was flagged in the full run, as requested. |
| `node scripts/run-tests.mjs apps/server/test/video-models.test.mjs` | 21 passed / 0 failed / 0 skipped after explicitly storing the intended $1 test ceiling. |
| `node scripts/run-tests.mjs scripts/test/skills-release.test.mjs scripts/test/test-toolchain.test.mjs` | Again did not settle; printed `Verified 4 shipped releases.` and was interrupted. No pass total claimed. |
| `node --test --test-reporter=tap --test-timeout=15000 scripts/test/test-toolchain.test.mjs` | 7 passed / 0 failed / 0 skipped; exit 0. |
| `node --test --test-reporter=tap --test-timeout=60000 scripts/test/skills-release.test.mjs` | Printed `Verified 4 shipped releases.` but did not settle or produce test totals; also interrupted. No assertion failure or completed result is claimed for this file. |
| `pnpm -r typecheck` | All five workspace typechecks passed, zero failures. |
| `pnpm demo:code` | Passed: versions 1 → 2, two answered choices, eight reused steps after motion edit, one lookup recovery, zero duplicate submissions, $0.44 / $4.00, final state `done`. Fixture media only. |
| Package size/digest and `git diff --check` | Passed: craft 6,878 bytes, SKILL 13,512 bytes, example motion prompts 62/63 words, exact package digest matches the pin, no whitespace errors. |

The two flagged full-run cases were:

- `transcription-preparation-engine.test.mjs` — “an edit during awaited preparation aborts the old signal and settles only that obsolete unstarted attempt”. This uses a 150 ms lease; its entire unchanged file passed 24/24 on rerun. This does not establish that the underlying timing race is fixed.
- `video-models.test.mjs` — “input-dependent ceiling blocks dispatch before submit”. Its prior implicit $1 default was replaced by an explicit stored $1 limit; the whole file passed 21/21. The exact $1.134 quote and zero-create assertion remain.

Logs are task-local `/tmp/openslate-q1-{build,focused,port-final,full-test,lease-rerun,video-rerun,script-rerun,toolchain-direct,release-direct,typecheck,demo}.log`; the final focused run uses `/tmp/openslate-q1-focused-final.log`. Full-run completion remains an integration verification issue for the lead. No implementation or assertion in either unfinished script file was changed, and no full-suite success is claimed.

## Tests changed

- Added two port regressions: $3.60 completes under the unstored $4 default and replays without another call; saved $1/zero limits survive first plan/restart and run values take precedence over settings.
- Added one setup refusal case for effective effort drifting to low. Updated native launch/turn assertions and synthetic catalogs for high effort, preserving model-discovery filtering and failure tests.
- Extended context delivery/digest checks to include the complete craft reference. Extended the sandbox example check to verify frame/motion separation through initial calls and consent retries.
- Updated the demo's motion-edit fixture and assertions for the new full prompt. It still proves only one clip and render change, eight old steps reuse, and unknown submission lookup without duplicate acceptance.
- Changed budget regressions that assumed a default $1 to set an explicit stored $1, or use a price just above $4. Their liability, reservation, idle-event, restart and no-resubmit assertions remain.
- Extended browser preference coverage for the $4 creation payload and preservation of an existing $1 preference. Display examples using explicit $1 films remain valid.
- No test deleted, disabled or skipped by this change.

## Files

Added:

- `skills/code-plan/references/film-craft.md`
- `docs/ai/film-quality/reports/Q1-report.md`

Changed:

- `skills/code-plan/SKILL.md`
- `skills/code-plan/openslate.skill.json`
- `skills/code-plan/references/example-plan.ts`
- `apps/server/src/code-plan/settings.ts`
- `apps/server/src/application/director-capabilities.ts`
- `apps/server/test/code-plan-director.test.mjs`
- `apps/server/test/code-plan-e2e-fixture.mjs`
- `apps/server/test/code-plan-e2e.test.mjs`
- `apps/server/test/code-plan-port.test.mjs`
- `apps/server/test/code-plan-runtime.test.mjs`
- `apps/server/test/video-models.test.mjs`
- `apps/web/src/next/app/useDefaultLimit.ts`
- `apps/web/test/next/code-plan.test.mjs`
- `packages/director/src/runtime/codex.ts`
- `packages/director/src/runtime/setup.ts`
- `packages/director/test/runtime.test.mjs`
- `packages/director/test/runtime-setup.test.mjs`
- `packages/director/test/runtime-setup-fixture.mjs`
- `packages/director/test/codex-image-fixture.mjs`

Deleted: none. No change to `skills/code-plan-v1`, shared browser contract, schema, implementation status or other cards' implementation files.

## Self-review and integration boundaries

Self-review checked prompt callers, stored-limit precedence, pending-charge preservation, native effort overrides/setup consistency and complete context delivery. It explicitly separates quality retakes from unsafe retries and shared-reference preparation from concurrent independent shots. The first focused run found two additional port tests trying to raise the new $4 default to $1.20/$2.00. Their isolated file reproduced both failures. The held-work case now explicitly stores $1, and the event case raises to $5, preserving every money/hold/event assertion. No production logic was changed to accommodate those obsolete defaults.

The full suite found one more obsolete default in `video-models.test.mjs`: the $1.134 input-dependent video quote no longer exceeds a $4 ceiling. This test now explicitly stores $1 before submitting; its exact quote and zero-provider-create assertions are unchanged.

Q2 owns the image reference/aspect API; Q3 owns `ctx.review`, `read_clip_frames` and contract 0.3.0; Q4 owns captions, sound placements and edit controls. The prose describes the combined flow with an installed-capability guard. The example and manifest compatibility remain on today's 0.2.0 API. The lead must integrate these streams and re-pin the resulting guidance package digest. This checkout establishes no real visual-quality improvement or native vision acceptance.

Two current documents outside Q1 ownership still describe the $1 default: `docs/technical/EXECUTION-ENGINE.md:73,87` and `docs/ai/code-plan/NEXT.md:25`. The lead should update these to $4 when integrating. Historical cards/reports retain their dated $1 observations. They were not edited across card ownership boundaries.

## Contract changes

None to `packages/core/src/studio-api.ts` or the shared contract. No declarations for Q2/Q3/Q4 were added.

## Proposed commits for the lead

No commits executed. Suggested split:

1. `feat(director): teach film craft and separate shot prompts` — `skills/code-plan/SKILL.md`, `skills/code-plan/openslate.skill.json`, `skills/code-plan/references/film-craft.md`, `skills/code-plan/references/example-plan.ts`, `apps/server/src/application/director-capabilities.ts`, `apps/server/test/code-plan-director.test.mjs`, `apps/server/test/code-plan-e2e-fixture.mjs`.
2. `fix(code-plan): default new films to a four-dollar ceiling` — `apps/server/src/code-plan/settings.ts`, `apps/web/src/next/app/useDefaultLimit.ts`, `apps/server/test/code-plan-port.test.mjs`, `apps/server/test/code-plan-runtime.test.mjs`, `apps/server/test/code-plan-e2e.test.mjs`, `apps/server/test/video-models.test.mjs`, `apps/web/test/next/code-plan.test.mjs`.
3. `feat(director): pin high reasoning effort` — `packages/director/src/runtime/codex.ts`, `packages/director/src/runtime/setup.ts`, `packages/director/test/runtime.test.mjs`, `packages/director/test/runtime-setup.test.mjs`, `packages/director/test/runtime-setup-fixture.mjs`, `packages/director/test/codex-image-fixture.mjs`.
4. `docs(film-quality): record Q1 verification and Tofu acceptance draft` — `docs/ai/film-quality/reports/Q1-report.md`.
