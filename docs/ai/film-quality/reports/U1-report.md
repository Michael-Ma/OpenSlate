# U1 upload formats report

November 1, 2026. Worktree `codex/u1-upload`. Source remains uncommitted for lead review.

## Implemented

- Picture input demuxers come from magic bytes and are selected with both `-f` and the matching whitelist. This applies to upload decoding, PNG validation, Director attachment thumbnails, generated keyframe thumbnails and contact sheets. The generated PNG sequence explicitly selects `image2`.
- Uploads recognize PNG, JPEG, WebP, GIF, BMP, TIFF, AVIF, HEIC and HEIF. Stored artifacts remain validated, immutable PNG. Small PNGs retain their exact bytes; larger pictures decode within a 100,000,000 pixel cap and scale to at most 4096 per side and 8,294,400 pixels. The input byte cap remains 32 MiB. A 6000 × 4000 upload stores as 3527 × 2351.
- JPEG baseline/progressive/grayscale/CMYK and EXIF orientation 6 are covered. Orientation 6 changes the noisy 1200 × 800 JPEG to an 800 × 1200 stored portrait. Missing JPEG EOI is refused instead of silently repaired. GIF and TIFF take their first frame/page. Animated WebP either decodes its first frame or returns `IMAGE_FORMAT_UNSUPPORTED` explicitly naming animated WebP. SVG is refused before upload in the browser and by content on the server.
- FFmpeg 8.1.1 exposes HEIC grids as `Tile Grid` stream groups. Mapping the group alone selects four streams, not a composed picture. The importer validates the complete canvas, tile offsets and total decoded pixels, then stacks/crops tiles before scaling. Primary-item flags choose the main image/grid when auxiliary images are present. A generated four-tile HEVC/HEIF fixture stores a complete 640 × 360 PNG; pixel content is compared against an independently assembled expected mosaic. A second fixture covers 48 tiles. Full probe metadata for it is 191,612 bytes, so geometry-only compact probing with primary-item flags (17,507 bytes) and a bounded 256 KiB output allowance prevent ordinary phone grids from exhausting the old metadata budget. These are offline synthetic grids, not owner/iPhone files.
- Video/audio whitelists now include AAC ADTS, AIFF, MPEG program streams, FLV and ASF. The protocol whitelist remains `file`; playlist/concat/device/network inputs are not enabled. HTTP tests use extensionless staged inputs, so the requested container matrix also exercises probing without filename hints. All requested media extensions have matrix entries, including aliases `.jpeg`, `.mpg`, `.oga`, `.aif` and `.weba`.
- Browser chooser/types/extensions match the image set and expanded media set. Empty browser MIME types no longer route JPEG/HEIC/etc. through a PNG-only refusal. PNG preflight permits scaling up to 100 MP. English/Chinese import refusals give a concrete next action without mentioning FFmpeg. Image capability values advertise the supported container family, with decoder-dependent refusal on an unavailable build.
- Original upload bytes, hash, name, expected head and authority continue to bind idempotency. A failed old-decoder attempt can resend the same key and original body successfully, then replay the one receipt. Stale head, scope, cancellation, source hash and immutable publication checks remain in place.

## Format results

`pnpm setup:test-media` and `pnpm check:toolchain` pass, but this checkout has no managed restricted-build installation. The resolver selects `/opt/homebrew/bin/ffmpeg` and `/opt/homebrew/bin/ffprobe`, both **8.1.1**. Homebrew is built with libdav1d, libsvtav1, libx265, libvpx, libopus and libmp3lame. Passing the version/required-encoder preflight does **not** prove the restricted profile was built.

The restricted profile in `scripts/test-media-toolchain.json` uses `--disable-autodetect --disable-network --enable-libx264 --enable-zlib`. Neither its binaries nor an offline source archive were found in the checked local toolchain/cache locations. RULES.md forbids external network, so I did not download source or claim a second codec-build result. The matrix can target an installed restricted build with `OPENSLATE_FFMPEG_PATH` / `OPENSLATE_FFPROBE_PATH`; `U1_FIXTURE_FFMPEG_PATH` can independently select a richer offline fixture generator.

“Pass” below means the actual HTTP upload handler succeeded; each picture became a PNG of the expected size and `messageAttachmentViews` reported it readable after real thumbnail projection. Videos also reached a readable Director projection. Audio became a normalized owned recording. Fixtures use FFmpeg noise/testsrc2/sine; Pillow 9.5 packages progressive/CMYK/grayscale/WebP/multipage variants from FFmpeg-generated pixels. No binaries or media fixtures are committed.

| Input | Restricted pinned build | Homebrew 8.1.1 |
|---|---|---|
| PNG, small, byte-identical | Not available | Pass |
| JPEG baseline `.jpg`, 785,975 bytes | Not available | Pass |
| JPEG baseline `.jpeg`, 785,975 bytes | Not available | Pass |
| JPEG progressive | Not available | Pass |
| JPEG grayscale | Not available | Pass |
| JPEG CMYK | Not available | Pass |
| WebP lossy | Not available | Pass |
| WebP lossless | Not available | Pass |
| Animated WebP | Not available | Decoder cannot read it; HTTP unsupported refusal verified; decode-success case skipped |
| GIF still | Not available | Pass |
| GIF animated, first frame | Not available | Pass, exact first-frame comparison |
| BMP | Not available | Pass |
| TIFF still | Not available | Pass |
| TIFF multipage, first page | Not available | Pass, decoded pixel hash comparison |
| AVIF | Not available | Pass |
| HEIC single item | Not available | Pass |
| HEIF (`mif1`) single item | Not available | Pass |
| HEIC four-tile grid | Not available | Pass, complete mosaic comparison |
| HEIC 48-tile grid | Not available | Pass, 2560 × 1080 |
| HEIC primary image with auxiliary item | Not available | Pass, primary item selected |
| 24 MP JPEG | Not available | Pass, 3527 × 2351 |
| 24 MP PNG | Not available | Pass, 3527 × 2351 |
| JPEG EXIF 6 | Not available | Pass, portrait |
| SVG / truncated JPEG | Not available | Clear refusal, no artifact |
| Failure then same-key resend / success replay | Not available | Pass, one artifact |
| MP4 H.264 | Not available | Pass |
| MP4 HEVC | Not available | Pass |
| MOV | Not available | Pass |
| M4V (MP4 container) | Not available | Pass |
| WebM VP9 | Not available | Pass |
| WebM AV1 | Not available | Pass |
| MKV | Not available | Pass |
| AVI | Not available | Pass |
| MPEG / MPG | Not available | Pass |
| FLV | Not available | Pass |
| WMV (ASF) | Not available | Pass |
| 3GP | Not available | Pass |
| WAV | Not available | Pass |
| MP3 | Not available | Pass |
| M4A AAC | Not available | Pass |
| Raw ADTS AAC | Not available | Pass |
| FLAC | Not available | Pass |
| OGG / OGA Vorbis | Not available | Pass |
| Opus | Not available | Pass |
| AIFF / AIF | Not available | Pass |
| WEBA | Not available | Pass |

The matrix prints one machine-readable `U1_FORMAT_RESULTS` record and a complete skip list. The only expected local skip is animated WebP decode success; its unsupported HTTP response is tested before the skip. Missing format encoders/decoders produce explicit, logged skips on other builds. Unexpected fixture-generation or upload errors fail the test.

## Verification

| Command / scope | Result |
|---|---|
| `pnpm setup:test-media` | Pass; resolves Homebrew 8.1.1 |
| `pnpm check:toolchain` | Pass; Node 24.15.0, pnpm 10.33.0, FFmpeg/ffprobe 8.1.1 |
| `pnpm build` | All five workspace builds pass |
| Seven-file focused gate below | **137 passed / 0 failed / 1 decoder skip (138 total)** |
| Homebrew HTTP matrix, included in focused/full gates | **46 passed / 0 failed / 1 decoder skip (47 cases)** |
| Final uninterrupted `pnpm test` | **4,953 passed / 1 failed / 2 skipped / 0 cancelled (4,956 total)** |
| `node scripts/run-tests.mjs apps/web/test/next/composer-files.test.mjs` | **5 passed / 1 failed / 0 skipped (6 total)**; same deterministic old-copy assertion |
| `pnpm -r typecheck` | **All five workspace typechecks pass; zero failures** |
| `git diff --check` | Pass |

The full-suite failure is `a file chip says what it is, how the upload goes, or why it failed`, at `apps/web/test/next/composer-files.test.mjs:24`. The expected sentence is the old catalog copy. Its isolated rerun reproduces exactly the same comparison, so it is not called a timing failure. This test is outside U1's explicit web ownership; the exact lead change is under Open issues. The full suite's two skips are the optional native Codex probe and animated WebP decode success. Animated WebP's explicit HTTP refusal is verified before its success case is skipped.

Final focused command (after the successful build):

```sh
OPENSLATE_FFMPEG_PATH=/opt/homebrew/bin/ffmpeg \
OPENSLATE_FFPROBE_PATH=/opt/homebrew/bin/ffprobe \
node scripts/run-tests.mjs \
  apps/server/test/local-images.test.mjs \
  apps/server/test/image-http.test.mjs \
  apps/server/test/upload-formats.test.mjs \
  apps/web/test/next/assets-import.test.mjs \
  apps/server/test/image-application.test.mjs \
  apps/server/test/director-images.test.mjs \
  apps/server/test/director-attachments.test.mjs
```

The final full run completed in 2,803.136 seconds. Its synchronous skill-release tests caused a long quiet tail and ultimately all passed. An additional release/toolchain recheck and disposable instrumented copies were interrupted after confirming forward progress to reduce concurrent work; they are not claimed as completed gates. The first focused gate passed 135 with zero failures and one decoder skip (136 total), before adding 48-tile and primary-item regressions. A preliminary full run was intentionally interrupted to finish those corrections; only the uninterrupted final full run is counted above.

Local evidence logs: `/private/tmp/u1-build-final.log`, `/private/tmp/u1-focused-complete.log`, `/private/tmp/u1-full-final.log`, `/private/tmp/u1-composer-copy-recheck.log`, `/private/tmp/u1-typecheck.log`. These are disposable logs, not repository artifacts.

Added **52 tests** (47 HTTP matrix cases, two local-image units, two generated-keyframe regressions and one browser-model test). Initial focused runs exposed stale copy/code assertions, a mono fixture passed to the stereo-only native Vorbis encoder, the no-dimensions animated WebP path, and disguised SVG keyframe degradation. These were corrected before the final gates. No integrity tests were deleted or disabled. Two existing image-format/PNG-limit browser tests and the old 8.3 MP upload refusal test were rewritten for the new behavior; capability/copy/error-code expectations were updated. The generated JPEG regression is over 200 KiB for both `.jpg` and `.jpeg`, instead of the old solid-red sub-KiB fixture.

## Self-review

Reviewed the complete diff and new files for ownership, callers, failure behavior, publication and cross-file effects. Fixed the overlooked oversized-PNG import integrity check, empty-MIME browser preflight, zero-dimension unsupported animated WebP, preserved explicit keyframe omissions for disguised SVG, bounded geometry-only metadata for many-tile grids, and primary-image selection for auxiliary HEIF items. Added noisy JPEG generated-keyframe coverage for both individual thumbnails and contact sheets. Existing scope, stale-head, cancellation, file-integrity, immutable receipts and replay tests remain active.

## Files

Changed:

- `apps/server/src/media/local-images.ts`
- `apps/server/src/media/local-media.ts`
- `apps/server/src/media/image-application.ts`
- `apps/server/src/media/image-routes.ts`
- `apps/server/src/application/director-images.ts`
- `apps/server/src/application/keyframe-projector.ts`
- `apps/web/src/next/model/assets-import.ts`
- `apps/web/src/next/i18n/catalog/assets.ts`
- `apps/server/test/local-images.test.mjs`
- `apps/server/test/image-http.test.mjs`
- `apps/server/test/image-application.test.mjs`
- `apps/server/test/director-images.test.mjs`
- `apps/web/test/next/assets-import.test.mjs`

Added:

- `apps/server/src/media/image-input.ts`
- `apps/server/test/upload-formats.test.mjs`
- `apps/server/test/upload-format-fixtures.mjs`
- `docs/ai/film-quality/reports/U1-report.md`

Deleted: none. `local-timeline.ts`, all other web files, `STATUS.md` and the shared contract are unchanged.

## Contract changes

None to `packages/core/src/studio-api.ts` or any contract shape. `GET /images` adds the supported MIME values to its existing `capabilities.acceptedFormats` field. The shared contract's upload comment still names the older four-format subset; the lead can update that comment outside this card's ownership.

## Proposed commits (not made)

1. `fix(media): normalize supported uploads with explicit image demuxers`
   - `apps/server/src/media/{image-input.ts,local-images.ts,local-media.ts,image-application.ts,image-routes.ts}`
   - `apps/server/src/application/{director-images.ts,keyframe-projector.ts}`
   - `apps/server/test/{local-images.test.mjs,image-http.test.mjs,image-application.test.mjs,director-images.test.mjs,upload-formats.test.mjs,upload-format-fixtures.mjs}`
2. `fix(web): accept supported uploads and clarify import refusals`
   - `apps/web/src/next/model/assets-import.ts`
   - `apps/web/src/next/i18n/catalog/assets.ts`
   - `apps/web/test/next/assets-import.test.mjs`
3. `docs(uploads): record U1 format validation and limits`
   - `docs/ai/film-quality/reports/U1-report.md`

## Open issues and limits

- Full-suite copy assertion `a file chip says what it is, how the upload goes, or why it failed` in `apps/web/test/next/composer-files.test.mjs:24` expects the previous image-format refusal. This is caused by U1's intentional catalog rewrite. The card explicitly forbids editing any other `apps/web/**` file, so that test is unchanged. The lead should replace its expected text with: `This picture format cannot be read here. Export it as PNG or JPEG and try again. SVG pictures must be exported first.` The isolated rerun confirms the mismatch: five tests pass and this one fails. No runtime source or integrity assertion was relaxed to hide it.

- The distinct restricted pinned-build matrix remains unrun because the offline build/archive is unavailable. A lead/CI run with that binary is needed; the Homebrew result is not evidence of its decoder coverage.
- Homebrew cannot decode the generated animated WebP. Import returns a named unsupported refusal. Animated GIF is the tested animation alternative.
- Real iPhone photos, HDR/color-profile fidelity and HEIF grid orientation metadata were not tested; the grid proof uses generated SDR HEVC tiles. macOS `sips` HEIC encoding was attempted locally and failed with an IOSurface write error, so the test uses explicit ISO-BMFF grid packaging around FFmpeg-generated tiles instead.
- No browser, real provider/native-model call, external network, protected-state read or port-3001 listener was used. All HTTP tests use authenticated `app.inject` with disposable state. No commits or pushes were made.

## Proposed STATUS.md entry (not applied)

U1 normalizes supplied pictures by content with an explicit input demuxer, adds GIF/BMP/TIFF/AVIF/HEIC/HEIF, preserves small PNG bytes, scales uploads up to 100 MP within stored-image limits, honors JPEG EXIF orientation, and composes HEIF tile grids. Browser import checks and plain English/Chinese refusals match, and AAC/AIFF/MPEG/FLV/ASF media inputs are supported. Real HTTP format tests verify Director readability and same-key recovery after a decoder failure. The Homebrew 8.1.1 format matrix passes with animated WebP explicitly unsupported. The focused gate passes 137 with one decoder skip; full tests pass 4,953 with one old-copy assertion failure and two skips, and all five typechecks pass. The unowned composer assertion needs the new catalog sentence, and separate restricted-build decoder coverage remains pending. Source is uncommitted for lead review; no paid/native/browser validation is claimed.
