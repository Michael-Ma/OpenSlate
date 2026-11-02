# Current implementation status

Reconciled **November 2, 2026**, against the D1 worktree baseline `47205eb2` (including merge `c8461021`). This page describes current source. Dated reports below retain their original counts, limitations and decisions; their earlier “pending” statements are historical.

OpenSlate is an early **single-user, single-machine** studio. The browser, Fastify app, SQLite, owned media, workers and native Directors run locally; configured model APIs can be remote. Installer packaging, portable data relocation and complete real-provider/long-film acceptance remain outstanding.

## Implemented now

| Area | Current scope |
|---|---|
| Studio | Next-only Last Ferry UI in `apps/web/src/next`, English/Chinese, explicit @ scope, responsive Director drawer, Start and Settings |
| Storyboard films | Brief/story/scenes/shots, import review, scoped/alongside edits, exact frame views, keyframes with voice, durable scene-video confirmation, fit/Undo, retained takes and storyboard-order export |
| Code-plan films | Versioned TypeScript in disposable QuickJS/WASM workers, deterministic replay, content-addressed media, dry-run diffs, bounded repairs and durable choice/attempt history |
| Code-film decisions | `ctx.keyframe` makes one frame per declared shot and waits for its priced video-input choice. New clips of declared shots require that choice; previously dispatched clips replay. Programs without shot declarations are not gated |
| Choice retirement | Cards remain in the reply where asked (`askedAt`). Latest completed pass reachability determines liveness. Changed dependencies retire affected cards; answering a retired choice is refused (`CODE_PLAN_CHOICE_STALE`, 409). Identical reached inputs can restore saved pictures/answers without purchasing again |
| Progress and uploads | Code Plan shows shared references and per-shot making/queued/held state, with elapsed minutes and navigation from the run strip. Uploaded pictures remain discoverable to the Director on later turns; reduced owned copies satisfy reference bounds |
| Codex Director | Pinned 0.162.1 App Server, default `gpt-6.1-sol`, high reasoning, actual account/runtime model list, saved selection preserved, verified side-by-side binary fallback with notice |
| Claude Code Director | Code films only, user's Claude subscription, Opus 5.5 or Sonnet 5.5; 2.1.312 or later 2.x; fresh restricted process, verified init, explicit MCP tools and private system-prompt file |
| Media | Codex/OpenAI images, Viggle/direct MiniMax H3, OpenAI speech/transcription, Lyria 3.5 music; Seedance/fal code-film adapters implemented, account/key/live acceptance separate |
| Film craft | Contract 0.3.0 image references/aspect ratios, free picture/video contact sheets and bounded review turns; cuts, source trims, speed, last-frame holds, fixed zoom, captions, six local sounds, fades and code-film loudness mastering |
| Spending/recovery | Code-film default $4, configurable new-film preference and per-film limits; charged/unknown/in-flight liability retained. Submission intent precedes effects, unknown outcomes reconcile before retry. Storyboard execution has no project spend cap |
| Local operation | Source launcher, pairing, exact toolchain, schema 4 entity store, same-root media-inclusive backup and quarantined restore |

Storyboard media retains two scene decisions: create keyframes, then inspect returned frames and actual timing/motion/video recipe before video. Code films instead execute the saved program within its ceiling and current choices. Configured providers need no separate API-key approval or usage allowance; returned clips have no additional acceptance gate. New user direction fences old epochs. Holds and preparations cannot borrow a later request's authority.

## Current contracts and limits

- Browser types: [studio-api.ts](../../packages/core/src/studio-api.ts). The only web entry is `apps/web/src/next`; no legacy selector is needed.
- Storyboard guidance: [shipped registry](../../skills/shipped-releases.json), latest **8.1.0 / 7.1.0**. Code guidance: [code-plan package](../../skills/code-plan/openslate.skill.json), **2.0.0 / 0.3.0**. Older bound catalogs, plan keys and instruction snapshots retain their identities.
- Storyboard declarations compile without JavaScript evaluation. Code-film programs evaluate only inside the bounded QuickJS guest; host Node/files/network/secrets are unavailable. [Compiler](../technical/PLAN-COMPILER.md), [execution](../technical/EXECUTION-ENGINE.md).
- Local renders: 30 fps picture, 48 kHz audio, 360 seconds, 64 clips, 65 audio placements and eight simultaneous audio lanes. Code-film row edits/captions do not imply a general timeline editor.
- Codex uses the accepted local runtime trust policy. Independent code-host/authentication isolation remains unverified, not an additional deployment gate. [Decision](RUNTIME-TRUST-DECISION.md).
- Existing eligible personal voice IDs support consent/revocation; creating a new clone from a recording is unimplemented. The Director cannot listen to music/audio. General detached QuickJS promise rejections outside observed `ctx` calls remain a documented limitation.

## Verification and acceptance

D1 changes documentation only. Its before/after checks, exact counts, self-review and browser limitation are in the [cleanup report](../ai/DOCS-CLEANUP-REPORT.md). Toolchain pins are Node **24.15.0**, pnpm **10.33.0**, FFmpeg/ffprobe **8.1.1**. Offline tests use temporary state/fake transports; they do not verify vendor access or subjective quality. Card rules prohibit launching browsers or real providers; the lead runs the rendered browser gate outside the sandbox.

The preceding integrated checkpoint recorded **5,083 passed, zero failures, two optional skips**, five typechecks, `pnpm demo:code`, 1,024 web tests and 207/207 browser scenarios. Those are historical results, not D1's rerun counts. Later merged changes require their own checks; see the M/K reports below.

**Dated real-media evidence:** [November 1 results](../ai/film-quality/RESULTS.md) record the Tofu film, contact-sheet review, one retake and model comparison ($2.68 film; $0.95 comparison; 355 Viggle credits total). This is one sample; the soundtrack had not been listened to. Reference-mode reframing cut the subject in two of four comparison clips; seven first-frame clips kept it whole. Upload/keyframe validation and its bounds are recorded in [U2](../ai/film-quality/reports/U2-report.md) and [K1](../ai/film-quality/reports/K1-report.md). A successful small run does not establish every installed provider or longer production quality.

For the next owner run use [测试说明](../ai/code-plan/TEST-INSTRUCTIONS.md) and [manual live production](MANUAL-LIVE-PRODUCTION.md). Validate latest Codex choices and Claude plan setup, then a small film, one scoped replacement and restart/reopen without duplicate submission. Media quality, sound and account usage need human observation.

## Decision and evidence map

The repeated per-card changelog has been trimmed here; detailed file inventories, tests and open decisions remain in the retained reports.

| Work | Retained record |
|---|---|
| Code replay, Director/port, HTTP/UI and offline integration | [Code-plan design](../ai/code-plan/DESIGN.md), [reports](../ai/code-plan/reports/) |
| Retry/ceilings, model capabilities, music, assets, references and lost Viggle replies | [N1–N8 reports](../ai/code-plan/reports/) |
| Film craft, image ratios/references, contact-sheet review and renderer | [Q1–Q4 reports](../ai/film-quality/reports/) |
| Upload formats and Director picture access | [U1/U2 reports](../ai/film-quality/reports/) |
| Confirmed keyframes, card retirement, generated-picture decode and progress | [K1/K2/K2b/K3 reports](../ai/film-quality/reports/) |
| Latest Codex/restart-safe upgrade and Claude process integration | [M1/M1b/M2/M2b/M2c reports](../ai/film-quality/reports/) |
| Last Ferry server/UI migration and integrity follow-ups | [UI task reports](../ai/uiux-plan/codex/reports/), [B1](../ai/uiux-plan/codex/B1-report.md), [B2](../ai/uiux-plan/codex/B2-report.md), [B4](../ai/uiux-plan/codex/B4-stop-report.md), [B7](../ai/uiux-plan/codex/B7-confirm-report.md) |
| Earlier real/synthetic/native acceptance | [Evidence index](VALIDATION-EVIDENCE.md), [live validation](LIVE-VALIDATION.md), [October 1 review](V1-COMPLETION-REVIEW.md) |
| Earlier UI/toolchain checkpoints | [October 3](OCTOBER-3-REFINEMENT-REVIEW.md), [October 5](OCTOBER-5-LIGHT-WORKSPACE.md), [conversation](OCTOBER-5-CONVERSATION-RESULTS-REVIEW.md), [retirement review](OCTOBER-5-POST-MIGRATION-REVIEW.md), [generation](OCTOBER-5-SIMPLIFIED-GENERATION-REVIEW.md), [October 7 UI](OCTOBER-7-DAY-NIGHT-REVIEW.md), [languages](OCTOBER-7-LANGUAGE-REVIEW.md), [toolchain parity](OCTOBER-8-TOOLCHAIN-PARITY.md) |

Current operational/component guides are indexed in [docs](../README.md) and [technical references](../technical/README.md). Historical designs, prototypes and still-pending research are classified in the [AI documentation map](../ai/README.md).
