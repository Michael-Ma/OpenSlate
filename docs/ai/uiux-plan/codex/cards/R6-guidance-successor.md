# Card R6: a versioned Director guidance successor (tool contract 6.0.0, skills v7) and frozen history

Read `_review-common.md` in this folder first. This is the only card allowed to add a tool catalog and a skill package. It still must not change any existing catalog (1.0.0–5.0.0) or existing package bytes (`skills/`, `skills/v2`–`skills/v6`).

Findings: skills-legacy-1, skills-legacy-2, skills-current-1 to -4, director-skill-propose-schema-gap, plus the B23.5 proposal in `docs/ai/uiux-plan/codex/reports/B23-live2-findings.md` (short framing, a real scene title).

Card R5 runs at the same time and owns the server-side behaviour of proposals:
- `discards_running`, prompt derivation, PROPOSAL_REQUIRED enforcement and path-level errors;
- in `packages/core/src/proposal-preview.ts` and `apps/server/src/application/director-proposals.ts`.

In those two files, change only what the new fields need: types, accepting the fields, and preview rows for purpose, action, framing and scene title. R5's shared prompt-derivation helper already covers purpose, action and framing; call it if it exists in your branch, otherwise leave a clearly marked TODO for the lead.

1. **Freeze history first (skills-legacy-2).**
   - Add a test that pins the packageDigest of every shipped package: `skills/production`, `skills/plan-authoring`, `skills/v2` to `skills/v6`.
   - The test sits next to the existing catalog pins in `packages/director/test/tools.test.mjs`, which already pin 1.0.0–5.0.0.
   - State in `skills/README.md` that a shipped package and a shipped catalog are never edited in place, and that later changes ship as a new version. The README is documentation and may change.
2. **Contract 6.0.0, with every earlier digest unchanged.** Build it from 5.0.0 without mutating shared schema objects (see the B23 warning about cloning `changeProposalSchema`).
   - **propose_change** updateShots also accepts `purpose`, `action` and `framing`. updateScenes also accepts `title`.
   - **prepare_change** creative:
     - `framing` uses a short-label schema: 1–3 words, at most about 40 characters, with examples Close-up, Medium, Wide;
     - `createScenes` accepts `title` (a short scene name, at most about 6 words or 60 characters) next to `purpose`;
     - `updateScenes` may change `title` and/or `purpose`.
   - The application and parser save `scene.title` for creative patches. The storyboard already has a human sceneTitle edit; reuse its field, with no migration.
   - Older epochs cannot use the new fields (CAPABILITY_MISMATCH or a validation error).
3. **Skills v7**, a new package based on v6 with these changes:
   - **plan-authoring and production (skills-current-2).** Never author image, review or video declarations, and never use `requestNewTakes`. Scene actions build all keyframe and video work. Never combine creative edits with source in one prepare_change. Only timeline and render source remain, if anything.
   - **notes.md, continuity-review.md and shot_plan (skills-current-1, director-skill-propose-schema-gap).** On a shot with media, changes to purpose, action, framing, prompts, duration or narration go through propose_change, with the full 6.0.0 field set. Pure text with no media impact applies directly. The server enforces this with PROPOSAL_REQUIRED (card R5).
   - **scene_plan (skills-current-3).** title is the short scene name; purpose is the scene's direction; coverage, timing and narration range go into story.
   - **narration.md (skills-current-4).** Replace per-section acceptance with the scene confirmation flow: the person reviews keyframes, motion and narration and confirms the scene once. Listening and recording edits are optional.
   - **Wording.** Name the studio's views and actions as `apps/server/src/application/film-planning-guidance.ts` now does (Plan, Keyframes, "Make keyframes", "Confirm frames & generate video", Film, Assets), not by colour.
   - Keep the example compiling, or replace it with a creative-patch example if the plan example no longer applies, and say which.
4. **Upgrade path (skills-legacy-1).**
   - Map contract 6.0.0 to guidance v7. `currentForFreshTurn` upgrades a saved 5.0.0/V6 lock (and every older chain) to 6.0.0/V7.
   - Verify a predecessor lock against the pinned list of shipped identities (catalog and package digests) plus the integrity of its on-disk snapshot, instead of rebuilding it from today's repository files. Today's files may then evolve through new versions without blocking old projects.
   - A lock whose identity is not in the shipped list keeps the current refusal, with an accurate message: "This film's Director guidance does not match any version this OpenSlate ships." Keep the existing restore wording only where it is true.
   - `startNative` verifies historical locks only for snapshot integrity, or only the epoch's bound lock, and does so before `attempted = true`. A refusal is then recorded as failed, not unknown with dispatched:true.
   - Tests:
     - the v6-3b3edf7 and startnative-history repro scripts in the scratchpad named in the finding (reproduce them in real tests);
     - a 5.0.0 lock from the earlier V6 bytes upgrades;
     - an edited historical package fails the pin test;
     - startNative refusals are recorded as failed.
5. **Host guidance.** `film-planning-guidance.ts` and `director-input.ts` describe 6.0.0 behaviour when the epoch is 6.0.0 and keep the current text for 5.0.0.

Report which existing tests you rewrote because they encoded the old "5.0.0 is the newest" assumption.
