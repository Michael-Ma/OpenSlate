# Plan compiler and atomic changes

The compiler parses a restricted TypeScript declaration and produces an immutable operation graph. It never evaluates generated JavaScript, calls a provider, grants permission or reserves spending.

## Language and bounds

Accept one supported `definePlan` declaration, literal metadata, a bounded arrow body, `const` bindings and registered `p.*` declarations. Supported operation kinds are image, video, speech, transcription, timeline and render; owned inputs and human review are graph primitives.

Babel parses TypeScript syntax; OpenSlate then exhaustively validates its narrower AST allowlist. Imports, arbitrary functions/control flow, mutation, spreads, computed properties, dangerous object keys and unregistered calls are rejected. Full-source compilation and trusted composition run in a bounded worker.

Current compiler limits: 2 MiB source, depth 64, 100,000 AST nodes, 5,000 operations, 20,000 bindings and a five-second deadline. These planning limits do not imply the local renderer accepts 5,000 cuts.

## Preparation and publication

1. Capture the project, lock, selected profiles, logical aliases and current bindings.
2. Parse/lower source or a supported trusted composition. Preserve durable IDs for known aliases.
3. Validate owned artifacts, ordered role/port inputs, profile compatibility, timing/review gates and acyclicity.
4. Hash effective intent/specification and calculate `reuse`, `replace`, `new` or `retire` impact.
5. Persist the exact prepared proposal/read-set without media effects.
6. On apply, recheck request epoch/scope, relevant current inputs, workflow and human generation origin; commit project/plan/bindings/receipt atomically or commit none.

The graph is the execution contract; original and canonical source remain audit evidence. A source alias or node rename cannot create generation authority. Relevant changed inputs invalidate preparation; compatible output progress does not need to invalidate every creative proposal.

Speech/transcription/model changes use trusted AST composition to retain the full unaffected plan. Accepted canonical narration can rebase only allowed audio/timeline inputs without changing picture specs or minting new grants.

## Reuse and timing

A camera-motion-only edit may keep its image while replacing video. Writing-only within-shot narration preserves visual media but blocks stale audio dispatch and changes derived assembly. Returned keyframe/motion approval binds actual effective bytes/specification, not merely an image alias.

[Video timing](../../packages/core/src/video-timing.ts) accepts explicit silence from planned frames and accepted measured audio from exact cues. Short within-shot audio keeps the planned picture duration. Undecided narration/pending audio remains a readiness gap.

## Source and checks

- [Compiler](../../packages/core/src/planning/index.ts), [worker](../../packages/core/src/planning/worker.ts)
- [Contracts](../../packages/core/src/contracts.ts), [narration rebase](../../packages/core/src/planning/narration-rebase.ts), [model composition](../../packages/core/src/planning/model-profile-composition.ts)
- [Production service](../../apps/server/src/application/service.ts)
- Tests: core planning/worker/composition/rebase suites; server service, stale preparation, model changes and exact review suites.

See [execution](EXECUTION-ENGINE.md) for admission and recovery; compiler success alone never authorizes a media POST.
