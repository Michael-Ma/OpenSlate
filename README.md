# OpenSlate

An open-source video agent for turning a story into a finished film.

OpenSlate is designed to plan scenes and shots, create reference assets, generate video takes, and assemble an editable timeline for rendering and post-processing.

**Status: initial skeleton.** The web app and API health endpoint run today. Codex integration, asset/video generation, persistent jobs, and rendering are planned; this repository does not yet generate videos.

## Direction

- TypeScript application with a React interface and Fastify service.
- Codex as the first director runtime, connected through validated OpenSlate tools.
- GPT Image 2 for assets and MiniMax H3 cloud for video generation.
- Optional Python H3 inference workers later, behind the same provider boundary.
- OpenSlate-owned project state, generation jobs, budgets, and edit decisions.

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
docs/design/          Architecture, component design, and roadmap
```

## Design and next steps

- [Architecture](docs/design/README.md)
- [Component design](docs/design/COMPONENT-DESIGN.md)
- [Implementation plan](docs/design/IMPLEMENTATION-PLAN.md)

Next: prove the Codex/MCP integration with a fake asynchronous provider, then build a short end-to-end production with real cloud APIs. See [Contributing](CONTRIBUTING.md) for development guidance.

## License

[MIT](LICENSE). Model weights and third-party services are governed by their own licenses and terms.
