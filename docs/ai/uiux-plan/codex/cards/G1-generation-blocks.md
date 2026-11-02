# Card G1: expose refused parts of a Director generation request to the web

Read `_review-common.md` first. Server only; do not edit `apps/web` (the lead builds the UI from `docs/ai/prototypes/failure-display/`).

The owner approved a design where, when part of a Director `make_keyframes` request is refused (e.g. `ATTEMPT_EXISTS`, `STALE_PROMPT_INTENT`, `SCENE_*` prerequisites), the chat shows a structured line under the reply from the application's own refusal record, not from the Director's prose.

The lead already added `DirectorGenerationBlock` to `packages/core/src/studio-api.ts`. Build exactly that shape:

1. **Record:** when `makeDirectorKeyframes` (apps/server/src/application/director-keyframes.ts) refuses a scene, persist a block record for the turn (same request + epoch scoping as `director_generation_effect`, same idempotency/receipt discipline; a replayed or reconciled call must not duplicate blocks). Fields: `kind: "keyframes"`, `sceneId`, `code`, `shotIds` (for ATTEMPT_EXISTS the blocking attempts' shots; for prompt refusals the shots whose prompts are stale when the error knows them, else the scene's requested shots), `attempts` for ATTEMPT_EXISTS mapped from `GenerationAttemptRecovery.attempts` (`attemptId, shotId, kind, phase, action` only; never paths, bodies, provider data), `at`.
2. **View:** `director-turn-view.ts` adds `effects.blocked: DirectorGenerationBlock[]` for the turn (empty array when none, like `generation`). Respect the allowlist; cap at the existing GENERATION_BLOCKER_LIMIT across the turn.
3. **Lifecycle:** blocks are history of that turn; the web decides whether one is still current from the overview. Do not mutate them later.
4. **Store:** if `persistence/store.ts` treats `director_generation_effect` specially (backup/restore/recovery lists at ~713 and ~782), treat the new kind the same way.
5. **Tests:** a refused scene in a typed editing turn yields one block with the right code, shots and attempts; a mixed request yields `generation` for the started scene and `blocked` for the refused one; replaying the same call or reconciling a lost receipt does not duplicate; no release path or body appears in the view; backup/restore keeps the records if the effect kind is covered there.

In the report, list the exact codes `make_keyframes` can refuse with and, for each, which `shotIds` you fill, so the lead can write copy per code.
