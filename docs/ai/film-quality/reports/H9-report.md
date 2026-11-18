# H9 — Code-plan skill 2.3.0

## Release and turn behavior

Code-plan 2.3.0 asks the Director to name the obvious film, write three visible or audible details that distinguish the chosen take, and mark the cuts that show them. The craft guidance carries the take through each block and the ending, writes feelings as observable actions, asks repeated footage to change, and calls for a one-sentence cold read during review.

The application pins the manifest and all six files with package digest `712c72a27716b3cd4a18094824bd5397bf92fb247c0c698f211ef4dca88db279` as of H9b. Tool contract **0.3.0**, plan language **1.0.0**, workflow **1.0.0**, the file inventory and `personTurnFiles` retain their existing values. This package ships separately from the storyboard release registry.

| Turn | Guidance supplied |
|---|---|
| Person-started, with a fresh 0.3.0 binding | All six 2.3.0 files |
| Application-started, including review, repair and media failure, or Director-started, with a fresh 0.3.0 binding | SKILL, film craft, Studio API and example |
| Archived 0.1.0 or 0.2.0 contract | All files from its pinned historical package |

The existing fresh-turn path gives a film previously locked to 2.2.0 a separate 2.3.0 lock. Historical epoch bindings, lock records, snapshot bytes, read evidence, plans and media receipts keep their identities. A re-prepare of an epoch already bound to an outdated current-contract package still fails the existing guidance pin check. An offline check using the exact 2.2.0 package from `0869b35a` verified its original digest and all seven package files after the next turn activated 2.3.0. The saved plan and first job remained intact, and repeating the original submit invocation returned its saved receipt with one total provider call.

## Factual corrections

- The advisory sentence in `SKILL.md` now also names `UNAWAITED_CALL`, `STEP_LIMIT` and `CEILING`. The sentence describes the three codes and omits the claim that each finding includes guidance detail, since the step and spending findings can be code-only. The two submit-rejection findings are `SOURCE_SYNTAX` and `RUNTIME_ERROR`.
- In the revised example, row 2 carries no mark. Row 4 marks both the steam turning gold and the chime with `proof: [2, 3]`. The cuts are marked `1`, unmarked, `1`, and `[2, 3]`, covering 8 of the 9.5 declared seconds. The chime starts at tick 195, the start of the last row.

The Studio declaration comment lists the optional idea fields. The film-craft guidance uses one-based proof numbers in the scene carrying the list. It calls for three proofs, plain sight words, a marked final cut and a stranger's reading. The cut-list check accepts up to 64 cuts across the declarations, with string `sees`, finite positive `seconds`, and a string shot ID or `still` as `clip`. The proof check accepts one to three nonblank strings of up to 240 JavaScript string units. A cut mark can be one integer or a list of one to three distinct integers in the proof list's range. `PROOF_SHAPE` covers malformed lists or marks. `PROOF_UNSEEN` names missing marks. Once each proof has a mark, `PROOF_SHORT` compares marked seconds with one third of the first proof scene's declared cut seconds. Each marked cut contributes its duration once.

## Repeated rows and the reviewed example

The example uses the same source range in rows 1 and 4 on two different shots. Their fake videos share a hash, and the prior content-only comparison reports `ROW_REPEATED` for those rows. The dry run now passes the timeline with its source refs to the repeat check. The check uses `artifactId` when both rows have one and kind plus hash when either lacks an ID. The same clip still produces the finding at matching zoom when the source ranges overlap by more than half the shorter range. Render inputs and step keys still normalize by content.

The scripted reviewer previously imposed its whole-clip trim on each occurrence of a clip. On this example that shortened the assembly past the chime and would have made the two ranges of shot 1 identical. The reviewer now saves multi-row assemblies with their planned ranges and timing intact. The existing single-clip fixture still exercises a trim based on contact-sheet timing.

## Tests and review

Four tests were added for the 2.2.0 predecessor policy, both outcomes of artifact ID comparison, and the advisory-code inventory. Three existing skill tests were updated for the release, package budgets and actual scripted review, and the existing lock test now checks the 2.3.0 pin. The 2.1.0 preservation case still runs. The example test checks the unmodified initial dry run, the initial submission, the reviewed submission and complete dry runs of both sources. It verifies the marked time, a mark for every proof, and every non-`own` basis against its declared structure or shape. Package validation checks relative links. No tests were deleted.

| Injected files | Original H9 words | Limit |
|---|---:|---:|
| All six | 14,474 | <14,900 |
| Four on application turns | 7,648 | <7,900 |

The diff review traced the timeline through normalization and replay and found that passing normalized rows alone would remove the IDs again. The implementation keeps them solely in the in-memory advice path. The review also identified the scripted trim's effect on the cut list and chime and checked that the example test runs the actual offline review turn.

## Original H9 verification

Pinned toolchain: Node **24.15.0**, pnpm **10.33.0**, FFmpeg and ffprobe **8.1.1**, and Hiragino Sans GB for CJK captions. Checks used temporary fixture data, fake providers and loopback only. Command logs are in `/tmp/openslate-h9.U3WYPV`.

| Check | Result |
|---|---|
| Skill release, loader, lock, catalog and code-plan suites | 750 passed, 0 failed, 0 skipped |
| `pnpm demo:code` | Passed. Versions 1 → 2 → 3 → 4, two choices, one lookup recovery, zero duplicate submissions, $0.40 of a $4.00 fixture ceiling, final state `done`. |
| `pnpm build` | 5 workspace builds passed, 0 failed. Vite reported its existing dynamic-import and bundle-size advisories. |
| Focused rerun of the skill, proof, lock and review tests | 113 passed, 0 failed, 0 skipped |
| `pnpm check`, including `pnpm test` | 5,457 tests. 5,456 passed, 0 failed, 1 skipped, 0 cancelled, 0 todo. Five workspace typechecks passed. |
| Standalone `pnpm -r typecheck` | 5 workspaces passed, 0 failed |
| Strict Studio declaration and example typecheck | Passed |
| Exact shipped 2.2.0 snapshot and content-only repeat reproduction | Both passed. |
| `git diff --check` | Passed. |

The full suite skipped `opt-in native Codex probe never starts a model turn`. The optional native probe was disabled.

The first run of the strengthened example test deliberately used the previous review code. It passed three tests and failed one, `2.3.0 example dry-runs, submits and reviews cleanly with distinct shots and a held keyframe`, with `Audio row 2: atSample must be an integer in 0–172799`. The final example run passes through submission and review with zero findings.

The lead runs the browser scenarios and a real Director turn. The offline example verifies declarations, advice and replay. Those checks cannot assess film quality.

Section 16 of the design notes was edited separately while H9 was running. Its statement that older plans receive none of the four findings is broader than the implementation. A new dry run of an unannotated plan can still receive `ROW_REPEATED`. Existing recorded findings remain as saved.

## Files and proposed commit

- Release and example: `skills/code-plan/openslate.skill.json`, `skills/code-plan/SKILL.md`, `skills/code-plan/references/example-plan.ts`, `apps/server/src/application/director-capabilities.ts`.
- Findings and demo review: `apps/server/src/code-plan/cut-findings.ts`, `apps/server/src/code-plan/index.ts`, `apps/server/src/application/fake-director.ts`.
- Tests: `apps/server/test/code-plan-director.test.mjs`, `apps/server/test/code-plan-proof-findings.test.mjs`, `apps/server/test/code-plan-skill.test.mjs`.
- Current docs: `README.md`, `docs/implementation/STATUS.md`, `docs/technical/DIRECTOR-RUNTIME.md`, `docs/technical/EXECUTION-ENGINE.md`, `docs/technical/SKILLS-TOOLS.md`, `docs/ai/code-plan/TEST-INSTRUCTIONS.md`.
- Added: `docs/ai/film-quality/reports/H9-report.md`. No files were deleted.

One proposed commit, `feat(code-plan): release take-on-screen guidance 2.3.0`, covers these 17 files. The work is uncommitted. There are no browser contract changes.

## H9b

A cut can use a one-based number or a list of one to three distinct numbers in range. Each number covers its proof and each marked cut contributes its seconds once. Invalid marks produce `PROOF_SHAPE` with the detail “Write proof as a list of up to three sentences, and mark a cut with proof: 2 or proof: [2, 3].”

The revised 2.3.0 package contains 14,492 words across six files and 7,666 across the four application-turn files. The lock tests compare the pinned digest with the exact package bytes.

Added 12 proof-finding cases and updated the example and submission tests to exercise both mark forms. The diff review traced the validator through dry run and replay. The submission tests verify identical step keys, prices, choices and provider calls when only proof annotations change.

Checks used the pinned toolchain and temporary fixture data. Logs are in `/tmp/openslate-h9b.9t7s8p`.

| Check | Result |
|---|---|
| `pnpm build` | 5 workspace builds passed, 0 failed. Vite reported its existing dynamic-import and bundle-size advisories. |
| Focused proof and example tests | 74 passed, 0 failed, 0 skipped |
| Skill and code-plan suites | 677 passed, 0 failed, 0 skipped |
| `pnpm demo:code` | Passed. Four plan versions, two answered choices, one lookup recovery, zero duplicate submissions, $0.40 of a $4.00 fixture ceiling, final state `done`. |
| `pnpm check`, including `pnpm test` | 5,469 tests. 5,468 passed, 0 failed, 1 skipped (the optional native Codex probe), 0 cancelled. |
| `pnpm -r typecheck` | 5 workspaces passed, 0 failed |

The Codex run stalled after these checks when the machine slept, before its closing message; the lead read the two rows above from the run's own logs (`check.log`, `status`), confirmed that the pinned digest equals the digest of the package files, and stopped the process.
