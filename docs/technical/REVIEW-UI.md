# Studio and review UI

The React studio presents saved production state and sends authenticated human commands. Server projections/revisions own the truth. Component state holds unsaved text, current display and pending command identity; it cannot grant media authority by itself.

## Workspace

The left resizable conversation contains scoped chat, @ project resources, concise plan/recovery widgets and inline production tools. The right **Plan / Keyframes / Assets / Film** views present the same saved Scene → Shot hierarchy. Keyframes uses a large selected-shot preview, compact inspector and scene shelves; prompt/edit/reference/regeneration shortcuts share the authenticated operations used in conversation. There is no workflow-dependent duplicate scene gallery. Assets retains owned media. Film auditions picture, accepted narration and music and exposes persisted ordering, plan timing and music placement/gain/mute.

Narration uses a compact shot-scoped script/recording/listen/accept flow, with advanced section/transcript interfaces retained for detailed review. Visual generation has two decisions per scene: create keyframes from the direction, then review exact returned frames/motion/video recipe and start video. Returned clips are available to inspect. Green completion means the current media is saved.

The compact inline Models tool in the conversation shows Director, Keyframes, Video and Narration, with transcription/accounts/local setup/existing voice identities disclosed on demand. Director choices come from the actual compatible account/runtime catalog. Director/media commands save separately; zero-impact media Save applies the exact current server preview, while actual unfinished changes receive a human impact review. Unknown responses retain their command identity for recovery.

## Browser state and safety

- Shared authenticated project SSE invalidates domain projections; hidden tabs disconnect and streaming failures use backoff/periodic refresh.
- Unsaved content and pending exact commands survive compatible projection updates; stale revisions prompt refresh/review instead of silent overwrite.
- Artifact URLs are identity/API/abort gated. An old blob must not flash under a new result's label.
- Viewport media release, indexed timeline data and bounded audio caching avoid retaining every media file.
- Long content, empty states, dialogs, keyboard controls and 390px layouts need rendered validation.

The Director divider supports drag/keyboard, persistent preferred width and container clamping; the composer resizes vertically. Chat uses safe GFM with horizontal table scrolling and no automatic external image loading. Background projection refresh retains connected content/controls and request-owned holds. The concise plan widget retains state-derived Saved / Next details and priority recovery states. [Studio Day/Night](../design/OPENSLATE-LIGHT.md) supplies the accepted Radix foundation, grayscale zones and purple-blue action tokens. Appearance/view changes preserve selection, draft and references. Dated verification belongs in [current evidence](../implementation/STATUS.md).

## Explanation of reviews

Configured credentials need no separate approval or usage allowance. Scene generation actions request work directly; the second decision reviews the exact returned keyframes and actual motion/video recipe. Videos can be inspected after return without another acceptance gate. Requested speech/transcription has no additional generation-review dialog. Audio acceptance confirms words/recording/range. A guidance upgrade is automatic compatibility maintenance before an eligible fresh turn. Name a concrete missing input or setup issue instead of asking for generic authorization.

## Source and checks

- [App](../../apps/web/src/App.tsx), [typed API](../../apps/web/src/api.ts), [project subscription](../../apps/web/src/project-subscription.ts), [resizable layout](../../apps/web/src/WorkspaceSplit.tsx), [safe Markdown](../../apps/web/src/ChatMarkdown.ts)
- [Editing](../../apps/web/src/ProjectEditor.tsx), [frame workbench](../../apps/web/src/FrameWorkspace.tsx), [reference composer](../../apps/web/src/ReferenceComposer.tsx), [scoped frame decisions](../../apps/web/src/FrameDecision.tsx), [conversation decisions](../../apps/web/src/ConversationActions.tsx), [inline fields](../../apps/web/src/InlineField.tsx), [shot audio](../../apps/web/src/ShotAudioPanel.tsx), [generation guide](../../apps/web/src/GenerationGuide.tsx), [settings](../../apps/web/src/ProjectSettings.tsx)
- Shared typography in `apps/web/src/typography.css`; scoped surface/layout styles in web CSS.
- Web model/command/playback tests plus disposable desktop/narrow-screen review. See [evidence index](../implementation/VALIDATION-EVIDENCE.md).

See the [studio guide](../design/STORYBOARD-STUDIO.md) for current human controls and [status](../implementation/STATUS.md) for accepted scope.
