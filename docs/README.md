# OpenSlate Documentation

The design documents describe OpenSlate's intended architecture. The repository now contains an interactive workspace with native or scripted direction, durable execution, canonical narration and owned local rendering. The status page distinguishes implemented behavior from outstanding integration and live validation. V0 runs for one user on one computer; local deployment still supports cloud LLM and media APIs. The accepted native policy trusts the pinned installed runtime/sandbox while retaining OpenSlate authorization and recovery.

| Document | Contents |
|---|---|
| [Implementation status](implementation/STATUS.md) | Tested foundation, demo, compatibility evidence and remaining gates |
| [Fresh checkout validation](implementation/CLEAN-CHECKOUT-VALIDATION.md) | New source/dependencies, build, default launcher and offline demo on macOS |
| [Local launcher](implementation/LOCAL-LAUNCHER.md) | One built process for interface/API, private local state and clean shutdown |
| [Opt-in media execution](implementation/MEDIA-EXECUTION-LAUNCHER.md) | Independent provider activation, truthful setup status and no-key browser evidence |
| [Automatic local assembly](implementation/AUTOMATIC-LOCAL-ASSEMBLY.md) | Real Engine timeline/render, immutable recipes, content reuse and restart recovery |
| [Installation recovery](implementation/INSTALLATION-RECOVERY.md) | Private same-root backup/restore CLI, quarantine and permanent imported-authority fences |
| [Recovery browser validation](implementation/INSTALLATION-RECOVERY-VALIDATION.md) | Interrupted restore, read-only preview, human release and fresh scoped edit |
| [Database migrations](implementation/DATABASE-MIGRATIONS.md) | Versioned schema, verified pre-upgrade backups and WAL-consistent restore |
| [Conversation workspace and local services](implementation/CONVERSATION-WORKSPACE.md) | Current UI, supervisor, native adapter, narration drafts, supplied-media renderer and verification |
| [Supervised Codex validation](implementation/CODEX-SUPERVISOR-VALIDATION.md) | Actual native supervisor question/restart/scoped-edit fixture passed; historical three-start experiment; later capability evidence linked below |
| [Local native setup](implementation/LOCAL-RUNTIME-SETUP.md) | Per-project installation and no-turn readiness checks |
| [Native browser validation](implementation/CODEX-BROWSER-VALIDATION.md) | Two browser conversations, restart and a persisted brief edit |
| [Native images and questions](implementation/CODEX-CAPABILITY-VALIDATION.md) | Bounded attached-image and structured-question evidence |
| [Native question continuation](implementation/CODEX-QUESTION-CONTINUATION.md) | One live answer resumed from the exact persisted application question |
| [Browser question validation](implementation/CODEX-QUESTION-BROWSER-VALIDATION.md) | Actual native question answered through the browser after reopen, exact replay and independent audit |
| [Narration browser validation](implementation/NARRATION-BROWSER-VALIDATION.md) | Actual canonical review, supplied playback and project-switch recovery |
| [Narration integration](implementation/NARRATION-INTEGRATION.md) | Drafts, recordings, exact acceptance and guarded canonical commit |
| [Narration capability follow-up](implementation/CODEX-NARRATION-CAPABILITY-VALIDATION.md) | One live turn correctly explains unavailable synthesis and the supported recording path |
| [Native stage and gap validation](implementation/CODEX-STAGE-GAP-VALIDATION.md) | Two scoped narration turns, independent semantic review and explicit application capability disclosure |
| [Native narration validation](implementation/CODEX-NARRATION-V2-VALIDATION.md) | One actual V2 draft edit after an explicit guidance upgrade, with preserved acceptance and authority |
| [Versioned narration tools](implementation/NARRATION-TOOLS.md) | Draft-only conversational writes, exact catalog locks and legacy compatibility |
| [Project guidance upgrades](implementation/DIRECTOR-TOOLS-UPGRADE.md) | Explicit human upgrade, old-epoch preservation and browser evidence |
| [Local media integration](implementation/MEDIA-INTEGRATION.md) | Owned uploads, render jobs, preview recovery and six-minute synthetic evidence |
| [Six-minute workflow probe](implementation/SIX-MINUTE-WORKFLOW.md) | Sixty shots, exact batch review, one-shot reuse and uncertain-job restart using fake media |
| [Speech application execution](implementation/OPENAI-SPEECH-EXECUTION.md) | Exact consumed approval, one-use speech dispatch and complete unadopted audio recovery |
| [Transcription application execution](implementation/OPENAI-TRANSCRIPTION-EXECUTION.md) | Exact owned upload and consumed approval, one-use dispatch, raw JSON recovery and backup closure |
| [Generated narration attachment](implementation/GENERATED-NARRATION-ATTACHMENT.md) | Verified human selection, exact canonical generation history, browser review and restart evidence |
| [Transcript review and adoption](implementation/TRANSCRIPT-REVIEW-ADOPTION.md) | Implemented bounded review, separate human writing/timing choices and canonical/backup provenance |
| [Audio activation and narration planning](implementation/AUDIO-ACTIVATION.md) | Implemented audio configuration/preflight/spending/runtime; planned preparation waiting, owned draft sources, generation review and chunks |
| [Audio preparation waiting](implementation/AUDIO-PREPARATION-WAITING.md) | Planned same-attempt local waiting before the one-use provider dispatch marker |
| [Audio execution bridge plan](implementation/AUDIO-APPLICATION-BRIDGES.md) | Implemented speech/transcription mappings, dispatch and raw-result recovery; candidate integration linked |
| [Unreviewed transcript candidates](implementation/TRANSCRIPT-CANDIDATES.md) | Exact recording/dispatch provenance, atomic publication and backup recovery; human adoption remains separate |
| [Transcription audio preparation](implementation/TRANSCRIPTION-AUDIO-PREPARATION.md) | Verified complete-source 16 kHz derivative, six-minute recovery, parser and timing helper |
| [Generated audio ingestion](implementation/GENERATED-AUDIO-INGESTION.md) | Verified raw storage, complete PCM normalization, provenance and six-minute recovery; later transcript phases |
| [OpenAI audio transports](implementation/OPENAI-AUDIO-TRANSPORTS.md) | Standalone speech/transcription transports, exact wire identity, cancellation and offline evidence |
| [GPT Image 2 transport](implementation/OPENAI-IMAGE.md) | Offline transport and required application integration |
| [MiniMax H3 transport](implementation/MINIMAX-H3.md) | Offline cloud transport, capability limits and uncertainty handling |
| [H3 application execution](implementation/MINIMAX-H3-EXECUTION.md) | Exact reviewed PNG transfer, one POST, durable polling and protected output recovery |
| [Human spending review](implementation/SPENDING-REVIEW.md) | Exact browser allowance/revocation, separate project-budget review and actual browser evidence |
| [Allowance HTTP](implementation/ALLOWANCE-HTTP.md) | Authenticated purpose-bound commands, durable replay and paginated coverage |
| [Project budget revisions](implementation/PROJECT-BUDGET.md) | Independent audited cap changes with revision and value checks |
| [Shared timeline capture](implementation/TIMELINE-CAPTURE.md) | Exact SQL source/audio resolution reused by human and future automatic rendering |
| [Pinned project local execution](implementation/PROJECT-LOCAL-EXECUTION.md) | Host-only new-project pins retained across edits and restart |
| [Immutable timeline documents](implementation/LOCAL-TIMELINE-DOCUMENT.md) | Exact content identity, verified owned JSON and recovery |
| [Local cancellation and recovery](implementation/LOCAL-MEDIA-RECOVERY.md) | Original-signal propagation, bounded reads and cleanup before return |
| [Trusted local assembly identity](implementation/LOCAL-EXECUTION-IDENTITY.md) | Optional host-only compiler identity with exact legacy compatibility |
| [External spending allowances](implementation/EXTERNAL-SPENDING-ALLOWANCES.md) | Human candidate/profile limits, permanent admission consumption and revocation |
| [Provider execution boundary](implementation/PROVIDER-EXECUTION.md) | Registered executor contracts, receipt identity, ingestion and recovery |
| [Frozen provider routing](implementation/PROVIDER-ROUTING.md) | Immutable adapter catalog, pinned profiles, separate spending admission and provider-call leases |
| [Installed model catalog](implementation/PROVIDER-CATALOG.md) | Trusted profile definitions, local readiness and immutable new-project selection |
| [Image execution bridge](implementation/OPENAI-IMAGE-EXECUTION.md) | Exact admitted image requests, durable single dispatch and response recovery |
| [Owned spool completions](implementation/SPOOL-COMPLETIONS.md) | Versioned completion receipts, local recovery, exact PNG ingestion and lease protection |
| [Generated video normalization](implementation/GENERATED-VIDEO-DERIVATION.md) | Separate raw/normalized identities, measured frames and durable derivation recovery |
| [Media ingestion composition](implementation/INGESTION-COMPOSITION.md) | Deliberate PNG/video/fixture routing and a generated-take local-render proof |
| [Durable output storage](implementation/OUTPUT-SPOOL.md) | Owned receipt/spool identities, bounded streaming and crash recovery |
| [Protected video downloading](implementation/VIDEO-DOWNLOAD.md) | Pinned HTTPS destination, bounded streams, cancellation and durable spool integration |
| [Local image ingestion](implementation/IMAGE-INGESTION.md) | Full PNG validation, exact bytes and immutable publication |
| [PNG reference library](implementation/PNG-REFERENCE-IMPORT.md) | Supplied-image import, conversational reference identity and verified browser preview |
| [Director image attachments](implementation/DIRECTOR-IMAGE-ATTACHMENTS.md) | Explicit request selections, bounded thumbnails, immutable receipts and read-only discussion |
| [Browser image discussion validation](implementation/CODEX-IMAGE-ATTACHMENT-VALIDATION.md) | One actual reference discussion, preserved state, refresh, native cleanup and exact identities |
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
