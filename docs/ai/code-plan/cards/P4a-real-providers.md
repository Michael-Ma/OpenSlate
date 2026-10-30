# P4a · Real providers and real rendering for code plans

Read `docs/ai/uiux-plan/codex/RULES.md` first; its hard rules apply in full: no real provider call, no network beyond loopback, never read `.env*`. Then read `docs/ai/code-plan/DESIGN.md` and the P1, P2b and P2c reports.

## Problem

Code plans run only on the fake provider:

- `CodePlanExecution` refuses anything but `fake/1`;
- models are a fixed table (`fake-image`, `fake-video`, `fake-speech`, `local-render`);
- `ctx.render` produces a labelled fixture.

P4 needs one real two-shot film: Codex image keyframes and Viggle H3 clips, under the $1 ceiling. This card makes that possible offline. The live run is the lead's P4b.

## Change

1. **Models from the installed catalog.**
   - A code project's available models are the installed provider profiles of the project's capability lock (image, video, speech), named by profile id. The fake models stay when the installation has no real profiles.
   - Each model's price comes from the profile's `unitCostMicros`, scaled the same way the graph quote does (per image, or per second of video).
   - An unpriced profile stays unpriced. Codex image uses the ChatGPT plan and counts as $0, capped by the step limit.
   - `read_film` and the code-plan guidance tell the Director which models exist and what they cost. If you change `skills/code-plan/`, update `CODE_PLAN_GUIDANCE_DIGEST`.
2. **Real dispatch through the existing provider adapters.**
   - Extend `CodePlanExecution` to call a profile's registered `ExecutionProvider` adapter (Codex image, OpenAI Images, Viggle H3, MiniMax H3, OpenAI speech) with the same intent-before-submit, one-use permit, lookup-after-restart and spool-then-ingest rules P1 built for the fake provider.
   - Reuse the existing credential resolver, egress allowlists, output spool, ingesters, crop step (F1 Viggle first-frame crop) and receipt rules. Do not fork them.
   - Do not go through the graph `Engine`'s node / candidate / grant admission.
3. **Real rendering.** `ctx.render` with the `local-render` model builds a timeline from the plan's clips and audio, and renders it with the existing local timeline / FFmpeg path (timeline capture, local media executor) and its bounds (30 fps, 48 kHz, cuts, lanes). The result is a probed, owned MP4 artifact. The fixture renderer stays only for fake projects.
4. **Safety.**
   - A real dispatch must be impossible without an installed, enabled, credentialed profile.
   - The ceiling check uses the real price.
   - Unknown outcomes are never resubmitted.
   - Graph projects are unaffected.
5. **Tests**, offline, against loopback fakes and the existing provider test fixtures (no real network):
   - a Codex-image-shaped and a Viggle-shaped step each go intent → submit → poll → spool → ingest;
   - a lost response is reconciled by lookup;
   - price and ceiling use the profile's cost;
   - a missing credential refuses before any submit;
   - a real `ctx.render` produces a probed MP4 from two fixture clips;
   - the P2c end-to-end flow still passes on fake models.
6. **Docs:** update `docs/technical/EXECUTION-ENGINE.md` and `PROVIDERS-ARTIFACTS.md`, and add a `docs/implementation/STATUS.md` entry.

## Files you own

- `apps/server/src/code-plan/**`, except `port.ts`.
- `skills/code-plan/**`, with the digest pin.
- `index.ts` wiring.
- Tests.

Shared execution, provider and media modules may get narrow, additive changes. List each one in your report.

## Out of scope

- The live paid run (P4b, lead).
- The web.
- Graph-mode behaviour.
