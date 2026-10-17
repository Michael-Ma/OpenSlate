# B24 — automatic review notes

## Done

- **B24-1; DC-1/DC-8/DC-11:** Diagnosed the exact LIVE-3 rejection. At `2026-10-16T23:39:38Z`, the retained native log (`$HOME/openslate-live-test-20261016c/native/7c55faa2-cbe7-4ab3-9f6a-2d908b8c5921/runtime/native-state/logs_2.sqlite`, table `logs`, row `280`) records `mcp__openslate__record_notes` with two notes using a singular `anchor.shotId`. Contract 5.0.0 permits `anchor.shotIds` (an array) and/or `anchor.sceneId`, with additional properties forbidden. Both texts were within the 600-character limit; the choices and evidence field formats were valid. The failed fields were `/notes/0/anchor` and `/notes/1/anchor`.

  Redacted structural example; all IDs, text, labels and hashes below are synthetic:

  ```js
  { notes: [
    { anchor: { shotId: "shot-0" }, kind: "observation", blocking: false,
      text: "[redacted observation]",
      seenKeyframe: { shotId: "shot-0", artifactId: "artifact-0", sha256: "a".repeat(64) },
      choices: [{ kind: "accept", label: "Keep" }, { kind: "reply" }] },
    // A second note used the same singular-anchor shape for its own shot.
  ] }
  ```

  `packages/core/src/tools.ts:parseToolArguments` returned `VALIDATION_ERROR`, previously with `Tool arguments do not match the registered schema`. Crucially, `packages/director/src/tools/bridge.ts:ToolBridge.call` ran this validator before HTTP. There was no server rejection response: this precise old message is established by deterministic redacted replay and source, not a separately captured server response. The retained application database confirms a completed review with only two successful `read_context` calls, no `record_notes` invocation and no saved notes. Read-only permissions and exact-frame authorization were never reached. The frozen V6 `references/notes.md` described anchoring to shot IDs but provided no anchor-object example.

- **B24-2; DC-1/DC-8/DC-11:** Kept the frozen 5.0.0 schema, catalog descriptors, handler identities, digests and V6 skill packages unchanged. Added mutable application guidance with exact anchors, typed choices, limits, scoped valid example, evidence requirements and same-turn correction instructions. Known V5 `record_notes` calls now cross the existing authenticated loopback bridge as bounded canonical JSON, and the authoritative server validator records a failed tool receipt for invalid arguments. Other tools and versions retain local validation. Invalid data is never normalized into authority or executed.

  Refusals now return bounded field paths and actionable constraints, such as `/notes/0/anchor must include sceneId or shotIds (an array of shot IDs)`. Diagnostics omit supplied values, note prose and arbitrary unknown property names. Domain scope, choice and exact-frame refusals also identify the failed field and a correction. A corrected call uses a fresh call identity in the same epoch; reuse for different arguments conflicts. Failed-call replays remain idempotent and cannot displace a newer successful result.

- **B24-3; WA-10:** Added application-owned `notesSaveFailure` on turn views, with only an error code and stable reason. Ended automatic reviews show a plain English/Chinese line beside their last reply, or on its own when no reply exists, independently of the Director's prose. Known refusals say some notes were not saved, which also covers partial batch success. Unknown outcomes say the application could not confirm whether notes were saved. A corrected save clears a known refusal; a later success cannot hide another call's unresolved outcome. Exact committed-receipt reconciliation clears confirmed uncertainty without resubmitting.

- **B24-4:** Added tests before implementing the initial behavior: core diagnostics, bridge forwarding, fake-runtime review and person-facing feedback all reproduced failures first. Extended coverage for request scope, exact evidence, domain refusal paths, atomic batches, legacy receipts, replay and uncertain-outcome reconciliation. The automatic fake review crosses the real loopback HTTP bridge, corrects the invalid anchor in the same read-only turn and saves two notes without editing the film or starting more media.

## Files

Changed (14):

- `packages/core/src/tools.ts`
- `packages/core/src/studio-api.ts`
- `packages/director/src/tools/bridge.ts`
- `packages/director/test/tools.test.mjs`
- `apps/server/src/application/director-notes.ts`
- `apps/server/src/application/director-turn-view.ts`
- `apps/server/src/application/tool-invocations.ts`
- `apps/server/src/application/film-planning-guidance.ts`
- `apps/server/test/director-notes.test.mjs`
- `apps/server/test/keyframe-review.test.mjs`
- `apps/web/src/next/model/types.ts`
- `apps/web/src/next/model/director.ts`
- `apps/web/src/next/director/Thread.tsx`
- `apps/web/src/next/i18n/catalog/director.ts`

Added (3):

- `packages/core/test/record-notes-validation.test.mjs`
- `apps/web/test/next/review-notes.test.mjs`
- `docs/ai/uiux-plan/codex/reports/B24-review-notes.md`

Deleted: none. `STATUS.md`, frozen skill/catalog packages, CSS, `CheckBanner.tsx` and `KeyframesView.tsx` were not edited. The supplied B24 card and LIVE-3 evidence were already present and were not changed.

## Tests

Added **24** tests: core validation 7, Director bridge 3, server notes 6, automatic review 2, web feedback 6. No existing test was rewritten, deleted, skipped or disabled. Existing fixture plumbing now exposes its disposable Fastify app for the loopback integration test.

Tests-first evidence: the new core diagnostics initially failed 4/6; the structured-reason follow-up failed 1/7; the selected bridge cases failed 2/2; automatic-review regressions failed 2/2; person-facing tests failed 5/5; the domain-refusal case and the mixed uncertain/success case also reproduced before their fixes. One new legacy-fixture test initially attempted to mutate an immutable completed receipt; its fixture was corrected to insert a historical receipt directly, with no production immutability change.

Final checks, pinned Node **24.15.0**, pnpm **10.33.0**, FFmpeg/ffprobe **8.1.1**:

- `pnpm setup:test-media`: passed using matching installed tools, no download.
- `pnpm check:toolchain`: passed, including required encoders.
- `pnpm build`: passed for all five packages/apps; Vite reports its existing large-chunk advisory.
- `node scripts/run-tests.mjs packages/core/test/record-notes-validation.test.mjs packages/director/test/tools.test.mjs apps/server/test/director-notes.test.mjs apps/server/test/keyframe-review.test.mjs apps/web/test/next/review-notes.test.mjs`: **75 passed**, 0 failed/cancelled/skipped/todo.
- `node scripts/run-tests.mjs apps/web/test/*.test.mjs apps/web/test/next/*.test.mjs`: **814 passed**, 0 failed/cancelled/skipped/todo.
- `pnpm test`: **3,322 passed**, 0 failed/cancelled/todo, **1 optional native-probe skip** (3,323 total).
- `pnpm -r typecheck`: **5 package/app typechecks passed**, 0 failed.

Logs: `/private/tmp/openslate-b24-build.log`, `/private/tmp/openslate-b24-touched.log`, `/private/tmp/openslate-b24-web.log`, `/private/tmp/openslate-b24-full.log`, `/private/tmp/openslate-b24-typecheck.log`.

Independent review found and resolved one issue: a later successful batch could hide an earlier unresolved note call. Its failing regression now passes. The final source review found no remaining must-fix issue.

## Contract changes

`packages/core/src/studio-api.ts` adds the browser-safe `ReviewNotesFailure` type, `{code, reason}`. The additive snapshot turn field `notesSaveFailure` uses it; the web's `TurnView` accepts an omitted field for compatibility. Reasons are `invalid_anchor`, `invalid_arguments`, `outside_scope`, `unseen_keyframe`, `missing_keep_choice`, `unavailable` and `unknown`.

No note, choice, resolution-route or frozen tool-contract shape changed. No schema migration or new entity kind was required; failed invocations use the existing durable tool receipts.

## Commits

Proposed atomic commit; the lead owns commits:

1. `fix(director): persist review notes with actionable failure feedback`
   - `packages/core/src/tools.ts`
   - `packages/core/src/studio-api.ts`
   - `packages/core/test/record-notes-validation.test.mjs`
   - `packages/director/src/tools/bridge.ts`
   - `packages/director/test/tools.test.mjs`
   - `apps/server/src/application/director-notes.ts`
   - `apps/server/src/application/tool-invocations.ts`
   - `apps/server/src/application/director-turn-view.ts`
   - `apps/server/src/application/film-planning-guidance.ts`
   - `apps/server/test/director-notes.test.mjs`
   - `apps/server/test/keyframe-review.test.mjs`
   - `apps/web/src/next/model/types.ts`
   - `apps/web/src/next/model/director.ts`
   - `apps/web/src/next/director/Thread.tsx`
   - `apps/web/src/next/i18n/catalog/director.ts`
   - `apps/web/test/next/review-notes.test.mjs`
   - `docs/ai/uiux-plan/codex/reports/B24-review-notes.md`

The failure type, durable receipts and app feedback are reviewed and verified together in this split.

## Open issues

- Browser verification and a fresh live automatic-review acceptance remain with the lead. No browser/scenario was launched or changed, no real model/provider call or external-network request was made, and no port 3001 listener was started. All runtime/media proof used disposable state, fake transports/providers or synthetic evidence; it does not prove live-model compliance or visual quality.
- Historical bridge-local refusals have no server receipt and are not fabricated from Director prose or retroactively replayed. The retained LIVE-3 state was only read for the specifically authorized diagnosis; no private note text was copied into this worktree. Credentials, auth files, `.env*`, secrets and `.openslate` data were not read or copied.
- No frozen-package change is necessary. Mutable runtime guidance carries the exact shape and correction instructions alongside the unchanged 5.0.0 schema.
- Process exception: one read-only `git status --short` ran during the initial parallel discovery before `RULES.md` finished loading. No later Git command, Git mutation, commit, stash, checkout, reset or push occurred.
