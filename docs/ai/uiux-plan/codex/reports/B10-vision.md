# B10 — keyframe vision, automatic reviews and Last Ferry

Worktree: `cx/b10`. Backend/script component only; no web changes, shared catalog edits, DDL, commits or pushes.

## Done

- **D4 / DC-7:** `KeyframeProjector` extends the existing immutable reference projector. Native scene/shot turns select exact current, unambiguous image bindings from the active plan, checking image intent, prompt, ownership, source hash and managed storage. User references occupy the first slots. Up to four available slots receive individual JPEGs; overflow receives one row-major FFmpeg `tile` contact sheet. Individual frames start at 768 px. Sheets stay below 4096 px on either axis and 16 million pixels; quality and resolution shrink to respect the **combined** 512 KiB/four-image native budget. Source images are processed one at a time rather than retaining a scene of full-size image buffers.
- `request_keyframe_projection` freezes shot/node/candidate/artifact/source hash/thumbnail hash/tile, omissions and attachment identities for the exact request/epoch. Turn-start context and subsequent context reads expose those pins, explicitly stating that later results are invisible. Replays verify the frozen thumbnails without selecting newer frames. Fixture/SVG, unsupported, absent, outdated or ambiguous frames never enter image input. Missing/unusable FFmpeg produces explicit omissions. Scripted turns also record that images were not inspected.
- **DC-7 / DC-10:** `record_notes.seenKeyframe` must match the exact request/epoch projection. A context claim or another request's receipt is insufficient. Existing hash-based note staleness remains intact, including replacement with identical bytes.
- **DC-8:** image presses persist exact node/candidate batch pins. Pure terminal/eligibility functions plus the controller's existing executor tick create one durable application request and queued review per batch digest, atomically. The default-on setting, global Stop, queued/running Director work and pending questions gate admission. Unknown submissions and remaining automatic retries are not terminal. Review scope covers the scene's current shots. Requests are `source: app`, `editing: false`, hold-free and absent from user conversation.
- Review tools are restricted to context/skill reads, notes and held proposals. Questions, edits, pauses and media suggestions/dispatch cannot be initiated by these reviews. Generation and confirmation busy checks ignore review turns; the generation overview still exposes that the Director is working, without presenting it as a generation blocker. A new user message, including discuss-only, supersedes the review. Its batch marker prevents another automatic dispatch after completion, failure, interruption or restart.
- **DC-13:** the scripted runtime reviews scene- or shot-scoped batches through the ordinary tool invocation service, creating honest nonvisual note (a), blocking closing-shot note (b), and a held six-to-eight-second proposal with proposal/Keep/edit choices. `/demo` accepts an explicit scene-scoped `review` action. Existing two-shot demonstration actions remain available.
- **DC-16:** snapshot `turns` exposes state, runtime, action, timestamps, safe last-tool progress, a terminal reason and effects (`notesCreated`, `proposalsHeld`, `changesApplied`). Reasons distinguish no reply, failed, timeout, superseded, interrupted, owner lost and unknown. Changes include confirmed tool reconciliation receipts. No tool arguments or native diagnostics enter this projection.
- **DC-17:** question answers retain question id, zero-based option index, canonical stored label and optional free text. Unknown/mismatched options and duplicate/foreign questions are refused. Structured answers survive keyed replay and appear in the next Director context. Existing free-text answers remain supported; HTTP structured replies may omit the top-level text.
- **DC-14 / DC-15 / card addition 6:** conversation entries carry the persisted event's ISO `at`; user entries retain scene/shot `scopeIds`, omitted for whole-film requests. Assistant `runtime` comes from the output's saved turn, so switching the current runtime cannot relabel history. Entry fields match the web's existing `ConversationEntry` shape.
- **Card addition 7:** authenticated `GET/POST /api/projects/:projectId/settings/director-review` returns `{ enabled }`. POST requires the specified body, head version and Idempotency-Key; it creates no request, hold or epoch revocation.

## D4 evidence: pinned Codex image protocol

An initial PATH check found 0.162.1; the ChatGPT-bundled executable reported 0.162.0-alpha.17.2. Neither was treated as evidence about the pin. A locally archived executable was then found and checked:

```text
/Users/michael/Documents/Codex/2026-09-07/wo-x/work/openslate-pinned-codex/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex --version
=> codex-cli 0.153.4

<same executable> app-server generate-json-schema --out /tmp/b10-pinned-schema
=> exit 0
```

The pinned `v2/TurnStartParams.json` defines `UserInput` variants `image` with required `type,url` and `localImage` with required `type,path`. It also defines function-output `input_image` content. This settles schema-level turn-start image acceptance; the existing native adapter already sends frozen data URLs through this input.

`v2/ThreadReadResponse.json` defines `McpToolCallResult.content` as an array with unconstrained items. This establishes that image-shaped results fit the protocol, **not** that MCP image bytes reach the model. End-to-end MCP forwarding remains unverified; no `view_keyframe` tool or reliance on MCP images was added.

SHA-256 evidence:

| Artifact | SHA-256 |
|---|---|
| Pinned executable | `b973d440acac501fd2594a43e7ca9ce41e0a65b9dfb28d0d7a7837c99e1261e3` |
| `v2/TurnStartParams.json` | `a3835e8c1e942e4b358e1a670939b89918b16c4d13105a579899892b7ade6dea` |
| `v2/ThreadReadResponse.json` | `a76583d07f6096fee33045da2dc9caed84d858f8f2d39b37bb38528dbaf32511` |

**Actual native model turns: zero. Actual media-provider calls: zero.** Version/schema generation did not start a native Director turn. The selected turn-start approach needs no MCP-image experiment.

## Last Ferry starting state

Run after building:

```sh
node scripts/storyboard-review.mjs --fixtures --film last-ferry
```

A disposable studio starts on loopback port 5173 (or a supplied `--port`; 3001 is refused). The eight rows were copied into `scripts/fixtures/last-ferry.json` from the specified web fixture. The server script never imports web code. There are three titled scenes and 48 planned seconds:

- Scene 1: three saved fixture clips and opened current keyframes; the 1.2 line measures 2.1 seconds.
- Scene 2: three returned fixture frames; only 2.1 is opened; 2.3 has a measured 7.4-second recording against six seconds of picture. Two scripted notes and an eight-second held proposal are open; accepting the proposal produces 50 planned seconds.
- Scene 3: two shots, no admitted keyframe/video work. The 3.2 line remains text-only.

The actual CLI was launched successfully on disposable loopback port **3187** and stopped afterward. Backend integration checks verify the seed's overview, timing, opened flags, notes, proposal preview and source labels. No visual/browser acceptance is claimed by this backend card.

## Files

Modified:

- `apps/server/src/app.ts`
- `apps/server/src/application/context-projection.ts`
- `apps/server/src/application/director-images.ts`
- `apps/server/src/application/director-notes.ts`
- `apps/server/src/application/director-supervisor.ts`
- `apps/server/src/application/fake-director.ts`
- `apps/server/src/application/local-director.ts`
- `apps/server/src/application/service.ts`
- `apps/server/src/application/tool-invocations.ts`
- `apps/server/src/generation-overview.ts`
- `apps/server/src/scene-generation.ts`
- `apps/server/test/director-images.test.mjs`
- `apps/server/test/director-notes.test.mjs`
- `apps/server/test/director-supervisor.test.mjs`
- `scripts/storyboard-review.mjs`
- `docs/implementation/STATUS.md`

Added:

- `apps/server/src/application/keyframe-projector.ts`
- `apps/server/src/application/keyframe-review.ts`
- `apps/server/src/application/director-turn-view.ts`
- `apps/server/test/keyframe-review.test.mjs`
- `scripts/fixtures/last-ferry.json`
- `scripts/fixtures/last-ferry.mjs`
- `docs/ai/uiux-plan/codex/reports/B10-vision.md`

Deleted: none. No dependencies or generated/binary/database files are included.

## Tests and checks

Pinned Node **24.15.0**, pnpm **10.33.0**, FFmpeg/ffprobe **8.1.1**. Both `pnpm setup:test-media` and `pnpm check:toolchain` passed.

New tests cover individual/sheet/reference-priority budgets, runtime JPEG acceptance, noisy-sheet shrinking, frozen replay, scope/intent/fixture/SVG omission, cancellation/tool failure, exact seen-frame refusal, terminal/unknown/retry decisions, once-per-batch restart behavior, settings and busy gating, actual fake notes/proposal acceptance, review tool restrictions, user supersession, generation and confirmation during review, historical presses, structured HTTP/domain answers, saved runtime/timestamps/scopes, and no-reply/failed/timeout/superseded/owner-loss endings. The existing note-staleness test's future-placeholder context evidence was rewritten to use the real projection receipt. No tests were deleted or integrity assertions relaxed.

Final required order and results:

| Check | Result |
|---|---|
| `pnpm build` | All five package builds passed |
| `node scripts/run-tests.mjs apps/server/test/director-images.test.mjs apps/server/test/director-supervisor.test.mjs apps/server/test/director-notes.test.mjs apps/server/test/keyframe-review.test.mjs` | **66 passed, 0 failed, 0 skipped** |
| `pnpm test` | **2,721 passed, 0 failed, 1 optional native-probe skip (2,722 total)** |
| `pnpm -r typecheck` | **All five packages passed, 0 failures** |
| `git diff --check` | Passed |

There are **24 added tests**, one rewritten existing projection-evidence fixture test, and no deleted tests. Final reporting tests also verify that a native message with an unknown phase still counts as a reply and that repeated application of one idempotent receipt counts as one change. Image-tool tests refuse disguised SVG input with a pinned PNG/JPEG demuxer and local-file-only protocols.

All media were disposable fake fixtures or locally normalized synthetic audio/images. No live provider/model call, external network request, production-state read/write, production restart, credential read, port 3001 listener, database migration or web edit was performed.

## Contract changes

`packages/core/src/studio-api.ts`: **none**. Existing conversation shape is filled in; snapshot `turns`, structured message answer inputs, the review setting routes and `/demo review` are additive server surfaces documented above. V1–V5 tool descriptors/digests and historical skill packages remain unchanged.

## Commits

No commits were created: `RULES.md` reserves staging/commits/merges for the lead. Proposed conventional split (shared files need hunk-level staging):

1. `feat(director): project frozen current keyframes into scoped turns` — `director-images.ts`, new `keyframe-projector.ts`, `director-notes.ts`, `context-projection.ts`, projection portions of `local-director.ts`, `director-images.test.mjs`, `director-notes.test.mjs`.
2. `feat(director): review completed batches and expose honest thread state` — new `keyframe-review.ts`, new `director-turn-view.ts`, `director-supervisor.ts`, `service.ts`, `tool-invocations.ts`, `generation-overview.ts`, `scene-generation.ts`, remaining `local-director.ts`, `app.ts`, `fake-director.ts`, `director-supervisor.test.mjs`, new `keyframe-review.test.mjs`.
3. `feat(demo): seed the Last Ferry review state` — `scripts/storyboard-review.mjs`, new `scripts/fixtures/last-ferry.{json,mjs}`, this report and `docs/implementation/STATUS.md`.

## Open issues

- **Decision:** D4 is satisfied through the exact pinned executable's generated schema, without using the optional native-turn allowance. Actual visual interpretation quality and MCP image forwarding are unverified. This component uses only the supported turn-start path.
- **Decision:** existing presses without persisted node/candidate pins and installation-imported presses do not initiate retrospective automatic reviews. Reconstructing their batch identity would risk a surprise model call. New presses record the required evidence.
- **Decision:** explicit user references have absolute priority. Four references leave no image slot; keyframes are explicitly described as omitted. When overflow shares one sheet, its tile order follows storyboard order. Further resolution reduction is preferred to exceeding the total byte budget.
- **Decision:** the Last Ferry seed uses silent, normalized **supplied synthetic WAVs**, labelled as uploaded recordings, for the two measured lines. It does not fabricate AI speech-generation provenance. The Scene 1 clips are explicit saved fake fixture records; 2.3's recording remains unsettled. Note (a) is the requested honest nonvisual scripted observation on the scene's first shot rather than the prototype's ungrounded maroon-coat claim.
- **Decision:** the setting gates admission of future automatic reviews; turning it off does not cancel a turn already admitted. Explicit human `/demo review` actions remain available with the automatic toggle off.
- **Decision:** terminal reasons and safe progress/effects are exposed as snapshot `turns` for the lead's thread renderer; this card does not edit web rendering. Model/provider visual acceptance and UI integration remain separate from the offline backend gate.
