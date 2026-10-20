# Current writing and planning guidance

Guidance package `7.0.0`, tool contract `6.0.0`, planning/workflow contracts `1.0.0`. Source is restricted declarative data and is never evaluated as JavaScript. Ordinary creative planning needs no source.

## Read current evidence

`read_context` accepts optional `section` and `offset`. `{}` reads overview; sections include shots, scenes, plan, aliases, grants, receipts, narration, audio_operations and notes. Follow `page.nextOffset` until null. Full shot records come from shots; overview is compact.

Compare `guard.headVersion`, `revisionId`, `activePlanId`, `graphDigest`, `capabilityLockId` and `domainCursor` across reads, plus `guard.dataDigest` within a section. Restart affected pagination if they change. Raw audit `cursor` is not a content freshness guard. Missing evidence is not permission to invent IDs or outcomes.

Before a separate source edit, concatenate all plan source chunks in returned UTF-16 offset order and read all aliases. Preserve current aliases and untouched branches; `current: false` is historical. Use the current revision/head even if saved source has an older base. If keeping the plan would require authoring image, review or video declarations, prefer the studio's Film/export controls instead of rebuilding generation work.

## Creative writing and proposals

Save harmless writing with `{variant:"project",expectedHeadVersion:currentHead,creative:{...}}`, then `apply_change` with the returned preparedId. Never combine creative and source in one `prepare_change`. Never use `requestNewTakes`. Scene actions build all keyframe/video work.

Contract 6.0.0 supports `createScenes: [{key,title,purpose}]` and `updateScenes: [{id,title?,purpose?}]`, with at least one update value. A scene title is a short name of at most about 6 words or 60 characters; purpose is direction. Story holds coverage, timing and narration range. Shot framing is a 1–3-word label of at most 40 characters (Close-up, Medium, Wide); use purpose/action/prompts for longer composition. Create shots with all required intent, prompt, reference and cue fields; only the application issues permanent IDs. Compact narration saves intent, never measured cues or acceptance.

On shots with current or retained media, changes to purpose, action, framing, motion, prompts, duration or narration must be proposed. Retained voice or accepted cues also establish media impact. Pure text without media impact may apply directly with a receipt. `propose_change` accepts `{patch:{updateShots:[{id,purpose?,action?,framing?,motion?,desiredFrames?,imagePrompt?,videoPrompt?,narration?}],updateScenes:[{id,title?,purpose?}]}}`; omit unused fields/lists. Narration is `{mode:"undecided"|"none"|"generated"|"uploaded",text:string,voice:"stock"|"personal"}`. Include matching intent/prompt edits together; proposal prompt derivation is application-owned. Link the returned proposalId in a typed note and wait for the person's exact Now/After decision. Do not apply media fields separately. `PROPOSAL_REQUIRED` means use that path.

## Separate timeline/render source only

Never author image, review or video declarations (`p.image`, `p.humanReview`, `p.approvedImage`, `p.video`), nor new speech/transcription declarations. Scene actions and audio routes own generation. Only timeline and render operations remain available for source authoring when needed. Current Film/export controls already assemble storyboard-order clips and narration; do not manufacture source merely to export.

The source is one `definePlan({baseRevision:"current revision"}, (p) => { ... });` containing simple `const` bindings and one final return. Supported authoring helpers here are:

| Helper | Inputs |
|---|---|
| `p.asset(id)` | Existing project-owned artifact ID; no file paths or URLs |
| `p.timeline(alias, options)` | Required nonempty ordered `takes` of owned video references; optional `narration` owned audio, `transition:"cut"`, `cueRange` known cue/scene ID |
| `p.render(alias, options)` | Required timeline operation, optional even `width`/`height` within 16–8192, `format:"mp4"` |

Use finite literals, arrays, plain objects and earlier bindings. No imports, exports, loops, branches, arbitrary calls, assignments, arithmetic, spreads, destructuring, computed properties or executable model code. References must be previously declared or verified owned assets. A timeline or render cannot create human generation authority or accept media. The application validates ownership, canonical audio placements and current inputs.

Preserve existing application-owned audio linkage; a noncanonical recording input cannot be repurposed into a timeline. Use separate audio tools for requested recognition or speech; they save pending suggestions, started only by a human press. Listen/edit recording choices are optional in the scene flow, not extra acceptance gates.

Read diagnostics literally and refresh evidence on real conflicts. A refusal prepares nothing; report no saved change without an apply receipt. Preserve identity and inspect receipts for an unresolved response; never blindly retry. The executor owns scheduling and technical recovery.
