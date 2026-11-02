# N1 · Failures, retry and the spend limit for code plans

Read `docs/ai/uiux-plan/codex/RULES.md` first; its hard rules apply in full: no real provider call, no network beyond loopback, never read `.env*`. Then read `docs/ai/code-plan/NEXT.md` (items 4, 5, 8 and B0), `docs/ai/code-plan/DESIGN.md`, and the P1, P2a, P4a and P4b reports in `docs/ai/code-plan/reports/`.

## Problem

The owner's real five-shot vertical film failed and could not be recovered:

- **The lost submit was never retried.** Viggle's POST failed 254 ms in with no HTTP status (`VIGGLE_H3_TRANSPORT_OR_RESPONSE_LOSS`). Every transport loss is treated as "may have been charged, never resubmit", so the step ended `failed`, $0.10 stayed charged, and nothing — not the person, not the Director — could retry it.
- **The run looked finished.** The program logged the failure and returned; the run said `done`, with no film.
- **Nobody was told.** The Director learned nothing until asked.
- **Every frame was cropped wrong.** The film was 9:16 and its keyframes portrait (941×1672), but the code-mode Viggle path used the profile's fixed `16:9` and center-cropped every first frame to 928×522.
- **The limit was stuck.** The $1 limit can only be raised by $1 from a button. The owner wants to set it in Settings and in chat; the owner decided **no cap** for chat changes.

## Change

1. **Connect-phase errors are "not submitted".** In the Viggle H3 and MiniMax H3 adapters (and any shared HTTP helper they use), classify errors that happen before a connection exists as a definitive no-submit outcome:
   - DNS failure, connection refused, connect timeout, TLS handshake failure. Use the error `cause.code` values that undici/fetch actually produce, and prove each with a loopback test.
   - Such a step releases its liability and may be retried without consent.
   - Any loss after the connection was established keeps today's policy: unknown, liability retained.
2. **Step errors say what a retry means**, filling the contract fields already added to `CodePlanStepView` in `packages/core/src/studio-api.ts`:
   - `error.retry`: `"safe"` (never reached the vendor), `"consent"` (may have reached it), or `"none"` (invalid input, refused content, a program error).
   - `error.mayHaveCharged`.
   - `attempts`.

   `read_film` carries the same fields.
3. **Safe failures retry on their own.** A step whose failure is `"safe"` is retried automatically, at most twice, with a short backoff, inside the existing intent-before-submit and permit rules. Each attempt is recorded.
4. **Retry with consent.** Add to `CodePlanPort` (`apps/server/src/code-plan/port.ts`; you may edit it for exactly this):
   ```ts
   retryStep(projectId: string, input: { stepKey: string; consent: { by: "person" } | { by: "director"; quote: string; invocationId: string } }): CodePlanView;
   setCeiling(projectId: string, input: { ceilingMicros: string; by: "person" } | { ceilingMicros: string; by: "director"; quote: string; invocationId: string }): CodePlanView;
   ```
   - **Which steps:** `retryStep` accepts a step the current plan reaches whose state is `failed` or a terminal unknown, with `error.retry` not `"none"`.
   - **What it does:** it opens a new attempt for the same step key, so the rest of the film stays reused. The previous attempt's liability stays counted. The new attempt passes the normal ceiling, hold and Stop checks. When it succeeds, its result becomes the step's result on the next pass.
   - **Routes:** `POST /api/projects/:projectId/code-plan/steps/:stepKey/retry` (person consent) and `POST …/code-plan/ceiling` accepting raise **or** lower. Both are idempotent with `Idempotency-Key`, like the other code-plan POSTs.
   - **Lowering:** refused below charged + unknown + in-flight, with a `CODE_PLAN_CEILING` error whose details carry the numbers.
5. **Director tools, contract `0.2.0`.** Add `set_spend_limit({ceilingMicros, quote})` and `retry_step({stepKey, quote})` to a new `CODE_PLAN_TOOL_CONTRACT` `0.2.0` (`packages/core/src/tools.ts`, the code-plan Director in `apps/server/src/code-plan/director.ts`).
   - **Consent:** a tool call is accepted only in a turn started by the person's own message, when `quote` appears in that message (whitespace-normalized). Otherwise it is refused with a clear code. There is no cap on the limit (owner decision).
   - **Versions:** new code films use `0.2.0`; films already pinned to `0.1.0` keep their catalog and still work.
   - **Receipts:** each accepted change is recorded so the thread can show it ("Limit set to $3.00 at your request", "Retrying shot tofu-05's clip").
6. **The run reports failures.** When the program returns and a step it reached is `failed` or a terminal unknown, the run state is `done_with_failures` (new value already in the contract), not `done`.
7. **The Director is told.** When a reached paid step ends `failed` or terminal unknown and is not being retried automatically, start one Director turn, as `triggerCodePlanRepairs` does for program errors. Its input names the step, its shot label, the code, `retry`, `mayHaveCharged` and the price. Never two turns for one failure.
8. **Guidance** (`skills/code-plan/`, update `CODE_PLAN_GUIDANCE_DIGEST`):
   - **Failures:** explain them in plain words, never bare codes. Say whether money may already be spent. Offer retry or skip, and on the person's yes call `retry_step` with their words.
   - **Limits:** change the limit with `set_spend_limit` when asked.
   - **In-program retries:** show the pattern for automatic flows. On `!clip.ok` with `retry` not `"none"`, call `ctx.choose("<shot>-retry", …)` with an honest cost line, then repeat the call with a `variant`. Programs cannot call `retry_step`.
   - **Vertical films:** pass `aspectRatio` for vertical films.
9. **Vertical films (B0).** Code-mode `ctx.video` accepts `aspectRatio` (one of the adapter's supported ratios: Viggle `16:9 | 9:16 | 1:1 | 4:3 | 3:4 | 21:9`; MiniMax as its adapter allows).
   - **Without it:** the first frame's own aspect picks the nearest supported ratio.
   - **Crop:** the crop step and the adapter request use that ratio, never the profile's fixed one.
   - **Identity:** the ratio is part of the step's normalized input.
   - **Test:** a 941×1672 first frame reaches the fake Viggle as 9:16, with a crop that keeps at least 95% of the frame.
10. **Tests** (offline, loopback fakes):
    - connect-refused and DNS failures are safe and retried automatically, while a reset after connect stays unknown;
    - `retryStep` reuses the step key and keeps the old liability;
    - person and Director consent, with a wrong quote refused;
    - lowering below liability refused;
    - `done_with_failures`;
    - one Director turn per failure;
    - `0.1.0` films unchanged;
    - the 9:16 crop;
    - the P2c end-to-end flow still passes.
11. **Docs:** update `docs/technical/EXECUTION-ENGINE.md` and `SKILLS-TOOLS.md`, and add a `docs/implementation/STATUS.md` entry.

## Files you own

- `apps/server/src/code-plan/**`, including `port.ts` for the two methods above.
- Code-plan routes in `app.ts`.
- The tool contract in `packages/core/src/tools.ts`.
- `skills/code-plan/**`, with the digest pin.
- Narrow transport-classification changes in `packages/providers/src/viggle-h3.ts`, `minimax-h3.ts` and their server execution authorities. List each one.
- Tests and docs.

Do not edit `packages/core/src/studio-api.ts` (the lead added the fields you need) or `apps/web/**`.

## Out of scope

Settings UI, red dots and plain-language error text in the web app (the lead), new providers (card N2), music (N3), shot links and posters (N4).
