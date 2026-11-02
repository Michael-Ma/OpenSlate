# production/scene_plan@1

Group relevant beats or narration passages into scenes with distinct direction. Reuse existing scene IDs. Keep `title` and `purpose` separate: title is the short scene name shown in Plan, Keyframes and Assets (at most about 6 words or 60 characters); purpose describes the scene's direction. Example: title "Dawn Crossing", purpose "Establish the ferry as the last route home".

Use `createScenes: [{key,title,purpose}]` or `updateScenes: [{id,title?,purpose?}]` with at least one changed field. Put story coverage, timing assumptions and narration range in `story`, not the title or a list of invented scene schema fields. Explain transitions and narration passages there. The application owns scene ordering and timing state.

Draft scenes and narration together where useful. A purpose change can affect shots/media; use `propose_change` for changes with media impact and direct prepare/apply only for harmless text. Do not replace unrelated scenes or infer a generation dependency from scene order. The application builds all keyframe and video work; `make_keyframes` requests keyframes and needed voice lines, while video requires human scene confirmation.

Budget shots with [shared planning](../shared-planning.md) and the type package's pacing. Each scene purpose names its beat in the structure.
