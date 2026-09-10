# OpenSlate — Design Review Notes

## Revision 0.2 — September 10, 2026

This revision responds to the request for a smaller initial skill/tool set, reliable capability lifecycle across requests, code-authored fast execution, live targeted edits, and a high-level component document. It changes design documents only; the application remains a skeleton.

### Changes reviewed

- Two initial skills, with continuity and asset direction kept as production references.
- OpenSlate-owned immutable package/handler locks and explicit activation across requests, separate from native Codex discovery.
- Five typed domain tools, including project-only creative changes before plan code exists.
- Restricted TypeScript plan source compiled without side effects into a durable operation graph.
- Parallel ready-work execution, semantic versus execution dependencies, and result reuse across plan revisions.
- Scoped edit holds, atomic patches, stale-result protection, and explicit user-pause ownership.
- Short diagrams and execution algorithms in the component overview, with dedicated framework/execution companions.

### Review findings incorporated

| Finding | Resolution |
|---|---|
| Discussion-only decisions had no persistence route | Prepare/apply tools accept a project-only variant without generating execution intents |
| Literal prompt text could remain unchanged after creative intent changed | Bind prompts/specs to generation-relevant intent; require reauthoring or reconfirmation before reuse/dispatch |
| Edit scope could miss semantic dependents | Initial hold covers known semantic and execution influence; newly discovered in-flight work is reported honestly |
| Patch completion or model controls could override a user pause | Release only the owned edit hold; all other applicable controls remain in force |

Independent Codex-framework and execution-reliability reviews were followed by an author consistency pass. Validation checks document links, code fences, diagram structure, and alignment across architecture, component, framework, execution, and roadmap documents. Diagram rendering and the illustrative planning language are not runtime-validated implementations.

The new native Codex claims were checked against official skill, MCP, and App Server documentation. Compatibility with the chosen release, precise planning-language support, provider behavior, real speed gains, and creative quality remain implementation gates. The defaults for video format, distribution, and autonomy remain provisional.

## Revision 0.1 — September 8, 2026 (historical)

The following records the initial architecture review before the application skeleton and the 0.2 document reorganization. References to component count and document layout describe that earlier snapshot. Current behavior is proposed in the 0.2 documents; build checks are tracked separately in CI.

### Initial review method

The primary author drafted the architecture, ten component breakdowns, ownership map, and phased plan. Three independent agents researched/reviewed Codex integration, media/H3 architecture, and execution reliability. The author evaluated their findings, revised the documents, and checked the resulting cross-document consistency and internal navigation.

Provider/runtime facts were checked against primary documentation. Suggested OpenSlate interfaces and behavior are labeled as proposals. No image/video generation was purchased and no end-to-end runtime, provider, or render test was performed.

### Material findings resolved in the draft

| Finding | Resolution |
|---|---|
| A replayed agent can invent new operation IDs and repeat paid work | Service-owned generation intents/candidates, uniqueness checks, and revision-checked regeneration actions |
| Lost runtime turn-start acknowledgment could cause another turn | Reconcile runtime and project evidence before restarting; at-least-once wakeups with domain deduplication |
| Runtime approval/input events lacked a return path | Added normalized pending requests, reply operation, timeout/cancellation, and a Phase 0 round-trip test |
| A project-scoped MCP process could be reused across projects incorrectly | Project/action-scoped capabilities and per-project runtime/bridge lifecycle |
| Completion events could restart a director the user interrupted | Persist automation pause until explicit resume; keep dispatch and accepted-job monitoring separate |
| H3 cancel/delete has a terminal-state race | Disable H3 remote cancellation in v0 unless a safe method is verified; stop new dispatch while preserving accepted jobs |
| Strict lease fencing could discard a delayed successful receipt | Permit correlated append-only receipt evidence; only current owner updates canonical job state |
| Synchronous image generation did not fit the asynchronous job diagram | Added direct submission-to-ingestion and definite-rejection paths; distinguished render phases |
| User-approved replacement could erase original unknown liability | Separate replacement reservation; preserve original uncertain/estimated charge |
| H3 image-to-video could use the wrong composition despite correct final export size | Prepare and record correctly shaped keyframe derivatives before submission |
| Optional context enhancement could be confused with vendor-internal processing | Distinguish extra standalone enhancement jobs from the normal hosted request pipeline |
| Hybrid local/cloud execution could hide hosted calls inside Python | TypeScript composes explicit hosted and local jobs; Python retains inference-only responsibility |

### Cross-component checks

The final draft addresses the whole production loop: brief, story/bible, scenes/shots, reference assets, prompt compilation, generation, take review, timeline/audio, render/post-processing, and selective revision. Each has an owner and an output artifact or committed state.

It also distinguishes creative acceptance from technical completion; project persistence from conversation history; provider completion from local ingestion; a requested cancellation from a confirmed outcome; and estimated admission control from exact provider billing. The local worker reuses the provider boundary without claiming cloud capability parity.

The roadmap starts with a small complete video and a fake provider. It reserves advanced editor features, multiple autonomous directors, hosted multi-user infrastructure, and GPU inference for demonstrated needs or later phases.

### Remaining uncertainty

- Product assumptions still need confirmation: first genre/duration, local versus hosted distribution, and default autonomy. Imported narration/music is a proposed initial scope.
- Codex integration is documentation-backed. Compatibility testing of the intended pinned runtime remains a Phase 0 gate.
- Account-specific API access, transfer behavior, latency, concurrency, usage reporting, and real generation quality require bounded live pilots during implementation.
- No exactly-once external generation guarantee is claimed. Lost-response cases remain visible and conservatively accounted for unless provider evidence resolves them.
- The exact GPU/runtime, performance, and license packaging for local H3 remain Phase 5 decisions.
- Markdown structure, local links, and diagram definitions were checked. Mermaid rendering has not been visually tested in a separate renderer.

These are explicit validation gates or product choices, not completed implementation work. The artifact is ready for architecture discussion and a Phase 0 prototype after those assumptions are accepted or adjusted.

Return to the [main design](README.md), [component breakdown](COMPONENT-DESIGN.md), or [implementation plan](IMPLEMENTATION-PLAN.md).
