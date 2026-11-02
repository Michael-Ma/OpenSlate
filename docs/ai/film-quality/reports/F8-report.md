# F8 · Linux CJK caption font discovery

## Done

Implemented F8 in the caption renderer and test-toolchain preflight. Existing preferred catalog families still win. Only on Linux, if none is present, both sides scan `/usr/share/fonts` and `/usr/local/share/fonts` for files starting with `NotoSansCJK` or `NotoSansSC` and ending in `.ttc`, `.otf` or `.ttf`. The scan visits at most 4,000 entries across the roots and at most five subdirectory levels, ignores symlinks, prefers Regular files across roots, and registers a usable candidate as `Noto Sans CJK SC`.

Each resolver caches the fallback result, including absence or rejected registrations, per native catalog for the process lifetime. An invalid/unreadable candidate does not prevent trying the next candidate. Comments identify the deliberately identical resolver on the other side; the preflight does not need a server build. Optional catalog/platform/root injection supplies the test seam without replacing the production defaults.

The server retains the registered path internally so caption receipts hash that exact file, including on subsequent lookups; the path does not enter the receipt. Existing macOS/Windows font selection, English fallback, missing-CJK caption error and Ubuntu toolchain install hint are retained. Native canvas loading remains lazy.

## Files

Changed:

- `apps/server/src/media/captions.ts`
- `scripts/test-toolchain.mjs`
- `apps/server/test/film-quality-render.test.mjs`
- `scripts/test/test-toolchain.test.mjs`

Added:

- `apps/server/test/captions.test.mjs`
- `docs/ai/film-quality/reports/F8-report.md`

Deleted: none. All edits remain within F8 ownership and this required report.

## Tests

Added 19 tests: 18 caption tests (the same eight behavior cases against each resolver, plus exact receipt hashing and the missing-CJK/English boundary), and one toolchain failure test with an injected catalog and empty temporary font directory. Coverage includes TTC/OTF/TTF, both filename prefixes, Regular preference, once-only success/miss/registration-failure behavior, missing roots, invalid candidates, scan depth/entry limits, symlinks, existing Linux families, and unchanged macOS/Windows selection.

Adjusted one assertion in the existing renderer/preflight agreement test to inject empty roots when asserting absent CJK support. This keeps the fake missing-font case deterministic on Linux hosts with Noto installed. No tests were deleted or replaced.

Validation uses Node 24.15.0, pnpm 10.33.0 and local FFmpeg/ffprobe 8.1.1:

| Command | Result |
| --- | --- |
| `pnpm setup:test-media` | Passed; pinned local binaries were already available; no download |
| `pnpm check:toolchain` | Passed; macOS reports `Hiragino Sans GB` |
| `pnpm build` | Passed |
| `node scripts/run-tests.mjs apps/server/test/captions.test.mjs apps/server/test/film-quality-render.test.mjs scripts/test/test-toolchain.test.mjs` | 60 passed, 0 failed, 0 skipped |
| `pnpm test` | 5,290 tests: 5,289 passed, 0 failed, 1 skipped; exit 0 (1,017.7 s) |
| `pnpm typecheck` | Passed; its `pnpm -r typecheck` passed all 5 workspace packages; exit 0 |

The first build caught an exact-optional-property TypeScript error in the cached-path return; it was corrected before the successful build and targeted tests.

The full-suite skip is the existing opt-in native Codex probe (`opt-in native Codex probe never starts a model turn`). No timing-sensitive test failed, so no file retry was needed.

## Self-review

Reviewed the complete source/test diff for correctness, failure boundaries, callers and cross-file effects. The `FontLookup` calling convention remains compatible, caption-free paths still avoid native canvas loading, and a fallback receipt hashes the registered Regular file rather than the first alphabetically matched font. The existing missing-font assertion now avoids dependence on the host catalog/filesystem. No important unresolved implementation issues were found.

## Contract changes

None. `packages/core/src/studio-api.ts` is unchanged.

## Commits

No commits were made. Proposed single conventional commit:

`fix(media): register uncatalogued Linux Noto CJK caption fonts`

Files: all six files listed above (both implementation files, three test files and this report).

## Open issues

The Linux cases use injected catalogs and temporary fixture files on macOS. They do not establish real `@napi-rs/canvas` registration or rendering with Ubuntu's TTC package. The lead must verify Ubuntu 24.04 with `fonts-noto-cjk`, as assigned by F8. No Ubuntu container validation is claimed. Cached absence requires a new process after installing a missing font, consistent with the once-per-process requirement.

No browser, real provider, non-loopback network, port-3001 server, credentials or live studio data were used.
