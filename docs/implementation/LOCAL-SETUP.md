# Local setup

OpenSlate runs from a source checkout on one computer. The launcher installs locked project dependencies and builds the studio; installer packaging and bundled operating-system tools are still pending.

## First run

1. Install **Node 24**; with nvm use `nvm install 24` and `nvm use 24`.
2. The pinned package manager is **pnpm 10.33.0**. The launcher can use that version through npx; alternatively install it with `npm install --global pnpm@10.33.0`.
3. For media import/export, use the verified FFmpeg/ffprobe **8.1.1** pair (`brew install ffmpeg` may select a different release). `pnpm setup:test-media` can build the pinned pair in an isolated repository cache; set `OPENSLATE_FFMPEG` and `OPENSLATE_FFPROBE` to the printed absolute paths when using that pair in the studio. A source build of SQLite may also require Python and compiler tools.
4. Run `./start.sh --init-config` to create ignored private `.env.live.local`; an existing file is preserved.
5. Run `./start.sh --doctor` or `--doctor --json` for redacted local checks, then `./start.sh`.

The studio opens at `http://127.0.0.1:3001` with a short-lived pairing link. Keep the startup terminal open. Demo profiles need no provider keys or native runtime and make no paid media calls. Missing media tools are a warning in demo mode; real enabled routes fail setup when their prerequisites are absent. Doctor starts no server and makes no provider request.

## Models and accounts

Use an explicit `OPENSLATE_PROVIDER_CONFIG` based on the [example catalog](../../examples/live-provider-profiles.example.json). Keep profile estimates conservative and label them as estimates; keep keys outside catalog JSON.

| Service | Server configuration |
|---|---|
| OpenAI image/speech/transcription | `OPENSLATE_OPENAI_API_KEY`; separate image/speech/transcription enable switches |
| Viggle H3 | `OPENSLATE_VIGGLE_API_KEY`, video enable switch and exact download hosts |
| Direct MiniMax H3 | `OPENSLATE_MINIMAX_API_KEY`, H3 enable switch and exact download hosts |
| Codex images | Existing ChatGPT login, absolute supported `OPENSLATE_CODEX_IMAGE_BINARY`; optional existing Codex home |

See [activation variables](MEDIA-EXECUTION-LAUNCHER.md). Local credential presence does not verify provider access, quota or voice eligibility. A selected model or enabled route creates no paid work; review the intended operation and finite allowance in the app.

The native director is configured separately. Use a pinned Codex 0.153.4 executable and complete its zero-turn local setup check. Its ChatGPT/API login is independent of media API keys; the image worker requires ChatGPT login. OpenSlate does not copy login credentials into project files.

## Storage and restart

Set one explicit `OPENSLATE_DATA_DIR` when changing launch modes. Root `pnpm start` defaults to repository `.openslate`; filtered/development server commands can otherwise point to a different directory. Keep data outside the public `apps/web/dist` bundle. The normal launcher reads `.env.live.local`, with exported variables taking precedence.

After changing code, keys, catalog or enable switches, run `./start.sh --restart`; it authenticates and verifies the existing process before graceful shutdown/rebuild. `--status` only inspects. See [launcher details](LOCAL-LAUNCHER.md), [human live testing](MANUAL-LIVE-PRODUCTION.md) and [backup/recovery](INSTALLATION-RECOVERY.md).
