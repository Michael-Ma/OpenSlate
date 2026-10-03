# Contributing to OpenSlate

Start with [current status](docs/implementation/STATUS.md), [architecture](docs/design/README.md) and the [technical index](docs/technical/README.md). Interfaces are internal and can evolve; keep documentation aligned with the implemented slice rather than publishing speculative contracts as current APIs.

Use Node 24 and pnpm 10.33.0:

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm check
```

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
