# OpenSlate

An open-source video agent for turning a story into a finished film.

OpenSlate is designed to plan scenes and shots, create reference assets, generate video takes, and assemble an editable timeline for rendering and post-processing.

**Status: an early local studio with native Codex conversations, supplied-media workflows and opt-in media generation.** Plan and review shots, develop narration, import recordings/clips/PNG references, discuss selected images and accept exact narration. Explicitly enabled image/H3 bridges use saved profiles, human spending allowances and keyframe review; real local assembly produces a compatible timeline export. The default remains a fake demo. The complete generation path has been verified with injected provider responses and real local rendering; live media validation is still pending. See [verified status](docs/implementation/STATUS.md).

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

Local deployment does not mean offline generation. The initial production adapters will call cloud LLM, GPT Image 2 and H3 services with user-configured credentials. V0 trusts the installed, pinned Codex runtime and its sandbox under an explicit `LocalCodexPolicy` with mode `local` and an exact version/configuration identity. OpenSlate still enforces tool catalogs, request epochs, approvals and generation authority. Independent code-host and authentication isolation are not proven or required as a separate deployment mode. Native setup and browser conversations are connected; projects use the demo director until native Codex is selected. See the [accepted runtime boundary](docs/implementation/RUNTIME-TRUST-DECISION.md).

## Quick start

Prerequisites: Node.js 24 and pnpm 10.33.0. The SQLite dependency invokes native build tooling; the verified macOS setup also had Python 3 and Xcode command-line build tools. See [fresh checkout evidence](docs/implementation/CLEAN-CHECKOUT-VALIDATION.md) for the tested environment. If needed, install pnpm with `npm install -g pnpm@10.33.0`.

```sh
git clone https://github.com/Michael-Ma/OpenSlate.git
cd OpenSlate
pnpm install
pnpm build
pnpm start
```

Open [the local app](http://127.0.0.1:3001). One process serves the built interface and API on loopback. Startup prints the absolute data directory and local token file location, without printing the token itself. Paste that file's token into the connection screen. Stop with Ctrl+C.

For development, use `pnpm dev` and open [the development interface](http://127.0.0.1:5173). Vite proxies `/api` to the local service on port 3001. Shared packages build before development starts; restart `pnpm dev` after editing them. Production serves the bundle captured at startup; rebuild and restart to use changed interface files.

The default app and fake demo require no API keys, Codex installation, FFmpeg, or GPU. They make no paid generation calls.

The server stores local state in `.openslate/` relative to its working directory, or `OPENSLATE_DATA_DIR`. Root-level `pnpm start` defaults to `<repository>/.openslate/`; `pnpm dev` and the filtered server start default to `<repository>/apps/server/.openslate/`. Set the same explicit directory when switching launch modes to retain the same projects:

```sh
OPENSLATE_DATA_DIR=/absolute/path/to/openslate-data pnpm start
```

The service creates a private `local-session.token` in that directory unless `OPENSLATE_LOCAL_TOKEN` is configured. The browser keeps this token in tab memory; enter it again after a full reload. The built interface and health endpoint are public on loopback; project/media APIs and director tools require their appropriate bearer tokens. Host and Origin checks also apply to the built interface. No model-credential saving API is enabled. Keep the data directory separate from `apps/web/dist`, which contains public build output.

Create a project and choose its director. Native Codex setup checks the pinned local installation using its existing sign-in, without starting a model conversation. To try the offline workflow, close setup or choose Demo, then select **Create a 2-shot demo**. Inspect and select the keyframes, then approve the selection to release their sample videos. Use a shot's **Discuss** action and the demo framing choices to exercise a scoped change. In demo mode, ordinary chat receives canned guidance. Native mode handles live conversations through the validated application tools. The application preserves the previous preview during a revision. All sample outputs are explicitly fake.

New projects can also select installed keyframe/video models under **Media models**. To add planning choices, point the local server at a provider catalog:

```sh
OPENSLATE_PROVIDER_CONFIG=/absolute/path/to/provider-profiles.json pnpm start
```

Use [the example catalog](examples/provider-profiles.example.json) as a template. Its prices are **illustrative configured estimates, not verified vendor pricing**; replace them with your own estimates and revise profile versions when changing definitions. Keep API keys out of this file. The project saves the exact selected definitions; later installation changes do not replace them. Unselected kinds keep demo profiles. External generation is off by default. Selecting a model or configuring a key does not authorize spending. See [catalog contracts](docs/implementation/PROVIDER-CATALOG.md).

To enable a provider, follow [local media execution setup](docs/implementation/MEDIA-EXECUTION-LAUNCHER.md). Image and H3 have separate startup switches and backend credentials; H3 also requires exact allowed output hostnames. Enabled generation needs FFmpeg/ffprobe. New H3 projects receive the real local assembly mode, while historical project locks retain their saved behavior. Before generation, review the configured estimate and grant an exact spending allowance; video additionally requires approval of its exact keyframe and motion plan. Live provider access and actual billing have not yet been validated.

Run `pnpm demo:headless` for a reproducible two-shot example. It generates clearly labeled fake keyframes and one-second placeholder clips, simulates exact human reviews, edits only one shot, then restarts during an uncertain submission. It prints a new temporary output directory, preview path and JSON summary. A successful run records six fake accepts and zero duplicate accepts. This is an execution proof, not a finished film or a quality sample.

## Commands

| Command | Purpose |
|---|---|
| `pnpm dev` | Start the web app and API in development |
| `pnpm start` | Serve the built interface and API at `127.0.0.1:3001` |
| `pnpm installation export / inspect / restore` | Back up or recover a stopped local installation; see the path options below |
| `pnpm check` | Build, run domain/API/SQLite tests and check TypeScript |
| `pnpm test` | Build and run offline tests, including the fake integration demo |
| `pnpm demo:headless` | Run the two-shot edit/restart demonstration without keys |
| `pnpm probe:workflow` | Verify a 60-shot, six-minute plan, review batches and scoped edit/restart with fake media |
| `pnpm probe:toolchain` | Check SQLite/schema and optional local FFmpeg H.264/AAC support |
| `pnpm probe:launcher` | Check the built local launcher with temporary data; requires port 3001 to be free |
| `pnpm probe:runtime --codex /absolute/path/to/codex` | Probe installed Codex with zero model turns |
| `pnpm build` | Produce library/API output and the web bundle |
| `pnpm typecheck` | Build shared packages and check TypeScript |
| `pnpm --filter @openslate/server start` | Start the built interface/API from the server directory |

The web build is written to `apps/web/dist`. Production loads a bounded snapshot of that directory: at most 256 entries, eight levels, 8 MiB per file and 32 MiB total. Only recognized web asset formats are served; hidden files, source maps and arbitrary data files are excluded, and symlinks are rejected. Missing API routes and missing assets never fall back to the interface. The local launcher is not a multi-host deployment service.

Tests use isolated local databases and require permission to bind loopback ports. The native Codex probe test is opt-in through `OPENSLATE_CODEX_PROBE_BINARY`; normal CI does not require Codex or credentials. Supplied-media workflows require FFmpeg and ffprobe on PATH (or OPENSLATE_FFMPEG and OPENSLATE_FFPROBE). They provide authenticated local upload, narration review, clip playback and rendering of compatible plans. They do not call cloud media APIs.

Recognized older databases receive a verified snapshot before a schema upgrade. Those snapshots contain database records, not the referenced media files. See [database migration and restore boundaries](docs/implementation/DATABASE-MIGRATIONS.md) before treating a metadata snapshot as a complete project backup.

## Local backups and recovery

Build the application, then stop its server before using these commands. A backup includes the installation's projects, saved conversations, owned media, recovery receipts and locked skills. Use a new backup directory outside the data directory:

```sh
pnpm installation export --data-dir /absolute/path/to/openslate-data --output /absolute/path/to/backups/openslate-backup
pnpm installation inspect --backup /absolute/path/to/backups/openslate-backup
```

The bundle is private and can contain protected provider result locations. It excludes API credentials, the local browser token and external Codex authentication. Keep it as carefully as your project data. Inspection verifies saved bytes without contacting any provider.

Recovery currently supports the **same original data path on the same computer**. It refuses to overwrite or merge existing installation data. Preserve any existing installation separately before restoring into its now-empty original path:

```sh
pnpm installation restore --backup /absolute/path/to/backups/openslate-backup --data-dir /absolute/path/to/openslate-data
OPENSLATE_DATA_DIR=/absolute/path/to/openslate-data pnpm start
```

If interrupted, repeat the exact restore command with the same bundle. The launcher refuses an unfinished restore. On successful startup, enter the local token (newly generated when `OPENSLATE_LOCAL_TOKEN` is unset) and inspect the recovery summary, saved projects and previews. Select **Review release**, then **Finish recovery review** when ready. Release keeps each project paused, while existing job results may now be recovered. Restored unused permissions cannot start new generation. Use a fresh conversation and new spending review for new work. Work after the backup may be absent, and uncertain provider submissions remain unresolved. See [recovery contracts and verification](docs/implementation/INSTALLATION-RECOVERY.md).

## Repository

```text
apps/web/             React conversation, storyboard, review and playback workspace
apps/server/          Application, director supervisor, SQLite, execution and local media
packages/core/        Domain contracts, workflow predicates and bounded plan compiler
packages/director/    Skill locks, MCP bridge, fake/native runtime ports and probes
packages/providers/   Fake provider and offline-tested image/H3 transports
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
