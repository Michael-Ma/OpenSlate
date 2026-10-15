# Card B1 (phase P1): who started a request, paid-press identity, no Director spending, retired spending routes

Read `docs/ai/uiux-plan/codex/RULES.md` first and follow it.

## Goal
The conversation shows only real conversation. Every paid or state-changing press has a request identity. The Director never spends money by itself. The retired allowance/budget/spending surface is gone.

## Items (spec = the item's Change in the gap files)
1. **DC-6 + GR-15** (gap-agent.md, gap-generation.md): add `source: RequestSource` ("user" | "app" | "director", from `packages/core/src/studio-api.ts`) to the request record via a `beginRequest` option. App presses (scene generate, controls stop/resume, narration sessions, import confirm, storyboard edits, every route that calls beginRequest with app-authored text) record `source: "app"`. The snapshot conversation shows only `source: "user"` (and records with no source that are not known app text). Migrate legacy records: a one-time projection that marks the known app-authored texts (list them from the code) as app. The Director's context (`context-projection.ts`) must show app requests as app actions, not as the user's words.
2. **GR-8**: require the `Idempotency-Key` header on scene generate (image and video), controls, and every new command route in this branch; error `IDEMPOTENCY_KEY_REQUIRED` (400). Same key + same body replays the receipt; same key + different body is `IDEMPOTENCY_CONFLICT`.
3. **DC-12 / LG-19 / decision D5**: the Director may no longer start paid speech or paid transcription. Where V5 tools publish paid audio work today, the tool must instead record a pending request a person presses (keep the receipt shape the web can show as "the Director suggests making this voice line"; the human press is the existing paid route). Keep 1.0.0 to 4.0.0 tool descriptors byte-identical (their digests are frozen); change behaviour at the application layer. Old epochs still validate.
4. **LG-8 (server part)**: unmount the allowance, budget and spending routes (`apps/server/src/application/allowance-routes.ts` and what only it uses: `allowance-projection.ts`, `spending-display.ts`, and the budget surface in `project-budget.ts`). `external-allowances.ts` and parts of `project-budget.ts` are still used by `media-execution-runtime.ts` and `persistence/store.ts`: keep only what live execution needs, remove the rest, and update or delete the tests and fixtures accordingly. `scripts/storyboard-review.mjs` imports one of these; keep it working. Remove `docs/implementation/SPENDING-REVIEW.md` or mark it retired.

## Out of scope
Holds, supersede rules and busy checks (card B3). Stop/resume semantics (card B4). The overview read (card B2). Anything in apps/web.

## Tests (at least)
- After a scene generate, a stop and a narration session, `snapshot.conversation` has no new user entry and the request records still exist with `source: "app"`.
- A legacy project with the old app texts shows none of them as user messages after the migration projection.
- Director context lists app actions separately from user messages.
- Generate and controls without a key: 400 `IDEMPOTENCY_KEY_REQUIRED`; replay returns the same receipt; a different body with the same key is refused.
- A Director tool call that would have started paid speech now records a pending request and creates no attempt, no reservation.
- The allowance/spending routes return 404; execution tests that used external allowances still pass.
