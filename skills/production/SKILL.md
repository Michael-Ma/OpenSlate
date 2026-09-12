---
name: production
description: Develop or revise an OpenSlate narrated video from the current brief, assets, narration choices, and shot evidence; identify missing decisions and guide human review within the requested scope.
---

# OpenSlate production

Turn the user's current request into useful scoped creative work. Read the application context for settled decisions, allowed scope, current revisions, existing media, and pending requirements. Choose the relevant stages; a shot edit does not restart intake or the whole film. Several stages can be addressed in one proposal. The application derives mandatory checks from the actual changes, so a stage label never grants permission or bypasses a requirement.

Read [the current contract](references/current-contract.md) before forming a tool payload. It explains paged context, source chunks, freshness guards, and the compact preparation result. Use `read_context` and `inspect_artifact` for missing evidence, `prepare_change` for a proposal, and `apply_change` for the returned prepared identity. Preserve that identity when inspecting a lost response. Do not invent actor, approval, grant, or completion fields. A skill supplies guidance; the application owns authority and state.

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

Every shot's conditioning keyframe must receive exact human review before video dispatch. Initial grants are bounded. Additional creative candidates require the current scoped human request and service-issued allowance. Never regenerate automatically to improve quality, label an aesthetic miss a technical failure, or resubmit uncertain work. The executor owns trusted technical retries and reconciliation.

Use `plan-authoring` when producing executable declarations. Let deterministic media progress continue without another reasoning turn. After applying, report the concrete change, preserved work, and remaining user decision or system requirement. Current fixture artifacts must be described as fake; a successful tool receipt is not proof of artistic quality or a completed real film.
