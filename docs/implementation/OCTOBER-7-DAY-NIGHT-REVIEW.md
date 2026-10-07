# October 7 Frame Studio Day/Night review

## Delivered workbench

The user's supplied `frame-studio-day-night.zip` is the layout and interaction target. The shared design conversation was read in the browser, and Linear's official redesign article was checked for neutral hierarchy/theme context. Later loose-file Codex/Claude variations were excluded. The existing design source [Studio Day/Night](../design/OPENSLATE-LIGHT.md) now defines the accepted implementation and boundaries.

React/Radix now has Day/Night semantic zones, local licensed Inter Variable/PingFang, rounded outline icons and Plan/Keyframes/Assets/Film navigation. The resizable conversation contains @ resource chips, concise plan widgets and protected inline tools. The right uses one canonical Scene → Shot hierarchy, a large selected image/video preview, inspector and scene shelves. Appearance/view switching preserves selection, unsent text and references without remounting the app.

@ references use owned project/scene/shot/media identity and explicit message scopes. Narrow references override preview selection and cannot implicitly resume a stopped whole film. Supported native image attachments remain bounded; other resources use readable local context links. Chips alone cannot submit an editable request.

Scoped image commands create missing frames or explicitly regenerate selected shots. New candidates preserve siblings/history and defer dependent video. Direct action/image/video Prompt edits preserve provenance and revision checks without dispatching media. Each current selected image requires successful decode, real visible exposure and an explicit check; hidden/thumbnail/history loads cannot qualify. A previously viewed exact image can be checked after scrolling to the inspector or returning to chat on a phone. The subsequent scene video decision still binds exact frame bytes, motion, duration, model and settings.

Film exposes actual shot ordering through drag and keyboard controls, saved 3–15 second plan timing, zoom/panel sizing and owned-music placement/gain/mute. Browser audition and local FFmpeg render share the source-local soundtrack placement helper. Retired `ProjectResults` presenter/styles and the obsolete Light-only palette were removed; its conservative current/historical data model remains shared.

## Review repairs

Independent review and actual browser verification repaired:

- Protected inline settings could allow a new workbench generation shortcut. Those requests now obey the same protected-save, creation and chat mutation guards, while exact unknown-command recovery remains possible.
- Scene reference/focus navigation used predecessor anchors. Plan and Frames now target the actual mounted scene/shot IDs.
- Ordinary same-identity projection refresh cleared a scene decision, causing blinking. Refresh keeps its connected content while identity/failed reads still revoke stale views.
- Regeneration with an owned/shared conditioner could leave the video and review gate tied to the old frame. Scene composition inserts and connects the new shot-owned image, preserves the shared source/siblings, and defers only its downstream video. Tests reject the old frame and assert the actual next provider input.
- A currently-visible-only check made confirmation impossible in stacked/narrow-height layouts after scrolling. Exact previously-seen proof now permits the deliberate click; never-seen/stale/error frames stay blocked.
- Direct Prompt writing after a whole-project edit and partial scene generation dropped an inherited scene hold. Continuation now retains valid current scene IDs as well as shot IDs. The regression follows edit → partial generation → direct prompt writing → selected-shot generation, preserving the other scene's content, pause and lack of generation grants.

## Verification

- Final `pnpm check`: **2,376 passed, zero failed, one optional native probe skipped** (2,377 total), all builds/typechecks passed; Node 24.15.0, pnpm 10.33.0.
- Independent backend/composition/storyboard checks: **50 passed**. The workbench reviewer independently checked integration authority/navigation and passed **18** focused frame/decision/reference tests after its confirmation fix.
- Final offline demo: **4 initial + 2 edited fake accepts, zero duplicates after restart**, unchanged shot preserved.
- Disposable built React/browser: two scenes/four shots; initial three fake keyframes and three videos, one targeted frame regeneration, then one second-scene image (**eight fake attempts total**). Sibling videos/history were preserved. An actual later Prompt edit saved without changing that attempt count; its old image became historical/ineligible.
- Theme and reference navigation retained selected shot, unsent text and explicit chips. A submitted @ Shot 1.2 message saved exactly that shot's scope in SQLite. Empty/reference-only submission and Stop/foreign/stale boundaries are covered by model/command tests.
- Actual Timeline Alt+Arrow reordering and pointer drag both saved canonical order. Music keyboard/pointer movement saved frame 122; gain and mute were written and auditioned through the shared real projection, without invented waveforms or sample duration.
- 390×844 final built browser: exactly one active pane and zero document horizontal overflow. An initially offscreen current frame could not qualify; scrolling it into view, then scrolling to the inspector and explicitly checking it succeeded. Day/Night controls remained reachable. Independent 720×421 review also had zero overflow.
- Delayed offline model preview disabled project switching, creation, settings closing, chat shortcut dispatch and new workbench mutations. Ctrl+Enter kept the draft unsent; SQLite recorded zero prohibited shortcut messages. The intentionally unavailable metadata-only model returned a definite setup failure; it was not a successful provider save/dispatch acceptance claim.
- The normal local launcher loaded the final UI into the existing IB Project after a read-only check of zero active media attempts and zero queued/running Director turns. Existing generated frames were inspected only; no real generation was requested.

Full gate: `/private/tmp/openslate-day-night-final-check.log`; demo: `/private/tmp/openslate-day-night-demo.log`. Browser captures are outside the repository under the task's `outputs/openslate-day-night/` directory. The private launcher log is not evidence to publish. The [sanitized machine record](day-night-evidence.json) contains no authentication material.

## Boundaries

No real-provider media calls or new native model turns were used for this rewrite. The disposable fixture uses synthetic owned audio and the real application/engine/HTTP routes with fake providers and no personal credentials. It verifies workflow/state integrity, not provider quality/account eligibility. Native runtime acceptance remains separately scoped.

Plan timing is not source trimming. Arbitrary trim/split, redo/adoption of earlier versions, independent effect/music lanes, waveforms, transitions and new voice cloning remain unsupported and have no inert controls. Advanced audio, imports, rendering and recovery retain their existing application semantics; their entire provider/physical-media acceptance was not re-run through the new browser. Subjective usability and full real conversation-to-film acceptance remain human testing.
