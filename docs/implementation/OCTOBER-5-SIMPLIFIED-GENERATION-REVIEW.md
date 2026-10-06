# October 5: simplified generation

The accepted flow uses configured keys/Codex installation without an API-key approval, usage allowance or project-cap gate. Two human generation decisions remain: generate a scene’s keyframes, then approve its actual video recipe after seeing the returned conditioning frames. Speech and transcription execute explicit requests; listening, attachment and timing acceptance remain separate.

## Result

- Scene green checks publish the exact reviewed work directly. There is no intermediate permission, frame-approval or spending dialog.
- Completed Director writing with a planning hold leads to scene generation rather than another Resume. Actual interrupted work, uncertain jobs and Stop keep their own recovery states.
- Requested narration/transcription works through the UI, authenticated HTTP and current native Director guidance. Saved shot scripts materialize automatically within the original shot/scene/project scope.
- Current V5 guidance uses the unchanged V4 JSON tool schema. Fresh native turns upgrade shipped predecessors; old packages, epoch bindings and receipts retain their original identities.

Scene composition runs in an isolated worker before any state mutation. One transaction checks revision/control/hold and work freshness, narrows a whole-film hold to the other scenes, installs the requested candidates, publishes the full scoped plan and, for video, binds the exact frame/motion/model/settings/duration decision. Image changes leave dependent video without a candidate until a separate video check. Known failed work needs a new explicit scene request; same-command replay returns its original receipt. Unknown submissions retain their original job identity.

Configured-provider admission retains the original capability lock, complete profile definition, candidate/grant and reservation proof. The same proof is validated during dispatch, persistence and backup/recovery. Historical allowance receipts remain readable; they do not impose a new user-facing gate. Estimates remain audit information.

Audio requests capture actor, inputs, command identity and cancellation once. Their immutable hold cutoff permits only evidenced earlier picture-planning holds; new/re-activated scoped pauses, Stop and changed audio intent still block dispatch. Earlier holds remain in place for pictures and export. Generic narration mutation cannot acquire the mapped shot authority used by the dedicated host path.

Removed retired spending/permission screens and the unused generation-step model. Inspection is read-only; scene controls own visual approval. The shared Radix success action uses the existing dark green semantic token with white text. Current README, setup template, design/API/workflow docs and live walkthrough describe this flow. Direct camera/framing/purpose edits update an authoritative current-direction header while preserving original prompt prose. Duration and motion edits retain their unchanged keyframes.

## Review and verification

Independent review identified and repaired stale conditioning-frame masking of an edited image prompt, cross-scene/audio coupling to deferred video, mismatched preview durations/models/settings, loss of publication identity across retries, incomplete configured-provider backup proof, mutable audio inputs and overly broad audio hold exceptions. Negative controls and after-fix probes were retained outside the repository.

- Full `pnpm check`: **2,304 passed, zero failures, one optional native probe skipped**; builds and typechecks passed.
- Offline restart/edit demo: **4 initial + 2 edited accepts, zero duplicate creates**; unchanged shot preserved.
- Actual production-bundle browser flow: one scene action created three fixture keyframes; one later action queued three fixture videos. Pending actions disabled, all displayed frames/motion visible, completed media truthful, and completed planning offered no Resume.
- Desktop and 390px layout checked. Actual React speech/transcription buttons sent one request each without a session-start, generation approval or allowance step. Returned-content acceptance remained separate.
- Dedicated audio runtime regressions: **25 passed**. Independent persistence checks: **30 passed**. Three private before/after review probes passed.

All automated media/network transports were synthetic or injected. No real provider generation or model calls were made during this change; credentials were not copied into fixtures. This verifies implementation and recovery behavior, not real-provider quality or complete native conversation-to-film acceptance. The existing live project was retained.
