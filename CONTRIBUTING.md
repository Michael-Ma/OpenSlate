# Contributing to OpenSlate

Start with [current status](docs/implementation/STATUS.md), [architecture](docs/design/README.md) and the [technical index](docs/technical/README.md). Interfaces are internal and can evolve; keep documentation aligned with the implemented slice rather than publishing speculative contracts as current APIs.

Use the exact test baseline: **Node 24.15.0**, **pnpm 10.33.0**, and **FFmpeg/ffprobe 8.1.1**:

```sh
nvm install
nvm use
pnpm install --frozen-lockfile
pnpm setup:test-media
pnpm check:toolchain
pnpm dev
pnpm check
```

The Node pin comes from `.nvmrc`, pnpm from `package.json`, and the media release/archive checksum from `scripts/test-media-toolchain.json`. CI uses these same inputs on Ubuntu 24.04. `pnpm setup:test-media` reuses an exact installed pair or builds the official checksummed source into ignored `.cache/test-toolchain/`; it does not replace system media tools. Build prerequisites are `brew install x264 pkg-config` on macOS, or `sudo apt-get install build-essential pkg-config nasm libx264-dev zlib1g-dev` on Ubuntu. A later Homebrew/Ubuntu version is not implicitly a matching test toolchain.

`pnpm check:toolchain` rejects drift before the full suite. The test runner passes the resolved absolute FFmpeg/ffprobe pair through both supported environment-variable conventions, including child-process tests. Explicit incompatible overrides fail instead of silently falling back. For a focused regression after building, use `node scripts/run-tests.mjs apps/server/test/media-audio-scale.test.mjs`. Raw `node --test` remains available for deliberately reproducing another toolchain, but is not the parity gate.

`pnpm check` builds all workspaces, runs Node's test runner and checks TypeScript. Tests use isolated databases and need loopback-listener permission. Native probes are opt-in; real media tests need a current explicit allowance. Passing offline tests does not prove provider access or creative quality.

## Implementation boundaries

- OpenSlate owns canonical state, requests, revisions, review, grants, budgets and execution. A model only proposes validated data.
- Never evaluate model-authored JavaScript. Keep the bounded parser and all plan validation paths.
- Preserve immutable review inputs, one-use grants, candidate/attempt separation, persisted submission intent and unknown-outcome reconciliation.
- Preserve request scope, edit-hold ownership and old epoch fencing. An unrelated request cannot borrow another edit's authority.
- Keep Codex protocol details in `packages/director`, provider transport details behind adapters, and server/compiler modules out of browser bundles. Browser contracts come from `@openslate/core/public`.
- V0 is one user on one computer. Multi-host operation, remote GPU workers and shared databases need a separate design.
- Keep credentials, databases, generated media, dependencies and build output out of commits.

Describe the concrete behavior and relevant validation in a PR. Run tests that exercise meaningful authority, recovery or user-facing failure boundaries; do not add tests that only repeat implementation details. Update [status](docs/implementation/STATUS.md) for material scope changes and keep dated evidence separate from current capability claims.

## UI work

Follow the [current studio](docs/design/STORYBOARD-STUDIO.md). Reuse shared typography and semantic surface tokens. Keep headings distinct from regular-weight content; name icon controls accessibly, preserve keyboard operation and test long/empty states.

Inspect the actual rendered flows at desktop and narrow phone sizes. Check page/dialog overflow, focus, loading and errors. State which flows were browser-tested; unit tests alone do not establish visual quality. Save examples/screenshots outside tracked private data and use synthetic projects.

## Documentation

Use portable relative links and repository-relative source pointers. Current guides explain what the application does; the [evidence index](docs/implementation/VALIDATION-EVIDENCE.md) labels dated experiments and their limitations. Consolidate superseded prose instead of appending another milestone page. Files under `skills/`, including legacy versions, are immutable runtime inputs and must not be treated as documentation cleanup.
