# N1 — chat confirmation choices

## Done

- **N1.1 — typed confirmation.** Contract 6.0.0 `record_notes` accepts exactly `{ kind: "confirm_video", sceneId }`. Recording checks the existing scene and its scene/shot anchor; a cross-scene shot anchor cannot offer one scene's confirmation. The choice does not satisfy a blocking note's required accept/keep alternative. Explicit resolution needs a later local human application scene confirmation for that project and scene, with both request and confirmation event evidence; missing, earlier, foreign, wrong-scene and wrong-kind results are refused with `NOTE_RESULT_INVALID`. Resolution dispatches no work.
- **N1.2 — first action settles.** Scene confirmation atomically settles all matching open confirmation notes. Image regeneration atomically settles each open regeneration choice fully covered by that one press/run, including `make_keyframes` regeneration. Partial coverage does not accumulate across presses. Resolution carries the chosen index, exact result reference and `elsewhere: true`; competing later actions cannot replace it. Regeneration settles before changing frame evidence, inside the same transaction as publication, so its replacement cannot stale the resolved note. Proposal acceptance still settles atomically and now also marks `elsewhere`; declining a proposal deliberately leaves its note open with the proposal visibly rejected. Later resolution of any settled note is HTTP 409 `NOTE_ALREADY_SETTLED`.
- **N1.3 — guidance and compatibility.** Current host guidance and skills V7 offer per-scene chat confirmation, typed remake/proposal choices and the same action in Keyframes. Ambiguous yes/ok/go replies are never confirmation, and start claims require application evidence. V1–V5 catalogs and host guidance and V1–V6 skill packages retain their bytes/pins. The exact preceding 6.0.0/V7 identity remains in the shipped identity list; frozen fixture and automatic/manual upgrade tests cover both pre-K1 and pre-N1 branch projects.
- **N1.4 — fake Director.** The bounded V6 script recognizes explicit make/generate/create/start video/clips requests and offers nonblocking confirmation plus reply notes for ready scenes within the request scope. It supports editing and keyframe-review paths; historical/unready/default scripted reviews remain available. This path creates notes only.
- **N1.5 — regressions and review.** Added scope/evidence, zero-spend review, first-wins, simultaneous different-key confirmation, partial/full regeneration, Director action identity, changed-frame staleness, rollback and compatibility regressions. Existing double-charge, unknown-outcome, replay and stale-version protections remain enabled. Self-review and an independent review covered callers, transaction placement, result proofs, proposal alternatives and downstream staleness; neither found an outstanding backend must-fix issue. The full test suite passes; the required recursive typecheck is blocked by the unchanged lead-owned web model described under Open issues.

## Files

Changed server source:

- `apps/server/src/application/director-notes.ts`
- `apps/server/src/application/director-proposals.ts`
- `apps/server/src/application/director-input.ts`
- `apps/server/src/application/director-shipped-guidance.ts`
- `apps/server/src/application/fake-director.ts`
- `apps/server/src/application/film-planning-guidance.ts`
- `apps/server/src/scene-confirmations.ts`
- `apps/server/src/scene-generation.ts`

Changed schema/tests:

- `packages/core/src/tools.ts`
- `packages/core/test/guidance-successor.test.mjs`
- `packages/director/test/tools.test.mjs`
- `packages/director/test/skills-v7.test.mjs`
- `apps/server/test/director-guidance-maintenance.test.mjs`
- `apps/server/test/director-successor-host.test.mjs`
- `apps/server/test/director-notes.test.mjs`
- `apps/server/test/director-proposals.test.mjs`

Changed V7 guidance:

- `skills/v7/plan-authoring/SKILL.md`
- `skills/v7/plan-authoring/references/example.md`
- `skills/v7/plan-authoring/references/grammar.md`
- `skills/v7/production/SKILL.md`
- `skills/v7/production/references/continuity-review.md`
- `skills/v7/production/references/current-contract.md`
- `skills/v7/production/references/keyframes.md`
- `skills/v7/production/references/narration.md`
- `skills/v7/production/references/notes.md`
- `skills/v7/production/references/stages/narration.md`
- `skills/v7/production/references/stages/review.md`
- `skills/v7/production/references/stages/shot_plan.md`
- `skills/v7/production/references/stages/storyboard.md`
- `skills/v7/production/references/stages/video.md`

Added:

- `apps/server/test/chat-confirm-notes.test.mjs`
- `apps/server/test/fake-director-confirm.test.mjs`
- `apps/server/test/fixtures/director-guidance-v7-before-n1.json`
- `docs/ai/uiux-plan/codex/reports/N1-chat-confirm.md`

Deleted: none. `tool-invocations.ts` required no edit: its current catalog validation and review-tool allowlist already dispatch `record_notes` safely. No web source, `studio-api.ts`, DDL, historical skill package or implementation-status file was changed.

## Tests

Added **26 tests**: chat/settlement 9, fake Director 9, proposal-decline 1, schema 1, V7 text 1, and host/pin/upgrade 5. Deleted or disabled: **0**.

Rewritten existing behavior assertions:

- Two regeneration-note cases now expect automatic settlement and a later `NOTE_ALREADY_SETTLED`, preserving exact result and linked-proposal rejection checks.
- Two proposal-note cases now expect the same settled refusal instead of acknowledging an already accepted proposal through a second command.
- Existing current-catalog/package pins and descriptor, keyframe-guidance, host-surface and identity-list expectations now reflect N1. Historical version pins remain unchanged. Existing pre-K1 upgrade tests were extended to include pre-N1, retaining the earlier cases.
- Two older successor-host guidance tests now assert typed chat confirmation, ambiguous-reply refusal and application start evidence instead of workspace-only wording. Their V5 compatibility assertions remain, and zero-spend assertions cover notes, grants, candidates, attempts and reservations.

Initial development checks found two text-assertion mismatches and two new fixture mistakes: deterministic fake images had identical hashes, and a foreign-project test attempted an invalid store write. Corrected the text expectations, used different valid fake SVG bytes/hash through normal execution, and supplied a separately owned foreign-project record. No production assertion was relaxed to fix these failures. The initial backend batch was 200/202; its two failures were `only a matching later human scene confirmation can resolve a confirm_video choice` and `keyframe regeneration settles covered choices only and resolved visual evidence stays settled`. The corrected chat file passed 9/9 in isolation; the guidance group passed 91/91.

The first full run returned **3,950 passed, two failed, one optional skip (3,953 total)**. The failures were the two superseded wording assertions in `director-successor-host.test.mjs`: `6.0.0 host context names the new fields and scene actions while 5.0.0 keeps its locked wording` and `contract-6 host guidance directs requested keyframes and eligible attached transcription while keeping video human-only`. That file passed **5/5** in isolation after the rewrite described above; no production change was needed. The complete suite was then rerun.

Final verification on October 27, 2026:

| Command/check | Actual result |
| --- | --- |
| `pnpm setup:test-media` | Passed, pinned tools already present; no download |
| `pnpm check:toolchain` | Passed: Node 24.15.0, pnpm 10.33.0, FFmpeg/ffprobe 8.1.1 |
| `pnpm build` | Passed, all five package/app builds; also passed in each full test run |
| `node scripts/run-tests.mjs <13 touched/related files>` | **293/293 passed**, zero failures/skips |
| `node scripts/run-tests.mjs apps/server/test/director-successor-host.test.mjs` | **5/5 passed**, zero failures/skips, after its two obsolete assertions were rewritten |
| Final `pnpm test` | **3,952 passed, zero failed/cancelled/todo, one optional skip (3,953 total)** |
| `pnpm -r typecheck` | Failed at the unchanged web model's three TS2366 errors |
| `pnpm -r --no-bail typecheck` | **4 package/app passes, 1 failure**: core, providers, director and server pass; web fails with those same three errors |
| `git diff --check` | Passed |

The 13-file group consists of `packages/core/test/guidance-successor.test.mjs`, `packages/director/test/{skills-v7,tools}.test.mjs`, and `apps/server/test/{director-guidance-maintenance,director-guidance-source-failures,chat-confirm-notes,fake-director-confirm,director-notes,director-proposals,scene-confirmations,scene-generation,director-keyframes,keyframe-review}.test.mjs`. The optional skipped test is `opt-in native Codex probe never starts a model turn`.

## Contract changes

- **No changes to `packages/core/src/studio-api.ts`.** Implemented the lead's existing `confirm_video` choice and `DirectorNote.resolution.elsewhere?: true` shapes.
- New stable resolve refusal: **HTTP 409 `NOTE_ALREADY_SETTLED`** for an already resolved note, including proposal notes. A successful original resolve command still replays its saved receipt with the same idempotency key. A new key cannot resolve it again. `REVISION_CONFLICT` remains for other note-version mismatches; `NOTE_RESULT_INVALID` remains for invalid action evidence.
- Only the unreleased 6.0.0 note grammar/descriptions and V7 guidance were amended. Current whole-catalog pin: `5967c822a2c77bdc9be1218d31fb9c354a08c836c664f4a0450eb4b18a479336`; handler pin: `4a4d340f74977cc9f4a946f5c2f8005e361a695978cdbceba295a9b8e7da95e6`. Current plan-authoring/production pins: `e1c2d030049e99717e8c3efc977677de1501d4fd1d19f898ce547f0f3e1cb1aa` / `7ef5d5d27cd5b78eac5979cd2468de67c130239d495755abbdee97323eda4fba`.

## Commits

No commits made, per card rules. Proposed split:

1. `feat(director): offer typed chat confirmation choices` — `packages/core/src/tools.ts`, both changed package test directories' files listed above, `director-input.ts`, `film-planning-guidance.ts`, `director-shipped-guidance.ts`, `director-guidance-maintenance.test.mjs`, `director-successor-host.test.mjs`, the before-N1 fixture, and all 14 changed V7 guidance files.
2. `feat(server): settle Director choices with human scene actions` — `director-notes.ts`, `director-proposals.ts`, `scene-confirmations.ts`, `scene-generation.ts`, `fake-director.ts`, both existing note/proposal test files, both new behavior test files and this report.

## Open issues

**Required typecheck blocker, owned by the lead:** `apps/web/src/next/model/notes.ts` omits `confirm_video` in three exhaustive switches: `choiceLabel` at line 52, `settledMsg` at line 99 and `action` at line 109. Each returns TS2366. Both the `NoteChoice` union containing `confirm_video` and this web model are unchanged from HEAD (`git diff HEAD -- apps/web packages/core/src/studio-api.ts` is empty), so the incomplete caller integration already exists in the assigned baseline. The N1 card explicitly says **"Do not edit `apps/web`"**, and RULES rule 2 assigns the web to the lead. No web workaround or contract narrowing was made. The lead must implement the three cases and rerun recursive typecheck; an all-green repository gate is not claimed.

No unresolved backend decision. Other decisions for the lead:

- Shared effect routes do not distinguish a chat-origin press from a workspace press. Both settle their matching notes with `elsewhere: true`. The chat's subsequent resolve therefore receives `NOTE_ALREADY_SETTLED`; refresh and show the saved resolution as done.
- Regeneration result references are the human press's request ID, or the distinct `scene_generation_action` ID for a Director `make_keyframes` run. One Director human request can own several scene actions; using its request ID for all of them would lose the exact action identity.
- Automatic settlement applies only to notes that are currently open before the effect. Stale notes stay stale; existing explicit action-result resolution can settle them only with valid later evidence. Existing read-only/automatic note-writing rights are unchanged, and offering choices grants no execution authority.
- Proposal rejection keeps the note open and its version unchanged. The proposals read/snapshot exposes that linked proposal as `rejected` with its `noteId`; hide/disable its unavailable Accept while allowing other note choices. Proposal acceptance marks the note resolved elsewhere; Undo still reopens it under existing rules.

The lead's sample film must mirror every following rule:

1. Validate `confirm_video.sceneId` against a scene anchor or shots entirely inside that scene; it never replaces a blocking note's keep choice.
2. A successful scene confirmation settles every matching open `confirm_video` note once, incrementing its version and saving choice index, confirmation ID and `elsewhere: true`.
3. A regenerate press/run settles each open regeneration choice only when that one action covers all its shot IDs. A partial action does not settle the larger choice. Ordinary missing-keyframe generation does not settle regeneration choices.
4. Preserve the first saved resolution across later effect routes and image/shot changes; settled notes never become stale because their effect changed the evidence.
5. Proposal Accept settles atomically with `elsewhere: true`; Reject leaves an open note with a rejected proposal; alternate choices reject held linked proposals. Undo retains the existing reopen behavior.
6. A new resolve of a settled note returns `NOTE_ALREADY_SETTLED`; invalid or non-later action evidence returns `NOTE_RESULT_INVALID`; other version conflicts retain `REVISION_CONFLICT`. Same-key success replay remains exact.
7. Scene confirmation across different keys on the same reviewed state admits one purchase. A second stale/running press starts no work and must not be retried automatically with another key.
8. Recording/pointing to choices and ambiguous chat replies start no work. Chat uses the same current frames, Opened proof, recipe, price, blockers and idempotent human effect routes as Keyframes. Claims of started work require the application receipt.

Browser replay remains with the lead under `RULES.md`; no browser was launched. All validation uses disposable local state, synthetic media/fake providers and fake Director runtimes. No real model/media call, external network request, credential read, production-state access/restart or port-3001 listener occurred.
