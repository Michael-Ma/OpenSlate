---
name: production
description: Develop or revise an OpenSlate narrated video from saved intent and media evidence, proposing changes with media impact and guiding human scene confirmation within the requested scope.
---

# OpenSlate production

Turn the current request into useful scoped creative work. Read the application context for settled decisions, allowed scope, revisions, existing media and pending requirements. A shot edit does not restart intake or the whole film. Stage labels never grant authority or bypass application checks.

Read [notes and human decisions](references/notes.md) before any mutation and [the current contract](references/current-contract.md) before forming a payload. Use `read_context` and `inspect_artifact` for evidence, `record_notes` for anchored observations and choices, `propose_change` for changes with media impact, and `prepare_change`/`apply_change` for harmless writing. On a shot with current or retained media, purpose, action, framing, motion, prompts, duration and narration are media inputs, even if their values are text. Propose their changes together; the person accepts the app-computed Now/After preview. Pure text without media impact may apply directly with a receipt. A `PROPOSAL_REQUIRED` refusal means propose the named fields rather than bypassing the boundary.

Never author image, review or video declarations (`p.image`, `p.humanReview`, `p.approvedImage`, `p.video`), and never use `requestNewTakes`. The application builds all keyframe and video work; `make_keyframes` requests keyframes and needed voice lines, while video requires human scene confirmation. Never combine creative edits with `source` in one `prepare_change`. `plan-authoring` covers separate timeline/render source only; ordinary creative planning needs no executable source.

Use [narration decisions](references/narration.md) for script or audio coverage, [audio suggestions](references/audio-proposals.md) for explicitly requested recognition or speech, and [continuity and review](references/continuity-review.md) for assets and visual feedback. Read [requested keyframes](references/keyframes.md) before `make_keyframes`. The fresh human editing request can start its requested keyframes and needed voice lines. An audio attachment sent with that request may be transcribed when the person asks what it says or its line is needed; other audio tools save pending suggestions for a human press. Their identities cannot be passed to `apply_change`. Never invent actor, grant, acceptance, completion or measured timing fields.

Load only the stage prompts needed for the request:

| Stage | Prompt reference | Read when |
|---|---|---|
| `intake` | [production/intake@1](references/stages/intake.md) | Interpreting a brief or supplied assets |
| `story` | [production/story@1](references/stages/story.md) | Developing beats and visual direction |
| `scene_plan` | [production/scene_plan@1](references/stages/scene_plan.md) | Separating scene names, direction and story coverage |
| `shot_plan` | [production/shot_plan@1](references/stages/shot_plan.md) | Creating or revising shot intent and prompts |
| `narration` | [production/narration@1](references/stages/narration.md) | Choosing script and audio work |
| `storyboard` | [production/storyboard@1](references/stages/storyboard.md) | Preparing saved shot writing for keyframes |
| `video` | [production/video@1](references/stages/video.md) | Explaining scene confirmation and requested takes |
| `assembly` | [production/assembly@1](references/stages/assembly.md) | Reviewing clip order, narration and export |
| `review` | [production/review@1](references/stages/review.md) | Explaining shown results and receiving decisions |

Name the studio views and actions by their labels. Plan contains brief, story, scenes and shots. When the person asks for keyframes in a fresh editing conversation, call `make_keyframes` for exactly the requested scenes or shots. The person may also press "Make keyframes" in Keyframes. When they want video for ready scenes, record a scene-anchored `confirm_video` choice for each, with `reply` when useful. Say: "Confirm in this chat or in Keyframes." They review exact returned frames, motion, narration and the actual video recipe before the click. Listening and recording edits are optional. This scene confirmation saves exact script, recording and measured timing together; do not request separate per-section acceptance. Film contains current clips, soundtrack and export. Assets contains saved media.

The person decides to make keyframes, either in the conversation or with the scene action, then confirms the actual returned frames and video recipe in chat or Keyframes. Returned clips need no further acceptance gate. Configured providers need no API-key approval, spending approval or usage allowance. A fresh human editing request naming shots can start new keyframe takes with `shotIds` and `regenerate: true`. If the shots are unclear or you propose a remake, offer a `regenerate_keyframe` note choice; existing takes stay in history. A video take needs the clicked scene confirmation. "yes", "ok" or "go ahead" replies do not confirm an open choice: point to it or offer a fresh one if stale or settled. Claim a start only after the application reports it. Never regenerate autonomously for quality or blindly resubmit an uncertain outcome. The executor owns technical retries and reconciliation.

Respect resolved notes, settled choices, unaffected work and request-owned holds. Human edits can run alongside this turn; a field conflict requires fresh evidence, not overwriting the person's change. Save a small usable creative draft before expanding it. Report actual saved progress and remaining choices. Tool receipts establish saved work, not artistic quality; describe known fixture media as placeholders.
