# N1 · Failures, retry and the code-plan spend limit

Worktree: `codex/n1-retry`. Implementation is offline; verification results below are updated from observed local runs. No commit or push was made.

## Done

- **NEXT 8 / N1.1–4 — retry:** Viggle and MiniMax distinguish proven connection-setup failures from ambiguous submission/response loss. DNS (`ENOTFOUND`, `EAI_AGAIN`), refused connections and undici connect timeouts prove no submission. TLS diagnostics additionally require the identical error object from undici's connection-error event, so a post-connect SSL error code cannot accidentally release liability. All-child checks handle aggregate connection errors. Abort, generic timeout and post-connect reset retain the existing unknown policy.
- Code-plan results, views and `read_film` expose `retry: safe | consent | none`, `mayHaveCharged` and attempt counts. Safe failures automatically open at most two new attempts, with persisted 250/500 ms backoff. No existing intent is submitted twice.
- Person retry and the Director's quoted-consent retry keep the same content-addressed step key. Execution work keys include project, step and ordinal to satisfy the existing global local-work index; no schema change is needed. Every earlier attempt remains in liability accounting. New attempts pass the usual price, ceiling, hold, Stop, capacity, version and one-use permit checks. Same-ID Director calls and HTTP commands replay their saved receipts.
- **NEXT 4 / N1.4–5 — limit:** `setCeiling` and the authenticated ceiling route accept raising and lowering. A limit below charged + unknown + in-flight liability returns `CODE_PLAN_CEILING` and all component amounts. There is no chat-specific cap; the existing nonnegative SQLite integer-micro bound remains. `raiseCeiling` remains as the existing host convenience method.
- New code films pin tool contract **0.2.0**, adding `set_spend_limit` and `retry_step`. A call needs a turn started by the person's own message and a nonempty, whitespace-normalized quote found in that original message. Application repair/failure turns cannot borrow this consent, and read-only or superseded epochs cannot mutate state. Accepted changes persist invocation-bound receipts and Director thread messages; reconciliation reads receipts without repeating effects.
- Films pinned to **0.1.0** keep their original two-tool catalog, handler and guidance digest. Runtime-selection changes preserve the saved code catalog. The exact old guidance package is archived at `skills/code-plan-v1` because an instruction package cannot contain undeclared nested packages.
- **NEXT 5 / N1.6–7 — failures:** a returned program with reached terminal failures reports `done_with_failures`. A reached media failure that has no scheduled automatic retry queues one durable Director turn per attempt. Its input contains the step, shot/display label, code, retry meaning, possible charge and price. Existing program-error repairs retain their separate two-turn bound.
- **B0 / N1.9 — vertical films:** new Viggle calls accept all six supported explicit ratios or infer the nearest ratio from the owned first frame. Normalized input, crop and wire request use that same ratio. Both explicit and inferred 941×1672 fixtures reach the fake Viggle as 9:16 and retain over 95% of the frame. MiniMax retains its adaptive first-frame ratio; explicit ratios must match the frame.
- **N1.8, 10–11 — guidance, tests and docs:** guidance and the example explain failure spending, ask retry/skip before an in-program variant, describe the new tools and vertical inputs, and re-pin the package digest. Technical execution/tool documentation and implementation status are updated.

Historical journal entries retain immutable original inputs/defaults and successful results. Installing aspect inference alone never buys replacement clips for an unchanged saved program. An explicit aspectRatio edit deliberately creates corrected work. Pre-N1 saved failure results acquire retry metadata from their retained execution evidence without losing their original liability.

## Files

Changed runtime/port/routes:

- `apps/server/src/code-plan/{director,execution,index,port,provider-authority,provider-input,records,routes,view}.ts`.
- `packages/core/src/tools.ts`.

Narrow shared changes necessary for catalog dispatch, recovery and pinned-film compatibility:

- `apps/server/src/application/director-capabilities.ts` — current/old code guidance digest and environment selection.
- `apps/server/src/application/director-tools-upgrade.ts` — report the saved code catalog; do not advertise an implicit upgrade.
- `apps/server/src/application/fake-director.ts` — recognize both pinned code catalogs.
- `apps/server/src/application/local-director.ts` — preserve a code film's catalog when changing the selected runtime.
- `apps/server/src/application/tool-invocations.ts` — dispatch the two new tools, retain detailed refusals, reconcile mutation receipts and recover submissions under their original code catalog.

Every provider/transport/shared-authority change:

- Added `packages/providers/src/connect-failure.ts` — conservative cause-code classification plus pre-connection TLS evidence.
- `packages/providers/src/viggle-h3.ts` — return definitive local no-submit evidence for classified connection failures.
- `packages/providers/src/minimax-h3.ts` — equivalent no-submit evidence with its required `H3_` diagnostic namespace.
- `apps/server/src/execution/viggle-h3-execution.ts` — preserve the no-submit diagnostic and explicit safe-retry authority in durable execution outcomes.
- `apps/server/src/execution/minimax-h3-execution.ts` — equivalent MiniMax receipt/outcome behavior.
- `apps/server/src/execution/viggle-h3-receipts.ts` — validate the code-mode ratio override and bind both request preparation and mapping verification to it; retain graph format checks.

Guidance/docs:

- Changed `skills/code-plan/{SKILL.md,openslate.skill.json,references/studio.d.ts,references/example-plan.ts}`.
- Added exact immutable copies at `skills/code-plan-v1/{SKILL.md,openslate.skill.json,references/studio.d.ts,references/example-plan.ts}`.
- Changed `docs/technical/{EXECUTION-ENGINE,SKILLS-TOOLS}.md` and `docs/implementation/STATUS.md`.
- Added this report.

Tests:

- Added `apps/server/test/code-plan-retry.test.mjs` and `packages/providers/test/connect-failure.test.mjs`.
- Changed `apps/server/test/code-plan-{director,execution,port,providers,routes,runtime}.test.mjs`.

Deleted: none. No web, browser contract, schema, dependency or generated output is part of the diff.

## Tests

**25 tests added; six existing behavior tests updated; none deleted, disabled or newly skipped.** Updated assertions replace the old two-tool latest catalog, unconditional clip fallback, permanently non-retryable positive rejection, profile-forced square-frame crop, raise-only ceiling and successful `done` state after a handled provider failure. Existing paid-effect, immutable intent, lost-reply, stale-version and recovery protections remain.

The new tests cover actual fetch/undici loopback connection refusal, offline DNS lookup failures, TLS handshake failure and connect timeout, post-connect reset, ambiguous TLS/error codes, bounded safe retries, success after retry, restart, consent, wrong/empty quote refusal, application-source refusal, receipt reconciliation, all liability components, Stop/holds/ceiling fencing, terminal failure state, one notification per failure, old catalogs/guidance, historical journal reuse, pre-N1 failure metadata, both vertical crop paths and ratio identity. The existing P2c HTTP/edit/restart integration flow remains in the focused gate.

| Command | Observed result |
| --- | --- |
| `pnpm setup:test-media` | Passed; installed FFmpeg/ffprobe already matched, no download |
| `pnpm check:toolchain` | Passed: Node 24.15.0, pnpm 10.33.0, FFmpeg/ffprobe 8.1.1 and required codecs |
| `pnpm build` | Passed, all five workspaces; existing Vite chunk/mixed-import warnings only |
| Focused 15-file `node scripts/run-tests.mjs ...` gate | **333 passed, zero failed/skipped/cancelled/todo**, 63.276 s |
| `pnpm test` | **4,724 passed, zero failed/cancelled/todo, one optional native skip; 4,725 total**, 1,051.914 s |
| `pnpm -r typecheck` | **5/5 workspace typechecks passed**, zero TypeScript errors, both after the final focused gate and after the full run |
| Guidance package digests | Current `4e0a9ba54a8d9fb2996d06c19581d76734939381b74d2a792785ce8349399db6`; unchanged 0.1.0 `d3811c72395713445f2167bb281273de28b058098189f9d8bec441d7b3d0052e` |
| Self-review, ownership and whitespace | Reviewed source/new files and caller effects; `git diff --check`, guidance pins and forbidden-path diff checks passed |

Focused files: `packages/providers/test/{connect-failure,viggle-h3,minimax-h3}.test.mjs`; `apps/server/test/code-plan-{runtime,execution,port,routes,director,retry,providers,e2e,sandbox}.test.mjs`; `apps/server/test/{viggle-h3-execution,minimax-h3-execution,viggle-h3-frame-crop}.test.mjs`.

Self-review corrected the global work-key uniqueness collision for retries, a second Viggle mapping field allowlist, MiniMax diagnostic namespacing, stale reached-step authority after an edit, read-only epoch refusal for the two new tools, pre-N1 error metadata, and the danger of treating a generic SSL code as proof of a failed handshake. Backoff tests use a controlled Date clock to avoid machine-load timing assumptions. It also preserved historical media reuse instead of silently regenerating old clips. Regression checks cover these changes. No additional actionable issue was found in the final owned diff.

Verification sequencing: the full run was already in progress when the final read-only-epoch guard/regression and controlled-clock test refinement were added. The final **333/333 focused gate** covers those final changes; the post-full typecheck also passed. The full run therefore contains one fewer test than a fresh run of the final tree. Earlier interrupted or failing preliminary runs are not acceptance results.

Logs: `/tmp/openslate-n1-{build,focused,full,typecheck,focused-typecheck}.log`. Tests use temporary state, injected providers and bounded loopback listeners. DNS tests inject offline resolution failures; no external DNS lookup is made. There is no real-provider quality or billing claim.

## Contract changes

`packages/core/src/studio-api.ts`: **none**. The pre-added retry/attempt/failure-state fields are filled as supplied by the lead.

`apps/server/src/code-plan/port.ts`: added exactly `retryStep(projectId, {stepKey, consent})` and `setCeiling(projectId, input)` with the card's person/Director unions. The existing `raiseCeiling` method remains compatible.

`packages/core/src/tools.ts`: adds catalog 0.2.0 and its two tool schemas/handler; retains 0.1.0 descriptor bytes and handler. Graph catalog descriptors/digests remain unchanged.

## Commits

No commits created, as the card rules require. Proposed lead-owned split:

1. `fix(providers): distinguish connect failures from unknown H3 submissions` — `packages/providers/src/{connect-failure,viggle-h3,minimax-h3}.ts`, `packages/providers/test/connect-failure.test.mjs`, `apps/server/src/execution/{viggle-h3-execution,minimax-h3-execution}.ts`.
2. `feat(code-plan): add consented retries limits and failure notifications` — all changed `apps/server/src/code-plan/**`, `apps/server/src/execution/viggle-h3-receipts.ts`, the five listed `apps/server/src/application/**` files, `packages/core/src/tools.ts`, all listed server tests, current code-plan guidance and its immutable v1 archive.
3. `docs(code-plan): record N1 execution behavior and verification` — both technical docs, status and this report.

## Open issues

- No live provider/native-model experiment was run. Browser/Settings UI and live acceptance remain with the lead, as assigned by the card.
- Historical implicit-ratio journal entries keep their original inputs and saved results. To correct an already-journaled old crop, explicitly edit aspectRatio; the reviewable dry run exposes the new work and price. A retry of an old intent preserves that intent's original ratio.
- Shot names are inferred from the existing `<shot>-keyframe` choices where available, otherwise the step's display label is used. N4 owns explicit media shot annotations and complete shot linkage.
- The immutable v1 archive and five narrow application integration edits sit outside the main code-plan directory because catalog/lock/recovery callers must recognize both versions. The report enumerates each for lead review.
- Carried runtime limits remain: unrelated detached-Promise rejection tracking and reached-prefix-only downstream previews. Pricing is configured per call, not verified vendor billing; unknown estimates cannot bound unknown actual charges.
- No browser, real provider, external network, protected `.env*`/secrets/production-state read, port-3001 listener, commit, push or subagent was used.
