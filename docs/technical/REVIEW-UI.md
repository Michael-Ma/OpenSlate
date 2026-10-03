# Studio and review UI

The React studio presents saved production state and sends authenticated human commands. Server projections/revisions own the truth. Component state holds unsaved text, current display and pending command identity; it cannot grant media authority by itself.

## Workspace

The Director conversation sits beside the treatment/scenes/shots storyboard. Shot controls support inline text, narration intent, add/delete/reorder, exact frame/motion review and selected clip preview. The lightweight Timeline auditions picture, accepted narration and music, while Assets retains uploaded/generated media. Chat **+** imports owned media.

Narration uses a compact shot-scoped script/recording/listen/accept flow, with advanced section/transcript interfaces retained for detailed review. Generation connects planning, intended operations, usage/spending, actual frame/motion review and export.

The compact header settings dialog shows Director, Keyframes, Video and Narration, with transcription/accounts/local setup/existing voice identities disclosed on demand. Director choices come from the actual compatible account/runtime catalog. Director/media commands save separately; zero-impact media Save applies the exact current server preview, while actual unfinished changes receive a human impact review. Unknown responses retain their command identity for recovery.

## Browser state and safety

- Shared authenticated project SSE invalidates domain projections; hidden tabs disconnect and streaming failures use backoff/periodic refresh.
- Unsaved content and pending exact commands survive compatible projection updates; stale revisions prompt refresh/review instead of silent overwrite.
- Artifact URLs are identity/API/abort gated. An old blob must not flash under a new result's label.
- Viewport media release, indexed timeline data and bounded audio caching avoid retaining every media file.
- Long content, empty states, dialogs, keyboard controls and 390px layouts need rendered validation.

The Director divider supports drag/keyboard, persistent preferred width and container clamping; the composer resizes vertically. Chat uses safe GFM with horizontal table scrolling and no automatic external image loading. Background projection refresh retains connected content/controls and hides Continue rows during Director execution without deleting holds. The [October 3 full/fixture checks](../implementation/OCTOBER-3-REFINEMENT-REVIEW.md) passed, with the reviewed response-order/native inventory fixes included in the final gate. A larger Change / Keep / Next plan card and app-wide minimal theme remain human choices.

## Explanation of reviews

Ordinary narration writing needs no spending authorization. A guidance upgrade is tool compatibility. Media generation needs explicit operation permission plus finite usage/spending; video also needs actual frame/motion approval. Audio acceptance confirms words/recording/range. The UI should name the concrete action and why it is waiting instead of grouping these as generic authorization.

## Source and checks

- [App](../../apps/web/src/App.tsx), [typed API](../../apps/web/src/api.ts), [project subscription](../../apps/web/src/project-subscription.ts), [resizable layout](../../apps/web/src/WorkspaceSplit.tsx), [safe Markdown](../../apps/web/src/ChatMarkdown.ts)
- [Storyboard controls](../../apps/web/src/StoryboardControls.tsx), [shot audio](../../apps/web/src/ShotAudioPanel.tsx), [generation guide](../../apps/web/src/GenerationGuide.tsx), [settings](../../apps/web/src/ProjectSettings.tsx)
- Shared typography in `apps/web/src/typography.css`; scoped surface/layout styles in web CSS.
- Web model/command/playback tests plus disposable desktop/narrow-screen review. See [evidence index](../implementation/VALIDATION-EVIDENCE.md).

See the [studio guide](../design/STORYBOARD-STUDIO.md) for current human controls and [status](../implementation/STATUS.md) for accepted scope.
