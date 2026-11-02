# F8 · The CJK caption font is found on Ubuntu

Read `docs/ai/uiux-plan/codex/RULES.md` first; its hard rules apply in full. You own `apps/server/src/media/captions.ts`, `scripts/test-toolchain.mjs` and their tests.

## Problem

CI run 41522139522 installed `fonts-noto-cjk` on ubuntu-24.04, and `pnpm check:toolchain` still failed: `CJK caption font: expected a supported CJK system font, found unavailable`. Both `systemCaptionFont` (captions.ts) and `findCjkCaptionFont` (test-toolchain.mjs) decide by `GlobalFonts.has("Noto Sans CJK SC" | "Noto Sans CJK" | "Noto Sans SC")` from `@napi-rs/canvas`. On Ubuntu the package installs TrueType collections such as `/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc`, and the canvas library's system catalog does not report those families, so the font is installed but never found.

## Change

On Linux, when none of the preferred families is in `GlobalFonts`, look for a Noto CJK sans file under `/usr/share/fonts` and `/usr/local/share/fonts` (bounded scan, `.ttc`/`.otf`/`.ttf`, names starting `NotoSansCJK` or `NotoSansSC`, Regular preferred), register it with `GlobalFonts.registerFromPath(path, "Noto Sans CJK SC")`, and use that family. Do it once per process, in one small shared function per side (the server and the script cannot share a module; keep their behaviour identical and say so in a comment). The caption receipt keeps recording the family and the file digest, as now. macOS and Windows behaviour is unchanged. Keep the clear error when no CJK font exists at all.

## Tests

With an injected catalog and a temporary fonts directory: a catalog without the family plus a `NotoSansCJK-Regular.ttc` file registers it and returns "Noto Sans CJK SC"; no file returns nothing and the toolchain check fails with the install hint; macOS behaviour is unchanged. Existing caption tests stay green. The lead verifies the real behaviour in an Ubuntu 24.04 container; you cannot, so do not claim it.

## Finish

Run the caption and toolchain tests and `pnpm typecheck`. Write `docs/ai/film-quality/reports/F8-report.md`.
