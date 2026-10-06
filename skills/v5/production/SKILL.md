---
name: production
description: Develop or revise an OpenSlate narrated video from the current brief, assets, narration choices, and shot evidence; identify missing decisions and guide human review within the requested scope.
---

# OpenSlate production

Turn the user's current request into useful scoped creative work. Read the application context for settled decisions, allowed scope, current revisions, existing media, and pending requirements. Choose the relevant stages; a shot edit does not restart intake or the whole film. Several stages can be addressed in one proposal. The application derives mandatory checks from the actual changes, so a stage label never grants permission or bypasses a requirement.

Read [the current contract](references/current-contract.md) before forming a tool payload. It explains paged context, source chunks, freshness guards, and the compact preparation result. Use `read_context` and `inspect_artifact` for missing evidence, `prepare_change` with createShots/updateShots.narration for requested compact shot text/source drafts, `revise_narration_draft` for an application-issued narration session, `prepare_change` for a creative or plan proposal, and `apply_change` for the returned prepared-change identity. Use `prepare_recording_transcription` for requested recognition of an existing owned recording and `prepare_narration_speech` for requested speech from one exact saved narration section. The application publishes these requested audio operations; their returned identities are not IDs accepted by `apply_change`. Narration drafts remain reversible and returned audio does not adopt or accept itself. Preserve operation identity when inspecting a lost response. Do not invent actor, approval, grant, or completion fields. A skill supplies guidance; the application owns authority and state.

Use [audio operations](references/audio-proposals.md) for explicitly requested recognition or speech. Read `audio_operations` for current profiles, recordings and outcomes. Configured provider credentials need no separate approval or usage allowance. Report a real missing key, unsupported input or disabled route as setup information; do not ask the user to approve a key or authorize narration guidance.

Use [narration decisions](references/narration.md) when audio or script coverage is uncertain, and [continuity and review](references/continuity-review.md) for assets, shot edits, or visual feedback. Load only the stage prompts needed for this request:

| Stage | Prompt reference | Read when |
|---|---|---|
| `intake` | [production/intake@1](references/stages/intake.md) | Interpreting a brief or new attachments |
| `story` | [production/story@1](references/stages/story.md) | Developing beats and visual direction |
| `scene_plan` | [production/scene_plan@1](references/stages/scene_plan.md) | Organizing scene purposes and coverage |
| `shot_plan` | [production/shot_plan@1](references/stages/shot_plan.md) | Creating or revising shot intent and prompts |
| `narration` | [production/narration@1](references/stages/narration.md) | Choosing script and audio work |
| `storyboard` | [production/storyboard@1](references/stages/storyboard.md) | Preparing conditioning images for review |
| `video` | [production/video@1](references/stages/video.md) | Planning reviewed video work or a requested take |
| `assembly` | [production/assembly@1](references/stages/assembly.md) | Planning cuts, narration placement, and previews |
| `review` | [production/review@1](references/stages/review.md) | Explaining visible results and receiving human decisions |

Ask for missing information when it changes the creative result or a required choice. Do not repeat settled questions or turn aesthetic concerns into hard blockers. Record concise advisory gaps; let service diagnostics identify enforced requirements. Continue independent drafting when feasible.

Each scene has two generation decisions: create keyframes from its direction, then inspect the exact returned frames with their motion, duration, model and settings before starting video. Use each scene's green actions for those decisions. Returned clips are available to inspect; a green completion status means current media is saved, not that quality was accepted. Do not add a post-generation acceptance gate, cost review, usage allowance or API-key approval. An additional creative take still requires the user's scoped request. Never regenerate automatically to improve quality, label an aesthetic miss a technical failure, or resubmit uncertain work. The executor owns trusted technical retries and reconciliation.

Use `plan-authoring` when producing executable declarations. Let deterministic media progress continue without another reasoning turn. After applying, report the concrete change, preserved work, and remaining user decision or system requirement. Current fixture artifacts must be described as fake; a successful tool receipt is not proof of artistic quality or a completed real film.
