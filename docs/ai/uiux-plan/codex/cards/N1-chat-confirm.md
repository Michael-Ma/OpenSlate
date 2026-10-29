# Card N1: the person can confirm what the Director asks for, in the chat

Read `_review-common.md` in this folder first, with one exception: like K1, this card may amend tool contract 6.0.0 and skills v7 in place (never released; keep the current 6.0.0 catalog and v7 package identities in the shipped-identity list so projects saved on this branch still upgrade, and extend the pin test).

The owner decided, after trying the studio: when the Director needs the person's OK (generate a scene's video, new takes of keyframes that already exist, a change with media impact), it must not tell the person "a chat approval can't replace the app action, go press the button". It asks in the chat with a typed choice, and the person clicks Confirm right there, like a Claude Code permission prompt. The person can still use the same control in the workspace. **Whichever happens first settles it**; the other side then shows it as done. The click stays the authority: an ambiguous chat reply ("ok", "go") is still never a confirmation, and the Director's ask spends nothing.

The vehicle is the existing Director note (`record_notes`) and its typed choices. The web now shows a note's choices in the thread too, not only in the Keyframes banner (the lead does the web; you do not edit `apps/web`). The lead already added to `packages/core/src/studio-api.ts`: `NoteChoice` `{ kind: "confirm_video"; sceneId }` and `DirectorNote.resolution.elsewhere?: true`. Build exactly those shapes.

1. **Choice `confirm_video`.**
   - Add it to the 6.0.0 `record_notes` schema (`packages/core/src/tools.ts`) only; 5.0.0 and older stay byte-identical.
   - Validation: the scene exists, and the note's anchor is that scene or shots inside it. A note may carry it in an editing turn and in a keyframe-review turn (offering a choice spends nothing). Read-only and automatic turns keep their current rules.
   - Resolving it (`POST .../director/notes/:noteId/resolve`) requires `resultRef` = the `confirmationId` of a human scene confirmation (`POST .../scenes/:sceneId/confirm`) for that scene, recorded after the note. Otherwise `NOTE_RESULT_INVALID`. The web presses the confirm first and then resolves with its confirmation id, the same way the regenerate choice works today.
   - A `confirm_video` choice must not count as the "keep" choice that a blocking note needs.
2. **First wins, across every path.** When the effect of an open note's choice happens through another control, the studio settles the note in the same command, with `resolution.elsewhere: true`, the choice index and the result ref:
   - a scene confirmation for scene X settles open notes with a `confirm_video` choice for X;
   - a keyframe regenerate press (or a `make_keyframes` regenerate run) that covers every shot of a `regenerate_keyframe` choice settles that note;
   - a proposal accepted through its own route already settles its note atomically: keep it. Check that a proposal declined from anywhere leaves its note in a sensible state (open with the proposal gone, or settled) and that the web can tell; report what you chose.
   - Resolving a note that is already settled stays a refusal (`REVISION_CONFLICT` today). Make the refusal tell the web it was settled, not just "changed": add a stable code `NOTE_ALREADY_SETTLED` (or keep `REVISION_CONFLICT` with a `details.state: "resolved"`; pick one, document it under Contract changes).
   - Two clicks at the same time (chat and banner) must buy once: the confirm route is already idempotent per command key; add a test that the second press of a different key on the same scene state is refused or deduplicated as today, never a second purchase.
   - A note stales today when its anchored evidence changes; make sure a settled-elsewhere note is not turned stale afterwards by the very change that settled it.
3. **Guidance (skills v7 and the 6.0.0 host guidance, `film-planning-guidance.ts`, `director-input.ts`).** Replace the "chat approval cannot replace the app action / go press the button" stance:
   - When the person wants video for scenes that are ready, record a note anchored to each scene with a `confirm_video` choice (and a `reply` choice when useful), and say in one line that the confirmation is in the chat and also in Keyframes. Do not ask them to go find the button.
   - When the person wants to redo frames that already exist and named the shots, `make_keyframes` with `regenerate: true` as today. When it is unclear which shots, or the Director proposes a remake itself, record a note with a `regenerate_keyframe` choice instead of refusing; existing takes stay in history.
   - Changes with media impact: `propose_change` and link it in a note with a `proposal` choice, as today; the person can accept it in the chat now.
   - A chat reply such as "yes", "ok" or "go ahead" to an open choice is not a confirmation. Point at the open choice (or offer a fresh one when the old one is stale or settled). Never claim something started until the application reports it.
   - Keep 5.0.0 and older guidance untouched. Keep the guidance short; remove sentences that the new rule makes wrong rather than adding exceptions.
4. **Fake director** (`apps/server/src/application/fake-director.ts`): a path that records a `confirm_video` note for a ready scene, for tests.
5. **Tests:**
   - the 6.0.0 schema takes `confirm_video`, 5.0.0 refuses it, the catalogs pin;
   - resolve without a matching later confirmation is `NOTE_RESULT_INVALID`; with it, settled;
   - a scene confirmation pressed in the workspace settles the open `confirm_video` note with `elsewhere: true`, and a later resolve from the chat gets the settled refusal;
   - a regenerate press covering the shots settles a `regenerate_keyframe` note elsewhere; a partial press does not;
   - two confirms for the same scene buy once;
   - offering the choice in a review turn starts nothing and costs nothing;
   - the guidance text tests (`director-guidance-maintenance.test.mjs` and the skills tests) reflect the new rule and no longer contain the old "cannot replace" stance.

Files: `packages/core/src/tools.ts` (6.0.0 only), `apps/server/src/application/director-notes.ts`, `scene-confirmations.ts`, `scene-generation.ts`, `tool-invocations.ts`, `fake-director.ts`, the guidance files, `skills/v7`, `packages/director` catalog tests, and their tests. Do not edit `apps/web` (the lead mirrors your rules in the sample film); list in the report every rule the sample film must mirror (codes, when a note settles elsewhere).
