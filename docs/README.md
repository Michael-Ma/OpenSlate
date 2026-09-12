# OpenSlate Documentation

The design documents describe OpenSlate's intended architecture. The repository now contains an interactive workspace with native or scripted direction, durable execution, canonical narration and owned local rendering. The status page distinguishes implemented behavior from outstanding integration and live validation. V0 runs for one user on one computer; local deployment still supports cloud LLM and media APIs. The accepted native policy trusts the pinned installed runtime/sandbox while retaining OpenSlate authorization and recovery.

| Document | Contents |
|---|---|
| [Implementation status](implementation/STATUS.md) | Tested foundation, demo, compatibility evidence and remaining gates |
| [Local launcher](implementation/LOCAL-LAUNCHER.md) | One built process for interface/API, private local state and clean shutdown |
| [Conversation workspace and local services](implementation/CONVERSATION-WORKSPACE.md) | Current UI, supervisor, native adapter, narration drafts, supplied-media renderer and verification |
| [Supervised Codex validation](implementation/CODEX-SUPERVISOR-VALIDATION.md) | Actual native supervisor question/restart/scoped-edit fixture passed; historical three-start experiment; later capability evidence linked below |
| [Local native setup](implementation/LOCAL-RUNTIME-SETUP.md) | Per-project installation and no-turn readiness checks |
| [Native browser validation](implementation/CODEX-BROWSER-VALIDATION.md) | Two browser conversations, restart and a persisted brief edit |
| [Native images and questions](implementation/CODEX-CAPABILITY-VALIDATION.md) | Bounded attached-image and structured-question evidence |
| [Native question continuation](implementation/CODEX-QUESTION-CONTINUATION.md) | One live answer resumed from the exact persisted application question |
| [Narration browser validation](implementation/NARRATION-BROWSER-VALIDATION.md) | Actual canonical review, supplied playback and project-switch recovery |
| [Narration integration](implementation/NARRATION-INTEGRATION.md) | Drafts, recordings, exact acceptance and guarded canonical commit |
| [Local media integration](implementation/MEDIA-INTEGRATION.md) | Owned uploads, render jobs, preview recovery and six-minute synthetic evidence |
| [GPT Image 2 transport](implementation/OPENAI-IMAGE.md) | Offline transport and required application integration |
| [MiniMax H3 transport](implementation/MINIMAX-H3.md) | Offline cloud transport, capability limits and uncertainty handling |
| [Provider execution boundary](implementation/PROVIDER-EXECUTION.md) | Registered executor contracts, receipt identity, ingestion and recovery |
| [Local image ingestion](implementation/IMAGE-INGESTION.md) | Full PNG validation, exact bytes and immutable publication |
| [Media credentials](implementation/MEDIA-CREDENTIALS.md) | Backend environment aliases and separation from spending authority |
| [Runtime trust decision](implementation/RUNTIME-TRUST-DECISION.md) | Accepted single-machine v0 boundary and pinned local native-runtime trust policy |
| [Codex probe](implementation/CODEX-PROBE.md) | Pinned no-turn runtime evidence and baseline limitations |
| [Codex live probe](implementation/CODEX-LIVE-PROBE.md) | Three-turn dispatch/interruption/resume evidence, history limitations and remaining gates |
| [Codex MCP follow-up](implementation/CODEX-MCP-FOLLOWUP.md) | Live MCP and model continuation after process replacement, with explicit limits |
| [Native skill validation](implementation/CODEX-SKILL-VALIDATION.md) | Two application-backed edits passed; command sandbox verified; code-host isolation inconclusive |
| [Codex validation allowance](implementation/CODEX-NEXT-VALIDATION.md) | Approved scope and accounting; all three starts consumed |
| [T06 skills/tools implementation](implementation/T06-SKILLS-TOOLS.md) | Shipped packages, locks, bridge, paged context, durable receipts and remaining integration |
| [Detailed technical designs](technical/README.md) | Component contracts, data model, algorithms, recovery, API/UI and verification |
| [Production workflow](technical/PRODUCTION-WORKFLOW.md) | AI stage selection, missing information, coded stage contracts and resumable scoped work |
| [Architecture](design/README.md) | Product scope, stack, high-level architecture, ownership, and production flow |
| [Component design](design/COMPONENT-DESIGN.md) | High-level diagrams, component ownership, and execution algorithms |
| [Skills and tools](design/SKILLS-AND-TOOLS.md) | Minimal capability set, loading, versioning, and multi-request lifecycle |
| [Execution and editing](design/EXECUTION-AND-EDITING.md) | Code-authored plans, parallel scheduling, scoped edits, and output reuse |
| [Commercial walkthrough](design/COMMERCIAL-WALKTHROUGH.md) | A 150-second boots commercial: narration, human review, services, and saved data |
| [Codex and providers](design/CODEX-AND-PROVIDERS.md) | What the runtime provides, what OpenSlate owns, and model extensibility |
| [Implementation plan](design/IMPLEMENTATION-PLAN.md) | Milestones, repository structure, acceptance criteria, and open decisions |
| [Review notes](design/REVIEW-NOTES.md) | Design review findings, corrections, and remaining validation work |

For installation and development commands, see the [project README](../README.md).
