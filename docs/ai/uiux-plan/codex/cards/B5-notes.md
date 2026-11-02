# Card B5 (phase P4, part 1): tool contract 5.0.0, V6 guidance and structured Director notes

Read `docs/ai/uiux-plan/codex/RULES.md` first and follow it.

## Goal
The Director can leave lettered, shot-anchored notes with typed choices instead of prose only. Notes are records the app shows and a person resolves. This card is the contract, the guidance and the notes; held proposals come in a later card.

## Items (spec = the item's Change in docs/ai/uiux-plan/gap-agent.md)
1. **DC-11**: tool contract 5.0.0 = 4.0.0 plus `record_notes` (and reserve `propose_change` in the catalog only if adding it later would change the 5.0.0 digest; otherwise leave it for the next card and say which you chose). One exported `SUPPORTED_TOOL_CONTRACTS` constant replaces the scattered version lists (about 30 hard-coded "4.0.0" sites). Fresh turns upgrade 4.0.0/V5 to 5.0.0/V6; in-flight 4.0.0 epochs keep their catalog. Never change the 1.0.0 to 4.0.0 descriptors (their digests are frozen). Truthful audio tool descriptions in 5.0.0 (they suggest; a person presses, per card B1).
2. **V6 guidance** in `skills/v6/production/` (copy V5, then change): when to record a note, ask a question, propose or apply directly (decision D1: changes that outdate paid media or change duration or narration become held proposals once they exist; until then, record a note with an `edit_field` or `regenerate_keyframe` choice instead of applying); one point per note; never judge a picture you were not shown; never re-raise a settled note; paid choices are always pressed by a person.
3. **DC-1**: `record_notes` writes `director_note` records exactly as `DirectorNote` in `packages/core/src/studio-api.ts` (letters assigned by the app per turn), emits an event, works in discuss-only (read_only) epochs, validates anchors exist and are inside the request scope, and has a reconcileEpoch branch. The project snapshot (GET /api/projects/:projectId) returns `notes`.
4. **DC-10**: `POST /api/projects/:projectId/director/notes/:noteId/resolve` with `ResolveNoteInput` and an Idempotency-Key. accept resolves; regenerate_keyframe and edit_field resolve with the `resultRef` of the person's own press or edit (this route never starts paid work); proposal choices return `PROPOSAL_UNAVAILABLE` until the proposals card lands. Notes turn `stale` by themselves when the anchored shot's revision or the seen keyframe's sha changes. The Director context gets a `notes` section with states and resolutions.
5. **DC-9**: open blocking notes anchored in a scene block that scene's video generate (`RECOMMENDATION_OPEN`) and appear in the overview as a scene blocker `recommendation_open` once card B2's overview exists (if `apps/server/src/generation-overview.ts` is not in your tree, expose a small exported function `openBlockingNotes(store, projectId, sceneId)` and note it in your report).
6. **DC-13 (part)**: the scripted (fake) Director emits two notes for a Scene-scoped request (one observation with accept and regenerate_keyframe choices, one recommendation with an edit_field narration choice), so demos show the design. Keep existing fake-director behaviour for other requests.

## Out of scope
Held proposals, Now/After previews, accept/reject/undo of proposals, alongside requests (next card). Keyframe projection and review turns (later card). Anything in apps/web.

## Tests (at least)
- Core: record_notes schema accepts and rejects; the 5.0.0 catalog digest is frozen; 1.0.0 to 4.0.0 digests unchanged.
- Upgrade: a fresh turn moves 4.0.0/V5 to 5.0.0/V6 while an in-flight 4.0.0 epoch keeps its catalog; customised locks still raise DIRECTOR_GUIDANCE_UNSUPPORTED.
- Notes allowed in a read_only epoch; an out-of-scope anchor is refused with SCOPE_DENIED; letters in order; idempotent call-id replay; reconcileEpoch confirms the effect; snapshot lists notes.
- Resolve: idempotent; accept on a stale note is refused; proposal choice gives PROPOSAL_UNAVAILABLE; the context notes section shows the resolution.
- A blocking open note blocks the scene's video generate; resolving it unblocks.
- V6 skill lock verification passes for the new manifest.
