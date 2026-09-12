# OpenSlate

An open-source video agent for turning a story into a finished film.

OpenSlate is designed to plan scenes and shots, create reference assets, generate video takes, and assemble an editable timeline for rendering and post-processing.

**Status: an interactive local workspace with a scripted demo.** Create a project, review keyframes, approve sample videos, and change one shot while keeping the others. SQLite state, validated plans, durable jobs, skill locks, a director supervisor and a pinned local Codex adapter are implemented. Supplied-media rendering and narration drafts have separately tested services. A live backend fixture verified the actual Codex adapter and supervisor across a saved question, backend restart and scoped edit. The default app still uses a canned director and fake media; native runtime setup/browser wiring, real media APIs and the complete narrated-film flow remain pending.

## Direction

- Single-user, single-machine local application: UI, API, database, media, workers and native Codex run on the same computer.
- TypeScript application with a React interface and Fastify service.
- Codex as the first director runtime, connected through validated OpenSlate tools.
- Up to six-minute films, with uploaded or conversationally developed/generated narration.
- Extensible model adapters; GPT Image 2 and MiniMax H3 cloud are the first image/video integrations.
- Human-reviewed keyframes before video generation, visual review, and conversational creative edits.
- Optional same-machine Python H3 inference later, behind the same provider boundary; remote GPU workers and distributed deployment are outside v0.
- OpenSlate-owned project state, generation jobs, budgets, and edit decisions.
- Code-authored execution plans with parallel work and targeted edits that reuse existing outputs.
- A small initial skill/tool set with explicit loading, versioning, and request lifecycle.

Local deployment does not mean offline generation. The initial production adapters will call cloud LLM, GPT Image 2 and H3 services with user-configured credentials. V0 trusts the installed, pinned Codex runtime and its sandbox under an explicit `LocalCodexPolicy` with mode `local` and an exact version/configuration identity. OpenSlate still enforces tool catalogs, request epochs, approvals and generation authority. Independent code-host and authentication isolation are not proven or required as a separate deployment mode. The native supervisor has passed a bounded backend fixture; the default remains fake while local native configuration and browser wiring are completed. See the [accepted runtime boundary](docs/implementation/RUNTIME-TRUST-DECISION.md).

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

The server stores local state in `.openslate/` relative to its working directory, or `OPENSLATE_DATA_DIR`. It creates a private `local-session.token` there unless `OPENSLATE_LOCAL_TOKEN` is configured. With `pnpm dev`, the default file is `apps/server/.openslate/local-session.token`. Paste this local token into the connection screen. It stays in tab memory and must be entered again after a full reload. Protected routes require bearer authentication; only the health endpoint is public. No model-credential saving API is enabled.

Create a project and select **Create 2-shot demo**. Inspect and select the keyframes, then approve the selection to release their sample videos. Use a shot's **Discuss** action and the demo framing choices to exercise a scoped change. Ordinary chat is saved and receives canned guidance; it does not interpret arbitrary creative requests. The application preserves the previous preview during a revision. All sample outputs are explicitly fake.

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

The web build is written to `apps/web/dist`; production serving is not wired yet. Tests use isolated local databases and require permission to bind loopback ports. The native Codex probe test is opt-in through `OPENSLATE_CODEX_PROBE_BINARY`; normal CI does not require Codex or credentials. Real supplied-media tests use local FFmpeg/ffprobe when available; these services are not yet connected to browser uploads or the execution engine.

## Repository

```text
apps/web/             React conversation, storyboard, review and playback workspace
apps/server/          Application, director supervisor, SQLite, execution and local media
packages/core/        Domain contracts, workflow predicates and bounded plan compiler
packages/director/    Skill locks, MCP bridge, fake/native runtime ports and probes
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

See the [verified implementation status](docs/implementation/STATUS.md) for remaining gates and the next work, and the [workspace/runtime/local-media implementation](docs/implementation/CONVERSATION-WORKSPACE.md) for the latest slice. See [Contributing](CONTRIBUTING.md) for development guidance.

## License

[MIT](LICENSE). Model weights and third-party services are governed by their own licenses and terms.
