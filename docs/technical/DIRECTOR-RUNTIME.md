# Director runtime

Codex is the first native director; a fake runtime supports offline tests and demo behavior. The adapter owns protocol/conversation mechanics. OpenSlate owns canonical state, request authority, paid work and rendering.

## Request lifecycle

1. Persist a human request with current scope and continuation proof; fence incompatible older epochs.
2. The supervisor queues one turn, claims its durable lease and opens a bound tool epoch.
3. Capture canonical project evidence, the locked tool/skill catalog, application capabilities, selected images and the exact request identity.
4. Revalidate setup and authority, persist a dispatch intent, then start the native turn.
5. Save public outputs/questions and reconcile tool receipts. A user answer starts fresh application authority rather than depending on an in-memory native stack.
6. Mark a known terminal result. After lost ownership/unknown dispatch, reconcile saved evidence instead of blindly starting another native turn.

A turn lease is separate from media-attempt leases. One active turn per project is enforced. Stop cancels current work and revokes its epoch; late output remains historical evidence and cannot mutate the new request.

## Native setup

The supported runtime is pinned by exact version and configuration identity, currently Codex 0.153.4. Setup probes the installed App Server with zero model turns and saves readiness/selection. A later request checks that configuration again. The director can use its chosen Codex account independently of image/video/audio providers. A bounded read-only account/runtime model list supplies actual compatible choices to settings; it starts no model turn or selection write. A missing list retains the current ID rather than fabricating availability.

The local policy explicitly trusts the installed runtime and sandbox. OpenSlate still restricts tool catalogs, configuration, bridge credentials, scope, epochs and mutations. Independent code-host/authentication isolation is not established; see the [accepted trust decision](../implementation/RUNTIME-TRUST-DECISION.md).

## Context and versioning

`production` and `plan-authoring` are locked instruction packages. Exact developer instructions carry required references; context/capability projection discloses unsupported paths rather than fabricating a tool. Old project locks and old turn epochs keep their immutable bytes. Before an eligible fresh native turn binds context or dispatches, exact shipped V1–V3 predecessors receive a verified V4 successor. Already-bound epochs retain their old lock; restored/stale/busy/customized input fails safely. The refresh creates no film/media authority and starts no extra model turn. See [guidance compatibility](../implementation/DIRECTOR-TOOLS-UPGRADE.md).

Selected discussion images are owned, hash-bound and converted through a bounded local attachment path. They do not become paid-generation references or authority merely by appearing in conversation. Native errors/logs are sanitized before ordinary UI projection.

## Source and verification

- [Runtime adapter](../../packages/director/src/runtime/codex.ts), [policy](../../packages/director/src/runtime/policy.ts), [setup](../../packages/director/src/runtime/setup.ts)
- [Supervisor](../../apps/server/src/application/director-supervisor.ts), [local selection/input](../../apps/server/src/application/local-director.ts), [context projection](../../apps/server/src/application/context-projection.ts)
- [Tool/guidance versioning](../implementation/DIRECTOR-TOOLS-UPGRADE.md)
- Tests: `packages/director/test/runtime.test.mjs`, `runtime-setup.test.mjs`, `runtime-images.test.mjs`; server director/supervisor/context suites.
- Dated native evidence: [index](../implementation/VALIDATION-EVIDENCE.md).

A successful read-only/writing native turn does not prove the complete conversation-to-film workflow or paid media access. The October 3 fresh-guidance check found an inventory overlap before dispatch. The repaired bounded rerun completed one native V3 → V4 scoped-writing turn while retaining history and exact catalog checks, with zero media attempts/grants. See [the refinement record](../implementation/OCTOBER-3-REFINEMENT-REVIEW.md).
