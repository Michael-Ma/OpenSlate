# H8 · Findings for proof and repeated rows

## Implementation

- Proof advice uses the first reached scene with a `proof` list and measures coverage and screen time from that scene’s own cuts. An unlisted proof takes precedence over short screen time. A mark requires a list in its own scene. When an annotated cut list is malformed, shape advice takes precedence. Unannotated legacy cut lists retain their existing findings, including shot warnings on malformed lists.
- Each reached render checks up to 64 rows in the shared dry-run and execution path. Video rows match by artifact kind and SHA-256, deep zoom equality, and a source overlap greater than half the shorter range. Still rows match by content and zoom. Connected pairs form a single group, and the first three groups are listed by their first timeline row. Video rows with unknown lengths are skipped.
- `obvious` stays descriptive scene data. The checks add advice to `CodePlanDiff.findings` without changing media inputs, step keys, prices, choices, answers, or plan admission.

## Finding details

| Code | Detail |
| --- | --- |
| `PROOF_SHAPE` | `Write proof as a list of up to three sentences, and mark a cut with proof: 1, 2 or 3.` |
| `PROOF_UNSEEN` | `No cut shows proof 2.` / `No cut shows proofs 2 and 3.` / `No cut shows proofs 1, 2 and 3.` |
| `PROOF_SHORT` | `The cuts that show the proof total 4.5 of 25 seconds; the take needs at least a third of the film.` Numbers use the same two-decimal rounding as `CUTS_LENGTH`. |
| `ROW_REPEATED` | `Rows 2, 4 and 6 show the same part of one clip. Rows 3, 5 and 7 hold the same picture. A repeat should change: closer, shorter or a different moment.` |

## Verification

- `pnpm check:toolchain` passed with Node 24.15.0, pnpm 10.33.0 and FFmpeg/ffprobe 8.1.1.
- `pnpm build` and `pnpm -r typecheck` each passed in **5 workspaces, 0 failures**. Vite reported its existing dynamic import and bundle-size advisories.
- `node scripts/run-tests.mjs apps/server/test/code-plan-proof-findings.test.mjs apps/server/test/code-plan-edit-tools.test.mjs` completed with **88 passed, 0 failed, 0 skipped**. Added 34 proof table cases, one malformed-list compatibility case, 19 repeat table cases, and two `submit_plan` integrations. The saved-plan restart test now also compares findings alongside the golden media inputs and keys, prices, choices, and answers. No tests were removed.
- `node scripts/run-tests.mjs apps/server/test/code-plan-port.test.mjs apps/server/test/code-plan-video-settings.test.mjs` completed with **38 passed, 0 failed, 0 skipped**.
- `pnpm demo:code` rebuilt all **5 workspaces** and exited **1** before its first plan submission. The checked-in WIP guidance at `461f2a8c` hashes to `34f5cf727d5818d6222d950516f7526a7ee0834db1cc55b13969c788a6dd3e57`. The released guidance pin is `dbb6dade117658792552343f37ae3b87b2b458cb2cbea6717207935b4600c646`. The Director returned `SKILL_PACKAGE_MISMATCH`. The H8 integration tests exercise the real `submit_plan` handler in the offline demo fixture with an already-bound test catalog, independently of guidance activation.

## Contract and review

`packages/core/src/studio-api.ts` and tool contract **0.3.0** keep their existing shapes. The catalog digest remains `830b7b794eb63417421e8bcd9fbd1a86d7664d2180bb23f0164535b724ef3e6e`. H8 requires no skill text or guidance pin update for the targeted tests.

Self-review checked shape precedence, legacy findings, content identity for bare and wrapped rows, transitive grouping, and the shared execution path. `git diff --check` passed. Checks used temporary data directories and offline fixture providers. The lead owns the skill release, web presentation, full suite, and browser verification. Rerun the stock demo once the draft guidance and pin agree.
