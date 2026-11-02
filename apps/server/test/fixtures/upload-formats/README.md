# Offline upload samples

Synthetic pictures, one-second 30 fps videos, and one-second 48 kHz stereo
440 Hz audio, generated on macOS with Homebrew FFmpeg **8.1.1** and Pillow
**9.5.0**. No user media, credentials, or provider calls are involved.

Regenerate explicitly from the repository root (requires the full Homebrew
FFmpeg with x265, SVT-AV1, VP9, MP3 and Opus encoders, plus Python/Pillow):

```sh
node apps/server/test/fixtures/upload-formats/generate.mjs
```

`generate.mjs` contains the complete commands. It is a maintenance utility and
is never imported or run by the tests. The HEVC tile and AVIF use the original
`testsrc2=s=320x180` single-frame commands, including `hvc1`, single-threaded
x265, and SVT's `lp=1`. The HEVC/AV1/VP9 videos use `testsrc2` at 320×180,
30 fps for one second; 3GP uses 176×144. Audio uses the original 440 Hz sine.
The image packaging variants retain 1200×800 dimensions, color modes,
progressive/lossless flags and two pages/frames. They omit random noise to keep
the samples small; multipage TIFF uses lossless deflate compression.

`hevc-tile.mp4` is 3.2 KB and `image.avif` is 2.4 KB. HEIC, HEIF, primary-item,
2×2 grid and 8×6 grid containers are assembled deterministically from that
tile by `../../upload-format-fixtures.mjs`, with no media encoding. This avoids
storing 48 duplicate HEVC tiles. The grid assertion still decodes the tile,
stacks it into a PNG and compares every normalized output byte.

The other formats cover the entire existing upload matrix, including the
previous Pillow/VP9/MP3/Opus skips. Most files are a few to a few tens of KB;
the largest is about 111 KB. BMP, basic TIFF, WAV and AIFF are gzip-compressed
for storage and restored byte-for-byte with Node's zlib before upload.

Only the deliberately noisy >200 KB JPEG, 24 MP oversized JPEG/PNG, and
expected PNG outputs are still produced at test time. These size-boundary
and pixel-comparison cases use `mjpeg`/`png`, which the toolchain gate requires.
The caption suite's procedural video/audio also uses required `libx264` and
`pcm_s16le`. Tests never need x265, SVT-AV1, Pillow, or other optional encoders.

Animated WebP retains both existing outcomes: successful decoding/import, or
an asserted `IMAGE_FORMAT_UNSUPPORTED` response naming animated WebP when the
installed decoder cannot read animation. The latter is a checked rejection,
not a skipped test. Missing AVIF or HEIF decoding always fails the suite.
