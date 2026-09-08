# OpenSlate — Design Review Notes

**Reviewed:** September 8, 2026. These notes record the architecture review before the initial application skeleton. Current build checks are reported separately in repository CI.

## Review method

The primary author drafted the architecture, ten component breakdowns, ownership map, and phased plan. Three independent agents researched/reviewed Codex integration, media/H3 architecture, and execution reliability. The author evaluated their findings, revised the documents, and checked the resulting cross-document consistency and internal navigation.

Provider/runtime facts were checked against primary documentation. Suggested OpenSlate interfaces and behavior are labeled as proposals. No image/video generation was purchased and no end-to-end runtime, provider, or render test was performed.

## Material findings resolved in the draft

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

## Cross-component checks

The final draft addresses the whole production loop: brief, story/bible, scenes/shots, reference assets, prompt compilation, generation, take review, timeline/audio, render/post-processing, and selective revision. Each has an owner and an output artifact or committed state.

It also distinguishes creative acceptance from technical completion; project persistence from conversation history; provider completion from local ingestion; a requested cancellation from a confirmed outcome; and estimated admission control from exact provider billing. The local worker reuses the provider boundary without claiming cloud capability parity.

The roadmap starts with a small complete video and a fake provider. It reserves advanced editor features, multiple autonomous directors, hosted multi-user infrastructure, and GPU inference for demonstrated needs or later phases.

## Remaining uncertainty

- Product assumptions still need confirmation: first genre/duration, local versus hosted distribution, and default autonomy. Imported narration/music is a proposed initial scope.
- Codex integration is documentation-backed. Compatibility testing of the intended pinned runtime remains a Phase 0 gate.
- Account-specific API access, transfer behavior, latency, concurrency, usage reporting, and real generation quality require bounded live pilots during implementation.
- No exactly-once external generation guarantee is claimed. Lost-response cases remain visible and conservatively accounted for unless provider evidence resolves them.
- The exact GPU/runtime, performance, and license packaging for local H3 remain Phase 5 decisions.
- Markdown structure, local links, and diagram definitions were checked. Mermaid rendering has not been visually tested in a separate renderer.

These are explicit validation gates or product choices, not completed implementation work. The artifact is ready for architecture discussion and a Phase 0 prototype after those assumptions are accepted or adjusted.

Return to the [main design](README.md), [component breakdown](COMPONENT-DESIGN.md), or [implementation plan](IMPLEMENTATION-PLAN.md).
