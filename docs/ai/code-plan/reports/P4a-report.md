# P4a real-provider implementation report

Date: 2026-10-29. Worktree: `codex-p4a-providers`; branch: `codex/p4a-providers`.

## Done

- **P4a 1 — models/prices:** code projects resolve image/video/speech models from the exact project capability lock and installed catalog, using profile ids. Removed/changed definitions fail closed; demo-only projects retain their fake models. Full profile-definition digests enter real step identity. Video defaults fit the saved duration bounds. `read_film` and Director context include model ids, defaults, configured unit prices, price basis and unknown-price flags. Codex uses its subscription at $0, retaining the shared native authentication check and 200-step bound. Other zero estimates remain explicitly unknown. P4a's explicit per-second video rule is implemented; see the graph-quote discrepancy below.
- **P4a 2 — real dispatch:** `CodePlanExecution` uses the installation's registered Codex image, OpenAI Images, Viggle H3, MiniMax H3 and OpenAI speech adapters. Installed definition, enablement, tools and credentials are checked before admission. The saved code-plan execution receipt supplies version/request/profile/price reservation authority instead of graph nodes, candidates or grants. The adapter's first irreversible marker rechecks the original plan version, lease, profile lock, Stop, priced holds and ceiling. Profile concurrency leaves blocked calls absent, without consuming attempts. First-submit permits remain one-use; recovered intents only look up retained evidence. Shared `execution_evidence` preserves accepted task identity if an adapter's receipt write fails.
- **P4a 2 — media integrity:** reused the existing credential resolver, egress/download allowlists, raw spool, receipt checks, image decoding, video/audio normalization, derivation receipts and measured `media_source` publication. Viggle records an alternate code-plan first-frame pin and uses the existing F1 centre crop; it creates no synthetic graph review. Raw and normalized hashes remain distinct. Publication atomically retains artifact, derivation and source records. An interrupted ingestion resumes locally without another submit/poll/download.
- **P4a 3 — rendering:** real `local-render` captures exact owned clip/audio descriptors, writes the existing local timeline format, freezes a manifest and uses the shared `LocalMediaExecutor`/FFmpeg path. Its immutable `code_plan_render_intent` precedes rendering. Output is an owned, probed H.264 MP4, with AAC/48-kHz stereo when audio is supplied. The existing cuts/30-fps/360-second/64-clip/65-placement/eight-lane bounds remain authoritative. Restart reuses a durable completion after lost SQL publication. Imported restore authority may recover existing bytes but cannot start another render. Demo-only projects keep fixture rendering.
- **P4a 4–6 — boundaries/docs:** no graph admission or graph pricing changes, browser contract change, web edit, DDL or dependency change. Updated execution/provider documentation, implementation status and code-plan guidance, including its digest pin. Live P4b remains the lead's task.

## Files

Added:

- `apps/server/src/code-plan/{models,provider-authority,provider-input}.ts`
- `apps/server/test/code-plan-providers.test.mjs`
- `apps/server/test/code-plan-providers-fixture.mjs`
- `docs/ai/code-plan/reports/P4a-report.md`

Changed within card ownership:

- `apps/server/src/code-plan/{director,execution,identity,index}.ts`
- `apps/server/src/index.ts`
- `skills/code-plan/SKILL.md`, `skills/code-plan/references/studio.d.ts`
- `apps/server/src/application/director-capabilities.ts` — guidance digest pin only
- `docs/technical/{EXECUTION-ENGINE,PROVIDERS-ARTIFACTS}.md`
- `docs/implementation/STATUS.md`

Narrow shared changes, individually:

- `apps/server/src/application/media-execution-runtime.ts` — expose the same registry, ingestion router and local executor to code mode; preserve the Engine's composition.
- `apps/server/src/execution/provider-use.ts` — verify an exact code-plan receipt as the alternate profile/admission proof.
- `apps/server/src/execution/codex-image-authority.ts` — alternate code-plan admission and first-dispatch checks; retain reference/profile/receipt validation.
- `apps/server/src/execution/codex-image-execution.ts` — classify a code-plan version fence as a selection change before native start.
- `apps/server/src/execution/viggle-h3-authority.ts` — alternate code-plan admission and exact first-frame intent pin.
- `apps/server/src/execution/viggle-h3-receipts.ts` — validate the alternate first-frame pin without weakening graph pins or crop checks.
- `apps/server/src/execution/viggle-h3-execution.ts` — recognize code-plan reservations when recovering known pre-marker non-dispatch.
- `apps/server/src/execution/audio-execution-authority.ts` — alternate code-plan speech admission; keep shared audio profile and lineage checks.
- `apps/server/src/execution/openai-image-execution.ts` — alternate code-plan admission/currentness/lease and pre-marker recovery.
- `apps/server/src/execution/minimax-h3-execution.ts` — alternate code-plan admission/currentness/lease, pre-marker recovery and exact owned-frame authority.
- `apps/server/src/execution/local-media-executor.ts` — code-plan entry point using the same timeline store, manifest renderer, probe checks and managed MP4 installer.
- `apps/server/src/media/timeline-capture.ts` — additive SQL-only code-plan media capture; preserve graph capture.
- `apps/server/src/persistence/store.ts` — retain code-plan profile proof without a graph grant; make local render intent and original execution fields immutable. No schema change.

Deleted: none. Lead-owned `port.ts`, `packages/core/src/studio-api.ts`, web files, dependencies and shipped graph guidance are unchanged.

## Tests

Added **28 tests**, with no existing test rewritten, deleted, skipped, disabled or relaxed. They cover installed inventory and Director cost context; exact Codex/Viggle intent-to-spool-to-ingest flow; real MP4 and AAC output; native and accepted-Viggle lost-reply lookup; terminal lost-POST liability; ceilings and missing credentials; disabled/removed/changed profiles; concurrency; version fencing during native prepare; local completion and ingestion restart; all five adapters; unknown prices and bounded defaults; accepted-evidence receipt repair; pre-marker recovery for the three HTTP image/video adapters; immutable inputs; reserved model ids; local-render failure visibility; independent later-version progress; and 200-second speech whose stereo normalization exceeds the raw spool cap. The existing P2c fake HTTP/edit/restart flow is retained unchanged.

All fixtures use temporary state, synthetic PNG/MP4/WAV bytes, injected native/HTTP/download transports and the pinned local media tools. There is no live provider acceptance claim. The two-shot real-pipeline fixture renders **180 frames / six seconds / 160×90 H.264**, using **600,000 configured micros** for two three-second clips; its speech variant adds **10,000 micros** and verifies AAC/48-kHz stereo. These amounts are fixture estimates, not vendor charges.

| Command | Observed result |
| --- | --- |
| `pnpm setup:test-media` | Passed; already installed tools matched, no download |
| `pnpm check:toolchain` | Passed; Node 24.15.0, pnpm 10.33.0, FFmpeg/ffprobe 8.1.1 and required encoders |
| `pnpm build` | Passed; all five builds |
| `node scripts/run-tests.mjs <19 code-plan/provider/local-media test files>` | **429 passed, zero failed/skipped/cancelled/todo**, 73.795 s |
| `pnpm test` | **4,755 passed, zero failed/cancelled/todo, one optional skip; 4,756 total**, 902.507 s |
| `pnpm -r typecheck` | **5/5 workspace typechecks passed**, zero TypeScript errors |
| Example strict TypeScript check | Passed |
| Code-plan package digest check | Passed using the shared `skillPackageDigest` function |
| `pnpm demo:code` | Passed; two choices, versions 1 → 2, seven reused steps, one new video/render, one lookup recovery, zero duplicates, $0.36 / $1 fixture ceiling |
| `git diff --check` and ownership check | Passed; no web/lead-owned contract/dependency diff |

The optional skip is `opt-in native Codex probe never starts a model turn`. No unrelated failure was observed in the completed final gates.

The focused gate's 19 files are `code-plan-{providers,execution,runtime,port,sandbox,e2e,director,routes}.test.mjs`, `media-execution-runtime.test.mjs`, `local-media-executor.test.mjs`, `codex-image-{execution,runtime,outcomes}.test.mjs`, `viggle-h3-{execution,frame-crop}.test.mjs`, `minimax-h3-execution.test.mjs`, `openai-{image,speech}-execution.test.mjs` and `provider-use.test.mjs`, all under `apps/server/test/`. Logs are `/tmp/openslate-p4a-{build,focused,final-full-test,typecheck,demo}.log`. Build retains the existing Vite mixed-import/chunk-size warnings; Node retains the existing TypeScript-stripping warning.

Self-review covered the complete source/new-file diff, authority and profile pins, callers, browser contract separation, ceiling and held work, concurrency, lease fencing, local capture/render/publication, normalization lineage and restart/shutdown paths. It corrected the graph-only Store pin, raw-versus-normalized publication ordering, shared accepted-task evidence, pre-marker reservation recovery, duration-default clamping, version fences after asynchronous native/local preparation, cancellation propagation, persistent local-render error visibility, and the separate raw/normalized audio byte bounds. Regression tests cover these fixes. The preliminary full runs were intentionally interrupted after the local-render and long-audio review findings; only the completed final run is used for acceptance. The final diff review and passing regression checks found no remaining actionable issue in the owned implementation.

## Contract changes

`packages/core/src/studio-api.ts`: **none**. `apps/server/src/code-plan/port.ts`: **none**. The additive model inventory is supplied only through the internal Director `read_film` result/context, via an optional internal model-reader capability; the browser `CodePlanView` retains its exact shape.

Code-plan guidance package digest: `d9b5c15aa32e3a152270af8786e8ed696183f6b3fbe667c0834a92845c93e0a4`.

## Commits

No commits created, as required by the hard rules. Proposed lead-owned split:

1. `feat(code-plan): dispatch installed providers with durable step authority` — code-plan `{models,provider-input,provider-authority,execution,identity,index,director}.ts`; shared execution `{provider-use,codex-image-authority,codex-image-execution,viggle-h3-authority,viggle-h3-receipts,viggle-h3-execution,audio-execution-authority,openai-image-execution,minimax-h3-execution}.ts`; `persistence/store.ts`; `application/media-execution-runtime.ts`; server `index.ts`; new provider test/fixture.
2. `feat(code-plan): render owned timelines through the local media executor` — `execution/local-media-executor.ts`, `media/timeline-capture.ts`, the local-render portions of code-plan execution and provider tests.
3. `docs(code-plan): describe installed models and record P4a verification` — code-plan skill/API declarations, `application/director-capabilities.ts`, execution/provider technical docs, status and this report.

The lead can stage file hunks where components share execution/test files.

## Open issues

- **Price interpretation for lead review:** this checkout's graph quote uses flat configured per-clip prices for Viggle/MiniMax; only fal lip sync is scaled per second there. P4a explicitly asks per-second video scaling. Code mode therefore multiplies the locked video unit cost by seconds, leaving graph quotes untouched. The unit basis is exposed in `read_film` and documented. Configure code-plan estimates accordingly; these tests do not verify actual vendor charges.
- **Live acceptance:** P4b must verify installed account/authentication access, actual model outcomes, cost configuration and film quality. No real native turn, provider HTTP request, external network call or paid experiment was run here.
- **Recovery limits:** a missing native/adapter reply with retained identity is reconciled by lookup; this does not add vendor discovery by application attempt id. Existing lost-POST policies remain intact, including terminal `SUBMISSION_RESPONSE_LOST` with retained liability and no retry. Zero/unknown estimates cannot bound unknown vendor charges.
- **Carried limitations:** P2b's unrelated detached-Promise rejection limitation and P2c's reached-prefix-only preview remain unchanged. Code-plan guidance locks are immutable; this card updates the current digest rather than adding a guidance-lock migration.
- No browser launch/check, protected `.env*`/secret/production-state read, port-3001 listener, commit, push or subagent was used.

## Lead review

- **Pricing changed to per call.** The card's "per second of video" was a lead error: graph quotes (`generation-quotes.ts`) charge one flat `unitCostMicros` per clip, so a 6 s clip at the profile's $0.10 would have priced at $0.60 in code mode. `modelPrice` now has one rule, per call for every kind; the per-second branch and its duplicate in `provider-authority.ts` are removed (the duplicate made every real video admission fail `CODE_PLAN_PROVIDER_AUTHORITY` once only one side changed). Duration is still validated against the profile frames in `provider-input.ts`. Tests now expect per-call spend; the ceiling test uses a $1.50 clip profile so one clip still crosses $1.
- `SKILL.md` states the per-call basis; `CODE_PLAN_GUIDANCE_DIGEST` recomputed.
