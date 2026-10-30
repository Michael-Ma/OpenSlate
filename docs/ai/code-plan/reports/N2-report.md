# N2 video-model implementation report

Date: 2026-10-30. Worktree: `codex-n2-video`; branch: `codex/n2-video`.

## Done

- **N2 1 — Seedance:** official ModelArk task create/retrieve/queued-cancel transport for `ap-southeast-1`; verified model ids for 1.0 Pro Fast, 2.0 Mini and 2.0. Requests pin first/optional last-frame roles, resolution, adaptive/explicit ratio, duration, audio, optional seed, no watermark and returned last frame. Model-specific duration/resolution/audio/last-frame limits and image dimensions/aspect/size fail before dispatch. Uses the existing credential resolver's new `modelark-video` alias (`OPENSLATE_MODELARK_API_KEY`). Definitive task failures release liability; realistic-face moderation reports `SEEDANCE_FACE_REJECTED`, a plain message, retained `retry: "none"` and execution `retryAllowed: false`. The clip uses the existing raw spool, measured normalization and ingestion; returned JPEG last frames become owned validated PNG artifacts. Actual reported tokens and their calculated cost are saved separately from the conservative reservation.
- **N2 2 — fal:** factored queue/auth/status/result/upload transport into `fal-queue.ts`; existing lip sync preserves its API, queue paths and download policy. `fal-video-i2v` shares the queue client and `fal-video` key. Allowlisted models are Kling 3.0 Standard silent, Veo 3.1 Fast, and **`alibaba/wan-3.0/image-to-video`**. Each has a separate exact field map and published duration/resolution/audio rules. Unknown models are rejected. Generic video uses inline owned PNGs, so it does not need a fal storage upload.
- **N2 3 — code plans/pricing:** installed profile locks expose both adapters through the existing registry and `read_film.models`, including model id, defaults and price basis. A single adapter pricing function per vendor supplies `modelPrice`, step reservation, immutable execution price and provider-authority verification. Seedance uses owned first-frame measurements and the official model-specific output grids; rational integer arithmetic rounds up once to a USD micro. Legacy per-call prices remain unchanged. Added aspectRatio mapping, input-dependent defaults/options and model duration validation. Code-plan guidance covers draft/normal/hero choices, face restrictions and model limitations, with its digest pin updated.
- **N2 4 — installation/graph boundary:** both routes install through the existing profile catalog and startup composition. Fixed API origins, exact protected download hosts, DNS pinning, bounded downloads and current profile/lease/version/Stop/hold/ceiling checks constrain dispatch. Graph overview reads omit N2 video quotes; graph video commands refuse before buying narration or dispatching. Existing graph adapters keep their behavior. Provider setup documentation includes six validated profile entries and copy-paste key/switch/config-variable examples; no private configuration file was created or read.
- **N2 5 — offline verification:** loopback fakes cover both complete pipelines, all three fal field maps, prices matching reservation authority, 9:16 adaptive input, owned last-frame conversion, moderation, lost create/restart, real refused loopback connections, download recovery, input-dependent ceilings, stale-version preparation fencing, changed-price refusal and graph snapshots/quotes.
- **N2 6 — docs:** updated `PROVIDERS-ARTIFACTS.md`, implementation status, code-plan skill/API declarations and this report.

The create marker is written before the HTTP request and cannot be rewritten. First-submit permits remain one-use. No provider-discovery query can reliably identify a missing task from the application's attempt id; a lost create therefore remains unknown with reserved liability, including after restart, and is never automatically resubmitted. A new reconciliation lease can positively close preparation interrupted before its create marker. Accepted evidence survives a failed local receipt write through the existing shared execution evidence.

## Files

Added:

- `packages/providers/src/{video-http,seedance,fal-queue,fal-video-i2v}.ts`
- `apps/server/src/execution/{video-i2v-options,video-i2v-execution}.ts`
- `packages/providers/test/video-models.test.mjs`
- `apps/server/test/video-models.test.mjs`
- `docs/ai/code-plan/reports/N2-report.md`

Changed:

- `packages/providers/src/{index,fal-h3-lipsync}.ts` — exports and shared-queue extraction.
- `apps/server/src/application/{provider-credentials,provider-catalog,media-execution-config,media-execution-runtime}.ts` — fixed aliases, profiles, enablement, host lists and registration.
- `apps/server/src/code-plan/{models,provider-input,provider-authority}.ts` — assigned model/input/price authority scope.
- `apps/server/src/code-plan/{identity,index,execution}.ts` — narrow necessary caller changes for input pricing, plain failure messages, free Seedance failure evidence, and primary-video/last-frame result projection. These overlap N1; merge N1 first and retain its retry/failure behavior.
- `apps/server/src/execution/{provider-use,video-download}.ts` — supported execution identities and protected image download source sharing the existing DNS/TLS/redirect/size policy.
- `apps/server/src/persistence/store.ts` — immutable new JSON receipt kinds only; no schema/DDL/version change.
- `apps/server/src/{generation-quotes,generation-overview,scene-confirmations,scene-generation}.ts` — narrowly omit unsupported graph quotes and refuse N2 graph video generation before priced narration.
- `apps/server/src/application/director-capabilities.ts` — code-plan guidance digest only.
- `apps/server/test/{fal-lipsync-execution,media-execution-config,provider-credentials}.test.mjs` — update exact startup fields and extend credential inventory/isolation coverage for ModelArk.
- `skills/code-plan/{SKILL.md,references/studio.d.ts}`
- `docs/technical/PROVIDERS-ARTIFACTS.md`, `docs/implementation/STATUS.md`

Deleted: none. No web, browser contract, dependency, lockfile, graph guidance or core source edit.

## Tests

**21 new tests** (16 server, 5 provider). **Six existing tests updated or extended** for explicit Seedance/fal-video switches/host lists and the new fixed ModelArk credential alias, including alias isolation. No old money/integrity test was removed or relaxed; no tests deleted, disabled or newly skipped.

| Command | Observed result |
|---|---|
| `pnpm setup:test-media` | Passed; pinned installed tools matched, no download |
| `pnpm check:toolchain` | Passed: Node 24.15.0, pnpm 10.33.0, FFmpeg/ffprobe 8.1.1 |
| `pnpm build` | Passed: all five workspace builds |
| `node scripts/run-tests.mjs packages/providers/test/video-models.test.mjs apps/server/test/video-models.test.mjs apps/server/test/fal-lipsync-execution.test.mjs apps/server/test/media-execution-config.test.mjs apps/server/test/provider-credentials.test.mjs` | **53 passed, zero failed/skipped/cancelled/todo**; 18.335 s |
| `pnpm test` | **4,721 passed, zero failed/cancelled/todo, one optional skip; 4,722 total**, 947.150 s |
| `pnpm -r typecheck` | **5/5 workspace typechecks passed**, zero TypeScript errors |
| Documented profile JSON validation | **6/6 valid profiles** |
| Guidance package digest check | Passed via `skillPackageDigest(readSkillPackageFiles(...))` |
| `git diff --check` and ownership check | Passed; no web/core contract/dependency diff |

Earlier exploratory runs found and corrected new-receipt persistence wiring and test expectations; they are not final acceptance results. One broader preliminary run was interrupted after the guidance pin changed while its already-built code still held the old digest. The first full run was intentionally interrupted during final review to add positive connect-timeout classification and a regression assertion distinguishing read timeouts. The completed final full run uses the rebuilt final source and the updated startup-configuration expectations; an intermediate completed full run had **4,716 passed / five failed / one optional skip (4,722 total)** in 1,055.985 s. Its only failures were three stale config expectations and two credential-inventory/isolation expectations; all are corrected, and the combined final touched gate passed 53/53. Only completed final gates are acceptance evidence.

Logs: `/tmp/n2-{setup,build,touched,full-test,full-test-preliminary}.log`; typecheck log is `/tmp/n2-typecheck.log`. Builds retain the existing Vite mixed-import/chunk-size notices. All generated fixture databases, images and MP4s stay in temporary directories.

Self-review inspected the complete source/new-file diff, callers and cross-file effects: profile/input/price identity, rational rounding, first/last-frame mapping, connect-versus-read timeout evidence, durable create markers, lease/version fencing, unknown recovery, accepted receipt repair, graph quote absence, download allowlists, image conversion and normalized artifact publication. It corrected a primary-result issue caused by canonical sorting of `lastFrame` before `video`; media results now explicitly select the video, and a regression assertion protects it. It also preserved the original lip-sync download allowlist while adding the documented Google Storage host only for generic fal video. The final source/test diff review found no further actionable issue. All final gates passed; the only skip is `opt-in native Codex probe never starts a model turn`.

## Contract changes

`packages/core/src/studio-api.ts`: **none**. `apps/server/src/code-plan/port.ts`: **none**. Internal model descriptions add `priceUnit: "input"`, `modelId` and `priceBasis`; the shipped code-plan browser view keeps its existing shape. Extra last-frame images use the existing media result's artifact list.

Code-plan guidance digest: `4c686d648999cfed0d64b7d347f2c6fff01a37db492f45e2a30f955da81eba8b`.

## Commits

No commits created under the card's hard rule. Proposed lead-owned split:

1. `feat(providers): add ModelArk Seedance and shared fal video transports` — `packages/providers/src/{video-http,seedance,fal-queue,fal-video-i2v,fal-h3-lipsync,index}.ts`; `packages/providers/test/video-models.test.mjs`.
2. `feat(code-plan): dispatch input-priced video profiles with durable authority` — `apps/server/src/execution/{video-i2v-options,video-i2v-execution,provider-use,video-download}.ts`; `application/{provider-credentials,provider-catalog,media-execution-config,media-execution-runtime}.ts`; `code-plan/{models,provider-input,provider-authority,identity,index,execution}.ts`; `persistence/store.ts`; graph `{generation-quotes,generation-overview,scene-confirmations,scene-generation}.ts`; the added server test file and all three updated server test files.
3. `docs(code-plan): document video setup limits and N2 verification` — `skills/code-plan/{SKILL.md,references/studio.d.ts}`; `application/director-capabilities.ts`; provider technical docs, implementation status and this report.

## Open issues

- **Live acceptance is intentionally pending:** the lead must run the separately authorized small paid checks. These tests establish request shapes, accounting and local recovery against fakes; they do not establish account/region eligibility, subjective output quality or actual vendor bills. All final public documentation pages were reachable by unauthenticated GET. Initial guessed Wan URLs returned 404; the public fal model catalog supplied its exact Alibaba endpoint. No API key or authenticated API was used to research documentation.
- **Model output assumptions:** adaptive pricing selects the closest standard aspect and the documented model-specific output grid; reported usage remains separate actual-cost evidence. Public ModelArk pricing labels token calculations as estimates. Validate provider-produced sizes/token counts in the lead's live check before treating the computed reservation as an actual bill.
- **Existing normalization is silent:** vendor audio flags are mapped and priced, but the shared silent H.264 normalization strips generated audio. Guidance and setup docs state this limitation; audible narration still uses owned speech. Expanding audio preservation is outside this card.
- **Profiles/locks:** existing selection pins one video profile per film. Installing six entries does not expose six choices inside an existing locked film, and no saved lock is upgraded automatically. N2 startup fields are additive/optional for trusted in-process callers; missing fields disable these new routes.
- **Recovery/downloads:** no create retry or task discovery by application attempt id. Protected locators can expire (ModelArk documents 24 h), and unlisted returned hosts are refused until the owner configures verified exact hosts. The queued-cancel transport does not add a new cancellation workflow. Generic fal accepted failures conservatively retain liability.
- **Merge note:** N1 owns broader retry/failure/ceiling work and merges first. Its existing per-call Viggle/MiniMax prices must remain unchanged while the new input-priced branches use the shared functions. The retry-none projection is retained execution evidence plus `retryAllowed: false`; no N1 browser failure contract is changed here.

No commit, push, browser launch/check, port-3001 listener, protected `.env*`/secrets/`.openslate` read, real native/model/provider call or subagent was used. Only permitted public documentation GETs and loopback fake APIs accessed the network.

## Lead review (merge with N1)

- **Connect failures have one rule.** `isConnectPhaseFailure` now delegates to N1's `connectFailureCode`, which gained N2's `ENETUNREACH`/`EHOSTUNREACH`/`ETIMEDOUT` cases, counted only when the failing syscall is `connect`.
- **Free failures can retry.** A Seedance task that fails for free and is not a content refusal now reports `retry: "safe"`, so it retries automatically up to twice. Otherwise it could never be retried. Face and moderation refusals stay `"none"`.
- **Code films can use every ready video model.** New code films pin all ready video profiles beside the selected one, which stays first as the default, so the model guidance is real. Graph films still pin one. Films already created keep their saved lock.
- **Audio from vendors is still dropped.** The shared normalization strips it, as the report says.
