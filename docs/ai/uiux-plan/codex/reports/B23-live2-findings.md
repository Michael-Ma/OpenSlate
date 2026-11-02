# B23 — LIVE-2 findings

## Done

### B23.1 — keyframe progress before video confirmation

Cause: video targets already exist while their conditioning frames run or wait for capacity. The old panel only selected keyframe progress when video targets were empty. Running images were excluded from the ready-but-unopened list, so an empty list selected “Every frame is opened.”

Fix: current keyframe work takes precedence over confirmation counts, passive downstream input waits and stale saved-video aggregates. The panel says keyframes are being made, gives an explicit reason video cannot be confirmed, and offers no action or price. Unknown paid outcomes retain first priority. Held frames and retained replacement takes keep their actual edit wait, including beside an older saved-video state. Exact returned-frame review resumes after generation finishes.

Tests: three regressions failed before implementation (11 pass / 3 fail in that file). Four added tests cover running/capacity queues with existing video targets, downstream input waits, retained replacement frames, stale scene state, held work, and the transition back to exact frame review. The resulting two-file model check passed 32/32.

### B23.2 — saved writing versus the next human generation press

Cause, verified from retained data: two creative `prepare_change` / `apply_change` pairs succeeded. A subsequent native `prepare_change` used `variant: "plan"` and executable source. Its syntax contained two shot/image/video branches, human review, approved-image inputs, timeline and render. The application correctly refused keyframe origin authorization. Saved story and shots were not rolled back. Retained SQLite databases were inspected through immutable, read-only connections; only operation names, outcomes and syntax counts were extracted. Model-authored source was never evaluated.

Fix: mutable host guidance tells the Director to save writing with creative prepare/apply and omit executable source and new-take requests. An executable preparation that reaches the exact `ORIGIN_NOT_AUTHORIZED` guard returns a durable `awaiting_human_generation` result: no prepared-change ID, no writing/plan saved by that call, no media started, previously saved writing retained, and the two human scene actions described plainly. The application guard itself is unchanged. Cancellation, revoked epochs, stale revisions, invalid plans and unknown outcomes retain their original handling. The result cannot be used with `apply_change` and replays from its original receipt after restart.

Tests: three added tool tests cover retained saves, receipt replay, absence of jobs/grants/charges, incomplete grant sets and stale/invalid/revoked refusals. One added guidance test checks the actual application guidance sent into a native turn. Four tests added across two files; none rewritten or deleted for these items.

### B23.3 — bounded shutdown and installation ownership

Cause: startup awaited Director/media cleanup without a deadline, then waited indefinitely for the reconcile loop. A closed listener did not establish that all pooled or streaming connections and workers had finished. The original LIVE-2 observation alone did not identify the stalled cleanup component.

Fix: one shutdown coordinator fences dispatch and scheduling before cleanup, closes idle connections and forcibly closes remaining streams/connections after a short grace, logs named waits, and uses one bounded cleanup deadline. Project/provider storage closes before installation ownership. Production releases ownership and exits in the same synchronous stack, preventing timed-out continuations from running against a replacement installation. Engine cancellation preserves original submission intent, reservations and unknown-outcome reconciliation; it does not persist Stop or invent a retry.

Native runtime close tracks and closes the actual active process groups concurrently with interruption, rather than waiting for the interrupt grace first. Transport close is idempotent. The controller tracks per-turn runtimes, aborts in-flight setup checks, and waits for their process cleanup without overwriting the previous successful diagnostic.

Tests: ten added across four files cover a held keep-alive connection plus an endless SSE stream, hanging/failed cleanup and named logs, shared deadline/idempotence/resource order, a child process retaining the installation lock through cleanup and allowing immediate reacquisition after exit, dispatch fencing, late accepted/unknown outcomes with unchanged liability and no duplicate submit after restart, active runtime closure, canceled setup cleanup, native group termination while interrupt is still waiting, and closing before any turn. These use disposable state, ephemeral loopback ports and synthetic child runtimes. The actual launcher/port 3001/native binary was not run.

### B23.4 — retained and current Director check evidence

Cause: model/setup readiness lived only in process maps, so restarting discarded a successful check.

Fix: a `director_local_check` JSON entity retains sanitized latest status and the last successful program, pinned version and timestamp for the exact selection and host setup identity. A newer failed check remains blocking, even when an old successful selection command is replayed. Historical evidence never supplies runtime options or bypasses setup before another native turn. Settings shows “Checked” with the original successful evidence. For legacy installations without a retained full check, its existing cheap `--version` read shows “Found” and explicitly identifies version-only evidence; it does not infer sign-in or model readiness. Current missing/mismatched versions override historical success. No DDL migration.

Tests: eight added tests cover controller/storage reopen, exact identity, latest failure, failed-first/never-checked state, fresh setup before another turn, legacy version-only reads and English/Chinese presentation. One old read-only audit was rewritten to allow only the new diagnostic entity while preserving the assertion that project/selection/events/commands/turns and media remain unchanged.

### B23.5 — short framing and scene names

Cause: framing permits unrestricted descriptive text; every published creative scene schema exposes only `purpose`, with no separate `title`. The browser falls back to purpose for scene headers/pills. The Director therefore wrote descriptions into both label positions.

Fix: mutable host guidance specifies 1–3-word framing labels (Close-up, Medium, Wide) and scene names of about six words. Under the current locked schema it uses a short scene purpose as the title fallback and puts longer direction in shot purpose/action/prompts or story. Existing descriptions are not silently shortened. The new guidance test verifies this reaches the Director.

Frozen schema/skill proposal, as the card requests instead of editing published packages:

- Publish a separately versioned successor catalog, proposed `6.0.0`, preserving all `1.0.0`–`5.0.0` catalog digests. `packages/core/src/tools.ts` freezes those versions. Its V4 preparation schema clones `packages/core/src/workflow/index.ts`'s `changeProposalSchema`; editing that shared schema in place would silently alter historical catalog digests too.
- Give framing a dedicated schema with a 1–3-word/approximately 80-character bound and short examples. Add `createScenes: { key, title, purpose }`, requiring a short title of approximately six words/80 characters. Let `updateScenes` change `title` and/or descriptive `purpose`, requiring at least one edited field. Extend parser/application handling for `scene.title`, preserving historical saves without a migration.
- Publish a successor to `skills/v6`, preserving the current package. Update production `references/current-contract.md`, `references/stages/shot_plan.md`, `references/stages/scene_plan.md`, and plan-authoring `SKILL.md`: labels in framing/title, descriptions in purpose/prompts, and creative save-only prepare/apply without executable source.

## Files

20 changed files:

- `apps/server/src/application/film-planning-guidance.ts`
- `apps/server/src/application/local-director.ts`
- `apps/server/src/application/tool-invocations.ts`
- `apps/server/src/execution/engine.ts`
- `apps/server/src/index.ts`
- `apps/server/test/director-guidance-maintenance.test.mjs`
- `apps/server/test/installation-status.test.mjs`
- `apps/server/test/local-director.test.mjs`
- `apps/server/test/tool-invocations.test.mjs`
- `apps/web/src/next/i18n/catalog/keyframes.ts`
- `apps/web/src/next/i18n/catalog/settings.ts`
- `apps/web/src/next/model/keyframes.ts`
- `apps/web/src/next/model/settings-computer.ts`
- `apps/web/src/next/model/settings-director.ts`
- `apps/web/test/next/keyframes-state-truth.test.mjs`
- `apps/web/test/next/settings-computer.test.mjs`
- `packages/director/src/runtime/codex.ts`
- `packages/director/src/runtime/transport.ts`
- `packages/director/src/runtime/types.ts`
- `packages/director/test/runtime.test.mjs`

4 added files:

- `apps/server/src/shutdown.ts`
- `apps/server/test/execution-shutdown.test.mjs`
- `apps/server/test/server-shutdown.test.mjs`
- `docs/ai/uiux-plan/codex/reports/B23-live2-findings.md`

None deleted. The supplied LIVE-2 evidence and card are unchanged. No CSS, lead-owned visual component, `docs/implementation/STATUS.md`, published catalog/skill, database, media, secret, dependency or build artifact belongs to this change.

## Tests

26 tests added: B23.1 four; B23.2/B23.5 four; B23.3 ten; B23.4 eight. One existing test rewritten for diagnostic persistence, as described above. None deleted, skipped or disabled by this card. Existing integrity checks remain.

Pinned toolchain: Node 24.15.0, pnpm 10.33.0, FFmpeg/ffprobe 8.1.1. `pnpm setup:test-media` found matching installed tools without downloading; `pnpm check:toolchain` passed.

| Final check | Result |
| --- | --- |
| `pnpm build` | All five package/app builds passed; existing Vite chunk-size advisory remains |
| `node scripts/run-tests.mjs` with the nine touched test files | 129 passed, 0 failed/cancelled/skipped/todo |
| `node scripts/run-tests.mjs apps/web/test/*.test.mjs apps/web/test/next/*.test.mjs` | 807 passed, 0 failed/cancelled/skipped/todo |
| Full `pnpm test` | 3,297 passed, 0 failed/cancelled/todo, 1 optional native-probe skip; 3,298 total |
| `pnpm -r typecheck` | All five package/app typechecks passed, 0 failed |

All nine touched `.mjs` test files passed `node --check`. No browser scenario file changed; scenario syntax checks therefore do not apply. Browser checks were not run.

An intermediate integrated touched run returned 82 pass / 1 fail because the result wording had changed after that build; rebuilding resolved the source/dist mismatch. This was separate from the intentional test-first failures for B23.1 and Director guidance.

Final integrated source review found no outstanding must-fix issue. Independent review caught and resolved held-frame/stale-playback precedence, an older ready response overriding a newer blocked check, and pending native setup cleanup that needed to finish before ownership release. The sole full-suite skip is `opt-in native Codex probe never starts a model turn`; it was not enabled under this card's no-live-runtime rules.

## Contract changes

None to `packages/core/src/studio-api.ts`.

The existing Director setup response gains optional `lastSuccessfulCheck` metadata; its already-existing version-only field is now used for honest current discovery. Internal Director tool receipts gain the expected human-generation outcome. Neither carries execution authority.

The exported host-only `DirectorRuntime` interface gains optional `close(): Promise<void>` for explicit native cleanup. Existing runtime implementations remain compatible.

## Commits

No commits made. Proposed split; the lead owns review and commits:

1. `fix(keyframes): show frame work before video confirmation`
   - `apps/web/src/next/model/keyframes.ts`
   - `apps/web/src/next/i18n/catalog/keyframes.ts`
   - `apps/web/test/next/keyframes-state-truth.test.mjs`
2. `fix(director): separate saved writing from human generation actions`
   - `apps/server/src/application/film-planning-guidance.ts`
   - `apps/server/src/application/tool-invocations.ts`
   - `apps/server/test/director-guidance-maintenance.test.mjs`
   - `apps/server/test/tool-invocations.test.mjs`
3. `fix(settings): retain successful local Director checks`
   - `apps/server/src/application/local-director.ts` (diagnostic persistence hunks)
   - `apps/server/test/local-director.test.mjs` (diagnostic tests/audit rewrite)
   - `apps/server/test/installation-status.test.mjs`
   - `apps/web/src/next/model/settings-director.ts`
   - `apps/web/src/next/model/settings-computer.ts`
   - `apps/web/src/next/i18n/catalog/settings.ts`
   - `apps/web/test/next/settings-computer.test.mjs`
4. `fix(server): bound shutdown and close active native workers`
   - `apps/server/src/shutdown.ts`
   - `apps/server/src/index.ts`
   - `apps/server/src/execution/engine.ts`
   - `apps/server/src/application/local-director.ts` (lifecycle hunks)
   - `apps/server/test/server-shutdown.test.mjs`
   - `apps/server/test/execution-shutdown.test.mjs`
   - `apps/server/test/local-director.test.mjs` (lifecycle tests)
   - `packages/director/src/runtime/types.ts`
   - `packages/director/src/runtime/codex.ts`
   - `packages/director/src/runtime/transport.ts`
   - `packages/director/test/runtime.test.mjs`
   - `docs/ai/uiux-plan/codex/reports/B23-live2-findings.md`

## Open issues

- The short-label schema and distinct Director-authored scene title require the successor catalog/skill release proposed above. Existing frozen schemas intentionally remain unchanged, so current label length is guidance rather than new validation.
- No browser replay or live model/provider validation is claimed. The lead must replay the LIVE-2 flow outside this sandbox, including shutdown and reopened Settings.
- Process note: one initial read-only `git status --short` ran alongside the first rules read. No Git mutation or later Git command was run. No browser, real provider/model call, external network request, port-3001 listener, credential read or retained-state mutation was performed.
