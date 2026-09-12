# Contributing to OpenSlate

OpenSlate has a tested fake backend foundation. Start with the [implementation status](docs/implementation/STATUS.md), [design](docs/design/README.md) and [implementation plan](docs/design/IMPLEMENTATION-PLAN.md). For a substantial feature or architecture change, discuss its scope in an issue before implementing it. The [technical index](docs/technical/README.md) defines target component contracts; passing tests establish current behavior.

Use Node.js 24 and the pnpm version declared in `package.json`:

```sh
pnpm install
pnpm dev
pnpm check
```

Keep changes focused. Describe what changed and how you verified it in the pull request. `pnpm check` runs builds, Node's built-in test runner, real SQLite/API integration checks and typechecks. Run tests with local loopback permission. Use the fake demo before connecting real APIs; actual Codex integration is separately opt-in and the probe starts no model turns.

Preserve these boundaries:

- Application state and job admission belong to OpenSlate, independent of director conversation history.
- Codex protocol details stay behind the director adapter.
- Cloud/local model behavior stays behind provider interfaces.
- Python remains optional for cloud users.
- Keep API keys, credentials, generated media, databases, and model weights out of commits. Future live API checks must be opt-in and have an explicit spending limit.

Interfaces remain internal and may evolve. Extend them alongside working vertical slices and keep the design and implementation status current.
