# Q3 — the Director watches clips before cutting

Implemented offline in `codex/q3-review`. No commits or browser runs. Work is confined to Q3's owned files and this report.

## Done

1. **Contract 0.3.0.** The new catalog adds only `read_clip_frames`; 0.1.0 and 0.2.0 retain their descriptors and handler identities. `skills/code-plan-v2` is an exact copy of the previous 0.2.0 package, retaining digest `5a3a2ff56de93f43df6b15ba4c6d285264335b32e6bc2545e88fdb671c260c26`. Current package changes are limited to the manifest's contract/tool list and the one `review` API line. Its new digest is `689b629b61e7005dd0823057a10bfd3503e6d6f172fe959d4d3edfd94f182b41`. Old films keep archived guidance and media step identity.
2. **Watch tool.** An owned clip or render is copied to a private temporary directory, checked against its artifact hash, probed and sampled at render's 30 fps. FFmpeg decodes once with selected output frames. Canvas draws JPEG cells, frame/time labels and computes normalized RGB differences on 32×32 samples before labels. The first motion value is zero; subsequent values compare consecutive sampled pictures, rather than claiming semantic action recognition. Both fixture MP4s and ordinary normalized clips work. The frame interval is inclusive; defaults are frame 0 through the final frame, every 15 frames. More than 36 cells returns a suggested interval (or a narrower range for long films). JPEG size is at most 1.5 MiB and the longest sheet side at most 2048 px. Files are removed in `finally`; a 25-second operation deadline leaves bridge timeout headroom.
3. **Transport and receipts.** HTTP/bridge/stdio preserve separate MCP text and image blocks. Only frame metadata, sheet SHA-256 and byte count enter `tool_invocation`; no JPEG or base64 enters an entity. Repeating a successful call rebuilds its transient sheet with one durable metadata receipt. The existing 1 MiB receipt bound is unchanged; ephemeral image transport uses the existing 4 MiB bridge response bound.
4. **Review checkpoint.** `ctx.review(id, {clips,note})` is enabled only for 0.3.0 runtime locks. Its durable key binds the id and exact owned video references. Awaiting it stops the continuation with `reviewing`; existing attempts keep advancing. Preview creates no review entity. The current pass records reached review keys, and submitting a new plan clears them so an obsolete waiting checkpoint cannot start a turn. Note-only edits update display text without creating another review.
5. **Application turn.** The existing repair scheduler reconciles terminal reviews, then queues one sourced application request when the film has no active/queued turn, pending Director question, Stop or open hold. Context includes the id, note, clip descriptors and remaining review/retake opportunities. The message explicitly asks for actual frame evidence and cut decisions and identifies itself as application speech. The Director may submit a changed plan and buy replacement variants under the current ceiling. Existing person-source consent checks refuse both ceiling changes and `retry_step` in a review turn.
6. **Completion and bounds.** Terminal completed/interrupted/waiting-user turns mark the checkpoint done; failed or unknown turns mark it failed. The runtime wakes and replays the current plan. Failed checkpoints return null with one failure log line. At most three application review turns start per film; further checkpoints return null with one skip line. Durable request identities and the existing turn lease recovery prevent duplicate dispatch after restart. The view exposes current-pass reviews in first-seen order.
7. **Scripted Director.** A review reads each clip's contact sheet, then submits a demo wrapper that changes only render cut points. Generation inputs are preserved byte-for-byte. The offline test completes a trimmed render with no second media purchase. This is a bounded fixture script, not a claim that the fake Director understands pictures.

## Files

Changed:

- `packages/core/src/tools.ts`, `packages/core/src/studio-api.ts` (code-plan view only).
- `packages/director/src/tools/bridge.ts`, `packages/director/src/tools/stdio.ts`.
- `apps/server/src/application/director-capabilities.ts`, `fake-director.ts`, `tool-invocations.ts`.
- `apps/server/src/code-plan/director.ts`, `index.ts`, `records.ts`, `sandbox.ts`, `view.ts`.
- `skills/code-plan/openslate.skill.json`, `skills/code-plan/references/studio.d.ts` (review line only).
- `apps/server/test/code-plan-director.test.mjs`, `packages/director/test/tools.test.mjs`.

Added:

- `apps/server/src/code-plan/clip-frames.ts`.
- `apps/server/test/code-plan-review.test.mjs`.
- `skills/code-plan-v2/{SKILL.md,openslate.skill.json,references/studio.d.ts,references/example-plan.ts}` (unaltered archived copy).
- `docs/ai/film-quality/reports/Q3-report.md`.

Deleted: none. No web source, schema, STATUS, current SKILL/example or film-craft changes.

## Tests and verification

Pinned Node 24.15.0, pnpm 10.33.0, FFmpeg/ffprobe 8.1.1. `pnpm setup:test-media` used installed matching tools; `pnpm check:toolchain` passed without downloads.

Added regressions cover: image-block stdio transport; owned fixture clips and renders; bounded labelled sheets and motion; 37-cell and foreign/non-video refusal; no persisted image bytes; repeated read receipts; stop/hold/person/question precedence; in-flight completion; fake trim/replay without a second purchase; retake identity and the fourth-review skip; every terminal turn type; waiting, queued and expired-owner restart; obsolete checkpoint removal; consent denial; 0.2.0 guidance/API/step-key compatibility. One existing current-catalog assertion was updated to include the new tool. No tests were deleted or disabled.

Initial development failures were a stale current-catalog expectation, two mistakes in new test fixtures (SQLite `data` instead of `body`, and a nonexistent foreign project), and use of the removed TypeScript 7 compiler API in the first fake-edit implementation. These were corrected; the final fake edit needs no compiler API or new dependency.

Final gate results:

| Command / gate | Result |
|---|---|
| `pnpm build` | All five package builds passed. |
| `node scripts/run-tests.mjs <seven focused files>` | **146 passed, 0 failed, 0 skipped/cancelled/todo**; 16.398 seconds. |
| Full `pnpm test --test-timeout=180000 <normal seven file globs>` | **4,921 passed, 0 failed, 1 optional native-probe skip, 0 cancelled/todo; 4,922 total**; 1,928.784 seconds. |
| `pnpm -r typecheck` | Core/providers passed; web failed with TS2741: its `Record<CodePlanRunState, Msg>` lacks `reviewing`. Recursive execution stopped before director/server. |
| `pnpm --filter @openslate/director --filter @openslate/server -r typecheck` | Director/server both passed. Aggregate: **four backend typechecks passed, one web typecheck failed**. |
| `git diff --check` / ownership audit | Passed; 16 tracked files changed, 7 files added, none deleted or outside Q3 ownership. All four archived files match their pre-Q3 HEAD bytes exactly. |

The focused files are `apps/server/test/{code-plan-review,code-plan-director,code-plan-runtime,code-plan-sandbox,code-plan-e2e,tool-invocations}.test.mjs` and `packages/director/test/tools.test.mjs`. **18 tests were added**, one current-catalog expectation was rewritten for 0.3.0, and none were deleted/disabled. The last focused recheck includes the strengthened real pending-input event and archived-v2 guidance comparison.

The full-run file globs are exactly the normal runner defaults: `scripts/test/*.test.mjs`, `packages/{core,providers,director}/test/*.test.mjs`, `apps/server/test/*.test.mjs`, `apps/web/test/*.test.mjs`, and `apps/web/test/next/*.test.mjs`. The CLI timeout bounds each individual test; no assertion or test selection was relaxed.

The first broad run reported `stop during isolated keyframe composition prevents old paid publication` in unchanged `apps/server/test/director-keyframes.test.mjs`. Following the card's timing instruction, the entire file was rerun before classification: **33 passed, 0 failed**, including that assertion. It also reported `an edit during awaited preparation aborts the old signal and settles only that obsolete unstarted attempt` in unchanged `transcription-preparation-engine.test.mjs`; that assertion passed on its file rerun, which then stopped advancing at the later pause-after-dispatch case. The subsequent bounded whole-file recheck passed **24/24**, including both cases. No implementation or assertion in either file was changed.

The first broad run was interrupted without a final summary while `scripts/test/skills-release.test.mjs` and `scripts/test/test-toolchain.test.mjs` remained outstanding. Its observed assertions are not represented as completed suite totals. A second full run uses the exact normal seven file globs with Node's `--test-timeout=180000`, passed through the existing runner CLI, so an unresolved test wait is counted instead of waiting indefinitely. The standalone test-toolchain timeout check passed 7/7. The completed bounded-run totals are in the table above.

The separate release-script recheck passed **32/32**, taking **1,031.550 seconds** on this machine. This explains a prolonged quiet output interval; the first full run was interrupted too early to distinguish that slow work from a stalled run. The completed bounded full rerun supplies the final suite totals above.

The final focused gate's 15-second 768×1344 synthetic clip produced a **339,403-byte sheet in 573 ms**; the completed full run measured **1,383 ms**, both below the 30-second bridge limit. The generated sheet was visually inspected locally for frame/time labels and preserved portrait geometry; no browser was launched.

## Contract changes

`CodePlanRunState` adds `reviewing`. `CodePlanReviewView` has exactly `{id,note,state,clipCount,updatedAt}` with waiting/watching/done/failed states. `CodePlanView.reviews` is optional for compatibility with old clients/fixtures; the runtime always supplies an array. No other browser-facing shape changed.

New JSON entities: `code_plan_review`, `code_plan_review_request`. The existing run gains optional `reviewKeys`. No DDL or schema version change.

## Live check for the lead

No real Director/model/provider call was made: RULES.md prohibits external network in this card. The earlier `codex exec` stripe experiment in the card is supplied evidence, not a live app-server validation by this worktree.

Use a disposable local data directory and an ephemeral non-3001 server with the accepted native runtime. Keep all media execution on fixtures/synthetic owned media so this exercise cannot purchase real media. Bound the check to one native review turn before evaluating any rerun.

1. Prepare a short owned synthetic clip with a randomly chosen, recorded color/action order at known source frames, including a late visible change. Make its program await `ctx.review` before its render. Keep the expected order out of native text context so correct recognition establishes image visibility.
2. Confirm native setup selects the expected named permission profile and exact 0.3.0 MCP catalog, including `read_clip_frames`. The model should call it and report actual visual content with frame evidence; ask it to use a denser bounded range around the late change when needed.
3. Verify its visible interpretation against the synthetic ground truth and its submitted timeline against valid source frames. Observe one review request, one terminal turn, replay of the current plan, a completed local render and unchanged media-purchase count. Confirm the tool receipt contains only metadata/digest/byte count.
4. Record exact runtime/model versions, selected permissions, tool calls and result byte counts, elapsed time, answer accuracy, changed plan version and terminal outcome. Keep image payloads out of application entities. If a turn becomes unknown, reconcile its saved turn/plan/attempt receipts before another dispatch.

### Native app-server differences from `codex exec`

These are source-inspected boundaries, not observed live behavior:

- OpenSlate launches `codex app-server --strict-config`, validates the pinned runtime/configuration, selects the `openslate_local` named permission profile on thread/turn creation, disables model shell/file tools, and advertises only epoch-locked MCP tools. The profile permits reading the workspace projection/snapshots and Node executable, with network disabled. Tool approval mode is configured per catalog entry. A standalone exec experiment does not prove this launch/permission/catalog path works; record any actual native denial in the bounded check.
- Frame extraction runs in the application server, outside the native model workspace. Native Codex needs the returned MCP image block; it needs no artifact-directory or FFmpeg filesystem access.
- The application HTTP bridge permits 4 MiB per response and 30 seconds per call. A maximum 1.5 MiB JPEG expands to 2 MiB of base64 plus small metadata. Stdio has an output-frame bound of 8 MiB + 4096 bytes. Native JSONL additionally has a 4 MiB line bound and a 16 MiB aggregate stdout bound per run (stderr separately bounded). Several large tool results in one review can exhaust the native aggregate bound even though each image fits; do not infer unlimited multi-clip capacity from the exec experiment. These runtime limits are outside Q3 ownership and are unchanged.
- Native defaults are 60 seconds for cold preparation, 15 seconds for individual RPC acknowledgments and 180 seconds for the complete turn. Host overrides retain existing bounds. They are distinct from the MCP bridge's 30-second tool-call limit.
- Native item events publish activity, not raw tool payloads, into application state. Assistant text remains ordinary persisted conversation. The test suite checks no image bytes in the actual code-review entity path.

## Self-review and open issues

Self-review checked callers, old contract pins, receipt reconciliation, current-version replay, stale waiting checkpoints, terminal/restart paths, input ownership, image-size/deadline bounds and the file ownership diff. It corrected note-only display updates, reset reached reviews on plan replacement, preserved the 0.2.0 handler for lost-reply reconciliation, and kept image bytes out of the durable receipt path. Compatibility tests compare against the archived v2 example so Q1 can independently change the current example.

**Required UI integration:** `apps/web/src/next/model/code-plan.ts:112` needs a `reviewing` entry in `STATUS`, with an appropriate message/localization and the lead's review presentation. Q3's required public-state addition exposes this exhaustive-map gap; the card assigns web changes to the lead. The full runtime test suite passes, while the complete workspace typecheck remains red until that UI work lands. No web file was edited.

Lead integration: the UI is intentionally left to its owner. Integrating Q1/Q2/Q4's current guidance/API additions must recompute the current package digest; leave the archived 0.2.0 copy unchanged. `retakesLeft` is the remaining review opportunities after this turn (initially two), not a USD balance or an independent authorization to retry a failed attempt. Failed/unknown reviews deliberately continue the film; they do not certify picture quality. Existing media reservations, unknown-outcome reconciliation and spending ceiling remain authoritative.

The scripted edit supports a default function fixture and trims render placements; arbitrary artistic editing and real-native picture comprehension remain the live acceptance above. Old artifact records without measured dimensions/posters expose zero for unknown dimensions in review context; `read_clip_frames` returns probed dimensions. Media tools use the same host PATH/OPENSLATE_FFMPEG/OPENSLATE_FFPROBE discovery order as startup. Tool selection and the native aggregate output limit should be checked on the lead's actual installation.

## Proposed commits (not created)

1. `feat(core): add code-plan review contract 0.3.0` — core tools/view, director-capabilities, current manifest/API line and archived `skills/code-plan-v2/**`.
2. `feat(director): transport bounded clip contact sheets` — clip-frames, tool-invocations, director bridge/stdio, transport regression.
3. `feat(server): replay durable Director clip reviews` — code-plan director/index/records/sandbox/view, fake-director, server regressions and this report.
