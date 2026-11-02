# K2b · `read_clip_frames` reads the pictures Codex makes

Read `docs/ai/uiux-plan/codex/RULES.md` first; its hard rules apply in full. You own `apps/server/src/code-plan/clip-frames.ts` and server tests. If you need another file, edit it and say so in your report.

## Problem

In a live film the Director called `read_clip_frames` on the film's three reference pictures. All three calls ended `unresolved` (`TOOL_CALL_UNRESOLVED`) within 40 ms, and the Director stopped instead of carrying on. The same happened once each in two earlier films. Calls on uploaded photos succeed.

Cause, reproduced on a copy of the database: Codex images are PNGs with a `caBX` chunk (C2PA content credentials, about 22 KB) between `IHDR` and `IDAT`. `loadImage` from `@napi-rs/canvas` 0.1.100 refuses them with `InvalidArg: Invalid SVG image`; with that chunk removed the same bytes decode. That error is not a `DomainError`, so the tool layer records the call as unresolved. FFmpeg and ffprobe read the file normally.

So today the Director cannot look at any picture Codex made, only at uploads.

## Change

In `readClipFrames`, decode a picture the way the video branch decodes frames: let FFmpeg read the source and write a plain PNG in the temporary directory, scaled so the long side is at most 1536 without enlarging, then `loadImage` that file and keep the existing JPEG quality ladder and `MAX_BYTES` bound. Use `imageInputArgs(imageFormat(bytes))` from the media code, as `LocalMediaService.reducedPicture` does, so every format the studio accepts is read the same way. Keep the hash check, ownership check, 32 MiB bound, timeouts and signal. Metadata `width` and `height` stay the stored picture's own size. Nothing is persisted.

A picture FFmpeg cannot read must fail as a `DomainError` (`CODE_PLAN_ARTIFACT_INVALID`, saying the picture could not be read), never as an unresolved call.

## Tests

In the existing clip-frames or uploads test file:

1. A PNG carrying a `caBX` chunk after `IHDR` (build it in the test with a correct CRC) returns a JPEG image block with the stored width and height. Show in your report that this test fails before the change.
2. A real generated-picture path: an image step's artifact in a code film, read through the tool layer (`tool_invocation` ends `succeeded`), and the replay of a succeeded call still rebuilds its image.
3. Unreadable picture bytes with a matching hash end `failed` with `CODE_PLAN_ARTIFACT_INVALID`, not `unresolved`.
4. Existing upload, video and refusal tests still pass.

## Finish

Run `pnpm test` and `pnpm typecheck`. Write `docs/ai/film-quality/reports/K2b-report.md`: what changed, the before and after of test 1, what you could not cover.
