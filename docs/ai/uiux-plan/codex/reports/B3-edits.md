# B3 — edits leave the Director and other shots alone

## Done

- **SB-1:** Storyboard commands opt into `beginRequest({ directEdit: true })`. They keep existing requests and epochs active, record their normal message/revision/edit audit, and do not inherit another request's holds. Detaching shot bindings creates only shot holds, released inside the same commit transaction. Rollback restores bindings, holds, messages and command identity. Music, reorder and scene/shot insertion never create holds. Existing head-version checks still reject a Director apply prepared before the edit.
- **SB-12:** Treatment and scene edits compare image/video intent per shot before invalidating bindings. Unchanged paid picture/audio and candidates survive; timeline/render bindings and actual dependent nodes are still invalidated.
- **SB-8:** A duration below its accepted within-shot narration returns HTTP 409 `SHOT_SHORTER_THAN_NARRATION`, with `error.details = { shotId, narrationFrames, requestedFrames }`. Equal duration succeeds; unrelated and unaccepted cues do not impose a floor. Rejection makes no writes.
- **GR-16:** Scene busy checks intersect running/queued Director requests and pending answerable questions with the scene, or exact selected shots for a shot press. The same checks run again after compilation and in the commit transaction. Scene presses use additive `supersede: "intersecting"` request options, preserving unrelated requests, epochs and holds. Whole-film scopes still intersect everything. Missing legacy scope is treated conservatively as whole-film.

## Files

Changed:
- `apps/server/src/app.ts`
- `apps/server/src/application/service.ts`
- `apps/server/src/scene-generation.ts`
- `apps/server/src/storyboard.ts`
- `apps/server/test/storyboard.test.mjs`
- `apps/server/test/scene-generation.test.mjs`
- `apps/server/test/service.test.mjs`

Added:
- `apps/server/src/application/request-scopes.ts`
- `docs/ai/uiux-plan/codex/reports/B3-edits.md`

Deleted: none. No web files, database migrations or provider changes.

## Tests

23 new test cases cover live-turn preservation, only-shot holds observed during commit, unrelated dispatch, hold-free music/order/insertion, paid output preservation on Brief/Story/scene edits, commit rollback and same-key retry, exact narration-floor errors, stale Director apply, unrelated questions/queued/running turns, scene/shot/film intersections, sibling-shot questions, same-key paid replay, and a question arriving during compilation.

Three old expectations were rewritten because B3 replaces them: direct-edit durability now expects an active epoch; consecutive direct edits no longer retain their own holds; partial-film prompt edits preserve an unrelated request's original holds instead of inheriting them. No test was deleted. Existing money/integrity tests remain, including unknown submissions, late completion, exact frame review, idempotency and stale version refusal.

Final validation, in the order required by RULES.md:

- `pnpm setup:test-media`: existing pinned FFmpeg/ffprobe pair already matches; no download.
- `pnpm check:toolchain`: passes with Node 24.15.0, pnpm 10.33.0, FFmpeg/ffprobe 8.1.1 and required encoders.
- `pnpm build`: all five package builds pass.
- `node scripts/run-tests.mjs apps/server/test/storyboard.test.mjs apps/server/test/scene-generation.test.mjs apps/server/test/service.test.mjs`: **79 passed, 0 failed, 0 skipped**.
- `pnpm test`: **2,503 passed, 0 failed, 1 skipped; 2,504 total**. The skip is the existing opt-in native Codex probe (`opt-in native Codex probe never starts a model turn`).
- `pnpm -r typecheck`: **5 packages passed, 0 failed** (core, providers, director, server, web).
- `git diff --check`: passes.

All validation used disposable fixtures and local tools. No live-provider experiment, production restart, port 3001, schema migration or browser edit was required. The existing web bundle-size advisory remains informational; builds pass.

## Contract changes

None to `packages/core/src/studio-api.ts`. The narration error's documented details are exposed only for that error code; other internal error details remain private. `beginRequest` options are additive and default callers retain their old semantics.

## Commits

No commits created, as required by RULES.md. Proposed conventional split:

1. `feat(server): isolate storyboard edits and scope scene requests` — `apps/server/src/application/service.ts`, `apps/server/src/application/request-scopes.ts`, `apps/server/src/scene-generation.ts`, `apps/server/src/storyboard.ts`, `apps/server/src/app.ts`, the three changed test files. These files form one verified component because the scene/edit integration tests exercise both request modes.
2. `docs(ai): record B3 implementation and validation` — this report.

## Open issues

No implementation blocker identified. Decisions for lead review:

- The card's explicit no-revocation requirement governs storyboard edits, including edits during in-flight media. The older general epoch-fencing wording and gap risk's legacy fallback are superseded for this path. `directEdit` is an internal opt-in capability; ordinary conversation requests retain their previous behavior. In-flight receipts remain durable and detached candidates cannot publish late output or trigger a blind retry.
- Brief, Story and scene purpose currently do not contribute to either shot intent digest, so wording-only edits preserve all shot media. The comparison uses actual before/after shot digests, rather than assuming every shot changed. Timeline/render invalidation remains.
- Previously owned holds are preserved, not silently transferred or cleared. New storyboard holds do not survive their command. Existing explicit continuation remains available for older holds.
- SB-8 follows the card's exact reject-with-details behavior. It does not rewrite historical invalid narration placements or change the playback response shape.
- Recommendations/held proposals and their settlement are P4 work. No recommendation endpoint, request-source schema, Stop behavior or browser change is introduced by B3.
