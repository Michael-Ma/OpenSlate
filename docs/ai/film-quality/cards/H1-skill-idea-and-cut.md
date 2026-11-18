# H1 · Skill 2.1.0: the idea before the plan, a cut list, and templates by kind

Read `docs/ai/uiux-plan/codex/RULES.md` first; its hard rules apply in full. This card runs after H2 (edit tools) has merged into `main`, because the example plan uses still rows and `suggest`. You own `skills/code-plan/**`, `skills/shipped-releases.json`, the skill release, snapshot and catalog tests, and the generated guidance digest the repository requires. Stay out of `apps/server/src/**` and `packages/**` except for that digest and those tests, and out of `apps/web/**`.

## Why

`docs/ai/film-quality/DIRECTOR-IDEATION-AND-CUT-PLAN.md`. The Director turned each sentence of a brief into one shot. From 2.1.0 it decides what the viewer comes for, weighs three takes against a library of templates (which it may use, bend or leave), writes how the viewer's reading changes, writes a cut list, and only then decides which shots to buy.

## What is already written: do not rewrite the prose

The lead wrote the text in this worktree:

- `SKILL.md`: seven sentences changed (templates in the opening line, findings, the idea in the first scene, one clip per declared shot, `suggest`, still rows and zoom, cut pairs).
- `references/film-craft.md`: "The idea, before any plan", "Cut list, then shots", "Confirmed keyframes" and "Watching and cutting" are new; one sentence each in "Clip length" and "Sound and words".
- `references/templates.md`: new.

Check every fact in these three files against `docs/ai/film-quality/reports/H2-report.md` and the code: field names, limits (a still row of 1–300 frames, zoom up to 2, 18 cuts a sheet, `suggest.why` up to 160 characters), finding codes and what each tool returns. Where a fact is wrong, correct that fact and leave the wording around it. In `SKILL.md` the sentence about the diff says "notes": make it name the advisory findings as H2 implemented them. List every correction in your report.

## Do

1. `openslate.skill.json`: version `2.1.0`; add `references/templates.md` to `files`, after the craft file.
2. `references/studio.d.ts`: the still row, zoom up to 2, `suggest` on the keyframe input, and one comment line saying the first scene may carry `fixed`, `takes`, `reading`, `rule` and `cuts`. Shapes exactly as H2 implemented them.
3. `references/example-plan.ts`: keep it a small offline demo of about 75 lines. It must now show:
   - the idea in `ctx.scene`: `fixed`, `takes` (each with `basis`, one `chosen`), `reading`, `rule` and `cuts`;
   - one clip feeding two timeline rows by two ranges;
   - one still row: a confirmed keyframe's `frame` held for 45 frames;
   - `suggest` on one keyframe;
   - shot lengths that still differ.
4. Release by the repository's rules (`skills/shipped-releases.json`, the digest, the snapshot and lock tests), so new Director turns get 2.1.0 and nothing recorded is rewritten. Say in the report which films and turns see the new guidance.

## Tests

- The release, snapshot and catalog tests pass with 2.1.0.
- The example plan passes its dry-run test and produces no `CUTS_*`, `ZOOM_SOFT` or `SUGGEST_UNAVAILABLE` finding.
- New assertions: `references/templates.md` is in the manifest and reaches a turn's context `references`; the example has a still row, one clip used in two rows, and a `cuts` list whose `clip` values are all declared shots; the example's cut lengths are not all equal.
- A tripwire: the five skill files together stay under 9,500 words.

## Finish

Run the skill and code-plan suites, then `pnpm build`, the full `pnpm test` and `pnpm -r typecheck`, with exact counts. Write `docs/ai/film-quality/reports/H1-report.md` with every corrected fact and the before and after of each changed line in `studio.d.ts` and the example.
