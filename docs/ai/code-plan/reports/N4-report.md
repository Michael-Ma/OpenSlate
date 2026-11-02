# N4 implementation report

Date: 2026-10-30. Worktree: `codex-n4-shots`; branch: `codex/n4-shots`. Offline implementation; no commit or push.

## Done

- **N4.1 / NEXT 7 — shot links:** image/video/speech media inputs accept `shot` (1–120 characters), stripped before identity, pricing and provider arguments. Live passes update the reached step's separate `shotId`; previews do not write. Adding, changing and removing the annotation keeps existing keys, attempts, results, receipts and accounting. The shared view/read_film projection links legacy `<shot>-keyframe` choice images by exact artifact identity and clips by first-frame content. Explicit metadata wins; ambiguous shared-frame fallbacks stay unlinked.
- **N4.2 / NEXT 6 — posters:** successful clip ingestion and local rendering attempt frame-zero derivation through the existing bounded local worker and validated PNG store. The exact owned clip hash, artifact-root containment, file-only media protocols, dimensions, PNG probe/decode, immutable image publication and project ownership are checked. Posters live in separate JSON associations, outside paid steps/attempts and immutable media results. Failures leave media succeeded. Worker contention, shutdown and quarantine defer publication; other failures are durable so a broken historical clip cannot monopolize backfill. Backfill attempts at most one historical clip per runtime tick across all code films.
- **N4.3 / NEXT 4 — initial limit:** create accepts optional integer-string `ceilingMicros` only for code films (`CODE_PLAN_MODE` for graph films). Creation persists the setting in the same transaction as the project. The existing authenticated/idempotent ceiling route and `setCeiling` work before any plan; the view stays empty and the first preview/run uses the saved value. The omitted default stays $1. Later setting/run updates are atomic and retain the charged/unknown/in-flight floor.
- **N4.4 / NEXT 5 — film list:** code films expose `planMode: "code"` and `needsAttention`; the count matches the browser's reached failed-or-unknown-with-error rule. Only run/step rows are read for this projection, without replay or attempt/receipt lookups. Graph fields are unchanged.
- **N4.5 — guidance:** media API declarations, current guidance and all shot-owned example calls include `shot`; guidance explains free annotation edits, posters and the stored pre-plan ceiling. Updated the exact package digest pin.
- **N4.6–7 — tests/docs:** added 15 offline regression tests, preserved the P2c end-to-end flow and existing integrity tests, and updated execution documentation and status.

## Files

Changed:

- `apps/server/src/code-plan/{execution,identity,index,records,view}.ts`
- `apps/server/src/app.ts` — project-create body schema/forwarding only.
- `apps/server/src/application/service.ts` — optional create limit validation and atomic JSON setting.
- `apps/server/src/project-library.ts` — code-film list fields only.
- `apps/server/src/media/local-media.ts` — narrow bounded local poster method; the private snapshot helper accepts the explicitly owned artifact root for this operation.
- `apps/server/src/application/director-capabilities.ts` — guidance digest pin only.
- `skills/code-plan/{SKILL.md,references/studio.d.ts,references/example-plan.ts}`
- `docs/technical/EXECUTION-ENGINE.md`
- `docs/implementation/STATUS.md`

Added:

- `apps/server/src/code-plan/posters.ts` — independent poster ownership/publication and failure isolation.
- `apps/server/src/code-plan/projection.ts` — pure fallback shot links and attention count.
- `apps/server/src/code-plan/settings.ts` — stored/run/default ceiling lookup.
- `apps/server/test/code-plan-shots-posters-limit.test.mjs`
- `docs/ai/code-plan/reports/N4-report.md`

Deleted: none. No web, browser contract, port interface, provider, dependency, schema, database or generated output change.

## Tests

**15 tests added; none rewritten, deleted, disabled or newly skipped.** Coverage includes annotation bounds and identity for all three available media kinds, paid-result/receipt reuse across metadata edits, dry-run immutability, read_film linkage, legacy frame/clip fallback and ambiguity, exact first-frame pixels and dimensions for clips/renders, owned authenticated poster content, restart, failure isolation, failed historical clips, one-per-tick backfill across films, contention deferral, hash/path refusal, create-limit validation/idempotency/admission, pre-plan limit restart and cheap reached-only list counts.

| Command | Observed result |
|---|---|
| `pnpm setup:test-media` | Passed; installed pinned media matched, no download |
| `pnpm check:toolchain` | Passed: Node 24.15.0, pnpm 10.33.0, FFmpeg/ffprobe 8.1.1 and required encoders |
| `pnpm build` | All five workspace builds passed |
| Focused command below | **177 passed, zero failed/skipped/cancelled/todo**; 61.919 s |
| `pnpm test` | **4,768 passed / one failed / one optional skip; 4,770 total**, zero cancelled/todo; 1,105.458 s |
| `pnpm -r typecheck` | **5/5 workspace typechecks passed**, zero TypeScript errors |
| Strict standalone example typecheck | Passed with ES2022/ESNext, `--strict --skipLibCheck --noEmit` and the supplied Studio declarations |
| Guidance digest and ownership checks | Passed; current package equals the digest pin; no web/browser-contract/port diff |
| `git diff --check` | Passed |
| Isolated startup failure reproduction | `node scripts/run-tests.mjs apps/server/test/media-execution-runtime.test.mjs`: **19 passed / one failed / 20 total**, zero skipped/cancelled/todo; 15.796 s. Details under Open issues. |

Exact focused command:

```text
node scripts/run-tests.mjs apps/server/test/code-plan-shots-posters-limit.test.mjs apps/server/test/code-plan-e2e.test.mjs apps/server/test/code-plan-director.test.mjs apps/server/test/code-plan-runtime.test.mjs apps/server/test/code-plan-port.test.mjs apps/server/test/code-plan-providers.test.mjs apps/server/test/code-plan-execution.test.mjs apps/server/test/code-plan-retry.test.mjs apps/server/test/code-plan-routes.test.mjs apps/server/test/project-library.test.mjs
```

The one full-suite failure is **“explicit routes and credential presence do not call networks or create generation authority at construction”**, at `apps/server/test/media-execution-runtime.test.mjs:139` (assertion at line 144). It expects the startup options object without the existing N2 video-profile list. Both the test and composition source are unchanged from HEAD; N4's focused gates and the P2c end-to-end flow pass. The skipped test is the optional native Codex probe; no native model turn was run. Existing Vite mixed-import/chunk-size notices remain build warnings.

Logs: `/tmp/n4-{build,touched-final,full-test,typecheck,runtime-baseline-check}.log`. Preliminary new-test failures were corrected as described in self-review. An earlier full run was intentionally stopped to fix the legacy fallback bound; it is not final acceptance evidence. An extra tail-test diagnostic was stopped after the final full run completed. The completed full run above uses the final source. Generated fixture databases/images/video remain temporary; no generated artifact is included in the diff.

## Contract changes

`packages/core/src/studio-api.ts`: none. `apps/server/src/code-plan/port.ts`: none. Existing optional `shotId`, `poster`, `planMode` and `needsAttention` fields are now populated. The create route gains optional `ceilingMicros`; `ProductionService.createProject` gains the corresponding optional fourth argument. Two new JSON entity kinds (`code_plan_settings`, `code_plan_poster`) require no DDL or schema version change.

Current code-plan guidance digest: `7216de9798f99c343f506e42460c536039b974f2db8ce8c0dca80bf441d8c33a`. Archived `code-plan-v1` is unchanged.

## Commits

No commits created under the hard rule. Proposed lead-owned split:

1. `feat(server): add code film shot links posters and initial limits` — `apps/server/src/code-plan/{execution,identity,index,posters,projection,records,settings,view}.ts`; `apps/server/src/{app,project-library}.ts`; `apps/server/src/application/service.ts`; `apps/server/src/media/local-media.ts`; `apps/server/test/code-plan-shots-posters-limit.test.mjs`.
2. `docs(code-plan): teach shot annotations and record N4 verification` — `skills/code-plan/{SKILL.md,references/studio.d.ts,references/example-plan.ts}`; `apps/server/src/application/director-capabilities.ts`; `docs/technical/EXECUTION-ENGINE.md`; `docs/implementation/STATUS.md`; `docs/ai/code-plan/reports/N4-report.md`.

## Open issues

- **Existing startup test failure:** `apps/server/test/media-execution-runtime.test.mjs:139`, “explicit routes and credential presence do not call networks or create generation authority at construction,” expects a startup options object that omits N2's existing `newCodeProjectVideoProfiles: [configured-video]`. The isolated runtime suite reproduces it (**19 passed / one failed / 20 total**). Both that test and `apps/server/src/application/media-execution-runtime.ts` are byte-identical to HEAD; the field is added by the unchanged composition at lines 243–247. No N4 poster operation or project creation is involved before the assertion. The lead should align the expected object with N2's ready-video profile pinning; this unrelated test/source is left unchanged.
- The lead owns browser/UI verification and integration. No browser launch/check or live-provider acceptance is claimed. No protected configuration/state was read; no external network or port-3001 listener was used.
- N3 music has not merged into this worktree and is explicitly out of scope. Its media call should use the same shot metadata stripping/projection and `ShotMediaInput` when integrated; recompute the guidance digest after combining both cards. No music runtime/provider was added here.
- Shared first-frame bytes used by multiple legacy shot choices are ambiguous after content normalization; the fallback leaves such clips unlinked. Adding an explicit `shot` resolves this without buying media.
- Missing local tools leave posters absent. Non-transient poster failures are recorded and skipped by later backfill; no automatic endless retries or extra failure gate is introduced. The existing image/input limits bound derivation, so an oversized or unavailable old clip may remain without a poster.
- This backend stores the per-film limit provided at creation; the lead's new-film Settings UI supplies its preferred default. No additional installation-wide preference API was required by the card.

Self-review inspected the complete tracked/new-file diff, identity and provider-input callers, metadata replay/fencing, fallback ambiguity, poster source ownership/hash/path/dimension bounds, publication and backfill, settings creation/restart/preview, list query boundaries, guidance pin and tests. It corrected settings/run ceiling publication to use one transaction and removed an unnecessary 120-character restriction on legacy choice-derived shot names (the new annotation remains bounded). A regression covers legacy names within the existing choice-ID bound. The final source review found no remaining actionable issue within the N4 diff; the separate baseline failure is recorded above. Preliminary new-test failures came from fixture assumptions (macOS realpath aliases, immutable-artifact refusal, a helper that rejects intentional budget pauses, and newest-first project ordering); these assertions were corrected without weakening application integrity checks. No old tests were changed or relaxed.
