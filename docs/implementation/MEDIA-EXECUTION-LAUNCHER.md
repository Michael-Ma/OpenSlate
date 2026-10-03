# Provider activation

Host enablement chooses which compiled-in routes the local service can execute. A key, catalog row or browser model selection cannot enable a route. Enablement itself starts no generation; current in-app operation permission and finite usage/spending remain required.

| Route | Enable variable | Credentials/setup |
|---|---|---|
| OpenAI image | `OPENSLATE_ENABLE_IMAGE_GENERATION=1` | OpenAI media key |
| Codex image | `OPENSLATE_ENABLE_CODEX_IMAGE_GENERATION=1` | Absolute pinned image binary; existing ChatGPT login |
| Viggle H3 | `OPENSLATE_ENABLE_VIGGLE_H3_GENERATION=1` | Viggle key; `OPENSLATE_VIGGLE_H3_DOWNLOAD_HOSTS` |
| Direct MiniMax H3 | `OPENSLATE_ENABLE_H3_GENERATION=1` | MiniMax key; `OPENSLATE_H3_DOWNLOAD_HOSTS` |
| OpenAI speech | `OPENSLATE_ENABLE_SPEECH_GENERATION=1` | OpenAI media key |
| OpenAI transcription | `OPENSLATE_ENABLE_TRANSCRIPTION=1` | OpenAI media key |

Switches accept only `0`/`1` (unset is off). FFmpeg/ffprobe are required for enabled media execution. Download allowlists contain exact trusted HTTPS hostnames separated by commas, without scheme/path/wildcards. An output-host error after video creation should recover the known job after correcting the allowlist and restarting; do not create a replacement.

Use [local setup](LOCAL-SETUP.md), choose an explicit [provider catalog](PROVIDER-CATALOG.md), then restart with `./start.sh --restart`. The server composes registered adapters, durable receipts/spooling, media ingestion, exact external allowances and local assembly. A catalog readiness view reports local prerequisites; it never verifies media access/quota or starts an API request.

## Existing projects

Projects retain saved profile/assembly definitions. Current model preview/apply changes defaults and eligible unfinished work while protecting completed, in-flight and separately reviewed audio work. Historical locks without the required local assembly pin can remain incompatible for video; the server reports this rather than silently rewriting history.

Media routes use backend-only credential aliases. Codex conversation setup and the Codex image account are distinct. There is no automatic switch between Codex subscription usage and API billing, or another provider fallback.

Source: `apps/server/src/application/media-execution-config.ts`, `media-execution-runtime.ts`, `provider-credentials.ts`; server bootstrap. Tests cover malformed config, prerequisites, fixed routing, exact admission and zero dispatch on missing authority. Real media acceptance is recorded separately in [status](STATUS.md) and [human testing](MANUAL-LIVE-PRODUCTION.md).
