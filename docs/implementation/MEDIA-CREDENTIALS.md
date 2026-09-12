# Backend media credential resolver

`EnvironmentMediaCredentials` provides a small trusted backend resolver with fixed aliases:

| Credential alias | Local server environment variable |
|---|---|
| `openai-media` | `OPENSLATE_OPENAI_API_KEY` |
| `minimax-video` | `OPENSLATE_MINIMAX_API_KEY` |

Only these two variables can be read. A caller cannot pass an arbitrary environment-variable name. The resolver's status contains aliases and configured booleans; it contains no credential value, raw backend error or secret-bearing serialized state. Resolution occurs at use time, so rotation is not cached indefinitely. An unavailable/malformed value produces a sanitized error before a transport is constructed.

This is an environment backend, not encrypted credential storage or a browser key-saving API. Configure values in the server's process environment; do not commit them, put them in URLs or add them to project plans, model context, logging or public status. OpenSlate's native Codex launch uses an explicit environment allowlist, and media subprocesses have their own minimal environment. These dedicated variable names avoid automatically adopting unrelated existing model credentials.

The resolver performs no network access and is not yet wired to live execution. Presence of a key does not enable a provider or authorize spending. The host still needs a selected immutable model/profile, exact candidate/review authority, durable submission intent, an explicit allowance and output ingestion. Ongoing accepted tasks retain liability if a rotated key cannot query them; changing credentials cannot prove an earlier request was absent.

Offline tests inject synthetic environment values and verify allowed lookup, metadata redaction, rejection of unknown aliases, malformed/unavailable values and rotation. No actual user credential was inspected during development.
