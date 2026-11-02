# K2b — read generated pictures

## Scope and implementation

`readClipFrames` now decodes pictures with the local FFmpeg process wrapper, selecting the input demuxer with `imageInputArgs(imageFormat(bytes))`, as `LocalMediaService.reducedPicture` does. It writes one plain PNG in the existing disposable review directory, strips metadata, and scales the long side to at most 1536 pixels without enlargement before canvas loads it. The JPEG quality ladder (85, 65, 45, 25) and 1.5 MiB output bound are unchanged. Returned metadata uses the stored picture dimensions, not the reduced review dimensions.

The original ownership check, snapshot/hash check, 32 MiB picture bound, 25-second operation signal, 24-second media-process timeout, and final temporary-directory cleanup remain. Video decoding is unchanged apart from sharing the already-existing process-wrapper closure with the picture branch. No image, artifact, media step or derived reference is persisted by review.

Unsupported picture formats, FFmpeg decode failures, and failures loading the transient PNG become `DomainError("CODE_PLAN_ARTIFACT_INVALID", "The picture could not be read")`. Other existing media domain errors, including cancellation, timeout and unavailable tools, retain their codes. The tool layer therefore saves a definitive failed receipt for unreadable pictures; its existing successful-replay behavior needs no change.

## Before and after

The regression constructs a complete 3072×1536 PNG, inserts a 22 KiB `caBX` payload immediately after `IHDR`, and calculates the PNG CRC over its type and data. The payload is synthetic metadata containing an embedded `<svg` marker, not a signed C2PA credential. An all-zero `caBX` payload alone did not reproduce the canvas failure; the embedded marker reproduces it with `@napi-rs/canvas` 0.1.100.

Before rebuilding the changed decoder, the final test file against the unchanged compiled implementation returned **18 passed, 4 failed, 0 skipped**:

- The new `caBX` regression failed at the direct source `loadImage` call with `InvalidArg: Invalid SVG image`.
- The generated-image regression completed normal Codex-image ingestion but its tool read threw `TOOL_CALL_UNRESOLVED`.
- Unrecognized picture bytes also became `TOOL_CALL_UNRESOLVED`; a damaged PNG was incorrectly accepted by canvas.

After rebuilding the changed decoder, all four regressions passed in both the focused and full suites. The `caBX` test returns a JPEG at 1536×768, metadata at the stored 3072×1536, the correct JPEG hash/length within 1.5 MiB, unchanged original source bytes, and no new database entities.

## Tests

Four tests added to the existing uploads file; none rewritten, deleted or disabled:

1. Correct-CRC `caBX` PNG, downscaling, stored dimensions, bounded JPEG and unchanged source/no persisted entities.
2. A new code film's real image-step execution and ingestion using the existing synthetic Codex transport. Its generated `fixture: false` artifact retains the credential chunk and output-spool lineage. Tool reading must end `succeeded`; replay via a new tool service must rebuild the same JPEG while retaining one metadata-only receipt, no extra entities and one image dispatch. The small image is not enlarged.
3. Unknown picture bytes with a matching hash must yield a `failed` tool receipt with `CODE_PLAN_ARTIFACT_INVALID`; exact failed-call replay preserves that receipt.
4. A recognizable PNG with damaged compressed data exercises FFmpeg's decode failure and the same failed-receipt behavior.

Existing upload, integrity, ownership, size refusal, video contact-sheet, frame-range and replay tests are retained.

## Verification

- `pnpm check:toolchain`: passed with Node 24.15.0, pnpm 10.33.0, FFmpeg/ffprobe 8.1.1 and required encoders.
- `pnpm setup:test-media`: passed; matching local tools were already installed, no download occurred.
- `pnpm build`: passed for all five workspaces before and after the source change.
- `node scripts/run-tests.mjs apps/server/test/code-plan-uploads.test.mjs apps/server/test/code-plan-review.test.mjs`: **38 passed, 0 failed, 0 skipped**, 13.785 seconds.
- An earlier focused run returned 37 passed / 1 failed because the new generated-path test's teardown could not remove sealed skill snapshots (`ENOTEMPTY`). Per the requested retry rule, reran the entire uploads file: 21 passed / the same 1 teardown failure. Fixed cleanup in the owned test by making those disposable snapshot directories writable in `finally`; the final 38-test focused gate passed. No shared fixture or production permission behavior changed.
- `pnpm test`: **5,109 passed, 0 failed, 2 skipped, 0 cancelled, 0 todo (5,111 total)**, 726.576 seconds. Skips: the installed decoder's unsupported animated WebP fixture (which returns the documented `IMAGE_FORMAT_UNSUPPORTED`) and the opt-in native Codex probe.
- `pnpm typecheck` (package build followed by `pnpm -r typecheck`): **all five workspace typechecks passed**, zero errors.
- `git diff --check`: passed.

Local evidence logs: `/tmp/openslate-k2b-tests-before.log`, `/tmp/openslate-k2b-build.log`, `/tmp/openslate-k2b-focused-final.log`, `/tmp/openslate-k2b-full-test.log`, `/tmp/openslate-k2b-typecheck.log`.

## Self-review

Reviewed the complete source/test diff, both `readClipFrames` callers (initial tool read and succeeded replay), shared image-format/process helpers, stored dimensions, transient-file lifetime, JPEG bounds, and error classification. The generated-path fixture was corrected to bind its epoch to the code-plan tool contract before recording the final baseline reproduction, and its sealed-snapshot cleanup was fixed after the repeated teardown failure. No remaining material issue found in the owned change. The final focused/full-suite/type checks passed.

## Files and contract

- Changed: `apps/server/src/code-plan/clip-frames.ts`.
- Changed: `apps/server/test/code-plan-uploads.test.mjs`.
- Added: `docs/ai/film-quality/reports/K2b-report.md` (this required report).
- Deleted: none.
- Contract changes: none. No `studio-api.ts`, web, schema, catalog or other card-owned source edits.
- No commits made. Proposed single commit: `fix(server): decode generated picture reviews through FFmpeg`, containing the three files above.

## Coverage limits

All validation is offline with synthetic media/metadata, disposable databases and injected provider transport. No original production picture/database or protected configuration was read; no real Codex/media-provider request, external network, browser or port-3001 listener was used. This covers the production generated-image execution/ingestion/tool path, but does not claim a new live Codex generation or replay of the original production film. C2PA signature validity is outside the regression: only a structurally valid PNG chunk with correct CRC is required to exercise this decoder failure.
