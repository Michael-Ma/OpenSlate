# N5 — assets, step inspection and crop warnings

## Done

- **N5.1 — code-film assets:** a separate journal projection uses `code_plan_step`, choices, the latest run declarations and poster associations. Succeeded steps supply their role and step key; `codePlanShotLinks` supplies explicit/legacy shot links; scene ids come from the run, without reading `project.shots`. Take numbers remain oldest-first per shot and picture/clip role. Current images require the reached step plus its chosen answer, reached-video first-frame use, or absence of a matching choice. Other reached successful steps are current. Imported media retain their existing roles. Poster artifacts are removed from code-film lists and exposed as optional clip/render thumbnails. The graph projection retains its existing fields/order/selection/labels, with only the requested optional dimensions added.
- **N5.2 — sizes:** pictures use their `ArtifactRecord` dimensions; clips/renders use their owned poster's dimensions. Unknown sizes are absent. Public references copy only artifact id, hash and kind.
- **N5.3 — details:** `CodePlanPort.stepDetail` and authenticated `GET /api/projects/:projectId/code-plan/steps/:stepKey` return the complete prompt/text/motion, input settings, owned first frame, measured output, latest-attempt call metadata and total attempt count. Unknown keys/projects return `NOT_FOUND`; graph mode returns `CODE_PLAN_MODE`. The new route is an allowed quarantine inspection. Reads do not replay or write.
- **N5.3 — adapter filtering:** Viggle H3, MiniMax H3, Seedance, fal video, Lyria, Codex image, OpenAI image and OpenAI speech have explicit mapping kinds. H3/image/speech transport descriptions take precedence; N2 video/Lyria use recorded immutable attempt scalars and mapping/dispatch digests. Only the card's scalar settings keys are considered. String token/ratio validation additionally excludes URL/path/header forms and known credential prefixes. Crop dimensions, task id and request digest are copied individually with type/syntax checks. No raw mapping, request, native session or receipt is serialized. Unrecorded fields remain absent.
- **N5.4 — crop warning:** a pure function counts explicit cover placements retaining less than 90% of the picture and rounds the worst percentage. Normalized timeline hashes resolve through project-owned clip posters. The five-clip 1344×768 → 1080×1920 shape reports `{ clips: 5, keptPercent: 32 }`. Portrait mild crops, contain/default fit and missing posters have no warning. No render/identity/execution changes or writes.
- **N5.6 — docs:** execution-engine documentation and implementation status updated.

## Files

Added:

- `apps/server/src/code-plan/artifacts.ts`
- `apps/server/src/code-plan/assets.ts`
- `apps/server/src/code-plan/fit-warning.ts`
- `apps/server/src/code-plan/step-detail.ts`
- `apps/server/test/code-plan-assets-prompts.test.mjs`
- `docs/ai/code-plan/reports/N5-report.md`

Changed:

- `apps/server/src/asset-library.ts`
- `apps/server/src/code-plan/index.ts`
- `apps/server/src/code-plan/port.ts`
- `apps/server/src/code-plan/routes.ts`
- `apps/server/src/code-plan/view.ts`
- `apps/server/src/application/recovery-routes.ts`
- `apps/server/test/code-plan-port.test.mjs`
- `docs/technical/EXECUTION-ENGINE.md`
- `docs/implementation/STATUS.md`

Deleted: none. No web source, browser contract, provider implementation, schema or dependency changes.

## Tests

**16 tests added** in `code-plan-assets-prompts.test.mjs`. They cover the exact serialized graph snapshot, graph image/poster dimensions, code roles/shots/takes/current state, imported-image role preservation, legacy shot links, long prompt/text/motion, output and normalized first-frame inspection, HTTP 404/mode/auth/quarantine boundaries, read-only state, eight adapter contamination cases, crop geometry and an actual offline adapter/render/restart flow. One existing port rejection test gains the new method. No old behavior tests were rewritten/deleted/disabled.

The contaminated mapping tests inject read shapes through a Store read wrapper: real Store receipt validators already reject several such writes. They therefore prove the HTTP projection's independent filtering rather than pretending those malformed mappings are valid provider receipts. The integration test uses the existing synthetic Codex/Viggle transports and real local media tools; it verifies actual persisted mapping layouts, crop dimensions, poster sizes, render warning and restart without another dispatch.

| Command | Result |
| --- | --- |
| `pnpm setup:test-media` | Passed; existing FFmpeg/ffprobe 8.1.1, no download. |
| `pnpm check:toolchain` | Passed: Node 24.15.0, pnpm 10.33.0, FFmpeg/ffprobe 8.1.1 and required encoders. |
| `pnpm build` | All five workspace builds passed. Existing Vite chunk-size/dynamic-import advisories only. |
| `node scripts/run-tests.mjs apps/server/test/code-plan-assets-prompts.test.mjs apps/server/test/code-plan-port.test.mjs apps/server/test/asset-library.test.mjs apps/server/test/code-plan-routes.test.mjs apps/server/test/code-plan-shots-posters-limit.test.mjs` | **87 passed / 0 failed / 0 skipped**. Includes both touched test files and existing asset/route/N4 guards. |
| `node scripts/run-tests.mjs apps/server/test/*.test.mjs` | **2,976 passed / 0 failed / 0 skipped**, 2,976 total; completed in 460.77 seconds. |
| `pnpm test` | **4,826 passed / 0 failed / 1 optional native-probe skip**, 4,827 total; completed in 644.22 seconds. No cancelled/todo tests. |
| `pnpm -r typecheck` | **5/5 workspace typechecks passed**, zero TypeScript errors (core, providers, web, director, server). |
| `git diff --check` | Passed; repeated at final handoff. |

Final focused/full-server logs: `/tmp/openslate-n5-focused.log`, `/tmp/openslate-n5-server.log`. The repository-wide test log is `/tmp/openslate-n5-full.log`; the typecheck log is `/tmp/openslate-n5-typecheck.log`. Initial focused attempts exposed only test-fixture issues (immutable record writes, missing attempt authority, undefined JSON fields and snapshot key order), which were corrected before the final passing focused and full-server gates.

## Self-review

Reviewed the complete source/test diff for graph callers, normalized input references, historical/current choice behavior, artifact ownership, adapter disclosures, pure crop computation and recovery-route access. Review corrections ensure the primary result is joined even if auxiliary artifacts are empty, a duplicate clip record lacking a poster cannot hide an available poster's size, and inherited property names cannot select an adapter mapping. No execution authority, attempt/result identity or render behavior changed. Final review found no remaining actionable N5 issue; ownership and whitespace checks passed.

## Contract changes

`packages/core/src/studio-api.ts`: **none**. The pre-existing `AssetItem`, `CodePlanStepView.fitWarning` and `CodePlanStepDetail` shapes suffice. The card-required internal `CodePlanPort.stepDetail(projectId, stepKey)` was added with its runtime/HTTP implementation. No further contract changes proposed.

## Commits

No commits made, as required by `RULES.md`; the lead owns review and commits. Proposed single component commit:

`feat(server): expose code-plan assets and step inspection`

File list: all six added and nine changed files listed above.

## Open issues and boundaries

- No unfinished N5 implementation or failing check. The optional native probe was skipped as expected; no live/native-provider acceptance is claimed.
- Render warnings require explicit positive render width/height and a known clip poster. Missing metadata is left unknown; inspection does not backfill, render or call a provider.
- `call` reports retained attempt intent and, when present, the exact recorded transport description. Its presence is not independent evidence that a request was accepted or charged. No missing task/crop/response is fabricated.
- No browser, real provider/native-model call, external network access, protected `.env*`/`secrets`/`.openslate` read, port-3001 listener, commit or push was performed. Tests use temporary state and fake transports, plus local FFmpeg/ffprobe. The pinned media tools were already installed; setup required no download.

## Lead review

Accepted as written. The secrets filter is an allow list, and the crop arithmetic matches the Tofu film (32%). Checked on a copy of the owner's Tofu film: 10 keyframes, 5 clips and 1 export, posters no longer listed as keyframes, shots grouped, every picture loads, and Film reports 5 clips at 32%. That check found one web bug outside this card: portrait pictures overflowed the shared viewer. It is fixed in the web commit after this merge.
