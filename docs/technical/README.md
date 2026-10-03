# Technical references

Current source-backed component references, reconciled October 3, 2026. These are internal implementation boundaries, not a stable public SDK. [Status](../implementation/STATUS.md) records verified scenarios and outstanding live acceptance; [architecture](../design/README.md) explains the system as a whole.

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
| Saved edit, playback and local export | [Timeline/rendering](TIMELINE-RENDERING.md) | Server media; web Timeline |
| Human interaction and browser state | [Review UI](REVIEW-UI.md) | Web studio and typed API |
| Launch, diagnostics and tests | [Operations/testing](OPERATIONS-TESTING.md) | Scripts; server launch/recovery; tests |

## Shared invariants

- SQLite and owned media preserve production state independently of chat history and browser caches.
- Revision/spec/review/receipt identities remain immutable; heads and selections advance through trusted commands.
- Models propose data. The compiler never executes generated code; the tool bridge never accepts model-provided human authority.
- A generation grant, spending allowance and returned-frame/motion approval serve different predicates.
- A creative candidate and an attempt are different records. A timeout or expired lease cannot authorize a duplicate paid submission.
- Scoped edits preserve compatible work, retain old evidence and cannot publish a late old output into a newer selection.
- Stop, request epochs, edit-hold ownership and recovery quarantine remain independent of progress/status display.
- Provider presence/readiness is not live access, pricing or quality verification.
- V0 assumes one user and one computer, including trust in the pinned local Codex runtime/sandbox.

Current types live in [core contracts](../../packages/core/src/contracts.ts). Time uses integer 30 fps frames and 48 kHz sample coordinates at the local media boundary; USD estimates/caps use nonnegative integer micros serialized as decimal strings. This is application accounting, not a vendor billing guarantee.
