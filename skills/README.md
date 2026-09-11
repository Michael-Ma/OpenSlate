# Creative skills

No skill implementations are shipped yet. The initial design uses two skills:

- `production`: intent and narration gap discovery, script development, story/shot planning, continuity/assets, human keyframe review, and conversational editing guidance.
- `plan-authoring`: code-authored execution plans and focused patches against existing project state.

Stage-specific guidance starts as lazy references, not separate agents or a large skill inventory. OpenSlate will own discovery validation, immutable package snapshots, compatibility locks, and activation records across requests. Skills supply instructions; typed tools enforce project state, authorization, and budgets.

See the [skill and tool framework](../docs/design/SKILLS-AND-TOOLS.md) and [execution/editing design](../docs/design/EXECUTION-AND-EDITING.md).
