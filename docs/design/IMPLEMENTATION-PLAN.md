# OpenSlate development plan

Updated October 1, 2026. Current evidence is maintained in [implementation status](../implementation/STATUS.md), rather than repeated here as a chronological development log.

## Fixed scope

Single-user local app, TypeScript orchestration, Codex as the first replaceable director, pluggable cloud image/video/audio providers, up to six-minute videos, keyframe review before clips, and conversational scoped edits. Timeline editing, local H3 inference, distributed execution and 10–30-minute productions are later extensions.

## Completed foundation

| Work | Delivered |
|---|---|
| T00–T04 | Runtime/toolchain probes, domain identities, persistence, commands/events, workflow stage contracts, restricted compiler, durable fake execution and human approval |
| T05–T08 | Conversation/review UI, native Codex, versioned skills/tools, narration preparation and owned media/timeline/rendering |
| T09–T12 integration | Provider adapters, durable dispatch/output recovery, independent spending, audio review/adoption, model changes, SSE, backup/restore and local launcher |
| Storyboard rebuild | Direct shot/scene/treatment commands, stable reorder/delete/undo, shot narration intent, light timeline and owned soundtrack mix; [scope and remaining limits](STORYBOARD-STUDIO.md) |
| Supplied-material intake | Persistent text/Markdown interpretation and human confirmation; bounded native import and responsive browser validation. Current presentation uses the storyboard above. |
| Shared UI typography | App-wide heading/body/caption tokens, explicit scene/shot headings, wrapped descriptions and desktop/mobile review |
| Workflow completion | Explicit silent shots, compact scoped audio, plural saved-edit continuation, guided generation, synchronized Timeline, owned audio library, personal-voice identity/consent and first-run doctor; [verified scope and remaining work](../implementation/V1-COMPLETION-REVIEW.md) |
| Initial T13 evidence | Offline six-minute workflow and one real six-second Codex-image/Viggle/export run |

Component implementation does not imply complete live-production acceptance. Consult the linked status for tested boundaries.

## Next sequence

| Priority | Work | Acceptance |
|---|---|---|
| 1 | Complete real conversational production acceptance | Native scoped writing and silent/multiple-edit context proofs passed. Rehearse a new real project through export using the guided review without manual state repair. |
| 2 | Finish personal voice enrollment | Choose provider/account, connect consent/sample upload and verify one approved voice. Existing eligible OpenAI identities already work through the durable speech contract. |
| 3 | Validate remaining real providers | Short speech/transcription and API-image runs with recorded dispatches, outputs, cost estimates and reopen behavior under an explicit budget |
| 4 | Validate multi-shot production and edits | Produce a 2–3-minute film, replace one shot conversationally, reuse unaffected work, then validate the six-minute boundary |
| 5 | Finish release operations | Doctor/private config/launcher are delivered. Broader clean-machine and OS packaging, interrupted work, backup/restore rehearsal and final user acceptance remain. |

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
