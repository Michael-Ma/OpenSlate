# K1 · Every shot's keyframe is confirmed before its video

Read `docs/ai/uiux-plan/codex/RULES.md` first; its hard rules apply in full. The lead is building the web card and the Assets labels in another worktree at the same time, so do not edit `apps/web/src/**` except the one line named in section 5. You may edit every other file this card names and any test that pins what this card changes. If you need a file that is not named here, edit it and say so in your report rather than stopping.

## Problem

The owner's model of a shot:

1. Reference images (uploads, character sheets, set plates) are shared.
2. A keyframe is one shot's preview, generated from the references and that shot's prompt.
3. The person confirms the keyframe. Only then does video start.
4. When video starts, the person chooses whether the keyframe goes in with the references, or not at all.

What happened in the film "Funny video about myself": a character sheet and three empty set plates, then three Viggle clips from `references: [upload, sheet, plate]`. No per-shot keyframe, zero `code_plan_choice` rows, $1.20 of video nobody confirmed. Assets labelled the sheet and plates "Keyframe" because `roles.image` is `"keyframe"` for every image step.

Nothing enforces the keyframe step. It lives only in the guidance, and the guidance also says references are the default for video.

Separately, `ctx.music` requests the exact film length, and that number is in the step key. Any re-cut therefore buys a different track for $0.08, even though Lyria returned 67 s for a 19.5 s request.

## Change

### 1. `ctx.keyframe`

```ts
type VideoInputChoice = "keyframe_and_references" | "references_only" | "first_frame";
interface KeyframeInput {
  prompt: string; references?: Artifact[]; aspectRatio?: "1:1" | "2:3" | "3:2" | "9:16" | "16:9"; model?: string; variant?: string;
  /** The clip this keyframe is for: it decides which inputs can be offered and what each costs. */
  video: { model?: string; durationSeconds: number; aspectRatio?: string };
}
type KeyframeResult =
  | { ok: true; frame: Artifact; choice: VideoInputChoice; input: { references: Artifact[] } | { firstFrame: Artifact } }
  | { ok: false; error: { code: string; message: string; retry: "safe" | "consent" | "none"; mayHaveCharged: boolean } };
keyframe(shot: string, input: KeyframeInput): Promise<KeyframeResult>;
```

Implement it as a host method in `CodePlanService.evaluate` in `apps/server/src/code-plan/index.ts`. Every host call is synchronous and replayed, so it composes the existing pieces inside `call`:

1. Validate: `shot` is a declared shot in this pass, `video` is present.
2. `const image = call("image", [{ prompt, references, aspectRatio, model, variant, shot }])`. Return `SANDBOX_PENDING` if pending, and the failed media result as it is.
3. Build the options (below) and call `this.choose(projectId, [`${shot}-keyframe`, { question, options }], dry)`. `question` is the declared shot's `title`, else the shot id. Return `SANDBOX_PENDING` if pending.
4. Return `{ ok: true, frame, choice, input }` from the answer. Record the shot in a per-pass map for section 2.

Add `"keyframe"` to `METHODS` in `apps/server/src/code-plan/sandbox.ts` and expose it only when `reviewEnabled`-style gating says the film is on contract 0.3.0, exactly as `review` is filtered: use one shared flag, and rename it if that reads better.

**Options.** Each option is the frame's artifact fields, flat, plus two fields, so existing code that reads `option.sha256` and `sameImage` keeps working:

```json
{ "artifactId": "...", "kind": "image", "sha256": "...", "keyframeInput": "keyframe_and_references", "references": [ ... ], "priceMicros": "400000" }
```

- `references` is the `references` the person's own input list, in order. `priceMicros` is what the clip costs in that mode: `modelPrice` on the normalized video input for that mode, with `codePlanPriceFrame`.
- Order and availability, using `videoModes` of the chosen video model:
  - `keyframe_and_references`, if `reference` mode exists. The clip gets `[frame, ...references]`, cut to that model's limit (4 for `viggle-h3`, else 9).
  - `references_only`, if `reference` mode exists and `references` is not empty. The clip gets `references`.
  - `first_frame`, if `first_frame` mode exists. The clip gets `firstFrame: frame`.
- At least one option must exist, else refuse with `CODE_PLAN_KEYFRAME_INPUT`. Text-only video models cannot be used through `ctx.keyframe`.

A prompt, reference, variant, duration or model change gives a new image or new options, so the digest changes and the person is asked again. That is the intended way to redo a keyframe. An unchanged keyframe keeps its answer across plan versions.

### 2. The gate

In `evaluate`, for `kind === "video"`, after the reused-step return and before pricing: when the film is on contract 0.3.0 and this pass has declared at least one shot, a new video step needs a confirmed keyframe. Steps already in the journal are exempt, so a saved film replays unchanged and a re-cut never needs a new confirmation.

- No `shot`, or a shot not declared, or no confirmed keyframe for it in this pass: refuse with `CODE_PLAN_KEYFRAME_REQUIRED` and a message that tells the Director to call `ctx.keyframe(shot, …)` and spread its `input` into `ctx.video`.
- The confirmed choice is `references_only` and the frame appears in `firstFrame`, `lastFrame` or `references`: refuse with `CODE_PLAN_KEYFRAME_INPUT`.
- The confirmed choice is either of the others and the frame appears nowhere in the input: refuse with `CODE_PLAN_KEYFRAME_INPUT`. A retake with a `variant` passes. A first-frame retake after `keyframe_and_references` passes, because the person allowed the keyframe as input.

A plan with no declared shots is not gated. Real films declare shots, the guidance requires it, and this keeps low-level engine tests simple. Films on 0.1.0 and 0.2.0 have no gate and no `ctx.keyframe`.

### 3. Assets roles

In `packages/core/src/studio-api.ts`, add `"reference"` to `AssetRole`. In `apps/server/src/code-plan/assets.ts`, an image step with a `shotId` is `keyframe`, one without is `reference`. References are numbered like keyframes. No migration: old films are relabelled by this rule. Do not change storyboard `asset-library.ts`.

### 4. Music survives a re-cut

Guidance and example only; no engine change. Request `durationSeconds: Math.ceil(filmSamples / 48000 / 30) * 30`, so a 19.5 s film asks for 30 s and a small re-cut keeps the step key and the track. Keep the existing check that the usable length covers the film, and the trim and fade at the cut. Say in `SKILL.md` why: the requested length is part of the step, Lyria treats it as a hint, so asking for the exact cut would buy a new track on every re-cut. `read_film.models` note stays.

### 5. One web line

Only this, so the web typecheck passes. The lead handles everything else in web:

```ts
const ROLE_ORDER: Record<AssetRole, number> = { keyframe: 0, reference: 1, clip: 2, voice: 3, music: 4, upload: 5, document: 6, export: 7, character_sheet: 8 };
```

in `apps/web/src/next/model/assets.ts`.

### 6. Guidance

This changes what the Director is taught, so keep the wording exact and short. In `skills/code-plan/SKILL.md`, `references/film-craft.md`, `references/studio.d.ts` and `references/example-plan.ts`:

- `ctx.image` is for shared references only: character sheets, set plates, anything used across shots. It takes no `shot`.
- Every shot makes exactly one keyframe with `ctx.keyframe(shot, …)` from those references and the shot's `frame` prompt. Do not use `ctx.choose` for keyframes. Make no alternatives unless the person asks.
- Spread the result into the clip: `ctx.video({ ...keyframe.input, shot, prompt: motion, durationSeconds, aspectRatio })`. Never choose the video input yourself. The person picks it on the card.
- Remove "References are the default for video" and the rule that lets the Director pick `firstFrame` without asking. Keep the fact that references can re-frame a shot, and tell the Director to mention it only if asked.
- Retakes reuse the shot's confirmed keyframe with a stable `variant`. When a subject was cut off and the person allowed the keyframe as input, `firstFrame: keyframe.frame` is the retake to use.
- When the person asks to change a picture, change that shot's `prompt` or `variant` in `ctx.keyframe`; the card asks again.
- Each pipeline still starts together with `Promise.all(shots.map(...))`, and a card appears as soon as its frame exists.
- Tell the person nothing about step IDs or modes in chat; the card says it.

Rewrite `example-plan.ts` to this flow with one keyframe per shot. Update the two-shot comment. Recompute `CODE_PLAN_GUIDANCE_DIGEST` in `apps/server/src/application/director-capabilities.ts`. The archived 0.1.0 and 0.2.0 guidance stays untouched.

## Tests

Add `apps/server/test/code-plan-keyframes.test.mjs`. Real plan submission and replay through `CodePlanService`, real `read_film` models where a price or mode is asserted.

1. A plan with declared shots and `ctx.video` without `ctx.keyframe` is refused at submit with `CODE_PLAN_KEYFRAME_REQUIRED`, no step dispatched, nothing charged.
2. The full flow: the keyframe image runs, the choice appears with three options in order with the right `references` and prices, no video step exists until it is answered, and each answer produces exactly the expected video input.
3. `references_only` with the frame in the input is refused. The other two with the frame missing are refused.
4. A journaled video replays with no keyframe and spends nothing: a saved film's unchanged plan still runs, and a re-cut of it needs no confirmation.
5. Options follow the model: a first-frame-only model offers only `first_frame`, no references removes `references_only`, a reference limit of 4 cuts the list.
6. A changed prompt asks again. An unchanged keyframe across plan versions keeps its answer and starts no new image.
7. A retake with `variant` passes without a new card. A first-frame retake passes after `keyframe_and_references` and is refused after `references_only`.
8. A failed keyframe image returns `{ ok: false }` to the plan and offers no card.
9. Contract 0.2.0: `ctx.keyframe` is undefined and nothing is gated.
10. Assets: a sheet with no shot is `reference`, a shot's frame is `keyframe`, in old and new films.
11. Music: a 19.5 s film requests 30 s, and a re-cut to 21 s reuses the music step, with no new charge.

Adapt the e2e fixture, `pnpm demo:code`, the fake Director and the six test files that declare shots. Prefer the new flow in the fixtures; in engine tests that are not about this, drop the `ctx.shot` declaration only if the shot is not what they test.

## Finish

Run `pnpm test`, `pnpm typecheck` and `pnpm demo:code`. Write `docs/ai/film-quality/reports/K1-report.md`: what changed, the plan API as built, what you could not cover, and anything in this card you decided against.
