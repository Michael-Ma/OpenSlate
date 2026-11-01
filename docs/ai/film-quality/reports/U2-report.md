# U2 — The Director sees uploads

## Implemented

1. Both fake and native `LocalDirectorController` supervisor preparation paths now prepare code-film attachments in the private native workspace. They use the real attachment projector, preserve its unreadable-extraction versus fatal-integrity policy, and bypass graph keyframe preparation.
2. Code-film upload preparation runs before the turn's film/context snapshot. `read_film` and every turn's `context.film` expose the newest 24 distinct supplied-image hashes, with owned artifact literals and measured dimensions/bytes. Fixtures, generated pictures and other films are excluded. The public `CodePlanView` is unchanged.
3. `read_clip_frames` also displays an owned picture: hash-checked, at most 32 MiB input, no enlargement, at most 1536 px on the long side, JPEG quality ladder and 1.5 MiB output bound. Image metadata is the new union member; video metadata is unchanged. Frame-range options are ignored for pictures. Tool replay regenerates transient JPEG content and stores only metadata.
4. `LocalMediaService.reducedPicture` snapshots/hash-checks the source, selects its decoder from content, tries 2048/1536/1280/1024/768 px PNGs, and publishes the first fitting reference through `LocalImageStore.ingest`. `code_plan_image_reference` links the source and ordinary derived artifact. Preparation is sequential and idempotent. Permanent failures retain the original with `imageReferences: false`; busy, shutdown and quarantine leave no row for a later retry. Assets hides copies and marks the original current when its copy conditions a video.
5. Instructions cover exact upload literals, larger attachment originals, untrusted names, subject continuity, inspecting pictures, and avoiding duplicate upload requests. The current skill/API reference and guidance pin are updated. Archived 0.1.0/0.2.0 guidance and catalogs are untouched. Fresh 0.3.0 epochs move from the previous guidance/catalog lock to the current lock.

The generated test PNG really contains 2880×2880 FFmpeg noise: **19,378,501 bytes**. Reduction tries the larger candidates and selects **1280×1280, 3,318,151 bytes**. The real installed-model dry-run accepts this copy for both `ctx.image({references})` and `ctx.video({firstFrame})`; the original is refused for image references. No provider dispatch occurs.

## Regression before and after

Before changing production source, added and built the two supervisor regression cases, then ran:

```
node scripts/run-tests.mjs apps/server/test/code-plan-uploads.test.mjs
```

Result: **0 passed / 2 failed / 0 skipped**. Both `fake supervisor prepares a code-film JPEG attachment in its workspace` and `native supervisor prepares a code-film JPEG attachment in its workspace` fail at `input.images?.length`: actual `undefined`, expected `1`. Evidence: `/tmp/openslate-u2-before.log`.

After the change, both original regressions pass: the projected file is a real JPEG within that film's native workspace, `attachedMaterial.attachments[0].readable` is true, a projection receipt exists, and `messageAttachmentViews` is readable. Additional fake/native regressions import a real JPEG through `ImageApplicationService` before attaching it, covering the production normalization path as well.

The new upload file has **18 tests**, covering later turns and read-tool replay, foreign/corrupt/oversized inputs, real large-PNG reduction and model dry-run, idempotence, permanent/busy/shutdown/quarantine failures, Assets visibility/current linkage (including an unrelated-picture negative case), exact legacy catalog pins, fresh old-0.3.0-lock tools, listing order/deduplication/bounds, valid-small-image reuse, and operation without a configured media service. One existing backup test is extended to verify the derived file and exact source/reference row survive export and inspection. No existing tests were deleted, disabled or rewritten to drop protected behavior.

## Verification

- `pnpm setup:test-media` and `pnpm check:toolchain`: passed; Node 24.15.0, pnpm 10.33.0, FFmpeg/ffprobe 8.1.1. No download needed.
- `pnpm build`: all five workspace builds passed.
- Touched tests: upload suite **18/18 passed** standalone; backup suite **20/20 passed** in the broader targeted run. The final full run also covers the added exact-catalog and fresh-turn tool assertions.
- `pnpm test`: **5,059 passed / zero failed / two optional skips (5,061 total)**; zero cancelled/todo, exit 0. The full run includes all required attachment, Director, review, end-to-end and catalog/guidance-pin suites. Evidence: `/tmp/openslate-u2-full-test.log`.
- `pnpm typecheck` (includes `pnpm -r typecheck`): all **five** workspace typechecks passed, zero failures.
- Lint: this repository defines no lint script or linter configuration. `git diff --check`, a whitespace scan of all **14** changed/added files, and `node --check` on both touched `.mjs` tests pass; TypeScript is checked by the workspace typechecks. No linter was installed or fetched.

An earlier broad targeted pass returned 140/141: the sole failure was a new test's JPEG variable shadowing its input bytes. That test bug was fixed; the subsequent 18/18 upload run passed. An earlier backup assertion exposed the unpublished directory issue described below; it was corrected before the broader gate. Neither failure was timing-sensitive. The final full run had no failures, so no timing-sensitive file needed a rerun. Its quiet final tail was the long skills-release suite, which completed normally without interruption.

## Review and decisions

Self-review checked both callers, turn snapshot ordering, artifact ownership/hash checks, metadata-only replay, derived-row atomicity, recoverability, catalog compatibility, Assets joins and backup closure. It found and fixed:

- A separate `artifacts/image-references` namespace would fail the existing explicit backup file allowlist. Copies now use the ordinary `artifacts/images/blobs` store. The existing backup test proves the exact bytes and entity mapping survive; no backup implementation or schema change is required.
- Video reference mode can have no `firstFrame`. Guarding the optional derived reference prevents an `undefined` set lookup from incorrectly marking unrelated images current. A negative regression pins this.

No requested product behavior was declined. The in-place descriptor change affects only the unreleased 0.3.0 catalog. Its digest moves from `2e3e1c106143fd4316b4fbdfe3e946cea5bf9ab2a82e0893cbb3970b42e96d99` to `81ec5a9290ad8e66909c89f316ef148bcf5dea7c2a3e4baa86ecd42ce61fea30`. Current guidance digest is `d9007ffc049781a8fb71f773f874fad79384ba7d7162477e0820bfa69c07170e`.

## Files and handoff

Changed:
- `apps/server/src/application/director-capabilities.ts`
- `apps/server/src/application/local-director.ts`
- `apps/server/src/code-plan/artifacts.ts`
- `apps/server/src/code-plan/assets.ts`
- `apps/server/src/code-plan/clip-frames.ts`
- `apps/server/src/code-plan/director.ts`
- `apps/server/src/media/local-media.ts`
- `apps/server/test/installation-backup.test.mjs`
- `packages/core/src/tools.ts`
- `skills/code-plan/SKILL.md`
- `skills/code-plan/references/studio.d.ts`

Added:
- `apps/server/src/code-plan/uploads.ts`
- `apps/server/test/code-plan-uploads.test.mjs`
- `docs/ai/film-quality/reports/U2-report.md`

Deleted: none. All source files are named by the card; the backup test is allowed by its test-ownership clause. No web source, browser contract, DDL, schema version or other card source was edited.

Both supervisor preparation functions are driven directly, using injected offline setup/runtime ports for the native path and the real projector/FFmpeg/local media services. The native model itself is not started; visual understanding by a live Director and real-provider quality remain unverified. Real installed-profile dry-run validation uses the existing offline provider fixture and makes no network request. No browser, protected state, external network, real provider/native-model call, port 3001 listener or commit was used.

Suggested single conventional commit for the lead: `fix(director): make uploaded pictures visible and reusable in code films`, containing all files above. The descriptor, guidance and their pin should land together with the implementation and regressions.
