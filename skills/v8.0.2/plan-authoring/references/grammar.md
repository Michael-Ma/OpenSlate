# Current writing and planning guidance

Guidance package `8.1.0`, tool contract `7.0.0`, planning/workflow contracts `1.0.0`. Source is restricted declarative data and is never evaluated as JavaScript. Ordinary creative planning needs no source.

## Read current evidence

`read_context` accepts optional `section` and `offset`. `{}` reads overview; sections include shots, scenes, plan, aliases, grants, receipts, narration, audio_operations, notes, audio_library and characters. Follow `page.nextOffset` until null. Full shot records come from shots; overview is compact.

Compare `guard.headVersion`, `revisionId`, `activePlanId`, `graphDigest`, `capabilityLockId` and `domainCursor` across reads, plus `guard.dataDigest` within a section. Restart affected pagination if they change. Raw audit `cursor` is not a content freshness guard. Missing evidence is not permission to invent IDs or outcomes.

Before a separate source edit, concatenate all plan source chunks in returned UTF-16 offset order and read all aliases. Preserve current aliases and untouched branches; `current: false` is historical. Use the current revision/head even if saved source has an older base. If keeping the plan would require authoring image, review or video declarations, prefer the studio's Film/export controls instead of rebuilding generation work.

## Creative writing and proposals

Save harmless writing with `{variant:"project",expectedHeadVersion:currentHead,creative:{...}}`, then `apply_change` with the returned preparedId. Never combine creative and source in one `prepare_change`. Never use `requestNewTakes`. The application builds keyframes and needed voice lines through `make_keyframes`; video still requires human scene confirmation.

Contract 7.0.0 supports `createScenes: [{key,title,purpose,beforeId?}]` and `updateScenes: [{id,title?,purpose?}]`, with at least one update value. A scene title is a short name of at most about 6 words or 60 characters; purpose is direction. Story holds coverage, timing and narration range. Shot framing is a 1–3-word label of at most 40 characters (Close-up, Medium, Wide); use purpose/action/prompts for longer composition. Create shots with all required intent, prompt, reference and cue fields; only the application issues permanent IDs. Compact narration saves intent, never measured cues or acceptance.

Contract 7.0.0 also takes `createShots[].beforeId` (a shot of the same scene) and `createScenes[].beforeId` to insert instead of append; `project.filmKind` (the whole film-kind@1 record) and `project.visualStyle` (a complete chosen look, or null); and character writing (`createCharacters`, `updateCharacters`, `deleteCharacterIds`, `updateShots[].characterIds`) in its own call. Image, clip and render sizes follow the film aspect saved in `filmKind.format`; never write pixel sizes into prompts. Moving, deleting, undoing, music and export use the 7.0.0 edit tools described in the production package's edits reference, not source.

On shots with current or retained media, changes to purpose, action, framing, motion, prompts, duration or narration must be proposed. Retained voice or accepted cues also establish media impact. Pure text without media impact may apply directly with a receipt. `propose_change` accepts `{patch:{updateShots:[{id,purpose?,action?,framing?,motion?,desiredFrames?,imagePrompt?,videoPrompt?,narration?}],updateScenes:[{id,title?,purpose?}]}}`; omit unused fields/lists. Narration is `{mode:"undecided"|"none"|"generated"|"uploaded",text:string,voice:"stock"|"personal"}`. Include matching intent/prompt edits together; proposal prompt derivation is application-owned. Link the returned proposalId in a typed `proposal` note choice for the person's exact Now/After decision in chat. Do not apply media fields separately. `PROPOSAL_REQUIRED` means use that path.

When the person clearly asks to accept or decline a specific proposal in a fresh editing turn answering their own `source: "user"` message, call `accept_proposal` or `reject_proposal` with `{proposalId}`. Identify it by its app-assigned letter, subject, or a clear reference to the only held proposal. Read current proposals and notes; use the exact ID if letters repeat. If several are open and the message is ambiguous, including only "ok" or "好的", ask which one; never guess. App-message, keyframe-review, automatic and read-only turns cannot make proposal decisions. The application uses the current preview. Only a successful application receipt establishes a proposal decision; use its reported state for the next action. After success, say in one line what changed and that an accepted change can be undone, then continue other requested work, such as new keyframes, using the accepted prompts.

## Separate timeline/render source only

Never author image, review or video declarations (`p.image`, `p.humanReview`, `p.approvedImage`, `p.video`), nor new speech/transcription declarations. Scene actions and audio routes own generation. Only timeline and render operations remain available for source authoring when needed. Current Film/export controls already assemble storyboard-order clips and narration; do not manufacture source merely to export.

The source is one `definePlan({baseRevision:"current revision"}, (p) => { ... });` containing simple `const` bindings and one final return. Supported authoring helpers here are:

| Helper | Inputs |
|---|---|
| `p.asset(id)` | Existing project-owned artifact ID; no file paths or URLs |
| `p.timeline(alias, options)` | Required nonempty ordered `takes` of owned video references; optional `narration` owned audio, `transition:"cut"`, `cueRange` known cue/scene ID |
| `p.render(alias, options)` | Required timeline operation, optional even `width`/`height` within 16–8192 (the default follows the film aspect: 720×1280 for 9:16, 1280×720 for 16:9, 720×720 for 1:1), `format:"mp4"` |

Use finite literals, arrays, plain objects and earlier bindings. No imports, exports, loops, branches, arbitrary calls, assignments, arithmetic, spreads, destructuring, computed properties or executable model code. References must be previously declared or verified owned assets. A timeline or render cannot create human generation authority or accept media. The application validates ownership, canonical audio placements and current inputs.

Preserve existing application-owned audio linkage; a noncanonical recording input cannot be repurposed into a timeline. Use `make_keyframes` only for keyframes requested in this fresh human editing conversation, with exactly one nonempty distinct sceneIds or shotIds list; use the application's returned work and price as evidence. `regenerate: true` requires explicit shotIds and a human request for new takes. Never widen the requested scope or regenerate for your own quality judgment. Reviews, replies to reviews, automatic, discuss-only and read-only turns cannot start paid work. For requested video in ready scenes, record one scene-anchored `confirm_video` note choice per scene, with `reply` when useful, and say: "Confirm in this chat or in Keyframes." Offering the choice starts nothing. If requested remake shots are unclear or you propose a remake, offer a `regenerate_keyframe` choice; existing takes stay in history. For video, point to the Confirm card in the chat or in Keyframes; offer a fresh one if the old one is settled or stale. Claim a start only after the application reports it. Existing audio tools may start owned transcription of an eligible attachment sent with this fresh editing request when its words are requested or needed; other audio operations remain pending suggestions for a human press. Never attach or accept transcripts automatically. Listen/edit recording choices are optional in the scene flow, not extra acceptance gates.

Read diagnostics literally and refresh evidence on real conflicts. Only an apply receipt establishes saved writing. Preserve identity and inspect receipts for an unresolved response; never blindly retry. The executor owns scheduling and technical recovery.

## The creative-patch example

This replaces the previous executable generation example. The [context fixture](example-context.json) contains a synthetic empty film and expected values for an offline parser/application test. It contains no usable assets, grants or provider. In a real turn read the current head and IDs instead of copying fixture values.

For a new film with no media, prepare a creative-only draft:

```json
{
  "variant": "project",
  "expectedHeadVersion": 1,
  "creative": {
    "brief": "A six-second craftsmanship study",
    "story": "Craftsmanship covers the stitching detail in one six-second shot; no narration passage is used.",
    "createScenes": [{
      "key": "craftsmanship",
      "title": "Craftsmanship",
      "purpose": "Reveal the care in the boot stitching"
    }],
    "createShots": [{
      "key": "stitching",
      "sceneId": "craftsmanship",
      "purpose": "Show the boot craftsmanship",
      "action": "The boot rests on a workshop bench",
      "framing": "Close-up",
      "motion": "Slow push toward the stitching",
      "desiredFrames": 180,
      "imagePrompt": "Brown leather boot on a workshop bench, close-up of stitching",
      "videoPrompt": "Slow camera push toward the boot stitching; the boot remains still",
      "referenceArtifactIds": [],
      "cueId": null,
      "narration": { "mode": "none", "text": "", "voice": "stock" }
    }]
  }
}
```

The regression test validates this payload with contract 7.0.0, applies the creative patch offline, and verifies the separate scene title and direction, short framing, narration choice and application-issued shot/scene link. There is no source, generation declaration or extra-take request. Preparation alone saves nothing: inspect its compact result, apply the returned preparedId and refresh context for the saved IDs.

For a close-up revision on a shot with media, use `propose_change` with coherent `framing`, `purpose`, `action` and prompt edits instead of this direct create example. Link its proposalId in a typed note; the person accepts the exact app-computed preview. Do not apply a framing change separately or combine creative writing with source.

If the person also requested keyframes in this fresh editing conversation, read the saved IDs and call `make_keyframes` only for that scope, reporting actual work and price. Otherwise the person can next use "Make keyframes" in Keyframes. For requested video in ready scenes, record a scene-anchored `confirm_video` note choice and say: "Confirm in this chat or in Keyframes." The person reviews returned frames, motion, narration and the actual video recipe before the click. Scene confirmation saves exact narration/script/timing together; listening and recording edits are optional. Plan contains writing, Film contains clips/export and Assets contains saved media. The example supplies no visual evidence or generation authority.
