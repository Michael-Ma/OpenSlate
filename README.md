# OpenSlate

An open-source video agent for turning a story into a finished film.

OpenSlate is designed to plan scenes and shots, create reference assets, generate video takes, and assemble an editable timeline for rendering and post-processing.

**Status: initial skeleton.** The web app and API health endpoint run today. Codex integration, asset/video generation, persistent jobs, and rendering are planned; this repository does not yet generate videos.

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

The skeleton requires no API keys, Codex installation, FFmpeg, or GPU. It makes no paid generation calls. Shared packages are built before development starts; restart `pnpm dev` after editing those packages.

## Commands

| Command | Purpose |
|---|---|
| `pnpm dev` | Start the web app and API in development |
| `pnpm check` | Build every package and run TypeScript checks |
| `pnpm build` | Produce library/API output and the web bundle |
| `pnpm typecheck` | Build shared packages and check TypeScript |
| `pnpm --filter @openslate/server start` | Start the built API after `pnpm build` |

The web build is written to `apps/web/dist`; production serving is not wired yet. There is no deployed service or database in this skeleton.

## Repository

```text
apps/web/             React + Vite starting page
apps/server/          Fastify API and health endpoint
packages/core/        Shared application types
packages/director/    Initial director lifecycle interface
packages/providers/   Initial video capability interface
skills/               Planned creative skills
workers/h3-python/    Future local inference boundary
docs/                 Documentation index and design files
```

## Design and next steps

Start with the [documentation index](docs/README.md).

- [Architecture](docs/design/README.md)
- [Component design](docs/design/COMPONENT-DESIGN.md)
- [Skills and tools](docs/design/SKILLS-AND-TOOLS.md)
- [Execution and editing](docs/design/EXECUTION-AND-EDITING.md)
- [Commercial walkthrough](docs/design/COMMERCIAL-WALKTHROUGH.md)
- [Codex and model providers](docs/design/CODEX-AND-PROVIDERS.md)
- [Implementation plan](docs/design/IMPLEMENTATION-PLAN.md)
- [Design review notes](docs/design/REVIEW-NOTES.md)

Next: prove the skill/tool lifecycle, code-plan execution, and mid-run edits with fake operations, then build a short end-to-end production with real cloud APIs. See [Contributing](CONTRIBUTING.md) for development guidance.

## License

[MIT](LICENSE). Model weights and third-party services are governed by their own licenses and terms.
