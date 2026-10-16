# OpenSlate

An open-source local video studio with a conversational director and an editable storyboard.

Develop a film as **brief → scenes → shots → reviewed keyframes → video → Film/export**. The application, database, files and workers run on your computer; configured model services may run in the cloud.

**Early development.** This branch delivers the studio in `apps/web/src/next`; it is the only web UI. Planning, scoped editing, scene confirmation, narration, take selection and local export are implemented. The earlier real Codex-image → Viggle H3 → six-second export remains dated evidence, not acceptance of every current provider or the new UI. New voice cloning from a recording and installer packaging remain pending. See [current status](docs/implementation/STATUS.md).

## Use the studio

Start a film, open a saved film or explore the **Last Ferry** sample. The Director sits beside **Plan / Keyframes / Assets / Film**; Settings has its own page. The interface supports English and Simplified Chinese with local Inter and a shared dark token system. Message IDs and server error codes drive translated controls; creative writing and Director replies retain their original language.

- **Plan** edits the brief, story, scene titles/order and shot fields. Text/Markdown import produces a reviewable proposal. Direct edits preserve unaffected paid media and support Undo.
- **Keyframes** shows one current preview, scene capsules, shot cards, narration fit and the scene video decision. Open each actual returned frame, inspect motion, timing and the video recipe, then confirm the scene. The server durably settles any missing voice and starts video; closing the browser does not own that sequence. Current media remains visible while a replacement is made. Takes exposes earlier eligible frames with a free selection command.
- **Director** uses explicit @ scene/shot scope; selecting a preview does not silently change the message target. Lettered notes and held proposals have application-computed effects and accept/reject/Undo actions. Application checks such as overlong narration are separate from Director suggestions.
- **Assets** lists owned images, clips, voices, music and exports with source and scene/shot filters. Importing media does not start generation.
- **Film** plays current picture, accepted narration and music in storyboard order. Shot order/timing and music placement, gain and mute are editable. Its single export surface reports readiness, history and changes since export; all-demo exports carry a Demo stamp.
- **Settings** separates media choices, Director setup/review, narrator/personal voices, this computer and language. The retained installation-status API reports local tool versions and provider configuration without returning paths or credentials.

OpenSlate owns canonical revisions, scoped human requests, durable attempts and immutable media evidence. Models propose validated data; restricted TypeScript plans compile to a graph without evaluating model-authored JavaScript. Every paid press keeps its identity across a lost response. Stop detaches unsent work; Continue does not resend it. Giving up on an unknown outcome releases the slot while preserving the possibility of a late charged result. Inspect the original request before trying again.

Configured providers need no separate API-key approval or usage allowance. There are two generation decisions per scene: make keyframes, then review returned frames and the actual video recipe before video. Returned clips need no additional acceptance gate. Narration can be generated with keyframes, fitted without another provider call, or imported as a measured recording. Existing eligible personal voice IDs support consent and revocation; creating a new clone remains pending.

The composer retains unsent words and explicit scope in this browser. Session expiry, disconnect, offline state, Stop and restore quarantine have separate recovery controls. Restoring a draft never submits it. Browser-only fixtures and disposable fake-provider studios are development tools, not live-provider evidence. See the [studio guide](docs/design/STORYBOARD-STUDIO.md), [UI reference](docs/technical/REVIEW-UI.md) and [current API](docs/technical/APPLICATION-API.md).

## Quick start

Requires **Node.js 24**. The launcher uses the pinned **pnpm 10.33.0**, installs locked dependencies and builds the studio.

```sh
git clone https://github.com/Michael-Ma/OpenSlate.git
cd OpenSlate
./start.sh
```

Open [the local studio](http://127.0.0.1:3001). Keep the terminal open; Ctrl+C stops a server started there. Startup opens a short-lived browser pairing link and preserves saved projects. If the verified server is already running, the launcher reconnects to it.

```sh
./start.sh --restart       # Rebuild and load changed code/configuration
./start.sh --status        # Inspect the current installation
./start.sh --doctor        # Explain local prerequisites without provider calls
./start.sh --init-config   # Create a private config template; preserve existing files
```

Default demo models need no API keys and make no paid media calls. FFmpeg/ffprobe are needed for media import and export. For real models, configure keys on the local server and choose a supported provider catalog. Configured keys/runtime enable their routes; optional explicit `0` switches disable a route. Scene actions or requested audio start work, and the app checks actual setup before dispatch. See [setup](docs/implementation/LOCAL-SETUP.md) and [human live testing](docs/implementation/MANUAL-LIVE-PRODUCTION.md).

Local storage defaults to `.openslate/`. Set one explicit `OPENSLATE_DATA_DIR` when switching between launch modes; root `pnpm start` and filtered development commands otherwise have different working-directory defaults. Keep private storage outside `apps/web/dist`. Provider keys stay on the server.

## Development

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm check
```

The verified development/CI baseline is Node **24.15.0**, pnpm **10.33.0**, and FFmpeg/ffprobe **8.1.1**. Use `nvm install`, `nvm use`, `pnpm setup:test-media` and `pnpm check:toolchain` before running the full gate. The media setup reuses a matching installed pair or builds an isolated checksummed release; [contributing](CONTRIBUTING.md) lists prerequisites. Application startup continues to support Node 24.

Development UI: [127.0.0.1:5173](http://127.0.0.1:5173). Its `/api` proxy targets a disposable fixture studio on port 3101 (`pnpm studio:fixture`), never the live studio on 3001 unless `OPENSLATE_API_ORIGIN` says so. `pnpm check` builds, runs isolated offline tests and checks TypeScript; local integration tests need permission to bind loopback ports. Rebuild shared packages/restart development after changing them.

| Command | Purpose |
|---|---|
| `pnpm build` / `pnpm start` | Build and serve the studio/API on port 3001 |
| `pnpm studio:fixture` | Disposable fake-provider First Light studio on port 3101 for UI development |
| `pnpm check:browser` | Browser scenarios in headless Chrome against disposable fixture studios (needs Google Chrome) |
| `pnpm demo:headless` | Two-shot fake edit/restart proof without keys |
| `pnpm probe:workflow` | Synthetic sixty-shot, six-minute workflow |
| `pnpm probe:toolchain` | SQLite and optional local media-tool checks |
| `pnpm probe:runtime --codex /absolute/path/to/codex` | Pinned Codex compatibility probe with zero model turns |
| `pnpm probe:launcher` | Disposable real-process launcher check; port 3001 must be free |
| `pnpm installation export / inspect / restore` | Private same-machine [backup and recovery](docs/implementation/INSTALLATION-RECOVERY.md) |

`pnpm studio:fixture --film last-ferry` seeds the server with **The Last Ferry**: three scenes, eight shots, saved demo clips in Scene 1, returned frames and measured synthetic narration in Scene 2, and unstarted Scene 3. Scripted notes and a held duration proposal exercise the review controls. The data root is temporary; all media/provider activity is fake. This seed is distinct from the browser-only sample at `?fixture=last-ferry`, whose local fixture transport simulates routes without API/provider calls. Neither establishes media quality or live integration acceptance.

`pnpm check:browser` builds and runs the rendered next-UI scenarios against disposable state with system Google Chrome. It is a separate browser gate from the Node test suite; run it only where browser launching is supported. Codex card sandboxes must leave that gate to the lead, as their [rules](docs/ai/uiux-plan/codex/RULES.md) require.

```text
apps/web/             React studio and review controls
apps/server/          Application authority, SQLite, director supervision and execution
packages/core/        Contracts, workflow predicates and restricted plan compiler
packages/director/    Versioned skills/tools and fake/native director adapters
packages/providers/   Image, video, speech and transcription adapters
skills/               Immutable versioned runtime instruction inputs
workers/h3-python/    Reserved future same-machine inference boundary
docs/                 Current guides, technical references and dated evidence
```

Start with the [documentation index](docs/README.md), [architecture](docs/design/README.md), [remaining work](docs/design/IMPLEMENTATION-PLAN.md) and [contributing guide](CONTRIBUTING.md).

## License

[MIT](LICENSE). Third-party model weights and services retain their own licenses and terms.
