# Card M1: follow-ups after merging R1–R7 and W1

Read `_review-common.md` in this folder first. The branch now contains every R card and W1. On it, `pnpm test` passes 3,732 of 3,734 tests, with one optional skip and one failure.

1. **A new Confirm after a blocked video confirmation fails at the voice step.**
   - The failing test: `apps/server/test/r2-retained-outcomes.test.mjs`, "R2 a temporary retained-frame replacement cannot detach a queued confirmation voice or strand it after frame restoration".
   - Sequence:
     - a video confirmation whose voice line was published but not yet dispatched gets blocked (SCENE_REVIEW_STALE, since R4's runner now blocks a detached pin visibly);
     - the frame is restored;
     - the person presses Confirm again;
     - the new run blocks at its speech step with `NARRATION_SPEECH_INVALID` ("The saved voice line is unavailable", from `workspace.saveWriting` returning no segment in `scene-confirmations.ts`).
   - Find the root cause. The product requirement: after any blocked confirmation, a fresh Confirm on unchanged words buys the voice line at most once in total and makes the clip.
   - Also check the cases the person can actually reach: an own-shot edit that blocks the run after its speech step, and Stop then Continue then Confirm. Make the test pass without weakening its money assertions, and add tests for the reachable cases.
2. **The scripted (fake) Director's demo actions are refused under the current contracts.**
   - Card R5's report: `/demo` close_up and wide on a 5.0.0 or 6.0.0 project with paid media now end with `PROPOSAL_REQUIRED`, as an unknown turn.
   - Migrate the scripted adapter (`apps/server/src/application/fake-director.ts`) for 5.0.0+ epochs: it proposes the change with `propose_change` and records a note whose choices offer that proposal, exactly as a real Director should.
   - Keep the 4.0.0 path and its historical proof unchanged.
   - Check every caller of the demo routes and the fake runtime, including the web fixture's scripted director, for flows that still expect a direct edit, and list them.
   - Tests: a demo close-up on a 6.0.0 project with keyframes and a clip yields a held proposal with a preview (keyframe_remade and clip_remade, derived prompts included); accepting it publishes the change; nothing is charged.
3. **Unknown turns that never dispatched.** Search for other paths where a refusal before any runtime start is recorded as `unknown` with `dispatched: true`; R6 fixed `startNative`. Fix any you find, with tests.

Checks: the RULES checks, the full `pnpm test` once at the end, and `pnpm -r typecheck`. List the browser scenarios that cover the demo Director, so the lead can run them.
