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

## Code plans (experimental)

P1 adds a separate, fake-only replay runtime in `apps/server/src/code-plan/`. A project with `planMode: "code"` runs an ordinary TypeScript default async function in QuickJS WASM; absent or `"graph"` retains the existing flow. Types are stripped with Node 24's `stripTypeScriptTypes`. The program receives only `ctx.shot`, `scene`, `image`, `video`, `render`, `choose` and `log`; `speech` reports `NOT_IMPLEMENTED`. There are no Director tools, routes or UI for this mode yet. P1 rendering produces the existing fake video fixture, rather than proving an FFmpeg export.

Each pass starts in a fresh interpreter with the run's saved time and seeded random sequence. Media identity hashes kind and normalized JSON: sorted keys, trusted model defaults, significant prompt whitespace, input artifacts by SHA-256/kind, and optional `variant`. Equal inputs reuse the same durable result regardless of code location. Choices hash their id and options; changing question wording preserves an answer. Shot/scene declarations and logs project the latest pass. Historical steps and artifacts remain after edits; unreached unsent steps are cancelled.

The four `code_plan_version/run/step/choice` entity kinds use the existing JSON store without DDL. A `code_plan_execution` receipt binds each step's existing `Attempt` to its request digest, observation and liability. Submission intent commits before dispatch; only its creating process holds the one-use first-submit permit. Restarted intents become unknown and use `lookup`; accepted jobs use `poll`. No outcome automatically creates a new submission. Completion is persisted before the existing ingestion router/fixture ingester publishes owned, hash-verified artifacts. The bridge accepts the existing output store for validated owned-spool receipts, but P1 fixture outputs use the existing fixture path. The graph engine excludes code-plan attempts from its workers.

Before dispatch, the host reserves trusted model prices as integer micros against a default $1 ceiling, including unknown and charged work. Only a definitive rejection releases liability. A ceiling increase persists and wakes the run. Unpriced calls cost zero; all distinct media steps, including historical versions and free renders, share the default 200-step run limit. QuickJS applies per-pass CPU, memory and stack limits, plus bounded source, host calls, inputs and error text. Provider waits have a deadline; a timeout stays uncertain. Shutdown drains owned work before closing the store. Installation recovery quarantine also fences this mode.

The existing 500 ms server loop calls `CodePlanRuntime.tick()`. Startup, submitted versions, answers, terminal steps and ceiling increases wake replay; passes are single-flight per project. P2 will add Director submission/typechecking/dry runs, P3 the UI, and P4 real-provider acceptance. The fake adapter, isolated sandbox tests and offline recovery evidence do not establish real-media compatibility or output quality. See the [design](../ai/code-plan/DESIGN.md) and [P1 report](../ai/code-plan/reports/P1-report.md).

Known error-reporting gap: this cached QuickJS build cannot observe unhandled rejections from discarded async branches. A synchronous throw or awaited failure makes the pass `error`, but a detached rejected Promise can still produce `done`. A sandbox build with native rejection tracking is needed before the design's general programming-error semantics are complete; a Promise monkeypatch does not cover native async functions.
