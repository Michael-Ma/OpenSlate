# Card B7 (phase P3, part 1): keyframes and voice together, one durable scene confirm, narration fit commands

Read `docs/ai/uiux-plan/codex/RULES.md` first and follow it. This card builds on card B2 (the generation overview); it is merged in your tree.

## Goal
Money and sequencing move to the server. Voice lines are made with the keyframes, so their length is known at review. Confirming a scene's video is one press that survives a closed tab or a server restart and never buys anything twice.

## Items (spec = the item's Change in docs/ai/uiux-plan/gap-generation.md and gap-storyboard.md; decisions D3, D6, D9)
1. **SB-5 (decision D3)**: the scene keyframe press (generate kind image, whole scene or targeted) also makes the voice line of every target shot whose narration is generated text without a current voice. The quote in the overview (`quotes.makeKeyframes`, and `regenerateKeyframe` when the shot's line is missing) includes the voice units. When the voice lands, the server attaches it to the shot automatically; if it fits the shot it is accepted, if it is longer the overview reports `narration.fits = false` with the measured seconds (no automatic cut). A failed or unknown voice job behaves like any media slot (failure, no_answer). Edited narration text outdates only the voice line.
2. **GR-3 + GR-4**: `POST /api/projects/:projectId/scenes/:sceneId/confirm` with `ConfirmSceneInput` (contract in `packages/core/src/studio-api.ts`). In one transaction: check the digest and frames like the existing fresh check, mint the grants, insert a `scene_confirmation` record with per-shot steps (speech if a line is still missing, attach, accept, then video) and a scene hold owned by the record. A step runner in the index.ts loop (after reconcile/runReady) advances it by reusing the narration service and the existing scene generation internals. Every step's key derives from the confirmation id; paid steps are never retried; results are stored in the record. It stops with `blocked {code, shotId}` on SCENE_REVIEW_STALE, NARRATION_CUE_OUT_OF_RANGE or a failed/unknown voice, before any further spend. Stop (card B4's controls) cancels the record's unsent steps. Restart resumes without repeating a step. The overview's `SceneOverview.confirmation` reflects it, and `confirmation_running` is a blocker while it runs. Replaying the same key returns the original receipt.
3. **SB-2 + SB-3**: `POST /api/projects/:projectId/shots/:shotId/narration-fit` with `NarrationFitInput` returns `NarrationFitReceipt`. `extend_shot` lengthens the shot to the line (whole seconds, within the video model's min/max and 3–15 s) and accepts the line; `cut_to_shot` keeps the length and accepts the line cut at the shot end with a short fade. Both are free storyboard commands with a `commandId` for Undo, and both set `narration.fit` in the overview. Changing the length outdates the clip recipe and re-quotes.

## Out of scope
Undo restoring media, keeping the current take until a new one succeeds, the use-take route (card B8). Director notes and proposals. Anything in apps/web.

## Tests (at least)
- Keyframes press on a scene with one generated line: one image attempt per shot plus one voice attempt; the overview's quote included the voice; the voice auto-accepts when it fits; a 7.4 s fake voice on a 6 s shot reports fits false with the measured seconds.
- Confirm on fake providers for mixed none / uploaded / generated narration reaches video; kill the runner between speech and accept, restart, and it resumes with no second speech attempt; same key replays the receipt; a changed frame gives SCENE_REVIEW_STALE before any spend; Stop mid-chain leaves no new attempts; a stale `expectedEstimateMicros` gives ESTIMATE_CHANGED with no grants.
- narration-fit: extend gives the right frame count and re-quotes; cut gives a cue ending at the shot end; both are undoable storyboard commands; the overview reflects `fit`.

## Notes from the lead after merging B1 to B4
- The overview's `narration_too_long` blocker must clear once a fit is chosen (`narration.fit` set), and `fits` should then be true for display purposes only if the chosen fit makes it fit (cut_to_shot: the line is cut to the shot; extend_shot: the shot was lengthened).
- Every new route requires an Idempotency-Key via `requiredCommandKey` (apps/server/src/application/command-key.ts), and every `beginRequest` from a route passes `source: "app"` (card B1).
- Stop's `detachUnsent` (card B4, engine.ts) must also cancel the unsent steps of open scene confirmations.
