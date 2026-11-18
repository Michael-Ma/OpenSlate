# H8 · Findings for the proof and for repeated rows

Read `docs/ai/uiux-plan/codex/RULES.md` first; its hard rules apply in full. This card runs alongside the lead's work on the skill text (2.3.0) and the web. You own `apps/server/src/code-plan/**`, `packages/core/src/**` where an item below needs it, and their tests. Stay out of `skills/**` and `apps/web/**`.

## Why

`docs/ai/film-quality/DIRECTOR-IDEATION-AND-CUT-PLAN.md`, section 15. Two real films were made with skill 2.2.0 and the chosen take could not be seen in either. In the pigeon film the take lived in 4.5 of 25 seconds, and those seconds were one second of footage and one cropped picture, each used three times.

From skill 2.3.0 the Director records, in the first scene declaration beside `cuts`:

- `obvious`: a string, the film anybody would make from the brief.
- `proof`: a list of three strings, things the viewer sees or hears in this film that the obvious film would not contain.
- on each cut that shows a proof, `proof: 1`, `2` or `3` (the 1-based position in the `proof` list): `cuts: [{ sees, seconds, clip, proof? }]`.

The dry run should tell the Director when the proof is not in the cut list, when it is a small part of the film, and when the timeline shows the same thing twice. All of it is advice in the plan diff's `findings`, as the `CUTS_*` findings are. Nothing here refuses a plan, changes a step key, a price, a choice or an answer.

## 1. Proof findings

Extend `cutListFindings` in `apps/server/src/code-plan/cut-findings.ts` (or add a pure function beside it and call it at the same place). Read `proof` from the same scene declarations that carry `cuts`; when several scenes carry `proof`, use the first and its own `cuts`.

- `PROOF_SHAPE`: `proof` is present but is not an array of one to three non-empty strings of at most 240 characters, or a cut's `proof` is present but is not an integer from 1 to the length of the list. Detail: "Write proof as a list of up to three sentences, and mark a cut with proof: 1, 2 or 3." When this fires, skip the two findings below.
- `PROOF_UNSEEN`: the list is well formed and at least one entry has no cut marked with its number. Detail names them in order: "No cut shows proof 2." or "No cut shows proofs 2 and 3."
- `PROOF_SHORT`: every entry has a cut, and the seconds of the marked cuts are less than one third of the seconds of all cuts. Detail gives both numbers, rounded as `CUTS_LENGTH` rounds: "The cuts that show the proof total 4.5 of 25 seconds; the take needs at least a third of the film."

A scene with `cuts` and no `proof` gets none of these (films planned before 2.3.0). A scene with `proof` and no `cuts` gets `PROOF_UNSEEN` for every entry. A cut marked `proof` in a scene with no `proof` list is `PROOF_SHAPE`. A malformed cut list (`CUTS_SHAPE`) reports only `CUTS_SHAPE`, as now, plus `PROOF_SHAPE` if the proof list itself is malformed. The existing check that a cut has a string `sees`, a positive `seconds` and a string `clip` must keep accepting a cut that also carries `proof`.

## 2. Repeated rows

Add `ROW_REPEATED`, computed where `ZOOM_SOFT` is computed: for each reached render, on dry runs and real passes alike.

- Compare the rows of one timeline in pairs. Row identity is the artifact's `kind` and `sha256`, as `renderSource` reads it. A bare artifact in the timeline is a row with no other fields.
- **Video rows.** The source range is `[startFrame, startFrame + durationFrames)`, with `startFrame` 0 when omitted and `durationFrames` from the row, or from the clip's measured length in `sources` when omitted. Skip a row whose range cannot be determined. Two video rows repeat when they have the same artifact, a deeply equal `zoom` (absent equals absent) and the overlap of their ranges is more than half of the shorter range.
- **Still rows.** Two still rows repeat when they hold the same picture with a deeply equal `zoom`, whatever their lengths.
- A video row and a still row never repeat each other.
- Group repeats (rows 2, 4 and 6 are one group, even if 2 and 6 overlap less than 2 and 4). Report one finding per render with up to three groups, rows numbered from 1 as `ZOOM_SOFT` numbers them: "Rows 2, 4 and 6 show the same part of one clip. Rows 3, 5 and 7 hold the same picture. A repeat should change: closer, shorter or a different moment."
- At most 64 rows are compared, as the timeline limit already guarantees.

Write it as a pure function with table-driven tests.

## Tests

1. Table-driven cases for every rule in section 1, including: a well-formed plan with all three proofs marked and more than a third of the seconds (no finding); proof 2 unmarked; marked cuts at 4.5 of 25 seconds; a `proof` list of four; a cut with `proof: 4`; `proof` without `cuts`; `cuts` without `proof` (no finding).
2. Table-driven cases for section 2: the pigeon timeline (one clip range three times and one still with the same zoom three times, among other rows) reports both groups; two ranges of one clip that do not overlap report nothing; the same still with a different zoom reports nothing; ranges 0–30 and 10–40 report a repeat (overlap 20 of 30) and 0–30 and 20–50 do not; a row without a known length is skipped.
3. Through `submit_plan` on a demo project: a plan with `proof` and marked cuts and no repeated row returns no new finding; the same plan with the marks removed returns `PROOF_UNSEEN`; a plan whose render repeats a row returns `ROW_REPEATED`. In each case the step keys, prices and choices are identical to the plan without these fields.
4. A saved plan that uses none of the new fields replays with identical step keys, prices, choices and answers, and its findings are unchanged.

## Contract and compatibility

- Finding codes are strings in `CodePlanDiff`; keep tool contract 0.3.0 if the catalog and lock rules allow an additive finding, as H2 did. If a digest or lock test forces a new version, follow the repository's rules and say in the report what changed.
- Do not edit `skills/**`. The lead adds the four codes to `SKILL.md` and releases the skill in a later card, so the guidance digest pin stays as it is in this card. If a test of yours needs the skill text, say so in the report and do not change the pin.
- Do not edit `apps/web/**`. The lead adds the four codes to the web's finding list and catalog.

## Finish

Run `pnpm build`, the touched test files with `node scripts/run-tests.mjs`, `pnpm -r typecheck` and `pnpm demo:code`, with exact counts. Write `docs/ai/film-quality/reports/H8-report.md`: what changed, the exact finding codes and detail sentences, and what you could not cover. The lead runs the full suite and the browser scenarios after merging.
