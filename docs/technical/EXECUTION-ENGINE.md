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

A project with `planMode: "code"` runs an ordinary TypeScript default async function in disposable QuickJS WASM workers; absent or `"graph"` retains the existing flow. Node 24 strips types before module evaluation. The program receives only `ctx.shot`, `scene`, `image`, `video`, `speech`, `render`, `choose` and `log`. Media execution remains fake-only: speech produces a priced fixture audio artifact, and rendering produces the existing fake video fixture. Director wiring, routes/UI and real-provider acceptance are separate cards.

Each pass starts in a fresh interpreter with the run's saved time and seeded random sequence. The first accepted submission uses the same clock/seed for its preview and live run. Media identity hashes kind and normalized JSON: sorted keys, trusted model defaults, significant prompt whitespace, input artifacts by SHA-256/kind, and optional `variant`. Equal inputs reuse the same durable result regardless of code location. Choices hash their id and options; changing question wording preserves an answer. Shot/scene declarations and logs project the latest pass. Historical steps and artifacts remain after edits; unreached unsent steps are cancelled.

`CodePlanRuntime` implements the lead-owned `CodePlanPort`. `view` projects the current run, reached/history steps, unanswered-first choices and the latest 50 versions with their saved dry-run diffs; an untouched project is `empty`. Display labels use prompt, then motion, capped at 200 characters. `source` reads one version. `submit` dry-runs before storing, refuses syntax/evaluation or runtime failures with `CODE_PLAN_REJECTED` and `details.diff`, and atomically fences `basedOnVersion` (`null` means no plan) while persisting an invocation receipt. A repeated invocation returns its original version/diff, including after restart and when submissions overlap. `failure` exposes only the current version's pass error. All port methods reject graph/unknown projects; installation quarantine refuses writes while preserving inspection/dry runs.

Dry runs share execution's call path with dispatch disabled and all provisional state in memory. They write no entity, attempt, run, choice, event or cursor. Recorded results and in-flight calls count as reused; absent calls are new with trusted prices; unreached unsent live entries count as cancelled. Unique reached new calls determine `certainMicros`. An unresolved call or unanswered choice stops its awaited continuation, sets `dependsOnPending`, and leaves later costs unknown. Independent concurrent calls can still be reached. Findings include `SOURCE_SYNTAX`, `RUNTIME_ERROR`, `UNAWAITED_CALL`, `STEP_LIMIT` and `CEILING`; the latter three are warnings, with live admission still enforcing limits.

The `code_plan_version/run/step/choice` entities use the JSON store without DDL. `code_plan_invocation` keeps submission receipts, `code_plan_hold` persists request-specific paid-dispatch holds, and `code_plan_view_digest` suppresses duplicate events. Released hold identities remain closed even after a late retry; a release that precedes its hold also records a closed identity. While any hold is open, positive-price calls remain absent. In-flight work, zero-price calls and local renders continue. Release wakes replay; multiple holds and their release states survive restart.

A `code_plan_execution` receipt binds each step's existing `Attempt` to its request digest, observation and liability. Submission intent commits before dispatch; only its creating process holds the one-use first-submit permit. Restarted intents become unknown and use `lookup`; accepted jobs use `poll`. No outcome automatically creates a new submission. Completion is persisted before the existing ingestion router/fixture ingester publishes owned, hash-verified artifacts. Owned output-store receipts are validated when supplied. The graph engine excludes code-plan attempts from its workers.

Before dispatch, the host reserves trusted integer-micro prices against a default $1 ceiling, including charged, unknown and in-flight work. Only a definitive rejection releases liability. The view splits charged/possibly-charged (`spentMicros`, including unknown submissions) from pending reservations (`reservedMicros`). A ceiling increase persists and wakes replay. Unpriced calls cost zero. The default 200-step project limit counts only entries with an admitted attempt across all versions: absent, held, budget-blocked and cancelled work consume no slot. Free dispatched calls and renders do consume slots. QuickJS applies per-pass CPU, memory and stack limits, plus bounded source, host calls, inputs and error text. Provider timeouts stay uncertain; shutdown drains owned work before closing the store.

The existing 500 ms server loop calls `CodePlanRuntime.tick()`. Startup, submitted versions, answers, terminal steps, ceiling increases and released holds wake single-flight replay. Successful state mutations and changed pass views append `code_plan.changed` with `{ planVersion, state }`, advancing the normal store cursor. Idempotent retries, idle ticks and semantically identical replays do not emit; `lastPassAt` alone is excluded from the digest, and unchanged absent steps retain `updatedAt`.

The sandbox uses upstream **`quickjs-emscripten@0.32.0`**, published February 16, 2026. Its API still leaves native promise-rejection tracking unimplemented. Bootstrap tracking observes whether each asynchronous `ctx` promise acquires a `then`/`await` consumer, including Promise.all, and reports `UNAWAITED_CALL` in the diff. It preserves Promise behavior without treating the warning as a rejection gate. Synchronous throws and awaited failures make the pass `error`; detached rejections unrelated to `ctx` can still report `done`. The upstream dependency and disposable-worker OOM recovery are tested, but this general detached-rejection limitation remains. See the [design](../ai/code-plan/DESIGN.md), [P1 report](../ai/code-plan/reports/P1-report.md) and [P2b report](../ai/code-plan/reports/P2b-report.md).
