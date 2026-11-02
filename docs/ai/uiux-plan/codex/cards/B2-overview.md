# Card B2 (phase P1): one generation overview read, durable Opened, prices

Read `docs/ai/uiux-plan/codex/RULES.md` first and follow it.

## Goal
One read, `GET /api/projects/:projectId/generation`, returns `GenerationOverview` from `packages/core/src/studio-api.ts`, and the web never derives media state again. Opened is a durable record keyed by frame content.

## Items (spec = the item's Change in gap-generation.md and gap-storyboard.md)
1. **GR-1**: first extract the per-shot row computation of `sceneView` (`apps/server/src/scene-generation.ts`) into a pure function verbatim, with no behaviour change; prove it by running the existing scene-generation tests against both. Then build `apps/server/src/generation-overview.ts` from one snapshot and one `inspectReview` per event cursor, cached by cursor and invalidated on new events. A shot with several active alternatives returns `choose_take` instead of throwing for the scene. `videoTargets` and `keyframeTargets` use exactly the rule the generate command uses. `confirmationDigest` is what the existing generate/confirm path checks (reuse the existing digest).
2. **GR-2**: `POST /api/projects/:projectId/shots/:shotId/frame-views` (`FrameViewInput`, Idempotency-Key required). Store a `frame_view` entity {principal, projectId, shotId, artifactId, sha256, at}. No hold, no message, no authority. A view of a non-current artifact is 409 `FRAME_STALE`. `keyframe.opened` is true only when a view matches the current artifact.
3. **GR-5 + SB-11 (decision D15)**: a pure `quote(lock, rows, kind)` giving `PriceQuote`s from the capability lock's `unitCostMicros`: makeKeyframes, regenerateKeyframe (one image unit), confirmVideo (video units for `videoTargets` plus voice units for lines still to make), voice. Unit 0 or quota-based models give `priceUnknown: true`. The generate command accepts an optional `expectedEstimateMicros`; a mismatch is 409 `ESTIMATE_CHANGED` with no grants.
4. **GR-7**: an empty scene gives `SCENE_EMPTY`; a shot with placeholder direction gives `DIRECTION_REQUIRED {shotIds}` (store an explicit `promptState: "placeholder"` on addShot instead of string matching) and shows `direction_required` in the overview.
5. **GR-9**: `failure` on the slot (code, technical, retryAllowed, autoRetriesLeft, charged from the reservation state).
6. **GR-11**: store `binding.outdated {at, fields, previous}` when a storyboard edit detaches outputs; the overview returns `outdated` with `previous` and `outdatedFields`.
7. **GR-12**: `runReady` records a `node_wait {nodeId, code, since}` only when it changes and clears it on admit; the overview maps it to `waiting` (capacity with `ahead`, edit_pending, stopped, review, voice, timing). Fix candidatePending so a held candidate is `queued` with a reason, not `none`.
8. **GR-17 (server part)**: `phase` and `startedAt` on running slots.
9. **GR-14 (server part)**: `restartCasualties` = no_answer attempts created before the current process start.
10. Narration on each shot (`ShotNarration`): text, measured seconds of the accepted or current voice line, a text estimate (0.3 s per word, or per CJK character) when none exists, `fits` against the shot length, and `fit` if a policy was chosen. Use the existing narration views; do not add paid behaviour.
11. Scene `title`: the scenes have no title yet (card B6 adds one later); use the scene purpose's first sentence until then, behind one helper so it is easy to swap.
12. `stopped`, `director`, `controlAuthorityId`: derive from the existing control state and director turns; card B4 will extend stop. `director.scopeIds` comes from the active turn or pending question scope.

## Out of scope
Changing generate/confirm semantics beyond `expectedEstimateMicros`, `SCENE_EMPTY` and `DIRECTION_REQUIRED`. Stop/give-up (B4). Request source and keys (B1). Anything in apps/web.

## Tests (at least)
- The pure row function equals the old sceneView rows on every fixture in scene-generation.test.mjs, scene-review-concurrency.test.mjs and scene-undercoverage.test.mjs.
- Overview on a 3-scene film: none / keyframes back / video saved; the scene states and counts; a two-alternatives shot returns choose_take without a 409.
- Frame views: opened survives an unrelated edit and turns false after a regenerate; a stale artifact gives FRAME_STALE.
- quote(): fake lock, Codex zero price, mixed narration; ESTIMATE_CHANGED with no grants.
- SCENE_EMPTY, DIRECTION_REQUIRED, failure fields (technical retry then failed charged; refused not charged), outdated with previous and fields, waiting reasons (capacity with ahead, held, stopped).
- The overview is cached per cursor (two reads at the same cursor build once).
