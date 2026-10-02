# Local setup

OpenSlate runs as a source checkout on one computer. It uses Node 24, pnpm 10.33.0 and FFmpeg/ffprobe for media processing. The launcher installs locked project dependencies and builds the app; it does not install an operating-system runtime or change your provider keys.

## First run

1. Install Node 24. If using nvm: `nvm install 24` and `nvm use 24`.
2. Install FFmpeg: `brew install ffmpeg` on macOS. Ubuntu CI uses `sudo apt-get install ffmpeg`.
3. Run `./start.sh --init-config` to create a private, ignored `.env.live.local`. Existing files are preserved.
4. Run `./start.sh --doctor`. The report lists every local blocker with its remedy. `--doctor --json` produces a redacted machine-readable report.
5. Run `./start.sh`. The built studio opens at `http://127.0.0.1:3001/` using a short-lived pairing link. Keep the startup terminal open.

With all real-generation switches set to `0`, demo profiles require no provider keys. Missing FFmpeg is a warning in demo mode because planning remains available, while media import/export needs the tools. `--doctor` performs no installation, server start, credential write or provider request.

## Real models

Select an explicit provider catalog using `OPENSLATE_PROVIDER_CONFIG`. Start from the checked-in examples, retain their exact model/profile contract and set conservative per-attempt estimates. New projects and the project's model settings choose from the installed catalog.

| Service | Local configuration |
|---|---|
| OpenAI image, stock speech, transcription | `OPENSLATE_OPENAI_API_KEY` and the corresponding `OPENSLATE_ENABLE_*` switch |
| Viggle H3 | `OPENSLATE_VIGGLE_API_KEY`, `OPENSLATE_ENABLE_VIGGLE_H3_GENERATION=1`, `OPENSLATE_VIGGLE_H3_DOWNLOAD_HOSTS` |
| Direct MiniMax H3 | `OPENSLATE_MINIMAX_API_KEY`, `OPENSLATE_ENABLE_H3_GENERATION=1`, `OPENSLATE_H3_DOWNLOAD_HOSTS` |
| Codex images | The existing Codex login and an absolute `OPENSLATE_CODEX_IMAGE_BINARY` path to supported Codex 0.153.4; enable its image route |

Video output host allowlists contain the provider's documented host names separated by commas, without a URL scheme, path or wildcard. API keys are server-only; the browser sees presence/readiness, never their values.

Local readiness means configuration is present. It does not verify provider access, quotas, organization eligibility or voice ownership, and it does not authorize generation. The application still requires exact human generation review and separate finite usage/spending permission.

After editing keys, provider switches, catalog files or code, run `./start.sh --restart`. The launcher first authenticates and identifies the existing production server, then gracefully restarts it. `./start.sh --status` inspects the current server without rebuilding.

See [manual live validation](MANUAL-LIVE-PRODUCTION.md) for actual API validation and [local launcher behavior](LOCAL-LAUNCHER.md) for ownership/recovery details.
