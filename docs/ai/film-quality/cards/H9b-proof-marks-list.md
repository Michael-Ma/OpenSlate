# H9b · A cut may show more than one proof

Read `docs/ai/uiux-plan/codex/RULES.md` first; its hard rules apply in full. This follows H8 and H9 in the same worktree. You own `apps/server/src/code-plan/**`, the guidance digest pin, their tests and your report. Stay out of `apps/web/**` and do not rewrite the prose of the skill files.

## Why

One of the three proofs is usually a sound, and a sound falls on a cut that already shows a picture. With one mark a cut, the Director must leave a proof unmarked (and gets `PROOF_UNSEEN` for a film that is fine) or mark the wrong one. The released example had to do this, and two of the paper-test plans did.

## What is already written

The lead changed, in this worktree:

- `skills/code-plan/references/film-craft.md`: a cut is marked with a number, `proof: 2`, or a list when it shows more than one, `proof: [2, 3]`.
- `skills/code-plan/references/example-plan.ts`: the second cut is unmarked again and the last cut is `proof: [2, 3]` (the steam turns gold, and the chime). Marks are now `1, none, 1, [2, 3]`: 8 of 9.5 seconds.
- `apps/web/**`: the idea panel reads a number or a list.

## Do

1. `proofFindings` in `apps/server/src/code-plan/cut-findings.ts`: a cut's `proof` is an integer from 1 to the length of the list, or an array of one to three such integers with no duplicates. Anything else is `PROOF_SHAPE`. Every listed number counts as seen. A cut's seconds count once toward the marked seconds however many proofs it shows. Update the `PROOF_SHAPE` detail: "Write proof as a list of up to three sentences, and mark a cut with proof: 2 or proof: [2, 3]."
2. Tests: table cases for a list mark (`[2, 3]` satisfies both; `[]`, `[2, 2]`, `[1, 4]`, `[1, "2"]` and a nested list are `PROOF_SHAPE`; seconds counted once), and the example test in `code-plan-skill.test.mjs` reads marks that are numbers or lists.
3. Pin the new guidance digest and keep version 2.3.0 (it has not been pushed or shipped). Update anything in your H9 report and in the docs you changed for H9 that describes the marks.

## Finish

Run the skill and code-plan suites, `pnpm demo:code`, `pnpm build`, the full `pnpm check` and `pnpm -r typecheck`, with exact counts and every failure quoted. Append a short "H9b" section to `docs/ai/film-quality/reports/H9-report.md`.
