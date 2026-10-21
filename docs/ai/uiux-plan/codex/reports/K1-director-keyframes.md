# Done

- K1.1: Added `make_keyframes` to contract 6.0.0 only. Exactly one explicit scene/shot list is required; regeneration requires exact shot IDs. Each scene uses the existing composition, quote, grant, retained-take and scene-voice runner paths. Results identify started frames/voice lines and their quotes, or per-scene refusal codes; another scene's refusal does not stop eligible scenes.
- K1.2: Generation requires the original, active human editing conversation and its exact active epoch/catalog lock. App/automatic, discuss-only, read-only, review and inherited review-answer authority cannot spend. Scope, foreign holds, Stop, supersede and asynchronous publication fences remain mandatory. Scene/voice records have distinct run identities under the same original human request. Candidate-to-run links preserve the existing scene-press dispatch guards and technical retry policy without changing grant ownership. Exact tool-call replay returns its receipt; unresolved calls require reconciliation and never dispatch again.
- K1.3: Snapshot turn effects expose `generation` with persisted, immutable per-scene prices/counts. Existing overview slots and voice `keyframesRun` project the work. Stop detaches unsent work, including after restart. Reconciliation reconstructs publication from effects committed atomically with domain work, rather than assuming an incomplete transport checkpoint proves an effect.
- K1.4: The existing recording tool can request owned transcription for the exact audio attachment carried by the current eligible human message. It preserves the original request's hold cutoff, verifies authority again at asynchronous publication, and commits its priced effect with the existing owned application. A different tool-call ID cannot bypass unresolved same-audio work; matching confirmed work returns its original publication and effect, including after head movement or another lost reply. Returned words never attach/adopt/accept themselves. Other recording/speech suggestions retain their human-action path.
- K1.5: Updated V7 skills, contract-6 host guidance and bridge/catalog tests. Instructions require requested scope, explicit new-take intent, actual started prices/refusals, and a human scene confirmation for video. Contracts 1–5 and skills V1–V6 are unchanged.
- K1.6: Video plan declarations retain `ORIGIN_NOT_AUTHORIZED` / `awaiting_human_generation`; conversation authority cannot authorize video. Keyframe grants remain scoped image grants.

# Files

Added:

- `apps/server/src/application/director-keyframes.ts`
- `apps/server/src/application/director-generation-authority.ts` (partial worktree implementation completed)
- `apps/server/src/application/director-generation-effects.ts` (partial worktree implementation completed)
- `apps/server/src/application/director-attachment-transcription.ts`
- `apps/server/test/director-keyframes.test.mjs`
- `apps/server/test/director-attachment-transcription.test.mjs`
- `apps/server/test/director-keyframe-reconciliation.test.mjs`
- `apps/server/test/scene-keyframe-run-identity.test.mjs`
- `apps/server/test/fixtures/director-guidance-v7-before-k1.json` (earlier branch identity retained from initial worktree)
- `skills/v7/production/references/keyframes.md`
- This report.

Changed:

- `packages/core/src/tools.ts` (partial contract-6 worktree implementation completed)
- `packages/core/test/guidance-successor.test.mjs` (updates the existing contract-6 tool-list assertion)
- `apps/server/src/app.ts` (only forwards the existing scene voice runner to internal tool invocations)
- `apps/server/src/application/{service.ts,tool-invocations.ts,director-turn-view.ts,director-shipped-guidance.ts,director-tools-upgrade.ts,film-planning-guidance.ts,director-input.ts}`
- `apps/server/src/{scene-generation.ts,scene-confirmations.ts,narration-reusable-speech.ts}`
- `apps/server/src/narration/owned-transcription-service.ts`
- `apps/server/src/persistence/store.ts`
- `apps/server/src/execution/retry-eligibility.ts` (adjacent execution change: resolve the exact Director scene run for an image candidate, retaining scene-press dispatch and retry behavior)
- `apps/server/test/{director-guidance-maintenance.test.mjs,director-successor-host.test.mjs,director-supervisor.test.mjs,keyframe-review.test.mjs}`
- `packages/director/test/{tools.test.mjs,skills-v7.test.mjs,runtime-fixture.mjs}`
- `skills/v7/plan-authoring/{SKILL.md,openslate.skill.json,references/grammar.md,references/example.md}`
- `skills/v7/production/{SKILL.md,openslate.skill.json,references/current-contract.md,references/audio-proposals.md,references/narration.md,references/notes.md,references/continuity-review.md}`
- `skills/v7/production/references/stages/{storyboard.md,narration.md,video.md,shot_plan.md,scene_plan.md,review.md}`

Deleted: none. No web source, browser contract, shipped migration, older skill package or STATUS.md edit.

# Tests

Pinned toolchain setup/preflight passed: Node 24.15.0, pnpm 10.33.0, FFmpeg and ffprobe 8.1.1; no download was needed. Final `pnpm build` passed for all five packages/apps. Vite retained its existing large-chunk advisory; there was no build failure.

Final focused/related checks: **441/441 passed** across the 409-case related batch and the final 32-case core-successor/supervisor assertion batch, zero failures, cancellations, skips or todo. They ran all changed/new test files and related context, tool-upgrade, scene generation/confirmation/guard/concurrency, owned transcription and generated narration tests with `node scripts/run-tests.mjs`.

Final `pnpm test` passed: **3,826 passed, zero failed/cancelled/todo, one optional native-probe skip (3,827 total)**. Its build also passed. Final `pnpm -r typecheck` passed **5/5** workspace package/app checks (`core`, `providers`, `director`, `server`, `web`), zero failures. `git diff --check` passed. Independent source, failure-boundary and report/inventory reviews have no remaining must-fix finding.

Coverage includes all-scenes image+synthetic speech, exact effect quotes, voice-only revised lines, partial direction/confirmation refusals, scopes and foreign holds, Stop/restart, read-only/review/older-contract refusal, explicit-shot regeneration, concurrent/exact/unknown replay, asynchronous supersede/Stop, partial publication reconciliation, later recording selection including A → B → A, owned transcription and its original hold cutoff, transaction rollback, unknown/reply-loss recovery, and human-only video.

**72 regression cases added**: 29 Director keyframe cases, 24 attachment-transcription cases, 3 interrupted-publication reconciliation cases, 6 scene-run identity/parity cases, 4 earlier/amended guidance pin and upgrade cases, 1 host-guidance case, 3 tool schema/bridge cases and 2 V7 guidance cases. Existing no-double-charge, unknown-submission, idempotency and stale-version tests were retained and checked. No test scenario was deleted, disabled or replaced. Existing expectations were updated for the additional contract-6 tool/catalog identity and empty `generation` effects; the fake native fixture now advertises the new tool only for contract 6. The package pin assertion now includes V7 while separately retaining and verifying its earlier identity fixture.

The resumed-worktree audit's first focused batch passed 185/187, with two real failures: a different tool call could resubmit the same attached audio after an unknown outcome, and a new call after publication reply loss bought a second candidate. Both failures reproduced alone (0/2), then passed after the same-audio fence and retained-publication replay fix; the final standalone attachment file passed 24/24. The explicit same-version guidance/status checks and existing tool-upgrade suite passed 46/46. Independent review also identified the distinct-run image-candidate linkage gap; it is fixed with immutable candidate-to-run records and regression coverage. These were implementation failures, not timing flakes.

The first full-suite run returned **3,824 passed, 2 failed and 1 optional native-probe skip (3,827 total)**. It exposed two obsolete assertions: `terminal snapshot reports no reply, failed, timeout, owner lost and superseded honestly` omitted the new required empty `generation` effect array; `V6 proposes all creative shot fields and scene title independently of purpose` expected the contract-6 and contract-5 tool lists to be identical. The files reproduced **25 passed / 1 failed** and **5 passed / 1 failed** alone. Both assertions were updated for the card's new shapes; the two files then passed **32/32**. No behavior case or integrity check was removed, and neither failure was a timing flake.

# Contract changes

None to `packages/core/src/studio-api.ts`. The existing `DirectorGenerationEffect` shape is used as supplied; every turn snapshot now includes `effects.generation`.

Contract 6.0.0 itself gains `make_keyframes` and its schema/description in `tools.ts`, as explicitly authorized by K1. Earlier tool catalogs remain unchanged.

# Commits

No commits made; the lead owns review and commits under RULES.md. Proposed split:

1. `feat(director): start requested scene keyframes with request-owned effects`
   - Core tool descriptor and core-successor catalog assertion; server app runner wiring; authority/effects/keyframes/tool-invocation/turn-view code; scene generation/confirmation, retry eligibility and retained-audio fences; generation receipt persistence; keyframe/reconciliation/dispatch tests and existing review/supervisor effect assertions.
2. `feat(director): transcribe current-message owned audio attachments`
   - Attachment transcription helper; service attachment input and atomic publication hook; owned-transcription hook/cutoff forwarding; transcription tests. Tool and store integration belong with the corresponding shared files in the first commit, or combine both commits to keep every intermediate commit buildable.
3. `fix(director): retain saved v7 identities while amending conversation guidance`
   - V7 packages, host guidance, shipped pins/same-version upgrade logic, prior-identity fixture, director/catalog/runtime/guidance tests and this report. Catalog identity and guidance must land together with the new tool.

The shared files make one combined `feat(director): generate requested keyframes and transcribe owned attachments` commit a valid alternative.

# Open issues

- U1 integration boundary: this checkout has the attachment browser types but no U1 message-attachment ingestion route. K1 adds a validated, cloned, idempotency-bound `beginRequest(..., { attachments })` field and consumes those immutable exact refs. U1 must forward its validated attachment refs to that field and register audio in the existing owned audio path. The message route/Director attachment projection remains U1's responsibility; K1 deliberately does not duplicate it. K1 refuses missing/mismatched refs and tests the real trusted request boundary.
- Natural-language intent remains the Director's guided responsibility. The application enforces fresh human edit authority, structural request scope, explicit target IDs, and explicit shot IDs for regeneration; it does not pretend a keyword heuristic can prove the person's meaning.
- A conversational new take does not automatically resolve an existing regeneration note. Note resolution retains its explicit app-action receipt requirement; K1 does not introduce automatic note acceptance.
- A voice refresh can replace the exact prior recording pinned when the run started. Later explicit recording selection, including A → B → A, fences completion; legacy runs without this new pin retain their strict prior behavior.
- Both earlier and amended unreleased 6.0.0/V7 identities remain in `SHIPPED_DIRECTOR_GUIDANCE`. Current creation selects the latest exact identity. Fresh-turn and explicit upgrade checks compare complete identities rather than version numbers, so saved earlier 6.0.0 projects upgrade without mutating their old locks or snapshots. The fixture test verifies both identities.
- No browser was launched, no real provider/native model call or external network request was made, no credentials/production data were read, and no port-3001 listener or production restart occurred. Rendered UI verification and U1 integration replay remain with the lead; synthetic/fake checks do not establish live media quality.
