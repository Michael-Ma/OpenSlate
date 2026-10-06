# Durable execution

The execution engine advances the saved graph through trusted providers and local media handlers. It owns candidate/attempt state and admission. The director does not poll every job or control provider recovery.

## Records and authority

A **node** is a planned operation. A **candidate** is a human-origin creative result slot. An **attempt** is one submission/recovery/retry under that candidate. A **receipt** records observed provider/local effects. An **artifact** is owned verified output. A current **binding** selects which candidate/output can satisfy the graph.

Configured admission rechecks the exact active candidate/node, pinned profile definition/options, credential/native/media readiness, epoch/hold/pause controls, accepted audio and exact keyframe review before video dispatch. It creates no usage allowance or hidden consumption step. Attempt/submission identity is committed before external effects. Technical retry requires trusted eligible failure evidence and bounded policy; it does not become a new aesthetic alternative.

## State and recovery

Attempt phases include `preparing`, `submitting`, `remote_pending`, `submission_unknown`, `ingesting`, `succeeded` and `failed`. Preparation can retain owned conversion work while media inputs are not ready; current selection is checked again before the first paid dispatch.

Leases use owner/epoch/expiry. A stale worker cannot mutate current state. An expired `submitting` lease becomes uncertain, because process failure does not prove that the vendor rejected the request. Recover the same task/receipt/output; never resubmit merely because observation timed out.

Provider results are retained even when a user edit supersedes their slot. Late completion can be historical evidence without replacing the new selected output. A positive no-dispatch proof may release known-unsent work; unknown effects retain liability. Unknown outcomes and lost synchronous image bytes can require human/account reconciliation.

## Publication

1. Retain immutable dispatch/observation receipt.
2. Save raw outputs through bounded durable spooling.
3. Decode/probe and normalize owned image/video/audio/transcript/timeline output.
4. Retain normalization/completion receipt before SQL selection publication.
5. Publish compatible bindings under the current lease/selection; recover missing SQL acknowledgement from the same immutable evidence.

Files are outside short database transactions. [Output storage](../implementation/OUTPUT-SPOOL.md) and [provider artifacts](PROVIDERS-ARTIFACTS.md) define their validation boundary. Restored installation quarantine blocks recovery until explicit release, and old unused imported authority cannot start new generation afterward.

## Source and checks

- [Engine](../../apps/server/src/execution/engine.ts)
- Configured external admission in `apps/server/src/execution/`, [current selection guard](../../apps/server/src/execution/current-generated-selection.ts); earlier durable accounting remains available for historical records
- [Submission preparation](../../apps/server/src/execution/submission-preparation.ts), [output store](../../apps/server/src/execution/output-store.ts), [ingestion router](../../apps/server/src/execution/ingestion-router.ts)
- Provider-specific execution/authority/receipt modules in `apps/server/src/execution/`.
- Tests: execution/recovery/routing/spool suites, competing admission, lease loss, Stop/selection races, rejected-versus-unknown outcome and provider bridges.

The engine executes the user's requested scoped work using configured providers. Historical accounting is retained; the active flow has no project spending-cap or usage-allowance prompt. Offline tests do not establish undocumented provider idempotency.
