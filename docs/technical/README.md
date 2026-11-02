# Technical references

Current source-backed component references. These are internal implementation boundaries, not a stable public SDK. [Status](../implementation/STATUS.md) records verified scenarios and outstanding live acceptance; [architecture](../design/README.md) explains the system as a whole.

| Component | Reference | Source ownership |
|---|---|---|
| Canonical state and persistence | [Data](DATA-PERSISTENCE.md) | Core contracts; server persistence |
| Human commands, transactions and events | [Application API](APPLICATION-API.md) | Server app/application/routes |
| Native conversation and supervision | [Director runtime](DIRECTOR-RUNTIME.md) | Director adapter; server supervisor |
| Scoped readiness and mutation rules | [Production workflow](PRODUCTION-WORKFLOW.md) | Core workflow; production service |
| Immutable instruction/catalog locks | [Skills and tools](SKILLS-TOOLS.md) | Director skills/bridge; core schemas |
| Restricted declarations and change impact | [Plan compiler](PLAN-COMPILER.md) | Core planning; production service |
| Admission, attempts and recovery | [Execution engine](EXECUTION-ENGINE.md) | Server execution modules |
| Writing, recordings and accepted cues | [Narration](NARRATION.md) | Server narration/media; audio adapters |
| Models, transport and owned outputs | [Providers and artifacts](PROVIDERS-ARTIFACTS.md) | Provider package; server execution/media |
| Saved edit, playback and local export | [Timeline/rendering](TIMELINE-RENDERING.md) | Server media; next Film |
| Human interaction and browser state | [Review UI](REVIEW-UI.md) | Web studio and typed API |
| Launch, diagnostics and tests | [Operations/testing](OPERATIONS-TESTING.md) | Scripts; server launch/recovery; tests |

## Shared invariants

- SQLite and owned media preserve production state independently of chat history and browser caches.
- Revision/spec/review/receipt identities remain immutable; heads and selections advance through trusted commands.
- Models propose validated changes. The storyboard compiler does not execute its declarations; code films evaluate programs only inside disposable QuickJS/WASM workers with bounded host calls. The bridge never accepts model-provided human authority.
- Storyboard films use two scene decisions: keyframes, then exact returned-frame/motion/video confirmation. Code films execute a saved program within a spending ceiling and confirm declared-shot keyframe/video inputs. Returned clips need no further acceptance gate. Configured providers require no separate API-key or usage approval.
- A creative candidate and an attempt are different records. A timeout or expired lease cannot authorize a duplicate paid submission.
- Scoped edits preserve compatible work, retain old evidence and cannot publish a late old output into a newer selection.
- Stop, request epochs, edit-hold ownership and recovery quarantine remain independent of progress/status display.
- Provider presence/readiness is not live access, pricing or quality verification.
- V0 assumes one user and one computer, including trust in the pinned local Codex runtime/sandbox and the configured Claude Code process for code films.

Current browser types live in [studio-api.ts](../../packages/core/src/studio-api.ts), alongside [core contracts](../../packages/core/src/contracts.ts). The only UI is `apps/web/src/next`; [Application API](APPLICATION-API.md) documents its overview, confirm, narration-fit, takes, notes, proposals, export, asset and recording commands plus retained diagnostics. Time uses integer 30 fps frames and 48 kHz sample coordinates at the local media boundary; USD estimates and retained reservation liabilities use nonnegative integer micros serialized as decimal strings. They are estimates, not a vendor billing guarantee. Code films default to a $4 ceiling, unless overridden for the film/new-film preference; graph execution has no project budget accounting. Codex 0.162.1 defaults to gpt-6.1-sol; Claude Code is an optional code-film Director. See the runtime reference for exact setup and compatibility.
