# F3 · Remake one shot's clip, keeping its keyframe

Read `docs/ai/uiux-plan/codex/RULES.md` first. Its hard rules apply in full.

## Problem

A person asked the Director to "remake only 1.1's video, keep its keyframe". There is no path for that:

- **Video targets:** `generationTargets(rows, "video")` (`apps/server/src/scene-row.ts:194`) returns only rows that are not `videoComplete`. A scene whose clips are all saved has no video targets, and video has no `regenerate`.
- **The Director's offer:** the Director can only offer a `confirm_video` note choice for the scene. On a video-saved scene that confirm can never be pressed. The web shows the button disabled, and the reason it gives is the panel label "Play Scene 1".
- **The workaround:** regenerate 1.1's keyframe, which makes 1.1 a video target again, then confirm. This pays for a keyframe nobody wanted and throws away the approved frame.

## Change

1. **Server: a human-pressed clip remake for named shots.**
   - Input: a scene, 1–4 of its shots, and the usual request/version guards.
   - Each shot must already have a saved clip and a ready, opened keyframe.
   - The remake makes a new clip for each named shot from its **current approved keyframe**: the same pinned frame, the same F1 crop, and the shot's saved motion, video prompt and duration.
   - No keyframe work. The saved voice line is reused, not regenerated.
   - **Reuse, don't fork:** build it on the scene confirmation path (`apps/server/src/scene-confirmations.ts`, `scene-generation.ts` with `kind: "video"`), for example `regenerate: true` with `targetShotIds`. It keeps every existing guard:
     - budget hold and quote;
     - no double submission, and idempotent replay by request ID;
     - unknown outcomes are reconciled, never blindly resubmitted;
     - stale-version refusal;
     - a refusal while a job on those shots is running or an edit holds them.
   - **Old and new clip:** the old clip stays in history. The new clip replaces it only when it succeeds, following the same supersede and candidate rules as a keyframe regenerate. If the remake fails, the old clip remains current.
   - **Other shots:** shots not named are untouched.
   - **Refusal codes:**
     - a named shot with no saved clip → `CLIP_NOT_SAVED`, saying to use the scene's confirm;
     - a shot from another scene, or duplicate IDs → `VALIDATION_ERROR`.
   - **Route:** expose it through the existing HTTP route style, next to the scene confirm route.
   - **Quote and availability:** expose both per shot in the generation overview, the way the keyframe regenerate quote reaches the web (`apps/web/src/next/model/price.ts` `keyframeEstimate` reads it), so the web can price a "New clip" press exactly.
2. **Note choice `remake_clip { shotIds }`** (1–4, same scene), as a new tool contract **7.1.0**.
   - `record_notes` validates the shots' state at record time:
     - the shots exist;
     - each has a saved clip and a ready keyframe.
   - When the remake starts (from any place), it settles the note through `settleNotesElsewhere` with `{ kind: "remake_clip", shotIds }`, exactly like `regenerate_keyframe`.
   - The Director never starts a clip itself. Only a human press does.
3. **Stop the dead card at the source.** Under contract 7.1.0, `record_notes` refuses a `confirm_video` choice for a scene with no video targets:
   - code `SCENE_VIDEO_SAVED`;
   - its recovery text tells the Director to offer `remake_clip` for the shots the person named.

   Older contracts keep their behaviour.
4. **Contract and guidance:**
   - Add 7.1.0 to `SUPPORTED_TOOL_CONTRACTS` and make it current. Keep 7.0.0 handlers and digests byte-identical, because shipped rows bind them.
   - Update the `record_notes` / `make_keyframes` descriptions:
     - `confirm_video` is for clips still to make;
     - `remake_clip` is for a named remake of saved clips that keeps the keyframe;
     - `regenerate_keyframe` is for a new frame.
   - Release the guidance with the F2 tool, never by hand:
     1. run `pnpm skills:draft`;
     2. edit `skills/next/production/**` (the video section) and anything else that teaches the confirm_video rule;
     3. run `pnpm skills:release --minor --contract 7.1.0`, which should produce 8.1.0.
   - New projects lock 8.1.0. Older locks still verify and upgrade on their next fresh native turn.
   - Update `fake-director.ts` so the fixture Director offers `remake_clip` when asked to remake a clip in a saved scene.
5. **Web types only:** add the new choice and the per-shot remake quote to `packages/core/src/studio-api.ts`.
   - Do not edit `apps/web/**`. If web typecheck fails because a switch over choice kinds is exhaustive, list the exact errors under Open issues. The lead wires the UI.
6. **Docs:** update `docs/technical/SKILLS-TOOLS.md` and `docs/implementation/STATUS.md`.

## Tests (minimum)

- **Remake:**
  - a 1.1-only remake on a video-saved scene makes exactly one clip, from the same keyframe artifact (sha256 of the pin unchanged), and leaves 1.2–1.4 untouched;
  - the old clip stays current until the new one succeeds, and a failed remake leaves the old clip current.
- **Idempotency and recovery:**
  - replaying the same request ID does not charge twice;
  - an unknown outcome blocks a second remake of that shot.
- **Refusals:**
  - `CLIP_NOT_SAVED`;
  - a shot from another scene;
  - a running job on the shot;
  - a stale version.
- **Notes:**
  - `record_notes` accepts `remake_clip` on 7.1.0 and refuses it on 7.0.0;
  - `confirm_video` on a fully saved scene is refused with `SCENE_VIDEO_SAVED` on 7.1.0 and is still accepted on 7.0.0;
  - pressing the remake from Keyframes settles a `remake_clip` note elsewhere.
- **Overview:** the overview carries the per-shot remake quote and availability.
- **Releases:**
  - the release-check test passes with 8.1.0;
  - 8.0.x locks still verify;
  - new projects lock 8.1.0.

## Out of scope

- The web UI (the lead owns it).
- Changing keyframe regenerate.
- Remaking clips across scenes in one press.
