# OpenSlate Light design system

Selected October 4, 2026. The user chose **A · Light workspace** from the OpenSlate direction comparison and approved Radix Themes as its component foundation. This is the current visual direction for the React studio.

## Purpose and structure

The studio helps one person develop a film through conversation, edit its storyboard and inspect media before authorizing execution. White surfaces keep the Director and controls readable; the pale gray canvas separates those surfaces from the creative work. Blue identifies primary actions and selection. Color does not imply that a generation grant, spending allowance or exact frame review exists.

The workspace keeps a resizable Director on the left, with the selected shot prominent and supporting shots available alongside it. Model settings organize choices by the job they perform. Small screens provide explicit workspace/Director navigation and stack controls rather than compressing the desktop arrangement.

## Foundation and source of truth

- `apps/web/src/main.tsx` mounts the light Radix `Theme` with blue/slate colors, medium radius and 100% scaling.
- `apps/web/src/light-theme.css` owns shared semantic tokens, component states and secondary surfaces. `main.tsx` first imports all legacy component CSS, then typography, Radix CSS, the shared light theme and workspace layout; it imports `App` afterward so nested duplicate CSS imports cannot reorder that first encounter. Radix portals inherit the same tokens.
- `apps/web/src/workspace-light.css` owns workspace layout and loads last.
- `apps/web/src/ui.tsx` owns standard actions, fields, selects and controlled modal layout. `components.tsx` owns reusable icons, guidance and media inspection.

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
| `--focus` | `#557bd5` | Keyboard focus |
| `--success` / `--success-bg` | `#366c51` / `#eaf4ed` | Completed/accepted states |
| `--warning` / `--warning-bg` | `#825b27` / `#fbf1e2` | Recovery and unresolved decisions |
| `--danger` / `--danger-bg` | `#a43a37` / `#fff1f0` | Errors and destructive actions |

`--slate-*` aliases map to the same roles for workspace components. Legacy `--paper`, `--pale`, `--green`, `--text` and `--border` aliases preserve older component integration. Radix accent/gray roles map to these colors; avoid a new literal palette per component. Decorative `--line` is not the required control boundary: use `--control` when a boundary identifies an input.

## Typography, shape and spacing

The available UI font is `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`; no font download is required. Body text is 14px, compact actions are 13px and captions are 12px. Headings use 26px/22px/18px/16px roles, with moderate 600–650 weight and short line lengths. Shot text stays readable body copy; status metadata stays compact.

Use a 4px spacing rhythm, typically 8–12px between related controls and 20–24px within major panels. Standard controls use 7px corners; cards/dialogs use 10–12px. Shadows are restrained and primarily identify overlays. Media uses `object-fit: contain` so review shows the actual frame without cropping.

## Component contract

| Component | Contract |
|---|---|
| `UiButton` | Native button event/form props; defaults to `type="button"`. Use `variant="primary"` for the next principal action, `secondary` for normal actions, `ghost` for low-emphasis actions and `danger` for destructive actions. Set `type="submit"` explicitly. Existing `button primary` and `text-button` classes remain supported. |
| `UiTextField` / `UiTextArea` | Radix textual fields with native input/textarea refs and change events. TextField supports textual/numeric input types; use specialized controls for checkboxes, ranges, files and media playback. |
| `UiSelect` | Controlled `value`, `onValueChange(value)` and `options: { value, label, disabled? }[]`. Its forwarded ref points to the trigger button. An empty option is internally encoded and returned as `""`; named forms preserve the real field value. Do not fabricate `ChangeEvent`s. |
| `IconButton` | Radix icon action with a required accessible label and native disabled/click behavior. |
| `HelpTip` | Radix tooltip for supplementary guidance, available through hover, focus or tap. Essential instructions remain visible in the product. |
| `AppDialog` | Controlled `open`/`onOpenChange`, semantic title, optional description, header supplement, scrolling body and optional footer. `preventClose` blocks Escape/outside dismissal while an operation needs protection; `closeDisabled` disables the close action. Focus returns to the launcher, including nested modal flows. |
| `Lightbox` | Exact image, direction, motion and planned duration. An optional approval action is provided by the parent only when the current application review permits it; the modal also requires its own exact image to load successfully. Read-only callers cannot approve media. |

Use text and semantics alongside color for selected, reviewed, pending, error and disabled states. A disabled control remains visible with an explanation when necessary. Keyboard focus uses a consistent blue outline. Loading feedback keeps saved content stable. Reduced-motion preferences suppress decorative animation and transitions.

## Behavior boundaries and verification

The design migration preserves OpenSlate's separate durable commands for Director choices, media choices, generation grants, usage allowances, frame/motion approval and unknown-outcome recovery. A shared dialog or a new visual state cannot bypass those commands or turn an uncertain submission into a retry. Narration writing remains an ordinary creative edit.

Review desktop and narrow layouts, keyboard focus/return, nested selects/dialogs, long model labels, disabled controls, unknown commands and actual frame approval against current saved state. Typechecking/building validates integration; rendered browser checks validate layout and interaction. Current results belong in the dated implementation evidence, not in assumptions attached to a visual token set.
