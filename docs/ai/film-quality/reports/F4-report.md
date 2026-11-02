# F4 · Linux CI media and caption prerequisites

Worktree: `codex/f4-ci`, baseline `64e5e143`. No commits, browser checks,
real-provider calls, credential reads, or changes to other cards' files.

## Causes in CI run 41496905996

The supplied log ends with **5,224 tests: 5,200 pass, 13 fail, 11 skip**.

Five failures had the same missing CJK system-font cause:

- `caption wrapping supports English and mixed CJK, refuses a third line and missing injected CJK font`
- `English and Chinese captions alter pixels only in the enabled interval and expected screen area`
- `real code-plan execution persists all edits, stays free and replays its completion without rendering`
- `eight clips, eight captions and twelve sounds render within the local timeout with a recoverable receipt`
- `caption receipt survives reopen without font lookup and detects tampered PNG bytes`

The execution test stopped at its caption-bearing dry run, before execution.
These were prerequisite failures, not evidence of five renderer defects.

Eight upload failures happened while encoding inputs: AVIF, HEIC, HEIF,
HEIC grid, HEIC primary item, 48-tile HEIC, MP4 HEVC, and WebM AV1.
The pinned Linux build has x264 but neither SVT-AV1 nor x265. Their private
`svtav1-params` / `x265-params` arguments failed before the old encoder-skip
handler recognized the failure. The log also shows ten upload skips from
Pillow, VP9, MP3, and Opus WebM sample generation.

There was a second, previously masked Linux problem: `--disable-autodetect`
without `--enable-libdav1d` leaves software AV1/AVIF decoding unavailable.
A generic `av1` decoder listing alone does not establish CPU decode support.

## Changes

- CI installs `fonts-noto-cjk` and `libdav1d-dev` in addition to its existing
  compiler/x264/zlib prerequisites. Dependency installation precedes the font
  preflight because it reads the native `@napi-rs/canvas` font catalog.
- The media profile adds Linux-only `--enable-libdav1d` and a Linux-only
  `libdav1d` requirement. Common checks cover native HEVC, the upload codecs,
  and the MOV/image-pipe/Matroska demuxers. Setup checks decoding both before
  reusing a binary and after building one. A missing Linux dav1d development
  package fails before downloading/building. macOS configure flags and build
  library prerequisites remain unchanged.
- FFmpeg's built-in HEVC decoder handles HEVC clips/HEIC tiles; its
  [pinned MOV demuxer](https://raw.githubusercontent.com/FFmpeg/FFmpeg/n8.1.1/libavformat/mov.c)
  reads HEIF/HEIC/AVIF item containers and grid metadata. No x265 encoder or libheif
  integration is needed. AV1 and AVIF use dav1d. See the official
  [dav1d decoder requirements](https://ffmpeg.org/ffmpeg-codecs.html#libdav1d).
  The [pinned 8.1.1 configure script](https://raw.githubusercontent.com/FFmpeg/FFmpeg/n8.1.1/configure)
  requires `dav1d >= 1.0.0`; Noble's 1.4.1 satisfies that minimum.
- The profile change invalidates both the workflow's media cache key and the
  managed binary-prefix digest. Cached x264-only tools cannot satisfy the
  Linux decoder check.
- `check:toolchain` checks the same native font catalog and accepted platform
  families as `systemCaptionFont`. An absent CJK font names the prerequisite
  and the Ubuntu install command. No production font-lookup change was needed;
  the existing renderer seam sufficed. A regression test compares the two
  lookups and requires a digested readable renderer font file.
- The upload matrix reads **38 synthetic fixtures, 1,589,683 bytes total**
  (largest 113,440 bytes). The original failing formats' base AVIF and HEVC
  tile are only 2.4/3.2 KB. Shared tile bytes are packaged into HEIC/HEIF/grid
  containers at runtime, without encoding. Other upload samples also use
  fixtures, removing Pillow/VP9/MP3/Opus encoder skips. Five uncompressed
  formats are stored as gzip and restored byte-for-byte; a fixture-local
  `.gitignore` exception makes them visible to Git. The fixture README and
  explicit maintenance generator document all commands and versions.
- The noisy >200 KB JPEG, oversized 24 MP pictures, expected PNG comparisons,
  and caption-suite procedural clips/audio still use required encoders
  (`mjpeg`, `png`, `libx264`, `pcm_s16le`). The existing encoder gate already
  requires all of them. No AVIF/HEIF decoder fallback can skip a test.

All success-path assertions, dimensions, byte/hash comparisons, first-page
and first-frame checks, HTTP rejection/retry/idempotency checks, and
Director-readability checks remain. The AVIF/HEIF decoder-error branch retains
its HTTP diagnostic assertions and rethrows instead of skipping: these
decoders are now mandatory. Animated WebP retains
its existing import-or-explicit-unsupported assertions; a verified rejection
now counts as a tested outcome instead of a skip. No tests were deleted or
weakened. Three preflight/configuration tests were added to the owned caption
suite; existing upload cases were rewritten to read samples.

## Ubuntu archive and font evidence

The official Noble archive lists all seven apt packages used by the workflow:

| Package | Noble archive evidence |
| --- | --- |
| build-essential | [12.10ubuntu1](https://packages.ubuntu.com/noble/build-essential) |
| pkg-config | [1.8.1-2build1](https://packages.ubuntu.com/noble/pkg-config) |
| nasm | [2.16.01-1build1](https://packages.ubuntu.com/noble/nasm) |
| libx264-dev | [Noble entry](https://packages.ubuntu.com/noble/libx264-dev) |
| zlib1g-dev | [Noble entry](https://packages.ubuntu.com/noble/zlib1g-dev) |
| libdav1d-dev | [1.4.1-1build1](https://packages.ubuntu.com/eu/noble/libdav1d-dev) |
| fonts-noto-cjk | [1:20230817+repack1-3](https://packages.ubuntu.com/en/noble/fonts-noto-cjk) |

The [Noble font package file list](https://packages.ubuntu.com/noble/all/fonts-noto-cjk/filelist)
contains `/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc` and
`NotoSansCJK-Bold.ttc`. These lie under the renderer's `/usr/share/fonts`
root and match its `notosanscjk` filename alias. Its preferred Linux families
include `Noto Sans CJK SC`, `Noto Sans CJK`, and `Noto Sans SC`. The new
preflight queries those exact names with `GlobalFonts.has`, refusing a Latin
fallback. Package/file-path compatibility is verified from archive metadata;
actual Ubuntu native-catalog loading still requires the CI run below.

Outbound research was limited to the card's requested Ubuntu archive and
official FFmpeg documentation checks; no application/provider traffic ran.

## Verification

| Check | Result |
| --- | --- |
| `pnpm setup:test-media` | Exit 0; existing exact Homebrew 8.1.1 pair satisfies the profile |
| `pnpm check:toolchain` | Exit 0; encoders/decoders/demuxers available; `Hiragino Sans GB` |
| `pnpm build` | Exit 0, all five workspace builds; existing Vite chunk/dynamic-import warnings only |
| `node scripts/run-tests.mjs apps/server/test/upload-formats.test.mjs apps/server/test/film-quality-render.test.mjs scripts/test/test-toolchain.test.mjs` | Final rerun: **88 pass, 0 fail, 0 skip**, exit 0, 81.97 s |
| `pnpm test` | **5,227 tests: 5,226 pass, 0 fail, 1 existing opt-in skip**, exit 0, 2,085.46 s |
| Final `node scripts/run-tests.mjs apps/server/test/upload-formats.test.mjs` | **47 pass, 0 fail, 0 skip**, exit 0, 26.17 s; follows the last assertion-preservation adjustment |
| `pnpm typecheck` (runs `pnpm build:packages && pnpm -r typecheck`) | Exit 0; three package builds and **5/5 workspace typechecks pass**, zero errors |
| Workflow YAML | Ruby/Psych parses it; checked `jobs.check.runs-on == ubuntu-24.04` |
| `git diff --check` | Exit 0 |

The targeted set contains 47 upload tests, 34 caption/render/preflight tests
and seven existing toolchain tests. Its first run also passed 88/88. The
rerun followed the self-review fixes, rather than a test failure.

The full-suite skip is `opt-in native Codex probe never starts a model turn`.
All F4 upload/caption tests ran; no test failure required a timing rerun.
In the full run the eight-clip render took 14.764 s against its unchanged
148.8 s timeout. While the full run's remaining release
tests finished, final review restored the pre-existing decoder-error HTTP
assertions followed by a mandatory rethrow; the final upload rerun verifies
that test-only adjustment.

The absent-font override is `requireTestToolchain({ fontLookup: () => undefined })`.
Decoder/demuxer overrides preserve the same FFmpeg version and real command
output except for the selected capability row, with `platform: "linux"` for
the dav1d check. Actual failures named:

```text
CJK caption font: expected a supported CJK system font, found unavailable. Ubuntu: apt-get install fonts-noto-cjk.
media decoders: ... found missing: libdav1d. Run pnpm setup:test-media ...
media decoders: ... found missing: hevc. Run pnpm setup:test-media ...
media demuxers: ... found missing: mov. Run pnpm setup:test-media ...
```

Tests also remove each required Linux decoder in turn, reject failed listing
commands, verify accepted Linux font names/Latin fallback rejection, and
assert unchanged macOS configure flags and prerequisites.

## Check the next CI run

1. Confirm `ubuntu-24.04` apt installs the listed packages and the changed
   profile selects a new media cache identity.
2. Confirm setup configures `--enable-libdav1d` and preflight reports
   `media decoders available`, `media demuxers available`, and a supported
   Noto CJK family. The generic `av1` listing is insufficient by itself.
3. Confirm all 47 upload cases execute with zero skips, including AVIF,
   both HEIF brands, primary-item and 48-tile grids, HEVC and AV1 clips.
   Confirm the caption suite's new readable-font assertion passes, then the
   five original caption failures and all remaining tests.
4. Confirm full test and typecheck exit codes are zero. Check the full log
   for additional timing-sensitive failures before declaring success.

## Limits and review

GitHub Actions was not run. This machine is macOS and its Docker daemon is
unavailable, so the Linux source build, apt installation and actual Ubuntu
native-font catalog were not executed locally. Archive metadata plus the
native Linux preflight/caption assertions provide the reviewable CI gates.
Local decoding uses the existing Homebrew FFmpeg/ffprobe 8.1.1. The Mac source
build deliberately retains its earlier library profile; this task does not
establish AV1 support for that older minimal Mac fallback build.

`README.md` and `CONTRIBUTING.md` already install dependencies before the
preflight, so the native font-catalog check fits their command order. The
lead should add `libdav1d-dev` and `fonts-noto-cjk` to CONTRIBUTING's Ubuntu
prerequisite list; that file is outside F4's ownership. Setup/preflight errors
and this report already give the new install commands.

Self-review caught and fixed ignored gzip test data and a shared dav1d
requirement that would have changed the Mac source-build prerequisites. It
also retained the original decoder-error HTTP assertions while replacing
their skip with a mandatory failure; the subsequent upload-only rerun passed.
No browser/API contract or product code changed. No commits were made.

Proposed split for the lead:

1. `fix(ci): require Linux CJK fonts and AV1 decoding` — workflow and the
   three toolchain profile/setup/check files.
2. `test(media): decode offline upload format fixtures` — upload suite and
   everything under `apps/server/test/fixtures/upload-formats/`.
3. `test(ci): cover missing caption fonts and media decoders` — caption suite
   and this report.
