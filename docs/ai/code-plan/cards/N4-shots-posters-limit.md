# N4 · Shot links, clip posters, the default limit and failures in the film list

Read `docs/ai/uiux-plan/codex/RULES.md` first; its hard rules apply in full: no real provider call, no network beyond loopback, never read `.env*`, never start anything on port 3001. Then read `docs/ai/code-plan/NEXT.md` (items 4, 5, 6, 7) and the N1 and N2 reports.

## Problem

- **Plan shows no keyframes.** Steps do not say which shot they belong to, so the Plan view cannot show a shot's chosen frame or clip. It guesses by matching prompts, and that fails as soon as the program builds its prompts.
- **Clips have no thumbnails.** Film rows are text only.
- **The limit has no default.** A new film always starts at $1, and the limit cannot be set before the first plan exists.
- **The film list hides failures.** A failed film looks like any other until it is opened.

The contract is already in `packages/core/src/studio-api.ts`: `CodePlanStepView.shotId`, `CodePlanStepView.poster`, `ProjectListItem.planMode`, `ProjectListItem.needsAttention`.

## Change

1. **`shot` annotation.** `ctx.image`, `ctx.video`, `ctx.speech` (and `ctx.music` once N3 merges) accept `shot: string` (at most 120 characters).
   - It is **not** part of the step's identity: adding or changing it must never create a new step or re-pay. Strip it before the step key and the provider input are computed.
   - Store the annotation on the step, updated by the latest pass that reached it, and expose it as `shotId`.
   - **Fallback for plans without it:** an image step whose artifact is an option of a choice with id `<shotId>-keyframe` belongs to that shot, and a video whose `firstFrame` is one of those options does too.
   - `read_film` shows `shotId` too.
2. **Posters.** When a clip or render is ingested, make a still from its first frame with the existing local media path (bounded, owned, probed image artifact, no provider, no cost).
   - Expose it as `poster`.
   - It is not a step and counts toward no limit.
   - A failed poster never fails the clip: the step succeeds, without a poster.
   - **Existing clips:** backfill at most one per tick, so films made before this change get thumbnails too.
3. **Default limit.**
   - `POST /api/projects` accepts optional `ceilingMicros` (code films only; refused for graph films with a clear code). The first run starts from it.
   - `setCeiling` works before the first plan exists, and the view reports the stored limit.
4. **Film list.** `GET /api/projects` reports `planMode` (only when `code`) and `needsAttention` for code films: the number of reached steps with `state: "failed"` or a terminal unknown, the same rule the web's `needsAttention` uses. Keep it cheap: no replay, no per-step reads beyond the run and step rows.
5. **Guidance** (`skills/code-plan/`, update the digest pin): always pass `shot` on media calls that belong to a declared shot, and extend the example. Tell the Director the annotation is free to add to an existing plan.
6. **Tests**, offline:
   - adding `shot` to a saved plan reuses every step and buys nothing;
   - the fallback links both a frame and its clip;
   - a poster is made, is owned and has the clip's dimensions;
   - a poster failure leaves the clip succeeded;
   - backfill runs one per tick;
   - `ceilingMicros` at creation, refused for graph;
   - `setCeiling` before a plan exists;
   - `needsAttention` counts only reached failures;
   - the P2c end-to-end flow still passes.
7. **Docs:** `docs/technical/EXECUTION-ENGINE.md`, and a `docs/implementation/STATUS.md` entry.

## Files you own

- `apps/server/src/code-plan/**`, except `port.ts` unless a method must change. List it if so.
- The project list and create route.
- The narrow poster hook in the media path.
- `skills/code-plan/**`, with the digest pin.
- Tests and docs.

Do not edit `packages/core/src/studio-api.ts` or `apps/web/**`.

## Out of scope

The web (the lead), music (N3), new providers.
