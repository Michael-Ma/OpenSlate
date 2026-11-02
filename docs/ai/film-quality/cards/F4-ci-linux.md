# F4 · CI on Linux passes: CJK caption fonts and upload format samples

Read `docs/ai/uiux-plan/codex/RULES.md` first; its hard rules apply in full. F1, F2 and F3 run at the same time: stay out of `apps/server/src/studio-launcher.ts`, `apps/server/src/index.ts`, `apps/server/src/code-plan/index.ts`, `view.ts`, `models.ts`, `apps/server/src/application/provider-catalog.ts` and `apps/web/src/**`. You own `.github/workflows/ci.yml`, `scripts/test-media-toolchain.json`, the toolchain setup and check scripts, `apps/server/test/upload-formats.test.mjs`, `apps/server/test/film-quality-render.test.mjs`, new fixtures under `apps/server/test/fixtures/`, and the caption font lookup only if a test seam is missing.

## Problem

CI run 41496905996 on `main` (ubuntu-24.04) failed 13 of 5,224 tests; all pass on the owner's Mac. The full log is at `/private/tmp/claude-501/-Users-michael-SideProject-OpenSlate/72ad4e96-05c6-43a3-b1fc-50ac771fee4e/scratchpad/ci-41496905996.log`.

1. **Five caption tests** (`film-quality-render.test.mjs`): `Caption 1: no CJK system font is available (PingFang SC, Hiragino Sans GB, Heiti SC, Noto Sans CJK or Microsoft YaHei)`. One of them, "real code-plan execution persists all edits…", fails its dry run for the same reason.
2. **Eight upload format tests** (`upload-formats.test.mjs`: AVIF, HEIC, HEIF, HEIC grid, HEIC primary item, 48-tile HEIC, mp4 HEVC, WebM AV1): the tests build their samples with the pinned FFmpeg, and CI's FFmpeg 8.1.1 is compiled with only x264 (`libsvtav1` and `libx265` are missing: "Unrecognized option 'svtav1-params'").

## Change

1. **Fonts.** Install a CJK font in CI that the existing lookup accepts (for example `fonts-noto-cjk` in the apt step), and confirm the lookup finds it on Ubuntu 24.04 (its file paths, or fontconfig). Make `pnpm check:toolchain` report a clear failure when no CJK font is present, so a missing font is caught before the tests.
2. **Decoding comes first.** The product must decode these uploads on Linux too. Check which libraries the pinned FFmpeg needs to *decode* AV1 (dav1d), HEVC and HEIF/AVIF stills, and add those to the CI and Linux toolchain build (`scripts/test-media-toolchain.json`, the setup script and the apt step), keeping macOS unchanged. If adding a decoder changes the cache key, that is expected.
3. **Samples do not need encoders.** Replace on-the-fly sample encoding with small committed fixtures (a few KB each, generated once on the Mac with the current commands, with a short README saying how), so the tests exercise decoding everywhere. Keep every assertion. If a sample genuinely needs to be produced at test time, require the encoder in the toolchain check instead of skipping.
4. No test is skipped or weakened to pass.

## Verify

You cannot run GitHub Actions. Show the fix as far as you can locally: the upload and caption suites pass with the fixtures; the toolchain check fails with a clear message when the CJK font or a required decoder is absent (simulate with an override); the workflow file is valid YAML and its apt packages exist on Ubuntu 24.04 (check package names against the Ubuntu archive). Run `pnpm test` and `pnpm typecheck`.

## Finish

Write `docs/ai/film-quality/reports/F4-report.md`: the cause of each failure, what changed, how a CI run should be checked, and anything you could not verify.
