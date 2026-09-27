# OpenSlate development plan

Updated September 27, 2026. Current evidence is maintained in [implementation status](../implementation/STATUS.md), rather than repeated here as a chronological development log.

## Fixed scope

Single-user local app, TypeScript orchestration, Codex as the first replaceable director, pluggable cloud image/video/audio providers, up to six-minute videos, keyframe review before clips, and conversational scoped edits. Timeline editing, local H3 inference, distributed execution and 10–30-minute productions are later extensions.

## Completed foundation

| Work | Delivered |
|---|---|
| T00–T04 | Runtime/toolchain probes, domain identities, persistence, commands/events, workflow stage contracts, restricted compiler, durable fake execution and human approval |
| T05–T08 | Conversation/review UI, native Codex, versioned skills/tools, narration preparation and owned media/timeline/rendering |
| T09–T12 integration | Provider adapters, durable dispatch/output recovery, independent spending, audio review/adoption, model changes, SSE, backup/restore and local launcher |
| Initial T13 evidence | Offline six-minute workflow and one real six-second Codex-image/Viggle/export run |

Component implementation does not imply complete live-production acceptance. Consult the linked status for tested boundaries.

## Next sequence

| Priority | Work | Acceptance |
|---|---|---|
| 1 | Unify the film plan and complete the ordinary conversational production path | Brief, narration and shots are shown by scene; supplied material populates a proposed plan for confirmation; next actions follow actual gaps. A new real project reaches export without repeated intake or manual edit-hold repair. See [the interaction design](SIMPLIFIED-VIDEO-FLOW.md). |
| 2 | Combine generation preparation and spending into a guided review | Clear next action and exact cost/usage disclosure; preserve immutable proposals, frame approval, freshness and durable replay |
| 3 | Validate remaining real providers | Short speech/transcription and API-image runs with recorded dispatches, outputs, cost estimates and reopen behavior under an explicit budget |
| 4 | Validate multi-shot production and edits | Produce a 2–3-minute film, replace one shot conversationally, reuse unaffected work, then validate the six-minute boundary |
| 5 | Finish release operations | Clean-machine install/start/restart, configuration errors, interrupted work, backup/restore, clear manual guide and user acceptance |

Provider tests can run independently once their prerequisites and spending scope are available. Longer production follows the short end-to-end path. Stop on unknown provider outcomes and reconcile existing jobs rather than spending again.

## Implementation rules

- Keep application authority and canonical state outside the model.
- Treat saved skill versions and their reference files as immutable runtime contracts.
- Preserve exact frame/motion review, one-use grants, spending reservations and uncertain-submission recovery.
- Verify behavior with focused tests and browser/media checks appropriate to the change; distinguish fixtures from real provider evidence.
- Keep local data, credentials, generated media and builds out of Git.
- Record milestone results in the status page and detailed evidence where useful; do not append contradictory historical status reports here.

## Later work

Timeline-based editing, richer transitions/audio mixing, streaming large previews, portable project relocation, packaging for additional operating systems, same-machine H3 workers, and longer films. These are not required to claim the current short-pipeline proof.
