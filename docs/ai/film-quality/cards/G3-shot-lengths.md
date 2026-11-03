# G3 · Each shot is generated at the length its beat needs

Read `docs/ai/uiux-plan/codex/RULES.md` first; its hard rules apply in full. G1 (Viggle quality and export size) and G2 (native frame rate, 24 fps renders) run at the same time. Stay out of `apps/server/src/**` and `packages/**` except skill-release tests. You own `skills/code-plan/**`, `skills/shipped-releases.json`, the skill-release and skill-snapshot tests, and any generated skill digest the repository requires.

## Problem (the owner's film, 2026-11-02)

Claude Code · Opus 5.5 requested `durationSeconds: 8` for all four shots and kept 4.7 s, 7.2 s, 3.3 s and 7.5 s of them. `skills/code-plan/references/film-craft.md` says "Request a clip longer than the retained beat … then cut it down", so the Director picks one safe length for everything. The owner sees every clip at the same length, not shaped by the story, and Viggle bills per started second: shot 3 paid for 8 s to use 3.3 s.

## Change the guidance

1. In the beat sheet, each shot gets a **target on-screen length** chosen from its role and action: a quick reaction or insert about 2–3 s, a clear action 4–6 s, a payoff that needs to breathe 5–8 s. Lengths should differ with the story; equal lengths need a reason.
2. Request `durationSeconds` = the target plus the late-start margin (about 1.5 s; the Tofu sample averaged 1.33 s late), rounded up to a whole second and clamped to the model's `durationSeconds {min, max}` from `read_film.models`. Viggle accepts 5–15 s, so a 3 s beat still requests 5 s.
3. Say why: video is billed per second, so asking 8 s for a 3 s beat pays for about 2.5 times the footage used.
4. After review, cut each clip to the observed action and the beat's target, not to the requested length.
5. Update `references/example-plan.ts` so its shots use different, beat-driven lengths computed this way.
6. Frame unit wording (G2 makes it true; it merges before this card): in `SKILL.md` (the "Only cuts, 30 fps, 48 kHz …" line) and `references/studio.d.ts` (the render comment), say that frame numbers are 1/30 s positions (30 per second), that each clip keeps its own frame rate and that the finished film plays at 24 fps. Do not change any frame number or API shape.

Keep the rest of the skill as it is. Keep the text short and in the skill's voice.

## Release

Follow the repository's skill release rules (`skills/shipped-releases.json`, skill snapshot/lock tests, `director_skill_lock`): bump the `code-plan` skill version as those rules require, so new Director turns get the new text and nothing that was recorded is rewritten. Say in the report which films and turns see the new guidance.

## Tests

The skill-release, snapshot and catalog tests pass with the new version; the example plan passes the dry-run test it already has; a check asserts the example's shot lengths are not all equal.

## Finish

Run the skill and code-plan suites, then `pnpm test` and `pnpm typecheck`. Write `docs/ai/film-quality/reports/G3-report.md` with the before/after text of every changed paragraph.
