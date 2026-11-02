# U1 · Every picture, clip and sound the studio can decode uploads and reaches the Director

Read `docs/ai/uiux-plan/codex/RULES.md` first; its hard rules apply in full. This card may also edit `apps/web/src/next/model/assets-import.ts`, its test, and `apps/web/src/next/i18n/catalog/assets.ts`. Nothing else in `apps/web/**`.

## Problem

The owner cannot attach pictures in the Director's composer: "工作室无法读取这个文件，它可能已损坏，或是 FFmpeg 不认识的格式。" Five real imports failed, all JPEG, 89 KB to 3.8 MB.

**Root cause, reproduced on FFmpeg 8.1.1.** `LocalImageStore.normalizeUpload` writes `source.jpg` and passes `-format_whitelist jpeg_pipe` with no `-f`. FFmpeg probes the file. `jpeg_pipe` scores 51 only when the end-of-image marker is inside the probe window. On any normal JPEG it scores lower, `image2` wins with 50 from the file extension, and the whitelist then refuses it: `[image2] Format not on whitelist 'jpeg_pipe'`. The result is `MEDIA_TOOL_FAILED`, which the web shows as "unreadable". The tests pass because their fixture is a 584-byte solid red JPEG.

The owner's requirement: every medium the model APIs accept must work, not only JPEG.

## Change

1. **Choose the demuxer, do not let FFmpeg guess.** Detect the format from magic bytes and pass `-f <demuxer>` with a matching whitelist. Apply this everywhere a whitelist is used on a picture: `apps/server/src/media/local-images.ts`, `apps/server/src/application/keyframe-projector.ts`, `apps/server/src/application/director-images.ts`.
2. **Accept these pictures:** PNG, JPEG (baseline, progressive, grayscale, CMYK), WebP (lossy, lossless), GIF, BMP, TIFF, AVIF, HEIC and HEIF. Detect by content, never by extension. Decode failures on a format this FFmpeg build cannot decode (for example AVIF without an AV1 decoder) give `IMAGE_FORMAT_UNSUPPORTED` with a message naming the format.
   - Animated GIF and multi-frame TIFF use the first frame. Animated WebP: use the first frame if this FFmpeg can decode it, otherwise refuse with a message that says animated WebP is not supported.
   - SVG is refused with a clear reason, in the browser and on the server.
   - HEIC from an iPhone is a tile grid. Handle it if FFmpeg 8 exposes it as a stream group, and test with a grid fixture if you can build one offline; report what you found.
3. **Large pictures are scaled down, not refused.** Phone photos are 12–48 MP and the store's limit is 4096 per side and 8 294 400 pixels. Decode up to 100 MP, then scale to fit, keeping the aspect ratio, and store PNG. This covers PNG as well: a PNG inside the limits stays byte-identical as it does today, a larger one is re-encoded. Keep the 32 MiB input limit.
4. **Respect orientation.** A portrait photo with EXIF orientation 6 must store as portrait. Test it.
5. **Video and audio.** Walk every entry of `VIDEO_EXT` and `AUDIO_EXT` plus the formats the model APIs take: video mp4 (H.264, HEVC), mov, m4v, webm (VP9, AV1), mkv, avi, mpeg, flv, wmv, 3gp; audio wav, mp3, m4a, aac (raw ADTS), flac, ogg, opus, aiff, weba. `INPUT_OPTIONS` in `local-media.ts` has no `aac`, `aiff`, `mpeg`, `flv` or `asf`. Add what is safe, check the same probing trap does not exist there, and make each one upload, or be refused before upload with a clear reason.
6. **Browser checks** in `assets-import.ts`: `IMPORT_ACCEPT`, the image type and extension sets, the header comment and the `other_image` path must match the server. Add `IMAGE_FORMAT_UNSUPPORTED` to `refusalMsg`. `capabilities.acceptedFormats` lists the real set.
7. **Words.** The refusal must not say "FFmpeg" to a person. Rewrite `assets.refusal.unreadable` in plain English and Chinese, and any other user text this touches. The same rules apply as the rest of the catalog: short, concrete, what to do next.
8. **Retry.** A file that failed under the old code must import when sent again with the same `Idempotency-Key`.
9. **Tests.** Add `apps/server/test/upload-formats.test.mjs`, which drives the real HTTP upload routes:
   - samples are generated with FFmpeg from noise or `testsrc2`, so each is well past the probe window; include a 200 KB+ JPEG named `.jpg` and `.jpeg`, this is the regression test;
   - each picture format is uploaded, stored as PNG with the right size, and shown to the Director through `messageAttachmentViews` as readable;
   - skip a format with a logged reason when the pinned toolchain has no encoder or decoder for it, and print the list of skips;
   - 24 MP JPEG scaled to the limit, EXIF orientation, animated GIF first frame, SVG refused, truncated JPEG refused, resend after failure.
   Extend the existing unit tests in `local-images.test.mjs`. Also run the same matrix once against `/opt/homebrew/bin/ffmpeg`, which has more decoders than the pinned build (`libdav1d`, for example), and put the result table in your report.

## Files you own

`apps/server/src/media/**` (image and media input only, not `local-timeline.ts`), `apps/server/src/application/director-images.ts`, `apps/server/src/application/keyframe-projector.ts`, `apps/web/src/next/model/assets-import.ts` and its test, `apps/web/src/next/i18n/catalog/assets.ts`, tests.

Do not edit `docs/implementation/STATUS.md`; put the entry you would add in your report.

## Report

Write `docs/ai/film-quality/reports/U1-report.md`: the format table with result per FFmpeg, what changed, checks run with counts, anything you could not do.
