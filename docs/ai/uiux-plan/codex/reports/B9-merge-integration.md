# B9 integration with B7, B8, B11 and B6

## Done

Resolved the six conflicted working-tree files without discarding either card's behavior. Read B7's confirmation report and the B8, B11 and B6 reports before integration. No Git command other than `git diff` and `git status` was run for this task. The lead owns staging and completing the merge.

Conflict resolutions:

- `apps/server/src/app.ts`: retained Director proposal and take-route imports/registration, B5 notes, B11 project/library routes and B6 export handling. Kept B7's runner creation, its `enqueueKeyframes` callback on scene generation, and confirm/fit registration. Each route is registered once.
- `apps/server/src/narration/narration-scope.ts`: retained B9's alongside requests and latest-session capability checks. Replaced B7's host-only `directEdit` flag with alongside `holdScopeIds` options. Runner and fit sessions explicitly request no automatic hold, preserving B7's own scene hold and deterministic session/checkpoint identities. Browser shot sessions still use their own scoped holds. Explicit continuation invalidates an old session capability without revoking the Director or borrowing another request's authority.
- `apps/server/src/narration/shot-audio-routes.ts`: retained B7's exported `createShotAudioWorkspace` extraction, B11's narrator-default resolver, and B9's field audit and scoped hold release inside that shared workspace. HTTP and the durable runner use the same validation/publication code.
- `apps/server/src/scene-generation.ts`: kept the thin HTTP route and extracted `generateScene`. B9's regeneration concurrency now lives in the shared command; B7's supplied original confirmation actor/grants remain authoritative. Kept B5's open-blocking-note and note-digest checks before publication and after asynchronous compilation. Kept B8's retained takes, dependent clips and replacement-success behavior. Alongside requests do not become the scene's latest Director request.
- `apps/server/src/storyboard.ts`: retained B11's `sceneTitle`, `deleteScene` and `moveScene`, their schemas/caps, and their hold-free behavior. All storyboard commands use alongside ownership. Kept B8's `input`/`undo` snapshots and media/canonical restoration after project publication, together with B9's human-field audit in the same transaction.
- `apps/server/test/shot-audio-http.test.mjs`: kept both B9 concurrency tests and B11's narrator-default test as separate complete cases, plus the automatically merged personal-voice and scene-order expectations. No case was discarded to resolve the conflict.

Additional integration boundaries:

- Replaced reintroduced `directEdit` call sites in `scene-confirmations.ts`, `narration-fit.ts` and `shot-takes.ts` with the single alongside mode. Explicit hold selection preserves their previous hold-free application requests while the confirmation retains its own scene hold.
- Proposal-note choices now return from the note route only when acknowledging a resolution already saved by proposal acceptance, with the matching accepted proposal, choice and `resultRef`. The note route cannot create a new resolution even if given an accepted proposal ID. Both the original pre-accept version and current resolved version may acknowledge that same result without events or note mutation.
- Human field events include entity creation/deletion/restoration and scene fields. Deleting a scene and undoing it cannot erase an older turn's field fence by returning the old values/IDs. Ordinary updates still protect only their changed fields.
- Proposal previews include B8's retained paid output while replacement is pending instead of claiming there is no media yet.
- New B7 audio steps freeze the effective narrator voice when the human press is captured. A later B11 project-default change affects future commands, while the queued line retains its captured voice across restart. Existing frozen speech inputs remain unchanged; no new browser field is introduced.

## Files

Resolved conflicts:
- `apps/server/src/app.ts`
- `apps/server/src/narration/narration-scope.ts`
- `apps/server/src/narration/shot-audio-routes.ts`
- `apps/server/src/scene-generation.ts`
- `apps/server/src/storyboard.ts`
- `apps/server/test/shot-audio-http.test.mjs`

Additional integration edits:
- `apps/server/src/application/director-notes.ts`
- `apps/server/src/application/director-proposals.ts`
- `apps/server/src/application/human-fields.ts`
- `apps/server/src/scene-confirmations.ts`
- `apps/server/src/narration-fit.ts`
- `apps/server/src/shot-takes.ts`
- `apps/server/test/director-proposals.test.mjs`
- `apps/server/test/scene-confirmations.test.mjs`
- `apps/server/test/narration-fit.test.mjs`
- `apps/server/test/storyboard.test.mjs`
- `docs/implementation/STATUS.md`
- `docs/ai/uiux-plan/codex/reports/B9-merge-integration.md`

No source/test file deleted. Incoming staged web, library, export and other card changes were retained; no web source was edited during conflict resolution. No schema or dependency change was introduced by this integration.

## Tests

Nine new cases cover acknowledgment-only proposal resolution; retained-take previews; all three B11 scene commands preserving Director authority/holds; scene deletion plus Undo preserving the old-turn field fence; durable runner sessions and unrelated Director holds across restart; narration-fit/Undo with old-turn field protection; and queued narrator-default capture across restart. (The three scene-command cases are generated by one table.) All pre-existing tests, including both sides of the conflicted test tail, remain.

Validation:
- `pnpm setup:test-media` and `pnpm check:toolchain`: pass with Node 24.15.0, pnpm 10.33.0, FFmpeg/ffprobe 8.1.1. Existing local tools matched; no download.
- `pnpm build`: passed.
- `node scripts/run-tests.mjs apps/server/test/director-proposals.test.mjs apps/server/test/director-notes.test.mjs apps/server/test/scene-confirmations.test.mjs apps/server/test/narration-fit.test.mjs apps/server/test/takes-undo.test.mjs apps/server/test/storyboard.test.mjs apps/server/test/shot-audio-http.test.mjs apps/server/test/shot-narration-scope.test.mjs apps/server/test/storyboard-export.test.mjs apps/server/test/generation-overview.test.mjs apps/server/test/project-library.test.mjs apps/server/test/asset-library.test.mjs`: **169 passed, 0 failed, 0 skipped**.
- `pnpm test`: **2,678 passed, 0 failed, 1 optional native-probe skip (2,679 total)**.
- `pnpm -r typecheck`: **all five workspace packages passed, 0 failures**.
- Conflict-marker scan of server source/tests and `git diff --check`: pass.

Tests use disposable databases, fake providers and injected synthetic speech/media. No live provider/model call, credential read, external network request, production edit/restart or port 3001 listener was made. B6 export checks and B8 takes/media-restoring Undo run as regressions alongside the new concurrency cases.

## Contract changes

None introduced by this resolution in `packages/core/src/studio-api.ts`. The incoming B7 public additions are retained. The captured per-step voice and narration-session hold selection are internal records/options only.

## Commits

None made. No staging, commit or merge-continuation command was run. Proposed lead commit: `fix(studio): reconcile alongside edits with durable scene commands and undo`, covering the resolved and additional integration files above as part of the in-progress merge.

## Open issues

- The six source/test conflicts are resolved in the working tree. Their index entries remain `UU` because the user explicitly restricted Git commands to `git diff` and `git status`. The lead must stage those six paths, stage the additional integration edits, and complete the existing merge. No index manipulation was attempted.
- Review the explicit hold choices: runner/fit/use-take requests use alongside with no automatic holds; the confirmation's scene hold and other request-owned holds remain separate. Ordinary shot-edit sessions retain their scoped hold until save/acceptance.
- Review the note-route acknowledgment rule: acceptance must resolve the actual linked note; an accepted proposal ID alone cannot settle a later or otherwise unresolved note.
- Review the additive voice checkpoint: new commands freeze the effective voice at the press, and old checkpoints retain their existing saved speech input. Real-provider quality and browser acceptance remain separate from this offline merge verification.
