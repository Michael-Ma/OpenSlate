# Contributing to OpenSlate

OpenSlate is at the skeleton stage. Start with the [design](docs/design/README.md) and [implementation plan](docs/design/IMPLEMENTATION-PLAN.md). For a substantial feature or architecture change, discuss its scope in an issue before implementing it.

Use Node.js 24 and the pnpm version declared in `package.json`:

```sh
pnpm install
pnpm dev
pnpm check
```

Keep changes focused. Describe what changed and how you verified it in the pull request. Add meaningful tests when introducing behavior; the initial build workflow checks workspace builds and types.

Preserve these boundaries:

- Application state and job admission belong to OpenSlate, independent of director conversation history.
- Codex protocol details stay behind the director adapter.
- Cloud/local model behavior stays behind provider interfaces.
- Python remains optional for cloud users.
- Keep API keys, credentials, generated media, databases, and model weights out of commits. Future live API checks must be opt-in and have an explicit spending limit.

Interfaces in the skeleton are starting points, not stable public APIs. Extend them alongside the first working vertical slice and keep the design current.
