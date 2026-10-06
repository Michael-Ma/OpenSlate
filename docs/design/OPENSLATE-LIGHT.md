# OpenSlate Light design system

Selected October 4, 2026. The user chose **A · Light workspace** from the OpenSlate direction comparison and approved Radix Themes as its component foundation. This is the current visual direction for the React studio.

## Purpose and structure

The studio helps one person develop a film through conversation, edit its storyboard and generate/review media per scene. White surfaces keep the Director and controls readable; the pale gray canvas separates those surfaces from the creative work. Blue identifies primary actions and selection. Green scene actions request keyframes or video; a completion check means the current media is saved rather than that its artistic quality was accepted.

The workspace keeps a resizable Director on the left. Conversation, generation decisions, editing, model choices, imports, narration and export controls belong there. The right side is a persistent project result view: Project → Scene → Shot, with each shot’s direction, prompts, keyframe, video and narration state together. A workflow transition updates those same shot cards; it never adds a second scene review gallery. Viewing controls, media playback and navigation remain in the result pane. Model settings organize choices by the job they perform. Small screens provide explicit workspace/Director navigation and stack controls rather than compressing the desktop arrangement.

## Foundation and source of truth

- `apps/web/src/main.tsx` mounts the light Radix `Theme` with blue/slate colors, medium radius and 100% scaling.
- `apps/web/src/light-theme.css` owns shared semantic tokens, component states, dialogs and secondary surfaces. Radix portals inherit the same tokens.
- `apps/web/src/director-plan.css` owns the compact current-plan card. `project-results.css` owns the canonical project/scene/shot result hierarchy; `conversation-actions.css` and `conversation-workspace.css` own the left operation cards and inline tools.
- `apps/web/src/workspace-light.css` owns the shell, navigation, Director, split boundary and production viewport. Component presentation belongs in its component sheet rather than an appended workspace patch.
- `main.tsx` is the production CSS entry point: retained legacy skins/layouts → typography → Radix → shared Light theme → current Director/film components → workspace layout → `App`. Register a new component sheet there at the appropriate layer. Component-local duplicate imports support isolated previews; production first encounters each sheet in the explicit entry-point order.
- `apps/web/src/ui.tsx` owns standard actions, fields, selects and controlled modal and inline conversation-tool layout. `components.tsx` owns reusable icons, guidance and media inspection.

Use those sources for new screens. Existing component CSS remains where it supplies domain layout; shared colors and basic controls should use the central system. Radix Themes supplies components and interaction behavior; OpenSlate supplies its layout, product language and durable commands.

## Semantic color roles

| Token | Value | Use |
|---|---|---|
| `--canvas` | `#eef1f4` | Workspace background |
| `--surface` | `#ffffff` | Panels, cards, fields and dialogs |
| `--soft` | `#f6f8fa` | Subtle sections and hover surfaces |
| `--ink` | `#1b2638` | Primary text |
| `--muted` | `#5c6981` | Secondary text and metadata |
| `--line` | `#d9e0e8` | Decorative separation |
| `--control` | `#8191aa` | Field and selectable-control boundaries |
| `--accent` | `#315cb2` | Primary actions and selected text |
| `--accent-hover` | `#274e9e` | Primary action hover |
| `--selected` | `#eaf0fb` | Selected surfaces |
| `--selected-border` | `#b5c8eb` | Selected secondary-surface boundary |
| `--focus` | `#557bd5` | Keyboard focus |
| `--success` / `--success-bg` | `#366c51` / `#eaf4ed` | Completed/accepted states |
| `--warning` / `--warning-bg` | `#825b27` / `#fbf1e2` | Recovery and unresolved decisions |
| `--danger` / `--danger-bg` | `#a43a37` / `#fff1f0` | Errors and destructive actions |
| `--media-bg` / `--preview-bg` | `#e5eaf0` / `#dfe5ec` | Storyboard frame and timeline picture surfaces |

Every current component uses the shared semantic names directly. Legacy `--paper`, `--pale`, `--green`, `--text` and `--border` aliases preserve older component integration. Radix accent/gray roles map to these colors; avoid a new literal palette per component. Decorative `--line` is not the required control boundary: use `--control` when a boundary identifies an input.

## Typography, shape and spacing

The available UI font is `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`; no font download is required. Body text is 14px, compact actions are 13px and captions are 12px. Headings use 26px/22px/18px/16px roles, with moderate 600–650 weight and short line lengths. Shot text stays readable body copy; status metadata stays compact.

Use a 4px spacing rhythm, typically 8–12px between related controls and 20–24px within major panels. Shape and control sizing use the shared tokens below; component overrides retain established compact storyboard actions. Shadows use `--shadow-card`, `--shadow-panel` and `--shadow-dialog`. Media uses `object-fit: contain` so review shows the actual frame without cropping.

| Shape/size token | Value | Use |
|---|---|---|
| `--radius-compact` | 6px | Small actions and navigation items |
| `--radius-control` | 7px | Standard buttons and fields |
| `--radius-inset` | 8px | Embedded plan/navigation surfaces |
| `--radius-card` | 9px | Shot cards and composer |
| `--radius-panel` | 10px | Generation/empty panels and narrow dialogs |
| `--radius-dialog` | 12px | Standard dialogs |
| `--control-height` / `--field-height` | 34px / 36px | Standard actions and selectors |
| `--touch-height` | 40px | Narrow-layout standard controls |

Keep normal and responsive declarations together within the component's sheet. The remaining storyboard `!important` overrides are compatibility with specific retained native rules; do not use them to resolve ordinary new-component styling. Remove a legacy sheet only after proving its selectors have no live component use.

## Component contract

| Component | Contract |
|---|---|
| `UiButton` | Native button event/form props; defaults to `type="button"`. Use `variant="primary"` for the next principal action, `secondary` for normal actions, `ghost` for low-emphasis actions and `danger` for destructive actions. Set `type="submit"` explicitly. Existing `button primary` and `text-button` classes remain supported. |
| `UiTextField` / `UiTextArea` | Radix textual fields with native input/textarea refs and change events. TextField supports textual/numeric input types; use specialized controls for checkboxes, ranges, files and media playback. |
| `UiSelect` | Controlled `value`, `onValueChange(value)` and `options: { value, label, disabled? }[]`. Its forwarded ref points to the trigger button. An empty option is internally encoded and returned as `""`; named forms preserve the real field value. Do not fabricate `ChangeEvent`s. |
| `IconButton` | Radix icon action with a required accessible label and native disabled/click behavior. |
| `HelpTip` | Radix tooltip for supplementary guidance, available through hover, focus or tap. Essential instructions remain visible in the product. |
| `AppDialog` | Controlled `open`/`onOpenChange`, semantic title, optional description, header supplement, scrolling body and optional footer. `preventClose` blocks Escape/outside dismissal while an operation needs protection; `closeDisabled` disables the close action. Inside `ConversationSurface`, the same component renders an inline labelled region in the left conversation. Protected saves also block project switching; focus returns to the launcher on close. Image inspection remains a modal viewing surface. |
| `Lightbox` | Exact image, direction, motion and planned duration. An optional approval action is provided by the parent only when the current application review permits it; the modal also requires its own exact image to load successfully. Read-only callers cannot approve media. |

Use text and semantics alongside color for selected, reviewed, pending, error and disabled states. A disabled control remains visible with an explanation when necessary. Keyboard focus uses a consistent blue outline. Loading feedback keeps saved content stable. Reduced-motion preferences suppress decorative animation and transitions.

## Behavior boundaries and verification

Director choices, media choices, scoped scene generation, exact frame/motion/video-recipe review and unknown-outcome recovery use durable application commands. Each scene has two generation decisions: create keyframes from its direction, then review the returned frames and actual video recipe before starting video. Returned clips are available to inspect without an additional acceptance gate. Configured provider keys/runtime enable requested generation without a separate approval or usage-allowance screen. Requested speech/transcription proceeds through the configured provider; listening, attachment and transcript adoption remain content decisions. A new visual state cannot turn an uncertain submission into a retry. Narration writing remains an ordinary creative edit.

Scene generation cards contain text recipes and links to the right scene, without duplicate images. Video generation is enabled only after the exact current keyframes have loaded in the active result pane. On a phone, already displayed exact frames remain eligible when returning to the Director; hidden initial loads, changed identities and failed loads never qualify.

Review desktop and narrow layouts, keyboard focus/return, nested selects/dialogs, long model labels, disabled controls, unknown commands and actual frame approval against current saved state. Typechecking/building validates integration; rendered browser checks validate layout and interaction. Current results belong in the dated implementation evidence, not in assumptions attached to a visual token set.

The [post-migration review](../implementation/OCTOBER-5-POST-MIGRATION-REVIEW.md) records current-job evidence, explicit scope recovery, the consolidated inspection path and rendered parity checks.

The [conversation/results review](../implementation/OCTOBER-5-CONVERSATION-RESULTS-REVIEW.md) records the current two-pane architecture and final verification.
