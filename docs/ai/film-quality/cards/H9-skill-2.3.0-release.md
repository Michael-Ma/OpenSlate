# H9 · Release skill 2.3.0: the take acted on screen

Read `docs/ai/uiux-plan/codex/RULES.md` first; its hard rules apply in full. H8 (the proof and repeated-row findings) is already merged into this branch. You own `skills/code-plan/openslate.skill.json`, the guidance digest pin, the skill and lock tests, and the docs named below. Stay out of `apps/web/**`: the lead has already added the proof to the idea panel.

## Why

`docs/ai/film-quality/DIRECTOR-IDEATION-AND-CUT-PLAN.md`, sections 15 and 16. In two real films made with skill 2.2.0 the chosen take could not be seen. Skill 2.3.0 makes the Director act the take: it writes three things the viewer will see or hear that the obvious film would not contain (`proof`), runs the take through every block and the kept image, never shows the same footage twice, writes feelings as actions, and in review writes the sentence a stranger would say.

## What is already written: do not rewrite the prose

The lead wrote the text in this worktree and tested it on paper with a blind read:

- `references/film-craft.md`: "The idea, before any plan" (act the take, `proof`, the take through the whole film, `obvious` and `proof` recorded), "Cut list, then shots" (`sees` in plain sight words, the `proof` mark on cuts, reading the cut list as a stranger before submitting, a repeat must change, a shot of its own for what the take makes a character), "Prompts" (a feeling is an action), "Watching and cutting" (find each proof first; the cold read).
- `SKILL.md`: the sentence about the first scene, and the sentence that lists the advisory findings (now with `PROOF_SHAPE`, `PROOF_UNSEEN`, `PROOF_SHORT`, `ROW_REPEATED`).
- `references/studio.d.ts`: the comment that lists the idea fields.
- `references/example-plan.ts`: `obvious`, `proof`, `proof` marks on the cuts, `sees` in plain sight words, frame and motion prompts in which the light moves, and the chime moved to the frame where the last row starts.

Check the facts in these files against the code (finding names and what each reports, the `proof` mark's shape, what the cut-list check accepts). Where a fact is wrong, correct that fact and leave the wording around it. List every correction in your report.

## Do

1. `openslate.skill.json`: version `2.3.0`. Files, `personTurnFiles` and compatibility stay as they are.
2. Release by the repository's rules (the digest pin in `apps/server/src/application/director-capabilities.ts` and the lock tests), as H4 did for 2.2.0, so new Director turns get 2.3.0 and nothing recorded is rewritten. A film locked on 2.2.0 keeps working and moves to 2.3.0 the way a film locked on 2.1.0 moved to 2.2.0.
3. `ROW_REPEATED` compares rows by the content of their artifacts. On a demo project the fake clips of different shots can share their bytes, so two different shots could be reported as one clip shown twice. Check this with the example plan (rows 1 and 4 use the same range of two different shots). If it happens, compare rows by `artifactId` when both rows carry one and by content otherwise, add a test, and say so in the report. A real film must still get the finding when one clip's range is used twice.
4. The example plan must dry-run with no finding at all, including the four new ones: its marked cuts must add up to at least a third of its seconds and every proof must have a cut. If it does not, change the example's marks or lengths, not the rules, and say what you changed.
5. Docs that name the current code-plan skill version or describe what it asks of the Director: `README.md`, `docs/implementation/STATUS.md` and any other current doc (not history, not `docs/ai/**` reports). One or two plain sentences each on what 2.3.0 adds.

## Tests

- The release, snapshot, lock and catalog tests pass with 2.3.0. Tests that are about history keep their recorded versions.
- Word tripwires move with the text, which grew by about 600 words: the six files together stay under 14,900 words, and the four files of an application turn under 7,900.
- The example's first scene carries a string `obvious`, a `proof` list of three and at least one cut marked for each proof; its dry run, its submitted run and its reviewed run report no finding.
- Every `basis` in the example still names a structure or a shape that exists in `formats.md` or `aims.md`; every relative link in the skill files resolves inside the manifest.
- `SKILL.md` names every advisory finding code the server can produce for a code plan: a test compares the list in the sentence with the codes in `apps/server/src/code-plan/**`.

## Finish

Run the skill and code-plan suites, `pnpm demo:code`, then `pnpm build`, the full `pnpm check` and `pnpm -r typecheck`, with exact counts and every failure quoted. Write `docs/ai/film-quality/reports/H9-report.md` with every corrected fact, what the release changed and which turns see what. The lead runs the browser scenarios and a real Director turn afterwards.
