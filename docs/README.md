# OpenSlate Documentation

The design documents describe OpenSlate's intended architecture. The repository now contains an executable fake backend foundation; implemented behavior and outstanding validation gates are distinguished in the status page.

| Document | Contents |
|---|---|
| [Implementation status](implementation/STATUS.md) | Tested foundation, demo, compatibility evidence and remaining gates |
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
