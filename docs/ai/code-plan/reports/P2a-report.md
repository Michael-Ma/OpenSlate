# P2a report — code-plan Director

## Done

Implemented the P2a card's changes 1–10 within the assigned worktree.

1. **Catalog:** independent stable contract `0.1.0`, handler `code-plan-tools@1`, and exactly `read_film` / `submit_plan`. Graph catalogs, descriptor bytes, shipped release pins and version lists are unchanged. Code mode is excluded from ordered graph comparisons. Source is bounded to 256 KiB UTF-8 and summary to 500 characters; based-on versions are integers or null.
2. **Instructions:** schema 1 `code-plan@1.0.0` package, pinned by `CODE_PLAN_GUIDANCE_DIGEST`, with every ctx method, awaited effects, variants, stable choices, exact prompt bytes, returned-diff interpretation and no secrets/paths. `studio.d.ts` and the two-shot example cover three variants per shot, frame choices, video fallback and render. The loader accepts bounded, non-executable TypeScript references as inert text.
3. **Selection/input:** code projects receive the code view/current source and exact verified instruction references, with persisted context/activation/read provenance. They skip graph projections and shipped-release upgrades. Fake/native selection changes preserve the code package and bind the selected runtime.
4. **Handlers/recovery:** submission uses author `director` and the durable tool invocation ID. Known refusals retain their diff on replay and HTTP transport; stale versions are delegated to the port. Lost results re-call only the explicitly idempotent port with the same ID and original arguments. Immutable unresolved transport receipts are preserved; the recovered result is stored in `tool_reconciliation`. A service-scoped host port registration covers tools constructed without options.
5. **Wiring:** `AppOptions.codePlans`, local controller, tool route and startup wiring added. The startup cast is temporary as explicitly allowed by the card, pending P2b.
6. **Holds:** queuing a code request opens its persistent request-ID hold. Completion, waiting for a user, Stop/interruption, failure, timeout and owner loss release it once. Periodic reconciliation closes saved terminal holds after restart; another queued request keeps its own hold.
7. **Repair:** poll current Director-authored failures, queue application-sourced repair turns with version/error/stack, persist a limit of two repair requests per failed version, then post one plain ask-the-person message. Stopped projects, active turns, pending Director questions and user-authored failures do not start repairs.
8. **Effort:** retained `low`; rationale below. No native runtime permissions or setup profiles changed.
9. **Fake Director:** submits the exact example delivered from the verified immutable package and reports the actual returned version/diff.
10. **Docs:** updated Director runtime, skills/tools and implementation status.

Self-review checked callers, graph isolation, persistence rules, asynchronous recovery, failure boundaries and file ownership. It corrected missing epoch-reference metadata, replaced an attempted rewrite of an immutable unresolved receipt with separate reconciliation evidence, retained error diffs through the tool route, added context/read provenance, and prevented repair turns while a Director question is pending. The focused regression gate passes after those corrections.

## Files

Changed:

- `packages/core/src/tools.ts`
- `packages/director/src/skills/index.ts`
- `packages/director/test/runtime-fixture.mjs`
- `packages/director/test/runtime.test.mjs`
- `packages/director/test/skills.test.mjs`
- `apps/server/src/application/director-capabilities.ts`
- `apps/server/src/application/director-input.ts`
- `apps/server/src/application/director-supervisor.ts`
- `apps/server/src/application/director-tools-upgrade.ts`
- `apps/server/src/application/fake-director.ts`
- `apps/server/src/application/local-director.ts`
- `apps/server/src/application/tool-invocations.ts`
- `apps/server/src/app.ts` (host port field/registration, queue hold, tool-route pass-through/refusal only)
- `apps/server/src/index.ts` (wiring only)
- `docs/technical/DIRECTOR-RUNTIME.md`
- `docs/technical/SKILLS-TOOLS.md`
- `docs/implementation/STATUS.md`

Added:

- `apps/server/src/code-plan/director.ts`
- `apps/server/test/code-plan-director.test.mjs`
- `skills/code-plan/SKILL.md`
- `skills/code-plan/openslate.skill.json`
- `skills/code-plan/references/studio.d.ts`
- `skills/code-plan/references/example-plan.ts`
- `docs/ai/code-plan/reports/P2a-report.md`

Deleted: none. No web, lead-owned contract, P2b runtime, P3a route, schema/DDL, shipped guidance, package dependency or lockfile changes.

## Tests

**21 tests added:** 19 code-Director tests, one native-protocol test and one inert-TypeScript-reference test. No existing tests rewritten, deleted, disabled or skipped. The native protocol fixture gained code-catalog discovery and bounded profile metadata; existing graph scenarios remain.

- Pinned setup/preflight passed: Node **24.15.0**, pnpm **10.33.0**, FFmpeg/ffprobe **8.1.1**. `pnpm setup:test-media` needed no download.
- `pnpm build`: passed.
- `node scripts/run-tests.mjs apps/server/test/code-plan-director.test.mjs packages/director/test/runtime.test.mjs packages/director/test/skills.test.mjs`: **106 passed, 0 failed, 0 cancelled, 0 skipped, 0 todo**.
- `pnpm exec tsc --strict --noEmit --target ES2022 --module ESNext --skipLibCheck --types node skills/code-plan/references/studio.d.ts skills/code-plan/references/example-plan.ts`: passed.
- `pnpm test`: **4,644 passed, 0 failed, 0 cancelled, 1 optional native-probe skip, 0 todo (4,645 total)**; exit 0. All **four** shipped-release checks passed.
- `pnpm -r typecheck`: **5/5 workspace typechecks passed** (core, providers, director, server, web); exit 0.
- `git diff --check`: passed. All **67** local documentation links resolved; ownership and whitespace checks passed for all **24** changed/added files (including new files).

The full suite was restarted once after self-review changes so the final result covers one consistent build. Earlier focused failures were corrected before the final focused gate. No native Codex/model invocation, real-provider call, non-loopback network request, browser launch/check, protected production-state access, port-3001 listener or commit occurred. Native tests use Node protocol fixtures; the plan example runs only in the existing isolated sandbox with deterministic fake ctx responses.

## Contract changes

**None.** `packages/core/src/studio-api.ts` and `apps/server/src/code-plan/port.ts` are unchanged. The independent internal tool catalog/type widening is described above.

## Commits

No commits made under the hard card rule. Proposed conventional-commit split:

1. `feat(director): add isolated code-plan catalog and pinned guidance`
   - `packages/core/src/tools.ts`
   - `packages/director/src/skills/index.ts`
   - `packages/director/test/runtime-fixture.mjs`
   - `packages/director/test/runtime.test.mjs`
   - `packages/director/test/skills.test.mjs`
   - `skills/code-plan/**`
   - `apps/server/src/application/director-capabilities.ts`
2. `feat(server): connect code-plan Director turns and recovery`
   - `apps/server/src/code-plan/director.ts`
   - `apps/server/src/application/director-input.ts`
   - `apps/server/src/application/director-supervisor.ts`
   - `apps/server/src/application/director-tools-upgrade.ts`
   - `apps/server/src/application/fake-director.ts`
   - `apps/server/src/application/local-director.ts`
   - `apps/server/src/application/tool-invocations.ts`
   - `apps/server/src/app.ts`
   - `apps/server/src/index.ts`
   - `apps/server/test/code-plan-director.test.mjs`
3. `docs(director): document code-plan Director scope and verification`
   - `docs/technical/DIRECTOR-RUNTIME.md`
   - `docs/technical/SKILLS-TOOLS.md`
   - `docs/implementation/STATUS.md`
   - `docs/ai/code-plan/reports/P2a-report.md`

## Open issues

- **P2b integration is required before startup can serve actual code projects.** This checkout still has P1's `CodePlanRuntime`, not the completed `CodePlanPort` implementation. The card-authorized startup cast remains at the two wiring sites. Remove it and run the integrated loop after merging P2b; P3a owns creation/HTTP routes. All P2a behavior is tested against the lead-owned port via a fake.
- **Reasoning remains `low`.** Native turn effort and launch config are hard-coded low in `packages/director/src/runtime/codex.ts`; setup's model capability filter and checked policy also require low in `runtime/setup.ts`. A correct medium mode requires a separately checked native setup/profile and model-capability selection, plus matching configuration identity/readiness and runtime tests. Overriding the turn alone would disagree with setup/policy. Graph profiles and locks remain unchanged.
- Speech and render remain at P1's declared capability level (`NOT_IMPLEMENTED` speech, fixture render). Instructions state this explicitly. No real-provider, real-model or browser acceptance is claimed.
