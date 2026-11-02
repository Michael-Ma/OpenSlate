# Card L1: no vendor task id means the reply is lost, for every provider

Read `docs/ai/uiux-plan/codex/RULES.md` and follow it: sandboxed, no git, no Chrome or browser checks, no `.env*`, nothing under `.openslate/`, nothing on port 3001, no real provider, no network beyond loopback. Do not edit `apps/web/**`; the lead does the UI.

## Owner's decision (final)

Design for real vendors, never around what only the fake provider can do. A real vendor issues its task id, or returns its bytes, only in the response to our request. It cannot find work by our attempt id. So when we have no vendor task id, `lookup(attemptId)` can never learn anything new from the vendor.

The rule for every adapter:

| Local state when `lookup` runs with no vendor task id | Outcome |
|---|---|
| A local receipt or result exists (accepted, rejected, not_dispatched, completed, saved bytes, owned output) | Unchanged: keep today's local recovery. Engine-side accepted evidence (`engine.ts` `acceptedIds`) also stays. |
| No dispatch marker, and the lease is fenced so a stale worker cannot dispatch any more | Provably never sent: `rejected`, certainty `not_accepted`, not charged. Codex image already does this (card R3; see `codex-image-execution.ts` recover). |
| A dispatch marker or an unknown receipt, and any in-flight request from any host must have ended (the adapter's maximum allowed timeout since dispatch) | Lost reply: `{ type: "failed", taskId: null, failureId: "SUBMISSION_RESPONSE_LOST", technical: true, retryAllowed: false }`. Reservation charged, no automatic retry. |
| A dispatch marker, but a request may still be in flight | Stay `unknown` (the engine's unknown backoff handles re-checking). |

Only a human press may buy again; the web shows "may already have been charged, making it again costs again". The reference implementation is the Viggle H3 change in commit 9596356:

- `apps/server/src/execution/viggle-h3-execution.ts`: `responseLost`, `MAX_SUBMIT_TIMEOUT_MS`, `replay`
- `packages/providers/src/execution.ts` `normalizeExecutionOutcome`
- the tests in `apps/server/test/viggle-h3-execution.test.mjs`

## Changes

1. **Normalizer.** Generalize the taskId-null `failed` exception in `normalizeExecutionOutcome` from Viggle-only to any adapter, but only for `failureId === "SUBMISSION_RESPONSE_LOST"` with `retryAllowed === false`. Keep the codex-image exception as it is.

2. **Adapters.** Apply the table to each of these, using each adapter's own dispatch marker and receipts:
   - `minimax-h3-execution.ts`
   - `openai-image-execution.ts`
   - `openai-speech-execution.ts`
   - `openai-transcription-execution.ts`
   - the wrappers that route to them: `narration-speech-execution.ts`, `owned-transcription-execution.ts`
   - **codex-image:** its lookup reads a real source, Codex `thread/read`, on a saved thread or turn id. Treat a saved thread or turn id like a task id and keep that path. Apply the lost rule only when no such id was saved after the dispatch marker.
   - **OpenAI speech and image:** the bytes exist only in the HTTP response. A dispatch with no saved result, once the request must have ended, is a lost reply.
   - Leave local-execution alone; it already fails.

3. **Fake provider.** `packages/providers/src/fake.ts` must stop looking up jobs by attempt id. That is the fake-only capability the owner rejected.
   - `unknown_after_accept` must behave like a real vendor whose POST reply was lost: lookup returns `SUBMISSION_RESPONSE_LOST`.
   - `poll(taskId)` with a known task id may still complete.
   - About 20 server test files expect a late result to be found by attempt id after `unknown_after_accept`. Examples: `r2-retained-outcomes`, `takes-undo`, `keyframe-blocker-recovery`, `scene-generation`, `project-model-settings`, `six-minute-workflow-smoke`, `stop-release`.
   - Rewrite each to the real-vendor behaviour: a charged lost reply that only a new press replaces. Delete a scenario only when it cannot happen with a real vendor, and list every rewrite and deletion in the report.
   - `apps/server/test/engine-unknown-backoff.test.mjs` overrides lookup to stay unknown on purpose, because it covers attempts that legitimately stay unknown with a task id. Keep it passing.

4. **Engine.** Do not add a generic engine-level shortcut. Adapters decide from their own receipts, because only they can tell "never sent" from "maybe sent".
   - Keep `releaseAttempt` ("Give up") for attempts that stay `submission_unknown` with a task id.
   - Do not change the unknown backoff or event dedupe from commit e643e8e.

## Tests (minimum)

For each adapter in change 2:

- **Lost reply:** dispatch marker present, no reply, and past the timeout window. Expect `failed` / `SUBMISSION_RESPONSE_LOST`, reservation `charged`, exactly one dispatch, no automatic retry after several `reconcile()` + `runReady()` cycles, and the concurrency slot freed.
- **In-flight window:** a dispatch marker inside the window stays `unknown`, then becomes lost once the window passes.
- **No dispatch marker** with a fenced lease: `rejected`, reservation `released`, not charged.
- **Local recovery still works:** an existing accepted receipt or a saved completion still resolves as today.

Also:

- **Normalizer:** accepts SUBMISSION_RESPONSE_LOST with taskId null for every adapter, and still rejects any other taskId-null `failed`.
- **Regression proof:** every new behaviour test must fail without the fix. Say in the report that you checked this.

## Report

Write `docs/ai/uiux-plan/codex/reports/L1.md` with the RULES headings. Also list:

- every adapter's in-flight window and where it comes from;
- every rewritten or deleted test and why;
- what the web needs to show for keyframes, narration audio and transcripts. The lead adds the UI. Today only the video inspector maps `SUBMISSION_RESPONSE_LOST` (`apps/web/src/next/model/inspector.ts`).

Finish with the full `pnpm test` and `pnpm -r typecheck` counts.
