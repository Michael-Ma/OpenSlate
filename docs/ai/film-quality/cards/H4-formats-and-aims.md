# H4 · Skill 2.2.0: format first, then aim

Read `docs/ai/uiux-plan/codex/RULES.md` first; its hard rules apply in full. You own `skills/code-plan/**`, the generated guidance digest, the skill tests, and one small server change described in item 2 (`apps/server/src/code-plan/director.ts` and wherever the skill manifest is validated). Stay out of `apps/web/**`: the lead adds the format and the aim to the idea panel.

## Why

`docs/ai/film-quality/DIRECTOR-IDEATION-AND-CUT-PLAN.md`, section 13. Skill 2.1.0 sorted its templates by what the viewer comes for and gave formats three lines. The owner asked for two layers: first the format (what the film is and what it is for: an advert, a short film, a micro drama, a music video, an explainer and so on), then the aim (the response the last picture should leave). The format fixes length, picture shape, the first seconds, the ending and the unit of structure; the aim's shape fills the turn.

## What is already written: do not rewrite the prose

The lead wrote the text in this worktree:

- `references/formats.md`: new. Thirteen formats, each with its constraints and its structures.
- `references/aims.md`: `templates.md` renamed and rewritten. Fourteen aims, each with its shapes.
- `references/film-craft.md`: the second paragraph of "The idea, before any plan" now says format first, then aim; the idea is recorded with `format` and `aim`; one paragraph on voice-over in "Sound and words".
- `SKILL.md`: the opening line and the sentence about the first scene.

Check the facts in these four files against the code: caption limits, what voice-over and music can do, that an uploaded picture can be held as a still, the timeline's limits. Where a fact is wrong, correct that fact and leave the wording around it. List every correction in your report.

## Do

1. `openslate.skill.json`: version `2.2.0`; `files` in this order: `SKILL.md`, `references/film-craft.md`, `references/formats.md`, `references/aims.md`, `references/studio.d.ts`, `references/example-plan.ts`.
2. **Supply the two idea files only on turns the person starts.** They are about 6,800 words and are needed when an idea is being found, not when clips are being reviewed.
   - The manifest names them in a new optional field (for example `"personTurnFiles": ["references/formats.md", "references/aims.md"]`). Every entry must also be in `files`; a manifest that names another path is refused. A manifest without the field behaves as today.
   - On a turn that the application starts (a review, a repair, a media failure: the request's source is not the user), the Director's context `references` omit those files. On a turn the person starts, all files are supplied.
   - The lock and the package digest still cover every file of the package. Read evidence is recorded only for files actually supplied.
   - `SKILL.md` already says "supplied on turns the person starts"; make that true and keep the sentence accurate.
3. `references/example-plan.ts`: add `format: "Short film"` and `aim: "Calm"` to the scene declaration. Keep the rest.
4. `references/studio.d.ts`: the comment that lists the idea fields names `format` and `aim` first.
5. Release by the repository's rules (the digest and the lock tests), so new Director turns get 2.2.0 and nothing recorded is rewritten.

## Tests

- The release, snapshot and catalog tests pass with 2.2.0, and the example passes its dry run with no advisory finding.
- A person-started turn's context has six reference files; a review turn's has four, without `formats.md` and `aims.md`; a manifest without the new field supplies every file; a manifest whose field names a path outside `files` is refused.
- Every `basis` in the example plan names a structure or a shape that exists as a bold name in `formats.md` or `aims.md`.
- No skill file links to `templates.md`, and every relative link in the skill files resolves to a file in the manifest.
- Word tripwires replace the old one: the six files together stay under 14,500 words, and the four files of an application turn under 7,500.

## Finish

Run the skill and code-plan suites, then `pnpm build`, the full `pnpm test` and `pnpm -r typecheck`, with exact counts. Write `docs/ai/film-quality/reports/H4-report.md` with every corrected fact, the manifest field as implemented and which turns see which files.
