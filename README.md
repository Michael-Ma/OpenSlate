# OpenSlate

An open-source local video studio with a conversational director and an editable storyboard.

Develop a film as **treatment → scenes → shots → reviewed keyframes → video → Timeline/export**. OpenSlate keeps the production editable while selected model providers generate the media. The application, database, files and workers run on your computer; enabled model services may run in the cloud.

**Early development.** Planning, scoped editing, reviewed generation, narration and local export are implemented. One real Codex-image → Viggle H3 → six-second export has been verified. Full conversational production, the other live media routes and user quality acceptance are still being tested. New voice cloning from a recording and installer packaging are not complete. See [current status](docs/implementation/STATUS.md).

## What makes the studio different

- **The film survives the conversation.** OpenSlate owns canonical project state, revisions, media, approvals and execution. The replaceable director reads that state and proposes validated changes; conversation history is not the production database.
- **Plans become durable work.** The director writes a restricted TypeScript declaration. OpenSlate parses and compiles it into a dependency graph, without evaluating model-authored JavaScript. Workers dispatch ready operations and recover progress without a model turn for every poll.
- **Edits preserve unaffected work.** Stable shot identities, exact input bindings and scoped change preparation let a framing, motion or narration edit reuse valid outputs. Saved edits can be continued together when the new request covers their scopes.
- **Reviews bind the actual work.** Video uses the exact reviewed keyframe and motion specification. Generation permission and finite usage/spending approval stay attached to the intended operation, rather than a general chat instruction.
- **Uncertain submissions remain recoverable.** Service-issued candidates, attempts and persisted submission intents retain the same paid job after a timeout or restart. An unknown outcome does not cause a blind replacement submission.
- **Audio belongs to the film.** Explicit silent shots use planned picture duration. Short accepted voiceover fits inside its shot; synchronized Timeline playback and local FFmpeg export use the same saved media and ranges.
- **Models are interchangeable through adapters.** Image, video, speech and transcription choices are separate. Profiles and exact definitions are saved with each project; changing the installation catalog does not silently change an existing film.

These are implemented design choices, not claims of commercial media quality or novel research.

## Use the studio

Edit treatment, scenes and shots directly, or refine a selected shot in chat. Bring an existing text/Markdown brief, reference image, owned recording or supplied clip. Review generation in the studio, inspect each returned frame and motion, then audition picture, narration and optional music in Timeline before exporting.

Personal voice support currently registers an existing eligible OpenAI custom voice ID with consent and revocation. Creating a new clone inside OpenSlate remains pending. Waveforms, transitions and richer audio mixing are later work.

The studio uses **OpenSlate Light**, the selected A workspace direction built on Radix Themes: white panels, a pale gray canvas, clear blue actions and shared component states. A resizable Director stays on the left; the selected shot is prominent beside compact supporting shots. Selecting a shot keeps its stable identity and chronological label. Chat renders safe GitHub-flavored Markdown, and background updates preserve the connected workspace.

The current-plan card shows **Saved / Next** from actual project, Director, review and job state. Eligible unfinished edits expose their saved scope and direction with **Resume this edit**; an active request instead shows progress, and an unanswered question points to its answer. Resuming sends a new scoped Director request; generation and spending retain their separate review.

**Models for this project** focuses on Director, Keyframes, Video and Narration, with transcription, accounts, local setup and existing voice identities available when needed. Director and media choices have separate saves and recovery. The [studio guide](docs/design/STORYBOARD-STUDIO.md), [design system](docs/design/OPENSLATE-LIGHT.md) and [October 5 verification](docs/implementation/OCTOBER-5-LIGHT-WORKSPACE.md) describe the delivered UI and its limits.

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

Default demo models need no API keys and make no paid media calls. FFmpeg/ffprobe are needed for media import and export. For real models, configure keys on the local server and choose a supported provider catalog. A configured key or selected model does not start generation. See [setup](docs/implementation/LOCAL-SETUP.md) and [human live testing](docs/implementation/MANUAL-LIVE-PRODUCTION.md).

Local storage defaults to `.openslate/`. Set one explicit `OPENSLATE_DATA_DIR` when switching between launch modes; root `pnpm start` and filtered development commands otherwise have different working-directory defaults. Keep private storage outside `apps/web/dist`. Provider keys stay on the server.

## Development

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm check
```

Development UI: [127.0.0.1:5173](http://127.0.0.1:5173). `pnpm check` builds, runs isolated offline tests and checks TypeScript; local integration tests need permission to bind loopback ports. Rebuild shared packages/restart development after changing them.

| Command | Purpose |
|---|---|
| `pnpm build` / `pnpm start` | Build and serve the studio/API on port 3001 |
| `pnpm demo:headless` | Two-shot fake edit/restart proof without keys |
| `pnpm probe:workflow` | Synthetic sixty-shot, six-minute workflow |
| `pnpm probe:toolchain` | SQLite and optional local media-tool checks |
| `pnpm probe:runtime --codex /absolute/path/to/codex` | Pinned Codex compatibility probe with zero model turns |
| `pnpm probe:launcher` | Disposable real-process launcher check; port 3001 must be free |
| `pnpm installation export / inspect / restore` | Private same-machine [backup and recovery](docs/implementation/INSTALLATION-RECOVERY.md) |

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
