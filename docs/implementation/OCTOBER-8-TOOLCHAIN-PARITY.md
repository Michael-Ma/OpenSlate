# October 8 CI/local toolchain parity

## Change

The failing [CI run](https://github.com/Michael-Ma/OpenSlate/actions/runs/37664605332) used Node 24.21.0 and Ubuntu FFmpeg 6.1.1, while the local verified run used Node 24.15.0 and FFmpeg 8.1.1. pnpm was already pinned to 10.33.0 and JavaScript dependencies were already locked.

Development/CI now read the exact Node patch from `.nvmrc`, pnpm from `package.json`, and the media release/configuration/source checksum from `scripts/test-media-toolchain.json`. CI fixes the runner family to Ubuntu 24.04. A shared source installer reuses an exact compatible local pair or builds the official source in ignored `.cache/test-toolchain/`. The verified source is FFmpeg 8.1.1, SHA256 `b6863adde98898f42602017462871b5f6333e65aec803fdd7a6308639c52edf3`; its official release signature was checked against fingerprint `FCF986EA15E6E293A5644F10B4322F04D67658D8`. Required codecs include libx264, AAC, PCM, PNG and MJPEG; libx264 and zlib are explicit build requirements. The cache is separated by platform, architecture and media-profile hash.

`pnpm check:toolchain` fails before the full gate for Node patch drift, package-manager drift, incompatible/missing media versions or missing codecs. Explicit media overrides stay authoritative rather than being silently replaced. `scripts/run-tests.mjs` verifies and passes the chosen FFmpeg/ffprobe pair through both environment conventions used by the test/child-process code. `pnpm check` and CI use this entry point. Production startup still accepts Node 24; installed production media tools/private configuration are not replaced by test setup.

## Reproduction and verification

A disposable Ubuntu 24.04 linux/amd64 container was seeded with only committed public source; no private installation, credentials or provider configuration was mounted. It installed the same FFmpeg `6.1.1-3ubuntu5` package as the failing hosted run and used checksum-verified Node 24.15.0 plus pnpm 10.33.0. This removed the Node patch difference while retaining the failure.

The unchanged audio-scale assertions failed at voice segment 9 under FFmpeg 6.1.1. Expected 500Hz power at that segment was about `3.61e7`, compared with about `5.34e12` for the initial voice. Repeating the same test with source-built FFmpeg 8.1.1 raised segment 9 power to about `5.42e12`; both audio-scale tests passed. The renderer and original assertions remain unchanged. Diagnostic prints were confined to the disposable reproduction and removed before its full gate.

- Local `pnpm check`: **2,408 passed, zero failed, one optional native skip** (2,409 total); all builds/typechecks passed.
- Seven meaningful toolchain regressions cover exact patch/version drift, paired tools, explicit overrides, child paths, malformed pin/source data, corrupt archives, cache platform/configuration separation and missing same-version codecs.
- Required offline demo: **4 initial + 2 edited fake accepts, zero duplicates after restart**; unchanged shot preserved.
- Disposable Ubuntu 24.04 linux/amd64 `pnpm check`: **2,408 passed, zero failed, one optional native skip** (2,409 total), with all builds/typechecks passed through the shared pinned runner. The final setup diagnostic and toolchain checks also passed on both hosts.
- Hosted CI is verified after publishing this reviewed fix; its result is recorded in the final report.

Local records: `/private/tmp/openslate-ci-toolchain/local-check.log`, `/private/tmp/openslate-ci-toolchain/demo.log`; Linux before/after audio logs are retained in the task evidence directory. This campaign used synthetic media and no real-provider media/model calls.
