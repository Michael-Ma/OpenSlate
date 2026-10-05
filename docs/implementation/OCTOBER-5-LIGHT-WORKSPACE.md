# October 5: OpenSlate Light on Radix

The selected **A · Light workspace** is implemented in the React studio using Radix Themes 3.3.0. This is an application implementation, with existing project state and commands, rather than the earlier standalone design study.

## Delivered behavior

- A pale canvas, white surfaces, blue primary actions, readable dark text and explicit control/focus boundaries share central semantic tokens. Standard fields, actions, selectors, navigation, settings and media dialogs use the shared Radix foundation. Secondary audio, narration, media and recovery surfaces follow the same tokens.
- A narrow navigation rail leads to Storyboard, Assets and Timeline. The left Director retains persistent pointer/keyboard resizing and a resizable composer. Phones use a Workspace/Director switch; long project names fit within the header.
- Each scene shows one selected shot and smaller supporting shots. Promoting a shot preserves stable IDs and chronological shot labels, and returns keyboard focus to its selection control. Inline writing remains revision-bound; media retains its aspect ratio.
- The Current plan card derives Saved / Next from actual project, Director, question, attempt and review state. It distinguishes running, questions, stopped work, uncertain submissions, generation, unfinished edits and returned frames. Resume uses an exact server continuation group whose scopes still have the request's active holds; it never confers generation or spending authority. The action is beside its saved scope so the live unfinished-edit card exposes it without scrolling past optional direction details.
- Keyframe review opens the exact frame with its motion and duration. The modal must load its own image, and the parent requires its captured review identity, a current ready member and the displayed hash before submitting the existing approval command. A changed storyboard closes the obsolete review.
- Settings lead with Director, Keyframes, Video and Narration. Optional transcription, accounts/local setup and existing voices are disclosures. Director/media writes stay separate. A zero-impact media change applies its exact preview; changes to unfinished work receive an actual impact review. Unknown responses retain the same command for recovery, including after closing/reopening the dialog. Active saves protect dismissal.
- Assets use the shared search/filter/actions and preserve actual empty/filter states. Timeline uses the shared export/music controls while its playback, seek and media elements retain their specialized behavior.

The [design contract](../design/OPENSLATE-LIGHT.md) identifies tokens, component APIs and layout ownership. New screens should reuse those sources.

## Code review

Two independent subagent reviews checked the integrated approval, revision, command, modal, selection and recovery contracts. Review-driven fixes included the modal's own image-load gate, directly captured review identity, StrictMode-safe launcher focus and consistent stylesheet ordering. A final live check also exposed a model-discovery race: a newer setup read can supersede the catalog reply after that reply fills the server cache. Superseded catalog reads now request fresh current setup instead of publishing stale state; aborted reads remain silent. Root browser review corrected reset-related shot control/asset row sizing, a phone header overflow and the clipped Resume placement. No unresolved blocking review finding remains.

## Executed verification

Under Node 24.15.0 and pnpm 10.33.0:

- `pnpm check`: **2,222 passed, zero failed, one optional native probe skipped** (2,223 total), with project builds/typechecks. This reran the complete existing suite and the new plan/selection/state regression tests.
- Final frontend build and typecheck passed after the remaining component/CSS integration. Frontend tests: **187 passed, zero failed**. The standard Vite warning about a JavaScript chunk larger than 500 kB remains; full Radix CSS is also included. This is a local studio and bundle-size optimization remains separate work.
- Production-build browser checks used a disposable fake-provider installation, separate from the user's saved projects. Desktop 1280×720, intermediate 800×900 and phone 390×844 layouts were inspected. Main phone document bounds remained 390×844; the Assets pane had no horizontal overflow. Frame-review headers/footers stayed visible on desktop and phone.
- Selecting a supporting shot promoted it with focus retained. A fixture keyframe/motion approval succeeded. A subsequent camera-movement edit persisted and cleared that obsolete approval; reload retained the edit. Director keyboard resizing persisted. Stop produced a truthful saved-work state with a fresh-direction action.
- A separate real-component/in-memory settings harness verified model-only save, actual pending-work impact, lost media and lost Director responses, closing/reopening before recovery, and repeated identical request keys. The lost Director case produced one durable fixture write. A slow save disabled Done/Close and blocked Escape. Tab boundaries and Escape/launcher focus return passed. Phone settings kept Done visible.
- A delayed model-discovery fixture forced a setup refresh before discovery completed. The picker recovered automatically, kept its original model, and exposed both fixture choices: one catalog read, three setup reads, zero writes/turns/grants/provider calls. Three regression tests cover superseded discovery, authoritative discovery and aborted discovery.
- Assets filtering switched from an empty uploaded result to two generated fixture assets. Read-only Timeline, empty music selection, media-import error states and frame inspection rendered with the shared system. Full production import/audio/export acceptance was not repeated through this design fixture.
- A read-only native model-catalog probe initially failed because the agent terminal sandbox prevented the native process from starting. Running the same pinned preflight in the installed host environment passed binary/account/model/catalog/policy checks and returned five supported model choices. The studio was relaunched in that environment; the final live settings picker discovered its real models automatically. No creative thread/turn was started.
- Read-only inspection of the live studio verified existing content and recovery state. Application project/authority digests and record counts matched before and after startup/inspection, with zero active Director turns or media attempts. No new real media-provider call, generation grant or spending allowance was created.

- Documentation audit: **115 Markdown files, 504 relative links, no missing targets**.

Screenshots and additional local inspection output are kept in the task's `outputs/openslate-radix-implementation/` artifact folder, outside Git. The disposable fixture uses the repository's labeled fake imagery; generated design-study media was not inserted into the live project.

## Boundaries

The complete suite's optional native probe was skipped; this design migration did not run a new native creative turn or a paid media generation. Existing runtime/media acceptance limits remain in [status](STATUS.md) and [manual live testing](MANUAL-LIVE-PRODUCTION.md). Browser checks do not constitute screen-reader certification or a 200% zoom audit. Personal voice enrollment, installer packaging and advanced editing remain separate capabilities.
