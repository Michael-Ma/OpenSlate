# OpenSlate

An open-source video agent for turning a story into a finished film.

OpenSlate is designed to plan scenes and shots, create reference assets, generate video takes, and assemble an editable timeline for rendering and post-processing.

**Status: executable backend foundation with fake media.** SQLite project state, validated planning code, scoped edits, human keyframe approval, durable jobs, budgets and restart recovery are implemented and tested. Versioned instruction packages, a fixed MCP tool bridge and durable director context/receipts are also implemented. The web interface remains a starting page. Real Codex conversation, model APIs, narration production and final rendering are still ahead; this repository does not yet generate a real commercial.

## Direction

- TypeScript application with a React interface and Fastify service.
- Codex as the first director runtime, connected through validated OpenSlate tools.
- Up to six-minute films, with uploaded or conversationally developed/generated narration.
- Extensible model adapters; GPT Image 2 and MiniMax H3 cloud are the first image/video integrations.
- Human-reviewed keyframes before video generation, visual review, and conversational creative edits.
- Optional Python H3 inference workers later, behind the same provider boundary.
- OpenSlate-owned project state, generation jobs, budgets, and edit decisions.
- Code-authored execution plans with parallel work and targeted edits that reuse existing outputs.
- A small initial skill/tool set with explicit loading, versioning, and request lifecycle.

## Quick start

Prerequisites: Node.js 24 and pnpm 10.33.0. If needed, install pnpm with `npm install -g pnpm@10.33.0`.

```sh
git clone https://github.com/Michael-Ma/OpenSlate.git
cd OpenSlate
pnpm install
pnpm dev
```

Open [the local app](http://127.0.0.1:5173). The API runs at [the health endpoint](http://127.0.0.1:3001/api/health). Both bind to loopback; the development app proxies `/api` to the server. Stop them with Ctrl+C.

The default app and fake demo require no API keys, Codex installation, FFmpeg, or GPU. They make no paid generation calls. Shared packages are built before development starts; restart `pnpm dev` after editing those packages.

The server stores local state in `.openslate/` relative to its working directory, or `OPENSLATE_DATA_DIR`. It creates a private `local-session.token` there unless `OPENSLATE_LOCAL_TOKEN` is configured. Protected routes require `Authorization: Bearer <token>`; only the health endpoint is public. No credential-saving API is enabled. Messages are recorded but report `director: not_connected` until the director integration lands.

Run `pnpm demo:headless` for a reproducible two-shot example. It generates clearly labeled fake keyframes and one-second placeholder clips, simulates exact human reviews, edits only one shot, then restarts during an uncertain submission. It prints a new temporary output directory, preview path and JSON summary. A successful run records six fake accepts and zero duplicate accepts. This is an execution proof, not a finished film or a quality sample.

## Commands

| Command | Purpose |
|---|---|
| `pnpm dev` | Start the web app and API in development |
| `pnpm check` | Build, run domain/API/SQLite tests and check TypeScript |
| `pnpm test` | Build and run offline tests, including the fake integration demo |
| `pnpm demo:headless` | Run the two-shot edit/restart demonstration without keys |
| `pnpm probe:toolchain` | Check SQLite/schema and optional local FFmpeg H.264/AAC support |
| `pnpm probe:runtime --codex /absolute/path/to/codex` | Probe installed Codex with zero model turns |
| `pnpm build` | Produce library/API output and the web bundle |
| `pnpm typecheck` | Build shared packages and check TypeScript |
| `pnpm --filter @openslate/server start` | Start the built API after `pnpm build` |

The web build is written to `apps/web/dist`; production serving is not wired yet. Tests use isolated local databases and require permission to bind loopback ports. The native Codex probe test is opt-in through `OPENSLATE_CODEX_PROBE_BINARY`; normal CI does not require Codex or credentials.

## Repository

```text
apps/web/             React + Vite starting page
apps/server/          Application boundary, SQLite store, fake executor, API and demo
packages/core/        Domain contracts, workflow predicates and bounded plan compiler
packages/director/    Skill locks, MCP bridge and probes; native supervisor pending
packages/providers/   Durable fault-injectable fake provider and provider boundary
skills/               Production and plan-authoring instruction packages
workers/h3-python/    Future local inference boundary
docs/                 Documentation index and design files
```

## Design and next steps

Start with the [documentation index](docs/README.md).

- [Architecture](docs/design/README.md)
- [Detailed technical designs](docs/technical/README.md)
- [Production workflow](docs/technical/PRODUCTION-WORKFLOW.md)
- [Component design](docs/design/COMPONENT-DESIGN.md)
- [Skills and tools](docs/design/SKILLS-AND-TOOLS.md)
- [Execution and editing](docs/design/EXECUTION-AND-EDITING.md)
- [Commercial walkthrough](docs/design/COMMERCIAL-WALKTHROUGH.md)
- [Codex and model providers](docs/design/CODEX-AND-PROVIDERS.md)
- [Implementation plan](docs/design/IMPLEMENTATION-PLAN.md)
- [Design review notes](docs/design/REVIEW-NOTES.md)

See the [verified implementation status](docs/implementation/STATUS.md) for remaining gates and the next work, and the [skill/tool implementation breakdown](docs/implementation/T06-SKILLS-TOOLS.md) for the latest slice. See [Contributing](CONTRIBUTING.md) for development guidance.

## License

[MIT](LICENSE). Model weights and third-party services are governed by their own licenses and terms.
