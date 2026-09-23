# Precision UI rebuild

September 23, 2026. Production React interface rebuilt from the approved Precision minimal iteration. The white/blue, system-font interface puts conversation on the left and film review on the right. At 760px and below, Director/Workspace navigation switches between the two without discarding state.

## Implemented

- Header project switcher, new-project form and existing model/settings dialog.
- Storyline, Assets and Preview views. Brief, story, narration review and technical plan details live under Storyline → Brief & narration.
- Compact scene-grouped shots, collapsible scenes, text search and frame-review filters. Exact frame, motion, duration and model information remain visible before approval.
- Current activity and pending questions stay above the composer. Chat history scrolls independently. Stop remains separate from Send and uses the existing durable stop protocol.
- Image references, source clips and spending controls move to Assets. Preview retains the real current/previous assembled output and local render controls.
- Narration and asset panels retain their mounted state when hidden. Existing SSE subscriptions, stale-review checks, displayed-frame hashes, command retry identities, recovery restrictions and separate spending permissions are preserved.

## Evidence

Web build and TypeScript checks passed. All 118 existing web regression tests passed, covering exact approval/spending identities, Stop, SSE, model changes, narration and artifact verification. The suite also includes pre-existing local-session work outside this UI commit.

A real browser against an isolated local server with fresh data and fake providers verified: project creation and Settings, two-shot demo planning, SSE-delivered frames, search narrowing to one shot, clearing filters, selecting/approving only shot 1, shot 2 remaining unapproved, navigation to Assets/Preview, and a preserved unsent chat draft. At 1280×800 and 390×844, the layout was visually inspected. Mobile review navigation opens Workspace; Discuss opens Director with the exact shot scope; Stop preserves the draft and saved work. A CSS class collision found in desktop inspection was fixed. No live model/media APIs were called and no existing user project was edited.

The final review also corrected the no-assembled-preview state (a video take alone is not an export), added explicit no-search-results feedback and retained truthful periodic-fallback connection wording. These final copy/conditional changes passed build/typecheck; the browser run above preceded them.

## Boundaries

The prototype's simulated take comparison and alternative-frame acceptance are not implemented here. There is no new timeline editor or separate Discuss/Change command mode. Existing conversational editing and genuine previous-export behavior are retained. Filters describe frame review rather than inventing precise shot-level job states from historical attempts. Existing exact spending review remains separate from creative frame approval; no illustrative price or fake generation modal is shipped.

This commit excludes the pre-existing uncommitted local-session/launcher changes. The currently running production server may cache the old built assets until restarted. Development mode reads the rebuilt source directly.
