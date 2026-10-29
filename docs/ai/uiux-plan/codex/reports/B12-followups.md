# B12 server follow-ups

Implemented October 15, 2026 in `cx/b12`. Source remains uncommitted for lead review, as required by `codex/RULES.md`. No web source, browser contract, shipped migration, tool catalog or skill package changed.

## Done

1. **This computer (SB-22/SB-23):** authenticated, no-store `GET /api/installation/status` implements the existing `InstallationStatus`. It works before any film exists. Local, bounded version-only probes inspect the selected Codex executable and the server's actual media tools. Missing, malformed and failed tool results become unavailable/null; raw stdout, errors, native homes and paths never enter the response. The route remains readable during installation recovery quarantine. Real-provider configuration is projected from the installed catalog's enabled host routes and configured credential/native-access presence.
2. **Director setup (SB-23):** `GET /api/projects/:projectId/director/setup` adds `codexVersion`, inspecting the selected native executable (or the host default for a demo project). A detected version mismatch is reported honestly, without setup, selection changes or a model turn.
3. **Personal voices (SB-24):** voice lists retain full selector `id` and immutable `identityId`, add `providerVoiceId`, `consentGrantedAt`, and `consentRevokedAt` when revoked. Existing consent/readiness enforcement remains.
4. **Taken-off slots (GR-10/GR-13):** overview slots expose the binding's stopped/released reason while no candidate is bound. Continue and late historical completion retain that reason; a new press clears its projection. Released attempts no longer appear as live no-answer jobs. Their immutable receipts, polling and money accounting remain unchanged.
5. **Stopped exports (SB-16):** storyboard exports can prepare, run and publish locally while stopped. Dependency holds, actor ownership, revision checks, frozen targets, cancellation and recovery still apply. Paid generation still returns `EXECUTION_PAUSED`; exporting does not resume the film or create media grants/attempts.
6. **Atomic shot edits (SB-1/SB-8/SB-9/SB-10):** `kind: "shotFields"` accepts `{id, fields, expectedHeadVersion}` at the existing storyboard route. The supported fields are imagePrompt, motion, desiredFrames (integer frames), videoPrompt, framing, purpose and action. All fields validate and save as one alongside command with one head-version increment and one media-restoring Undo. Empty/unsupported/invalid fields, stale versions and durations below accepted within-shot narration refuse without partial changes. Media invalidation is the union of the existing single-field rules; video-only edits preserve frames. Human field fences and request-owned transient holds use the existing command transaction.
7. **Keyframe voice defaults (SB-5/SB-24):** existing capture of the project narrator default at the human press is retained and tested across default changes/restart. Pinned ready personal voices override the default. A pinned personal identity whose consent is revoked cannot silently fall back to stock narration; revocation after capture also prevents speech purchase.

## Files

Added:
- `apps/server/src/installation-status.ts`
- `apps/server/test/installation-status.test.mjs`
- `docs/ai/uiux-plan/codex/reports/B12-followups.md`

Changed:
- `apps/server/src/app.ts`
- `apps/server/src/index.ts`
- `apps/server/src/application/local-director.ts`
- `apps/server/src/application/recovery-routes.ts`
- `apps/server/src/generation-overview.ts`
- `apps/server/src/media/application.ts`
- `apps/server/src/media/local-media.ts`
- `apps/server/src/narration/personal-voices.ts`
- `apps/server/src/scene-narration-view.ts`
- `apps/server/src/storyboard.ts`
- `apps/server/test/personal-voice-http.test.mjs`
- `apps/server/test/scene-confirmations.test.mjs`
- `apps/server/test/stop-release.test.mjs`
- `apps/server/test/storyboard-export.test.mjs`
- `apps/server/test/storyboard.test.mjs`
- `apps/server/test/takes-undo.test.mjs`
- `docs/implementation/STATUS.md`

Deleted: none.

## Tests

Added 13 cases: three installation/setup HTTP cases; two stopped/released overview HTTP cases; one stopped-export HTTP case; three compound-edit cases; one compound media-restoring Undo HTTP case; and three personal-voice cases. Extended the existing consent HTTP case to assert full IDs and both dates. Retained the existing narrator-default/restart test.

Rewrote the old storyboard-export fence test to remove its obsolete assertion that pause refuses storyboard export. Its holds, revision, foreign-ID and freeze/publication assertions remain. No tests were deleted. Existing money/idempotency/unknown-outcome/stale-write tests remain.

Final required gates (Node 24.15.0, pnpm 10.33.0, FFmpeg/ffprobe 8.1.1):

- `pnpm setup:test-media` and `pnpm check:toolchain`: passed, existing matching local tools; no download.
- `pnpm build`: passed, all five packages built.
- `node scripts/run-tests.mjs apps/server/test/installation-status.test.mjs apps/server/test/personal-voice-http.test.mjs apps/server/test/stop-release.test.mjs apps/server/test/storyboard-export.test.mjs apps/server/test/storyboard.test.mjs apps/server/test/takes-undo.test.mjs apps/server/test/scene-confirmations.test.mjs`: **103 passed, zero failed/skipped/todo**.
- `pnpm test`: **2,970 total: 2,961 passed, seven failed, one optional native-probe skip, one existing todo**. All failures are in the unchanged frontend files listed below; none is a B12 backend test.
- `pnpm -r typecheck`: **all five packages passed, zero failures** (core, providers, director, server, web).
- `git diff --check`: passed.

The seven unchanged frontend failures reproduce independently with `node scripts/run-tests.mjs apps/web/test/next/plan-fixture.test.mjs apps/web/test/next/settings-catalog.test.mjs apps/web/test/next/start-commands.test.mjs apps/web/test/next/start-new.test.mjs`: **57 total: 49 passed, seven failed, one existing todo**. These tests import frontend TypeScript and fixtures directly, without the B12 server. `git diff --exit-code HEAD -- apps/web packages/core/src/studio-api.ts` passed with no changes. No assertions were weakened or skipped.

Exact failing tests:

1. `apps/web/test/next/plan-fixture.test.mjs:228` — “unknown kinds are refused; kinds other views own go on to the next storyboard route”: fixture soundtrack route throws `NOT_FOUND`.
2. `apps/web/test/next/settings-catalog.test.mjs:15` — “no message id is defined in two catalog files (the catalog spreads them, so a copy silently wins or loses)”: eight duplicate error IDs across existing catalogs.
3. `apps/web/test/next/start-commands.test.mjs:83` — “a new film from a written plan: created, Codex Director set up, plan sent; it opens in the studio”: pending action is `create` instead of null.
4. `apps/web/test/next/start-commands.test.mjs:137` — “without Codex the Director step stops with CODEX_NOT_FOUND, final and without a toast; the empty outline never asks”: fixture reports `found` instead of `not_found`.
5. `apps/web/test/next/start-commands.test.mjs:150` — “a real first run cannot read Codex before a film exists; the new film’s Director step finds out”: expected fixture rejection is absent.
6. `apps/web/test/next/start-commands.test.mjs:250` — “in the refusals sample the models change once under the sheet: Create is refused, the next one with the new list works”: fixture catalog digest remains unchanged.
7. `apps/web/test/next/start-new.test.mjs:117` — “prices never read $0.00: Codex images use the plan, an unset estimate says so”: formatter returns `$0.0005` while the assertion expects `$0.001`.

The existing todo at `start-commands.test.mjs:303` concerns library-level press keys with no film open. It is distinct from the seven failures.

## Contract changes

None to `packages/core/src/studio-api.ts`. Additive existing-route response fields are listed above. No DDL.

## Proposed commits

- `feat(server): expose safe installation and voice setup status`
  - `apps/server/src/installation-status.ts`, `apps/server/src/app.ts`, `apps/server/src/index.ts`, `apps/server/src/application/local-director.ts`, `apps/server/src/application/recovery-routes.ts`, `apps/server/src/media/local-media.ts`, `apps/server/src/narration/personal-voices.ts`, `apps/server/test/installation-status.test.mjs`, `apps/server/test/personal-voice-http.test.mjs`.
- `fix(server): report detached slots and allow stopped local exports`
  - `apps/server/src/generation-overview.ts`, `apps/server/src/media/application.ts`, `apps/server/test/stop-release.test.mjs`, `apps/server/test/storyboard-export.test.mjs`.
- `feat(server): apply compound shot edits with media-restoring undo`
  - `apps/server/src/storyboard.ts`, `apps/server/test/storyboard.test.mjs`, `apps/server/test/takes-undo.test.mjs`.
- `fix(server): require ready pinned personal narration voices`
  - `apps/server/src/scene-narration-view.ts`, `apps/server/test/scene-confirmations.test.mjs`.
- `docs: record B12 follow-up scope and verification`
  - `docs/implementation/STATUS.md`, this report.

## Open issues and decisions

- All seven B12 items and their targeted checks are complete. The full repository gate is blocked by the seven independently reproduced, unchanged frontend failures above. `RULES.md` and this card forbid edits under `apps/web`; the lead must fix those failures. The lead also owns integration/commit/merge; nothing has been staged, committed or pushed.
- `signedIn` is deliberately null: these reads only run local version commands and do not inspect credential files or start an account/model session. The exact pinned runtime version comes from the existing Director constant. `found` identifies a recognized Codex executable; an incompatible detected version is still returned alongside the pin, and existing native setup continues to reject incompatible versions.
- `providersConfigured` describes host-enabled provider configuration plus credential/native-access presence, independently of tool readiness. It is not an entitlement, network authentication, quota or model-quality check. Tool availability is reported separately.
- For compound edits, explicitly supplied prompts win over prompts derived from purpose/action/framing/motion. Missing prompts are derived once from the complete final direction, so field ordering does not change the result. Duration values use numeric frames, matching the card and existing shot timing domain.
- Only storyboard exports bypass the stopped check; the classic plan render surface keeps its existing pause behavior. Dependency holds and request/target integrity checks are retained for both.
- All new validation is offline with disposable stores, synthetic consent/credentials, stub executables and fake media transports. No real provider/model call, personal credential read, external network request, production-state read/write/restart or port 3001 listener occurred. No browser rendering or real-provider acceptance claim is made.
