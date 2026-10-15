# B9 — held proposals and alongside human edits

## Done

- **DC-2 / D1:** Extended the explicitly unreleased 5.0.0 catalog with `propose_change({patch})`, restricted to the six approved shot fields and scene purpose. Read-only turns may propose without placing holds or creating generation authority. Durable proposals, exact tool receipts/reconciliation, an owned list route and keyed accept/reject/undo routes, and proposal-note acceptance are implemented. V6's repeated guidance now consistently proposes duration, narration and changes that outdate paid media; harmless text may still apply directly with its receipt. Catalogs and skill packages 1–4/V1–V5 are unchanged.
- **DC-3:** Pure `previewCreativePatch` and its digest cover Now/After fields, ordered per-shot and film seconds, keyframe/clip/voice effects and absent media. Scene durations can be summed from the scene-keyed timeline without another contract shape. Unrelated changes rebase; touched shot/scene revisions expire with `SHOT_CHANGED`. Shot data is also pinned because compact narration intentionally can keep its visual revision. Accept recomputes the live preview and refuses `PROPOSAL_PREVIEW_CHANGED`. The overview now identifies retained obsolete paid outputs as outdated rather than queued.
- **DC-4:** Accept saves before/after field values. Undo restores only still-matching fields, leaves later changes (and later accepted proposals) alone, returns the inverse preview and `leftAlone`, and reopens the linked note. Originally absent narration is restored as absent. Exact keyframe bindings survive duration acceptance and undo; no generation is started by either operation.
- **DC-5:** Unified B3's `directEdit` into `concurrency: "alongside"`, including owned audit/holds and scoped release. Storyboard field edits, proposal decisions, note resolutions, compact/full narration edits and narration fit preserve running Director epochs. Regeneration also uses alongside ownership. A typed new direction still interrupts. `HUMAN_EDITED_FIELD` checks the original captured turn against durable human field events, including ABA edits, derived prompt changes, narration drafts and canonical duration/voice changes; both preparation and publication are fenced. Unrelated alongside edits no longer supersede pending imports; exact reviewed IDs rebase while overlapping changes expire the draft. Alongside actions do not become the latest Director request for scene confirmation.

## Files

Changed:
- `apps/server/src/app.ts`
- `apps/server/src/application/director-notes.ts`
- `apps/server/src/application/film-planning-guidance.ts`
- `apps/server/src/application/service.ts`
- `apps/server/src/application/tool-invocations.ts`
- `apps/server/src/generation-overview.ts`
- `apps/server/src/narration/canonical.ts`
- `apps/server/src/narration/narration-scope.ts`
- `apps/server/src/narration/routes.ts`
- `apps/server/src/narration/service.ts`
- `apps/server/src/narration/shot-audio-routes.ts`
- `apps/server/src/plan-imports.ts`
- `apps/server/src/scene-generation.ts`
- `apps/server/src/storyboard.ts`
- `apps/server/test/director-notes.test.mjs`
- `apps/server/test/narration-http.test.mjs`
- `apps/server/test/plan-imports.test.mjs`
- `apps/server/test/shot-audio-http.test.mjs`
- `apps/server/test/shot-narration-scope.test.mjs`
- `docs/implementation/STATUS.md`
- `packages/core/src/index.ts`
- `packages/core/src/tools.ts`
- `packages/director/test/tools.test.mjs`
- `packages/director/test/runtime-fixture.mjs`
- `skills/v6/plan-authoring/SKILL.md`
- `skills/v6/production/SKILL.md`
- `skills/v6/production/openslate.skill.json`
- `skills/v6/production/references/continuity-review.md`
- `skills/v6/production/references/current-contract.md`
- `skills/v6/production/references/narration.md`
- `skills/v6/production/references/notes.md`
- `skills/v6/production/references/stages/narration.md`
- `skills/v6/production/references/stages/review.md`
- `skills/v6/production/references/stages/shot_plan.md`
- `skills/v6/production/references/stages/video.md`

Added:
- `apps/server/src/application/creative-rebase.ts`
- `apps/server/src/application/director-proposals.ts`
- `apps/server/src/application/human-fields.ts`
- `apps/server/test/director-proposals.test.mjs`
- `docs/ai/uiux-plan/codex/reports/B9-proposals.md`
- `packages/core/src/proposal-preview.ts`
- `packages/core/test/proposal-preview.test.mjs`

Deleted: none. No web source, DDL, shipped migration, historical catalog/skill, dependency or provider implementation changed.

## Tests

Added seven pure core/schema cases and 21 server proposal cases, plus two import-concurrency cases and three narration/session-concurrency cases. Coverage includes read-only/no-hold proposals, strict schemas, scope/principal/project refusals, replay/key conflicts, lost tool-response reconciliation, unrelated rebase, touched revisions/narration, changed preview/media, actual fake-media effects, selective/idempotent undo, absent narration, note reopen/accept, later accepted proposals, ABA human edits, stale prepared publication, atomic rollback, restored origin refusal and an actual running fake Director completing after alongside actions. Narration checks include synthetic uploaded audio, a seven-second match-audio fit and both compact/full writing sessions.

Rewritten expectations (no test deleted):
- B5's nonexistent/unavailable proposal choice now fails ownership validation; a real proposal choice resolves through the preview-bearing accept route. Existing note replay/staleness checks remain.
- The offline native-protocol fixture now advertises `propose_change` in V5, matching the real MCP catalog. The strict native inventory assertions remain unchanged; the V5 stdio test now forwards both notes and proposals exactly once.
- The unreleased V5 complete-catalog and handler digests are refrozen. V1–V4 digest assertions remain exact.
- The full narration HTTP test now expects canonical publication to release its own alongside hold; exact acceptance, replay, canonical provenance and zero grants/attempts remain required.
- A compact saved narration edit releases its own transient hold. The old test's hold-presence assertions now check that release; its exact frame preservation, old-video `TIMING_REQUIRED`, no image resubmission, correct fake accept count and no stale-video attempt assertions remain intact.

Verification:
- `pnpm setup:test-media` and `pnpm check:toolchain`: Node 24.15.0, pnpm 10.33.0, FFmpeg/ffprobe 8.1.1 and required codecs pass; existing local binaries matched, with no download.
- `pnpm build`: passed.
- `node scripts/run-tests.mjs packages/core/test/proposal-preview.test.mjs packages/director/test/tools.test.mjs apps/server/test/director-proposals.test.mjs apps/server/test/director-notes.test.mjs apps/server/test/plan-imports.test.mjs apps/server/test/shot-audio-http.test.mjs apps/server/test/narration-http.test.mjs apps/server/test/shot-narration-scope.test.mjs apps/server/test/director-guidance-maintenance.test.mjs apps/server/test/owned-transcription-http.test.mjs`: **149 passed, 0 failed, 0 skipped**.
- `pnpm test`: **2,560 passed, 0 failed, 1 optional native-probe skip (2,561 total)**.
- `pnpm -r typecheck`: **all five package typechecks passed**.
- `git diff --check`: passed.

Validation uses disposable fixture databases, synthetic audio and fake adapters. The bounded proposal media proof creates exactly one fake image and one fake video, then verifies accepting the duration change creates no additional dispatch. No live Codex/model or real media-provider call, production-data edit/restart, port 3001 listener, external network request, credential read or schema migration was made. Browser implementation and visual review are outside this backend card.

## Contract changes

None to `packages/core/src/studio-api.ts`. Existing `ProposalList`, `ProposalPreview`, `AcceptProposalInput` and `ProposalReceipt` shapes are used. Core-only helper/types and the explicitly unreleased tool catalog are extended.

## Commits

No commits made: `codex/RULES.md` rule 1 reserves all commits and merges for the lead. Proposed split:

1. `feat(core): compute creative proposal previews`
   - `packages/core/src/proposal-preview.ts`
   - `packages/core/src/index.ts`
   - `packages/core/test/proposal-preview.test.mjs`
2. `feat(director): add held proposals and alongside human edits`
   - All remaining files listed above: catalog/digest, server implementation/tests, V6 guidance, status and this report.

## Open issues

No unfinished B9 implementation or failing required check remains after the final verification below. Decisions for lead review:

- Extended/refroze 5.0.0 and V6 only under the card's explicit unreleased-branch permission; historical catalogs and skill bytes are untouched.
- The tool input is `{patch: {updateShots?, updateScenes?}}`; host code supplies prompt reconfirmation internally. Models cannot supply plan source, new takes, revisions, authority or grants.
- Proposal publication retains paid bindings/outputs and uses existing intent/prompt/readiness checks to outdate changed media. It does not clear immutable receipts or dispatch replacements. Duration-only edits preserve the exact keyframe. This is intentionally the creative-publish rule; direct storyboard operations retain their established candidate-detachment behavior. Both projections report the same media effect.
- Staleness is derived on read from pinned revisions/data and the originating message's existing recovery fence, matching the notes approach; GET does not mutate the proposal ledger. A superseded originating request does not invalidate a held proposal by itself.
- The accept endpoint requires the preview digest and resolves linked proposal choices atomically. The note route may acknowledge that saved acceptance through `resultRef = proposalId`; it cannot accept an unseen preview. This preserves the existing note input contract.
- Explicit session continuation retires the old session capability through the latest session head, including direct scoped mutation checks. It does not supersede another request or revoke a Director epoch. Existing transcription stale-session and replay tests remain unchanged.
- Opened narration sessions own their own holds. Compact writing releases its hold when saved; pending narration still blocks stale video. Canonical narration/fit releases only its own alongside holds, never another request's holds. Legacy sessions preserve their prior hold semantics until explicitly continued.
- Import field edits are permitted alongside interpretation; structural import-conflicting operations stay blocked. Rebase preserves exact reviewed IDs and refuses overlap, capability/plan drift or missing original revision evidence.
- New context capture is not a way to erase a turn's human-edit fence. The earliest captured cursor for that epoch remains authoritative; the Director must preserve the person's field.
- No user action is needed for this card. Lead review/merge remains the next workflow step. Keyframe projection/review turns and web rendering remain B10/UI work.
