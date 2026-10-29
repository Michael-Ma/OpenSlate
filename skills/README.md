# Creative skills

The current Director guidance is **release v8** ([skills/v8](v8/release.json)), version `8.0.0` with JSON tool contract `7.0.0`. New films lock it, and saved V7 films move to it on their next eligible fresh native turn. Historical V1–V7 package bytes remain available for verifying existing immutable locks.

A release pins 22 instruction-only packages with one `release.json`. The application routes them from the saved `project.filmKind`: core always, the film's type package, the vertical format package for 9:16 films, and the craft packages those need (some only when the film has characters, a soundtrack or narration). Only routed `SKILL.md` entries and the two core references are injected; every other file is read on demand with `read_guidance`.

| Role | Packages |
|---|---|
| core | [production](v8/production/SKILL.md) (authority, the 7.0.0 contract, notes, routing and intake, shared planning, edits and cards, stage prompts), [plan-authoring](v8/plan-authoring/SKILL.md) |
| type | [type-social](v8/type-social/SKILL.md), [type-music-video](v8/type-music-video/SKILL.md), [type-commercial](v8/type-commercial/SKILL.md), [type-explainer](v8/type-explainer/SKILL.md), [type-narrative](v8/type-narrative/SKILL.md), [type-narrated-story](v8/type-narrated-story/SKILL.md), [type-showcase](v8/type-showcase/SKILL.md), [type-documentary](v8/type-documentary/SKILL.md), [type-trailer](v8/type-trailer/SKILL.md) |
| craft | [craft-story](v8/craft-story/SKILL.md), [craft-comedy](v8/craft-comedy/SKILL.md), [craft-visual-style](v8/craft-visual-style/SKILL.md), [craft-style-prompting](v8/craft-style-prompting/SKILL.md), [craft-shot-prompting](v8/craft-shot-prompting/SKILL.md), [craft-characters](v8/craft-characters/SKILL.md), [craft-continuity-review](v8/craft-continuity-review/SKILL.md), [craft-narration](v8/craft-narration/SKILL.md), [craft-music-timing](v8/craft-music-timing/SKILL.md), [craft-performance](v8/craft-performance/SKILL.md) |
| format | [format-social-vertical](v8/format-social-vertical/SKILL.md) |

Every `filmKind.kind` routes to its type package; `undecided` and `other` use the fallback (core plus story, visual style and shot prompting). Permissions and decisions are written only in core; a CI lint keeps them out of the other packages, and a CI budget keeps entries and the worst-case injection within `release.json` limits.

A shipped package, release and tool catalog are never edited in place. This includes the root `production` and `plan-authoring` packages, `v2` through `v8`, and catalogs `1.0.0` through `7.0.0`. Every later guidance or schema change ships as a new version with a new identity: a changed package gets a new minor version, the release a new version and `SHIPPED_DIRECTOR_RELEASES` a new row. Package, release and catalog digest tests pin that history; do not update a historical pin to accommodate an edit.

OpenSlate validates exact package contents, creates immutable content-addressed snapshots, locks compatible versions and records activation and every guidance read. Already-started epochs keep their saved lock. Skills supply instructions; typed tools enforce current project inputs, scope and exact media review. Configured provider credentials require no separate API-key approval or usage allowance.

These are OpenSlate product packages; they are not installed into a contributor's global Codex configuration. See the [skill and tool framework](../docs/technical/SKILLS-TOOLS.md), the [v8 architecture](../docs/ai/skill-architecture/2026-10-28-skill-architecture.md) and the [film-kind taxonomy](../docs/ai/film-kind/2026-10-28-film-kind-taxonomy.md).
