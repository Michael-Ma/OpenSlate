# OpenSlate Studio design system — Day & Night

Current direction: October 7, 2026. The supplied Frame Studio Day/Night artifact is the implementation target. This document remains the existing design source of truth; the earlier Light-only presentation is historical.

## References and product structure

- Exact layout/interaction reference: the supplied `frame-studio-day-night.zip`, `studio.html`, `DAY-NIGHT.md` and its Day/Night captures. The later Codex/Claude style variants are not part of this selected direction.
- Design brief: [the supplied conversation](https://chatgpt.com/s/cx_6ac60628b4488191846d212aaa2f527e), which describes chat collaboration, project resources, Scene/Shot hierarchy, keyframe iteration and timeline editing.
- Color/hierarchy inspiration: [Linear’s official UI redesign](https://linear.app/now/how-we-redesigned-the-linear-ui). OpenSlate’s hex values come from the supplied artifact; they are not claimed to be Linear’s official tokens.
- Production remains React/Radix with application-owned state, authenticated commands and durable generation/recovery. The prototype’s sample perfume project, simulated generation, credits and silent animatic are not production behavior.

The left resizable conversation contains chat, scoped resource references, concise plan/status widgets and inline editing/model/import/audio tools. The right has **Plan / Keyframes / Assets / Film** views. A large selected-shot preview, inspector and Scene → Shot shelves share the same saved project. Selecting a shot retains its stable ID and scopes further conversation; @ scene/shot references explicitly override preview selection. View or appearance changes do not submit work, clear drafts or change selected-shot identity.

The new brief permits direct right-side editing/reference/regeneration shortcuts, as well as chat widgets. Those shortcuts invoke the same authenticated application operations. Current work remains inspectable across views; workflow progress does not append duplicate result galleries or switch the user’s selected view automatically.

## Semantic system

| Role | Day | Night |
|---|---|---|
| Conversation | `#e8e8ee` | `#131316` |
| Workbench | `#ffffff` | `#27272f` |
| Inspector | `#f0f0f5` | `#393941` |
| Shelf | `#f5f5f8` | `#19191f` |
| Composer zone | `#dcdce5` | `#0c0c10` |
| Main text | `#191a20` | `#f2f2f5` |
| Action fill | `#5e56d8` | `#6960d5` |

Purple-blue identifies actions and selection; green identifies checked/saved results; amber identifies stale/pending/unknown work. Labels and geometry accompany color. Media viewing stays dark in both appearances and uses `object-fit: contain` so current frame review never crops the underlying artifact.

Workspace navigation uses one selected surface on the outer Radix button. Its visible label and hidden width-measurement label share spacing and remain transparent; hover and keyboard focus also belong to the button. Selection must not add an inner plaque or change tab height in either appearance or language.

`frame-theme.css` owns the palette, semantic/Radix aliases, inputs, dialogs, Markdown and states. Day auxiliary text and Night hover fills are adjusted slightly from the reference to preserve readable contrast. Root layout/components use `--zone-*`, `--ink`, `--muted`, `--line`, `--control`, `--selected`, `--action-*` and semantic status roles. Do not introduce another component palette.

Bundled **Inter Variable** renders supported glyphs; system **PingFang SC**, Microsoft YaHei and system sans provide language fallbacks. No font/network request is required. Title 22px/630, body 14px, controls 12–13px, auxiliary metadata 10–11px. Icons use one rounded outline style, 1.85 strokes, round caps/joins. Shared shapes are 7–8px controls, 10px cards, 11px composer; spacing follows a 4px rhythm.

## Interaction and authority

- Appearance changes CSS/Radix theme context in place. Valid URL `mode=day|night` overrides stored appearance; default is Day. Mode and current `view` are reflected in the URL. Storage/history failures do not disable the workbench. React components remain mounted during mode changes.
- @ offers searchable project, scene, shot, owned image/video and recording references. Keyboard arrows/Enter/Escape select/cancel; chips locate their objects. Messages contain readable local reference links with explicit scope IDs and bounded native image attachments when supported. Reference chips alone cannot submit a fresh editable request. A narrow referenced edit cannot silently resume a stopped whole project.
- Right-side keyframe checks require an actually decoded, visible current selected frame; thumbnail prefetch, old takes and hidden panes never qualify. The green check records an explicit local review for that current decision. Genuine current server review receipts can display the same checked state. Changed/removed/stale frame identities clear local proof. Scene video approval still binds exact returned frames, motion, duration, model and settings at the server.
- A scoped image request can create missing frames or explicitly regenerate selected shots. New candidates retain sibling outputs and historical artifacts; unknown/in-progress jobs are inspected rather than blindly repeated. Regenerating an owned/shared conditioner rewires the affected video and review member to the new frame and defers its video candidate.
- Plan/Prompt edits are normal human writing. Image prompt, video prompt, action, framing, purpose, motion and duration are revision checked; only the relevant visual work becomes stale. They do not dispatch media automatically.
- Timeline video drag/order buttons and Alt+Arrow persist shot order. Saved 3–15s controls edit **shot plan timing**, which may require an affected video update. Music drag/keyboard, gain and mute persist actual placement; browser audition and local render share the same source-local sample calculation. Zoom, playhead and panel sizing are viewing state. Arbitrary source trim/split, redo/version adoption and multiple independently arranged music/effect lanes remain unsupported; omit inert controls.
- Protected saves block conflicting project/creation/chat/generation mutations. Unknown responses retain their exact request body/key. Background refresh preserves same-identity connected content and reading position; new messages do not force an older conversation to the bottom.

## Interface language

English and Simplified Chinese are available from the header and startup page. Preference precedence is valid URL `lang=en|zh-CN` (the `zh` alias is accepted), saved browser preference, supported browser language, then English. Switching changes React context and `html.lang` in place; it does not key/remount the app, submit a request, edit the project or replace pending command identity.

Static copy uses explicit English/Chinese pairs, with parameter interpolation preserving inserted values. Controlled derived labels/errors use explicit exact whitelists and scoped presenters. Never apply translation to project/shot writing, native Director questions/answers, recording names, scripts, transcripts, model/provider names, IDs, hash values or command bodies. Unknown service diagnostics remain original unless they have a registered sanitized interface message. Scene/shot resource chips localize presentation around their stable identity; sent reference text remains the saved text.

Use contextual pairs for singular/plural English labels; a shared Chinese term may represent multiple English nouns and cannot resolve context by reverse lookup alone. Longer copy must wrap within its owning control/tool. Language and theme selectors remain reachable at narrow widths.

- `Locale.tsx`, `locale-model.ts`, `locale.css`: browser preference, in-place context, selector and metadata.
- `locale-ui-messages.ts`, shell/error and workbench/settings/media catalogs: registered interface copy.
- Settings/media/workbench presenters translate controlled dynamic feedback while preserving source records.

## Responsive contract and source ownership

Desktop retains a remembered/clamped Director divider, large preview, compact inspector and scrollable scene shelves. At narrow widths, explicit Conversation/Workspace navigation presents one pane at a time; inspector/actions stack without clipping, and major mobile controls target 44px. Appearance remains accessible in the header. Long metadata and prompts wrap or scroll within their owning area; reduced motion is respected.

- `Appearance.tsx`, `appearance-model.ts`, `frame-theme.css`: modes, tokens, font and shared states.
- `FrameWorkspace.tsx`, `frame-workspace-model.ts`, `frame-workspace.css`: Plan and selected-media/Scene/Shot workbench.
- `ReferenceComposer.tsx`, `reference-model.ts`, `reference-composer.css`: composer and exact project references.
- `FrameDecision.tsx`, `frame-decision-model.ts`, `ConversationActions.tsx`: actual scoped image and scene video decisions.
- `Timeline.tsx`, `timeline-editor-model.ts`, `timeline-editor.css`: synchronized preview and supported direct edits.
- `frame-shell.css`: shell, concise plan widget and final responsive integration.
- `ui.tsx`: shared Radix controls and protected inline/modal tools. `main.tsx` registers production CSS in explicit order, with the shared theme followed by current workbench/layout sheets.

Current verification belongs in the dated implementation review and status; passing model tests alone is not visual or real-provider acceptance.
