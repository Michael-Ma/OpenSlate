# B5 — structured Director notes and V6 guidance

## Done

- **DC-11:** Added contract 5.0.0 with nine tools, the new `record_notes` descriptor, `director-tools@5`, truthful pending-audio-suggestion descriptions, and one exported `SUPPORTED_TOOL_CONTRACTS` registry for support/upgrade checks. Historical 1.0.0–4.0.0 complete catalog and handler digests remain unchanged. Fresh native turns verify their predecessor and upgrade to 5.0.0/V6; bound in-flight epochs retain their original lock/catalog. Customized locks still fail with `DIRECTOR_GUIDANCE_UNSUPPORTED`.
- **V6:** Copied both V5 instruction packages into `skills/v6`, updated the manifests, added `production/references/notes.md`, and reconciled narration, audio, review, continuity, shot and plan-authoring guidance. The Director records one point per note, reads settled decisions, never judges unseen pictures, leaves paid presses to humans, and uses edit/regenerate choices for duration, narration and paid-media-invalidating changes until proposals exist.
- **DC-1:** Added exact public `DirectorNote` records, separate revision/call provenance, per-turn a…z/aa… letters, scoped anchors/choices, read-only epoch support, bounded schema validation, `director.note` events, durable effect receipts and reconciliation. Project snapshots return `notes`. A batch validates atomically before writing. `seenKeyframe` requires exact trusted attached-keyframe evidence; that projection itself remains B10 work.
- **DC-10:** Added the authenticated, keyed resolve route using `ResolveNoteInput`. Accept refuses stale notes; proposals return `PROPOSAL_UNAVAILABLE`. Edit choices require a subsequent saved human edit of the named shot/field. Regeneration choices require a subsequent human regeneration command for all named shots, with its returned request ID. Reply choices require a subsequent saved human reply. The route never starts work, edits film state, supersedes requests or revokes epochs. Notes expose derived staleness on shot-revision/keyframe-hash changes; the paged notes context carries states/resolutions and overview counts.
- **DC-9:** Open blocking notes prevent scene video generation with `RECOMMENDATION_OPEN`, including rechecks after compilation and at commit. Blocking notes must offer an accept/keep choice. B2's existing overview adds `recommendation_open`; the scene read exposes open/blocking notes and `notesDigest`. Video checks supplied note digests and always fences note changes during compilation. Keyframe generation is unaffected.
- **DC-13 (part):** A Scene-scoped scripted request emits two real tool notes: an honest observation with accept/regenerate choices and a narration recommendation with accept/edit choices. Other fake commands retain existing behavior. No visual inspection or live AI output is claimed.

## Files

Changed:
- `docs/implementation/STATUS.md`
- `apps/server/src/app.ts`
- `apps/server/src/application/application-capabilities.ts`
- `apps/server/src/application/audio-operation-context.ts`
- `apps/server/src/application/context-projection.ts`
- `apps/server/src/application/director-capabilities.ts`
- `apps/server/src/application/director-input.ts`
- `apps/server/src/application/director-tools-upgrade.ts`
- `apps/server/src/application/fake-director.ts`
- `apps/server/src/application/film-planning-guidance.ts`
- `apps/server/src/application/local-director.ts`
- `apps/server/src/application/service.ts`
- `apps/server/src/application/tool-invocations.ts`
- `apps/server/src/generation-overview.ts`
- `apps/server/src/scene-generation.ts`
- `apps/server/test/director-guidance-maintenance.test.mjs`
- `apps/server/test/director-tools-upgrade.test.mjs`
- `apps/server/test/generation-overview.test.mjs`
- `apps/server/test/narration-tools.test.mjs`
- `packages/core/src/tools.ts`
- `packages/director/test/runtime-fixture.mjs`
- `packages/director/test/tools.test.mjs`
- `skills/README.md`

Added:
- `apps/server/src/application/director-notes.ts`
- `apps/server/test/director-notes.test.mjs`
- `skills/v6/plan-authoring/SKILL.md`
- `skills/v6/plan-authoring/openslate.skill.json`
- `skills/v6/plan-authoring/references/example-context.json`
- `skills/v6/plan-authoring/references/example.md`
- `skills/v6/plan-authoring/references/grammar.md`
- `skills/v6/production/SKILL.md`
- `skills/v6/production/openslate.skill.json`
- `skills/v6/production/references/audio-proposals.md`
- `skills/v6/production/references/continuity-review.md`
- `skills/v6/production/references/current-contract.md`
- `skills/v6/production/references/narration.md`
- `skills/v6/production/references/notes.md`
- `skills/v6/production/references/stages/assembly.md`
- `skills/v6/production/references/stages/intake.md`
- `skills/v6/production/references/stages/narration.md`
- `skills/v6/production/references/stages/review.md`
- `skills/v6/production/references/stages/scene_plan.md`
- `skills/v6/production/references/stages/shot_plan.md`
- `skills/v6/production/references/stages/story.md`
- `skills/v6/production/references/stages/storyboard.md`
- `skills/v6/production/references/stages/video.md`
- `docs/ai/uiux-plan/codex/reports/B5-notes.md` (this report)

Deleted: none. No `apps/web` source, DDL, provider implementation, historical skill package or credential files changed.

## Tests

Added 13 Director-note cases covering strict bounded schemas, V6 lock verification, discuss-only writes, ordered letters and paging, call-ID replay/conflicts, scoped anchors and choices, atomic rejection, unseen-image refusal, lost-result reconciliation, snapshot/context resolution, missing command keys, stale accepts, unavailable proposals, field-edit provenance, reply provenance, real fake-provider video blocking/unblocking, stale note-digest refusal and regeneration resolution without dispatch. Added one actual V5 MCP child test and V5 immutable digest coverage. Extended complete-reference coverage to V5 and native maintenance coverage to V4 predecessors.

Rewritten expectations:
- Fresh/default guidance and tool status now expect contract 5.0.0/V6; legacy explicit V4 upgrades still work and correctly advertise a newer update.
- Upgrade validation rejects unsupported 99.0.0 instead of newly supported 5.0.0.
- The existing B2 test `Opened is durable, independent of editing and authority, resets after regenerate; stale and keyless views fail` initially failed on a pre-existing 400/409 mismatch. Its keyless assertion now expects HTTP 400, matching the existing baseline error handler's `IDEMPOTENCY_KEY_REQUIRED` mapping (confirmed in HEAD). It still asserts the rejection and all original frame/replay integrity behavior.

No test deleted and no money/integrity assertion relaxed.

Validation:
- `pnpm setup:test-media`: pinned local FFmpeg/ffprobe already match; no download.
- `pnpm check:toolchain`: Node 24.15.0, pnpm 10.33.0, FFmpeg/ffprobe 8.1.1 and required encoders pass.
- `pnpm build`: five package builds pass (existing web bundle-size advisory only).
- Targeted `node scripts/run-tests.mjs` over all six changed test files: **104 passed, 0 failed, 0 skipped**.
- Final full `pnpm test`: **2,491 passed, 0 failed, 1 optional native probe skipped; 2,492 total**.
- Final `pnpm -r typecheck`: **5 packages passed, 0 failed** (core, providers, director, server, web).
- `git diff --check`: passes.

All tests use disposable local fixtures, fake providers and loopback. No live provider/native model calls, production edits/restart, port 3001 listener, external network request or schema migration.

## Contract changes

None to `packages/core/src/studio-api.ts`; existing `DirectorNote`, `ResolveNoteInput` and overview blocker shapes are used exactly.

Additive server response fields: project snapshot `notes`; scene read `openNotes`, `blockingNotes`, `notesDigest`; scene generation receipt `requestId`. The legacy scene generate body accepts an optional `notesDigest` for refreshed-review refusal without breaking old clients. Existing in-request freshness fences and the blocking-note gate always run, even for legacy clients that omit it.

## Commits

No commits created, as required by RULES.md. Proposed conventional split (the lead should split shared-file hunks):

1. `feat(director): add immutable v5 catalog and v6 guidance` — `packages/core/src/tools.ts`, `skills/v6/**`, `skills/README.md`, server `application/{director-capabilities,director-input,director-tools-upgrade,local-director,application-capabilities,audio-operation-context,film-planning-guidance}.ts`, version-registration hunks in `app.ts`, `context-projection.ts` and `tool-invocations.ts`, and the changed guidance/upgrade/narration/MCP tests and runtime fixture.
2. `feat(server): persist and resolve scoped director notes` — new `application/director-notes.ts`, note integration hunks in `application/{service,context-projection,tool-invocations,fake-director}.ts`, `app.ts`, `scene-generation.ts`, `generation-overview.ts`, new `test/director-notes.test.mjs`, and the existing keyless-status correction in `test/generation-overview.test.mjs`.
3. `docs(ai): record B5 notes implementation and verification` — this report and `docs/implementation/STATUS.md`.

## Open issues

- **Catalog decision:** `propose_change` is omitted. B9 explicitly permits extending and refreezing the still-unreleased 5.0.0 catalog on this branch; it should do so before release. If 5.0.0 is released first, adding a descriptor requires a new version to preserve immutable catalogs. No unusable proposal tool is advertised in B5.
- **Staleness decision:** Reads derive stale state from durable revision/hash pins without writing events, incrementing note versions or altering the film. This keeps recovery/read-only inspection side-effect-free. Resolved decisions stay resolved. Restoring the exact original baseline can make an unresolved note current again.
- **Human action decision:** Resolution validates actual saved human actions after the note; action choices may resolve a now-stale note because their own edit/regeneration caused the change. Accept/reply cannot resolve stale notes. Notes themselves carry no execution authority.
- **Visual boundary:** Until B10 supplies attached-keyframe evidence, live notes cannot claim `seenKeyframe`; scripted notes are explicitly nonvisual. The hash-staleness test uses a labeled trusted projection fixture.
- **Integration boundary:** UI rendering, held proposals, alongside request unification, keyframe review turns and generation-chain orchestration remain their later cards. No B5 implementation blocker remains; all final gates pass.
