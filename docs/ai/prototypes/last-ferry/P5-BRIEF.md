# Phase P5 design brief: the views the Last Ferry design does not show yet

The Keyframes view is designed (`last-ferry.html`, `DESIGN.md`). Phase P5 designs the rest of the studio in the same system before it is built in `apps/web/src/next/` (plan decision D13).

## Fixed

- The design system in `DESIGN.md`: colour roles (amber only for the Director; white for the chosen option and primary action; green for an opened frame), Inter, the shell (52 px top bar with the view tabs, 392 px Director column on the left), component treatments (pills, status pills, cards, banner, toast).
- The Director column stays on the left in every view; the composer's @ pointing works in every view.
- Dark only (D12). English and Chinese; Chinese strings are longer and must not break layouts.
- The backend contract for each view is in `packages/core/src/studio-api.ts` and the gap items cited below; draw only what the backend can say.

## Views to design (requirements: `docs/ai/uiux-plan/gap-storyboard.md`)

| View | Gap items | Must show |
|---|---|---|
| Plan | SB-20, SB-13, SB-9, SB-12 | Brief and story; scenes with titles (rename, reorder, delete with its shots); shots per scene with purpose, framing, duration, narration text; add shot / scene; import a written plan (review, then confirm or discard); single-step Undo. Editing a field says what it outdates before saving. |
| Film | SB-19, SB-15, SB-16, SB-17, SB-18, SB-24 | Synchronized playback of clips, narration and music in storyboard order; shot order and planned length; one music lane (choose, start, volume, mute); Export with its readiness checks per shot, progress, Cancel, Check again, Download; the last export and what changed since; the Demo mark for an all-demo film. |
| Assets | SB-21 | Images, clips, voice lines, music, uploads and exports grouped by scene and shot, with role, take number, current flag, source (generated, imported, demo); Download; point the Director at an asset; Import. |
| Settings | SB-23, SB-24, D4 | Models for Director, keyframes, video, narration and transcription; prices as host-configured estimates; default narrator voice; personal voice (consent and revoke); local setup status; "the Director reviews new keyframes" toggle. |
| Start | SB-22, SB-14 | No films yet; the demo path when no provider keys exist; import a written plan; new film; open or archive a film; reconnect when the studio restarted. |
| States | GR-9, GR-10, GR-13, GR-14 | Failed (charged or not), no answer (give up, may pay twice), Stop and Continue, restart casualties, offline, session expired, in every view where they can appear. |
| Phone | — | Every view at 390 px: the Director as a drawer, no sideways page scroll. |

## Deliverable

One HTML study per view in `docs/ai/prototypes/last-ferry/` (`plan.html`, `film.html`, `assets.html`, `settings.html`, `start.html`, `states.html`), sharing the Last Ferry sample film and the same CSS tokens, with English copy and a note of the Chinese strings that are longest. A short `P5-DESIGN.md` recording the decisions. The lead reviews them, then builds them in the next tree.
