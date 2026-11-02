# V1 — voice-line and Director-transcription outcomes

## Done

- **V1.1 / GR-9:** The real browser-facing `ShotNarration` builder is `GenerationOverviewReader` in `generation-overview.ts`. It now returns the same allowlisted `MediaFailure` as keyframes/clips for a failed current voice attempt, and its exact `attemptId` for `making`/`no_answer`. `scene-narration-view.ts` supplies section evidence; `service.ts` and `context-projection.ts` do not construct `ShotNarration`, so none needed edits.
- **V1.1 / L1:** Extracted the existing picture/clip failure mapping into `media-failure.ts` and reused it for speech/transcription. It derives charge status from the reservation, retries from the executor's effective remaining budget, and time from execution evidence with the existing creation-time fallback. Lost replies remain `SUBMISSION_RESPONSE_LOST`, charged, terminal and ineligible for automatic retries. A proven pre-dispatch cancellation returns `charged: false, notDispatched: true`. Released reservations alone, provider refusals and invalid/foreign receipts do not imply non-dispatch.
- **V1.2 / GR-10:** Existing Give up supports no-answer voice attempts without an engine or route change. The returned voice `attemptId` works through `POST /api/projects/:projectId/attempts/:attemptId/release`; an identical keyed replay returns the same receipt. The current narration returns to `text_only`, while the old attempt remains unknown/reconcilable and its reservation remains committed. Release does not resubmit anything.
- **V1.3:** Every Director turn read recomputes `transcription` from the original attachment publication and its exact candidate's latest attempt. It reports queued/in-flight work as `running`, completed work as `ready`, an unknown submission as `no_answer`, and terminal failure with the shared safe metadata. Completed Director turns continue updating as transcription settles. Original tool replies and durable generation effects remain immutable. Transcript text, provider prose, RPC bodies and diagnostic request IDs are excluded from the new projection.
- **V1.4:** New offline regression coverage exercises actual injected OpenAI speech/transcription bridges, durable publication, reconciliation, reservations, live turn reads and voice HTTP release. No real provider is called.
- **V1.5:** The precise sample-film parity work is listed below for the UI lead; no `apps/web/**` file was edited.

## Files

Changed:

- `packages/core/src/studio-api.ts`
- `apps/server/src/generation-overview.ts`
- `apps/server/src/application/director-attachment-transcription.ts`
- `apps/server/src/application/director-turn-view.ts`

Added:

- `apps/server/src/media-failure.ts`
- `apps/server/test/voice-outcomes.test.mjs`
- `apps/server/test/director-transcription-outcomes.test.mjs`
- `apps/server/test/media-failure.test.mjs`
- `docs/ai/uiux-plan/codex/reports/V1-report.md`

Deleted: none. No service/grant code, schema, provider implementation, UI or frozen catalog changed.

## Tests

Added **20 tests**: four voice outcomes, five Director-transcription outcomes, eleven shared-failure cases. No existing test was rewritten, deleted, disabled or weakened.

Before production edits, the four voice tests and original four transcription tests each failed on their missing public failure/outcome/attempt fields (**0/4 + 0/4**). The first attempt to run voice tests could not load absent build output; after a baseline build, all four reached the intended failing assertions. The additional historical-linkage and helper tests cover new implementation boundaries.

Final checks:

- Exact toolchain: Node **24.15.0**, pnpm **10.33.0**, FFmpeg/ffprobe **8.1.1**. `pnpm check:toolchain` and `pnpm setup:test-media` passed; setup reused installed matching binaries without a download.
- `pnpm build`: passed for all five packages/apps.
- `node scripts/run-tests.mjs apps/server/test/voice-outcomes.test.mjs apps/server/test/director-transcription-outcomes.test.mjs apps/server/test/media-failure.test.mjs apps/server/test/generation-overview.test.mjs apps/server/test/director-attachment-transcription.test.mjs`: **72 passed, 0 failed/cancelled/skipped/todo**.
- The shared-helper file was also rerun after adding an assertion that native proof remains valid without an optional diagnostic: **11 passed, 0 failed/cancelled/skipped/todo**.
- `pnpm test`: **4,129 passed, 0 failed/cancelled/todo, 1 optional native-probe skip (4,130 total)**. The skipped test is `opt-in native Codex probe never starts a model turn`. The run exited 0 and completed in 476.239 seconds.
- `pnpm -r typecheck`: **5/5 packages/apps passed**, 0 failures (`core`, `providers`, `director`, `server`, `web`).
- `git diff --check`: passed after all source, test and report edits.

Self-review covered correctness, current/historical attempt identity, retry/charge semantics, callers, privacy, receipt integrity and cross-file effects. It confirmed that the overview is the only `ShotNarration` builder, and improved transcription lookup to use the exact original publication ID. A separate agent reviewed the complete source/test diff and found no material issue or required test gap. It suggested optional future coverage for damaged transcription attempt node/candidate identity; the new missing-publication/alias test and existing owned-application integrity tests cover the principal boundary. The transcription agent also reviewed this report, clarifying that historical Director effects retain their original attempt identity after later narration changes.

## Contract changes

Only additive optional fields in `packages/core/src/studio-api.ts`, with the card's exact shapes:

```ts
ShotNarration.attemptId?: string;
ShotNarration.failure?: MediaFailure;
DirectorGenerationEffect.transcription?: {
  state: "running" | "ready" | "failed" | "no_answer";
  attemptId?: string;
  failure?: MediaFailure;
};
```

The `MediaFailure.notDispatched` comment now includes exact audio pre-dispatch receipts as well as native receipts. No existing field or required shape changed.

## Commits

No commits made, per `RULES.md`. Proposed split for the lead:

1. `feat(server): expose voice-line failure and release outcomes`
   - `packages/core/src/studio-api.ts`
   - `apps/server/src/media-failure.ts`
   - `apps/server/src/generation-overview.ts`
   - `apps/server/test/media-failure.test.mjs`
   - `apps/server/test/voice-outcomes.test.mjs`
2. `feat(server): project live Director transcription outcomes`
   - `apps/server/src/application/director-attachment-transcription.ts`
   - `apps/server/src/application/director-turn-view.ts`
   - `apps/server/test/director-transcription-outcomes.test.mjs`
   - `docs/ai/uiux-plan/codex/reports/V1-report.md`

## Open issues

- No incomplete backend card work or failing check remains. Decisions and the UI lead's separate fixture/browser follow-up are recorded below.
- **Sample-film parity belongs to the UI lead.** In `apps/web/src/next/fixtures/fixture-commands.ts`, `startVoices`/voice completion must retain a synthetic voice attempt ID while making/unknown, remove it and any old failure when settled/reset, simulate the three failures with all six required failure fields, and include narration failures/unknown outcomes in scene attention/blockers. `release` currently finds keyframe/video slots only; extend it to no-answer narration, preserve liability/history and return narration to its pre-generation text state. A lost reply must be failed/charged/no auto retry; a never-dispatched failure uncharged with `notDispatched: true`; a provider refusal uncharged without `notDispatched`.
- **Sample Director parity:** `fixture-director.ts` currently emits keyframe generation effects only. When simulating attached-audio transcription, expose `transcription` only on transcription effects, update it on reads/ticks through `running` → `ready` or `no_answer` → `failed`, and use synthetic attempt IDs and the same failure metadata. Never place recognized words, provider prose or RPC fields in the generation effect. Current voice narration must clear stale IDs/failures after edits, release and fresh generation; historical Director transcription effects keep their original candidate/attempt identity, including on ready/failed outcomes and after later requests. Exercise the corresponding UI scenarios. No sample fixture was changed because this card forbids web edits.
- **Historical evidence decision:** A transcription effect whose exact original attachment publication is missing or inconsistent returns `no_answer` without an attempt ID. It never borrows a same-recording alias/later request or invents completion/release authority. A valid publication with no admitted attempt reads `running` without an attempt ID. Both cases are covered.
- **Small mapping correction:** An exact native pre-dispatch receipt now proves `notDispatched` even when it has no optional native diagnostic. Audio proof similarly depends on receipt validation, independently of whether diagnostic details exist. Invalid diagnostics do not break the read.
- Browser verification remains with the lead under the card's no-browser rule. All validation here uses disposable offline fixtures; no live-provider quality claim is made. No external network, real provider/model, credential file, `.openslate` path, port 3001 listener, browser launch or Git mutation was used.
