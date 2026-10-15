# B1 completion report

## Done

- **DC-6 / GR-15:** Requests save the existing public `RequestSource` values (`user`, `app`, `director`). Every application-authored request call site supplies `app`. Snapshot conversation includes user requests and actual Director output; app/director request records remain available for audit. Director context pages separate `messages`, `applicationActions`, and `directorActions`, including coverage and guard digests. Director turn input labels application actions, and supplied import text is also available as attached material in planning context.
- **DC-6 legacy projection:** Opening a service projects source-less and former `storyboard` records once into sourced JSON rows. Matching uses request command-key prefixes and the exact historical copy/patterns in `application/request-source.ts`. Explicit sources and keyed question answers win. Projection fallback also supports records restored/inserted after opening. Stored command receipts, input captures, past turns and their digests are unchanged; legacy application keys still replay.
- **GR-8:** Scene image/video commands and controls require a nonblank, bounded Idempotency-Key and return 400 `IDEMPOTENCY_KEY_REQUIRED` otherwise. Authentication stays ahead of command handling. Existing store commands replay the original receipt and reject a changed body with `IDEMPOTENCY_CONFLICT`.
- **DC-12 / LG-19 / D5:** Audio tools prepare exact proposals and durable `director_audio_request` suggestions; receipts retain proposal identity/digest and add the pending request/action. They create no execution grant, candidate, attempt or reservation. Saved shot scripts can materialize narration sections during preparation. Current application guidance overrides historical locked spending instructions for all valid epochs. Audio request/publication boundaries require human actors, and generic Director plans cannot mint missing audio grants. Historical paid invocation reconciliation remains available. Frozen 1.0.0–4.0.0 descriptors and skill packages are unchanged.
- **LG-8:** Removed spending/allowance/budget route mounting and display modules. Retained trusted allowance issue/revoke and execution admission for historical jobs and fixtures, plus static historical budget receipt validation in Store. Removed the budget application writer and allowance display list. Retired SPENDING-REVIEW.md and removed the storyboard review script's obsolete mounting option/import.

## Files

Status is relative to this worktree's HEAD; A means added, M changed, D deleted.

- `M` `apps/server/src/app.ts`
- `D` `apps/server/src/application/allowance-projection.ts`
- `D` `apps/server/src/application/allowance-routes.ts`
- `M` `apps/server/src/application/application-capabilities.ts`
- `M` `apps/server/src/application/context-projection.ts`
- `M` `apps/server/src/application/director-input.ts`
- `M` `apps/server/src/application/external-allowances.ts`
- `M` `apps/server/src/application/film-planning-guidance.ts`
- `M` `apps/server/src/application/project-budget.ts`
- `M` `apps/server/src/application/service.ts`
- `D` `apps/server/src/application/spending-display.ts`
- `M` `apps/server/src/application/tool-invocations.ts`
- `M` `apps/server/src/generation-permission.ts`
- `M` `apps/server/src/index.ts`
- `M` `apps/server/src/media/image-routes.ts`
- `M` `apps/server/src/media/routes.ts`
- `M` `apps/server/src/narration/audio-library-routes.ts`
- `M` `apps/server/src/narration/audio-request-session.ts`
- `M` `apps/server/src/narration/narration-scope.ts`
- `M` `apps/server/src/narration/narration-speech-service.ts`
- `M` `apps/server/src/narration/owned-transcription-service.ts`
- `M` `apps/server/src/narration/personal-voice-routes.ts`
- `M` `apps/server/src/narration/routes.ts`
- `M` `apps/server/src/plan-imports.ts`
- `M` `apps/server/src/scene-generation.ts`
- `M` `apps/server/src/storyboard.ts`
- `M` `apps/server/test/allowance-routes.test.mjs`
- `M` `apps/server/test/api.test.mjs`
- `M` `apps/server/test/audio-request-flow.test.mjs`
- `D` `apps/server/test/audio-spending-display.test.mjs`
- `M` `apps/server/test/codex-spending-display.test.mjs`
- `M` `apps/server/test/external-allowances.test.mjs`
- `M` `apps/server/test/installation-recovery-http.test.mjs`
- `M` `apps/server/test/installation-recovery.test.mjs`
- `M` `apps/server/test/narration-speech-http.test.mjs`
- `M` `apps/server/test/owned-transcription-http.test.mjs`
- `M` `apps/server/test/owned-transcription-review.test.mjs`
- `M` `apps/server/test/prepared-change-publication.test.mjs`
- `M` `apps/server/test/project-budget.test.mjs`
- `M` `apps/server/test/scene-generation.test.mjs`
- `D` `apps/server/test/spending-display.test.mjs`
- `M` `docs/implementation/SPENDING-REVIEW.md`
- `M` `scripts/storyboard-review.mjs`
- `A` `apps/server/src/application/command-key.ts`
- `A` `apps/server/src/application/request-source.ts`
- `A` `apps/server/test/allowance-usage-fixture.mjs`
- `A` `apps/server/test/project-budget-fixture.mjs`
- `A` `apps/server/test/request-fixture.mjs`
- `A` `apps/server/test/request-source.test.mjs`
- `M` `apps/server/src/application/audio-operation-context.ts`
- `A` `docs/ai/uiux-plan/codex/B1-report.md` (this report)

## Tests

Pinned toolchain preflight passes (Node 24.15.0, pnpm 10.33.0, FFmpeg/ffprobe 8.1.1). `pnpm build` passes. The touched-file runner passes **200 tests, 0 failures, 0 skips**. `pnpm test` passes **2,446 tests, 0 failures, 1 optional native-probe skip (2,447 total)**. `pnpm -r typecheck` passes **5/5 workspace projects**. Final `git diff --check` passes. The full suite includes the existing money, replay, stale-version, media-provenance and unknown-outcome protections.

Added request-source, legacy migration/replay, context separation, keyed controls and scene command, pending audio proposal, human-only paid publication, Director plan refusal, retired-route/import and historical budget integrity tests. Rewrote the old automatic Director spending tests to require a human request while retaining scope, Stop, cancellation, stale input and unknown-outcome protections.

Retired tests for the removed spending display/projection and public budget/allowance writers. Kept the zero-dollar Codex finite-start/unknown-outcome test, external allowance admission/consumption/revocation tests, and historical budget immutability/restoration coverage. Display-only narration HTTP cases were removed; source-currentness and execution refusal remain covered by narration review/execution tests. Test-only allowance summaries now inspect durable admission receipts instead of the deleted application display helper.

`node --check scripts/storyboard-review.mjs` passes. The interactive review script was not launched. Tests and fixtures use only local fake/injected providers; no live media or Codex call was made.

## Contract changes

None to `packages/core/src/studio-api.ts`. No files under `apps/web` changed.

## Commits

No commits were created: RULES.md requires leaving the worktree for lead review. Proposed split (each source change together with its tests):

1. `feat(server): distinguish conversation from application requests`
   - Source: `apps/server/src/application/{request-source,service,context-projection,director-input,film-planning-guidance}.ts`, `apps/server/src/{app,generation-permission,plan-imports,scene-generation,storyboard}.ts`, `apps/server/src/media/{routes,image-routes}.ts`, `apps/server/src/narration/{routes,narration-scope,audio-request-session,audio-library-routes,personal-voice-routes}.ts`.
   - Tests: `apps/server/test/{request-source.test,request-fixture,scene-generation.test}.mjs` (source/conversation assertions).
2. `fix(server): require identities for scene and control commands`
   - Source: `apps/server/src/application/command-key.ts`, `apps/server/src/{app,scene-generation}.ts` (identity handling).
   - Tests: `apps/server/test/{api,request-source,scene-generation}.test.mjs` (command identity assertions).
3. `fix(director): prepare paid audio suggestions for human requests`
   - Source: `apps/server/src/application/{tool-invocations,application-capabilities,audio-operation-context,service,director-input,film-planning-guidance}.ts` (audio policy/suggestion/publication changes), `apps/server/src/narration/{narration-speech-service,owned-transcription-service}.ts`.
   - Tests: `apps/server/test/{audio-request-flow,prepared-change-publication}.test.mjs`.
4. `refactor(server): retire spending routes and projections`
   - Source: deleted `apps/server/src/application/{allowance-routes,allowance-projection,spending-display}.ts`, retained/reduced `apps/server/src/application/{external-allowances,project-budget}.ts`, mounting changes in `apps/server/src/{app,index}.ts`, `scripts/storyboard-review.mjs`.
   - Tests: changed `apps/server/test/{allowance-routes,codex-spending-display,external-allowances,installation-recovery-http,installation-recovery,narration-speech-http,owned-transcription-http,owned-transcription-review,project-budget}.test.mjs`; added `apps/server/test/{allowance-usage-fixture,project-budget-fixture}.mjs`; deleted `apps/server/test/{spending-display,audio-spending-display}.test.mjs`.
   - Docs: `docs/implementation/SPENDING-REVIEW.md`, `docs/ai/uiux-plan/codex/B1-report.md`.

Shared-file hunks should be split by the lead; do not stage whole shared files into the first commit.

## Open issues

- No implementation blocker remains within B1; B2–B4 and web integration remain outside this card.
- **Legacy classification decision:** Use command provenance first, then known exact app text and bounded historical templates. Source-less historical human text identical to old application copy is inherently ambiguous and is classified as app; explicit new `source: user` and keyed question answers are preserved. Unrecognized old text stays user text.
- **Compatibility decision:** Apply the no-Director-spending policy at the application layer to every valid epoch, including older locks, without changing frozen descriptors or historical receipts. Existing unknown jobs continue through their original reconciliation path.
- **Pending suggestion decision:** Keep the existing `ungranted` audio receipt shape and proposal identity, adding a durable pending suggestion/action. The person's existing paid audio route owns currentness and publication; a stale suggestion must be refreshed rather than silently rebased or submitted. No new command route or schema migration is needed.
- **Execution compatibility decision:** Keep the trusted allowance issuer/revoker because retained execution fixtures/history still exercise this model. It has no HTTP or Director entry point. Historical budget receipt validation stays for persistence/restore; the budget writer/display surface is removed.
