# October 3 studio and settings refinement

October 3, 2026. Implemented source was inspected against the delivered browser/application behavior. This is a usability/compatibility milestone, not new real-provider media acceptance. No media-provider calls were made; one real native writing turn is recorded below.

## Delivered scope

| Area | Behavior | Boundary |
|---|---|---|
| Flexible workspace | Drag/keyboard Director divider; saved/clamped width; double-click reset; vertically resizable composer | Phone layout hides the divider; size is a browser preference |
| Chat | Safe GFM headings/emphasis/lists/links/code/tables/task lists; contained table scrolling | Raw HTML not enabled; model-supplied images are links, owned attachments keep verified viewer |
| Background updates | Same-project content/connected state retained during refresh; Continue rows hidden while Director runs | Holds persist; real disconnection/Stop/recovery still enforce their rules |
| Settings hierarchy | Four main jobs: Director, Keyframes, Video, Narration; optional transcription/accounts/local setup/voice identities | No new credential-entry API or voice-clone enrollment |
| Director models | Actual compatible runtime/account choices, read-only catalog refresh, secondary current-ID/manual fallback | Listing is no model turn, selection write or media-access proof |
| Settings save | Separate durable Director/media commands; current zero-impact server-preview apply after explicit Save | Actual unfinished work receives human impact review; no generation/spending is granted |
| Unknown save | Reviewed choices and exact command identity retained; same-command check recovers outcome | Browser hard reload can lose tab-local state; server receipts remain durable |
| Guidance | Verified shipped V1–V3 → V4 successor before eligible fresh undispatched/unbound native input | Already-bound epochs keep old locks; stale/busy/restored/customized guidance fails safely; no extra turn/media authority |
| Documentation | Current README/architecture/contracts/run guides, 70 redundant Markdown histories removed | Immutable runtime skills and all 41 prior JSON evidence remain intact |

Ordinary storyboard/script writing needs no generation or spending permission. Media generation/usage, returned-frame/motion review, audio acceptance and personal-voice consent remain separate concrete decisions.

## Verification

The integrated **`pnpm check` passed 2,207 tests, zero failed, one optional native probe skipped**, with all builds/typechecks under Node 24.15.0. This final full gate includes the reviewed UI response-order and native skill-inventory fixes. An earlier gate passed 2,202 tests before those findings; it is superseded for this milestone by the final result.

Focused suites cover pane bounds/keyboard, safe Markdown, settings presentation and exact zero-impact apply, actual native model-list shape/filtering and compatible guidance maintenance/rejections. Existing domain/execution/narration/recovery tests retain their separate authority boundaries.

The actual React settings components were browser-reviewed against a disposable **in-memory API fixture**. Observed: scoped Director save; one zero-impact preview/apply; human review for actual pending impact; Back retaining draft; lost apply and close/reopen restoring reviewed choices; same UUID recovery without a second fixture mutation; catalog fallback/read-only refresh; 390px viewport with a 370px dialog/no horizontal overflow; 44px phone controls; focus trap, Escape and focus return. Those model/account labels and counters are fixture values, not provider access or production-server integration proof.

A rapid **synthetic SSE** rehearsal at 100 ms recorded twelve samples with Planning/Live updates stable and controls enabled. It exercises refresh presentation under frequent events, not real provider progress or a universal performance bound. Resize/Markdown and narrow-screen examples use disposable UI data. Production/private projects and credentials are not copied into these docs.

## Code review

Root and a separate backend reviewer inspected the combined settings, connection/resize/Markdown and authority boundaries. The review found a delayed model-list read that could overwrite newer Director busy/selection state; both reads now share an ordering gate, including old errors/finalizers. Four controlled response-order tests preserve the dirty draft and exact unresolved-save identity.

Native validation exposed retained snapshots being discovered after cached setup; per-turn verified exclusions fixed that inventory defect without weakening enabled-catalog equality. The first captured capability snapshot now follows immutable epoch binding, so it advertises the same writing/audio tools actually activated. No immutable skill bytes, old epochs, paid grants or receipt identities are rewritten.

## Native supplement discovered a real inventory gap

After the full offline gate, a bounded fresh native guidance run stopped safely with `RUNTIME_SKILLS_UNEXPECTED` before dispatch. Historical V3 and current V4 snapshot directories both appeared in the native runtime's skill inventory. Fake runtime tests had not exposed that inventory behavior. The successor lock/context was installed, canonical project state was unchanged and zero model turns, tools, media attempts or grants started.

The repaired runtime launch explicitly disables verified historical OpenSlate snapshot entries, then enables only the current activation. Immutable history and exact catalog equality remain intact; a regression confirms an unexpected unowned skill still fails before dispatch.

The [bounded native rerun](october-3-native-guidance-evidence.json) completed **one real Codex turn**: V3 → V4 compatible upgrade, scoped script saved through V4 read/prepare/apply/read tools, other shot/project narration/visual revision preserved. It created **zero media attempts, generation grants or accepted audio**. The initial failed attempt dispatched no model turn and was not retried as an unknown outcome. This establishes the narrow migration/writing path; it is not real media or full-film acceptance.

## Pending human choices and acceptance

- Choose the app-wide minimal design system from prepared examples before applying its tokens/components globally.
- Choose whether to adopt the larger **Change / Keep / Next** visible plan-card proposal. Hiding active Continue rows is delivered; the larger plan-card redesign is not claimed shipped.
- Final integrated build/test/typecheck: **passed**, including the reviewed response-order and native inventory fixes. Implementation is committed locally as `014c821`; installation evidence is recorded below.
- Real API-image/speech/transcription, complete native conversation-to-film, multi-shot reuse/restart and subjective quality: still [human testing](MANUAL-LIVE-PRODUCTION.md).
- New voice enrollment, installer packaging and advanced timeline work remain [outstanding](../design/IMPLEMENTATION-PLAN.md).

Source: web `WorkspaceSplit.tsx`, `workspace-layout-model.ts`, `ChatMarkdown.ts`, `App.tsx`, settings components/models; server guidance/input/capability/local-director routes; director native setup/model listing. [Current status](STATUS.md), [studio](../design/STORYBOARD-STUDIO.md), [settings](PROJECT-SETTINGS-AND-UPDATES.md) and [guidance](DIRECTOR-TOOLS-UPGRADE.md) describe current behavior. The [evidence index](VALIDATION-EVIDENCE.md) retains earlier campaigns with their original scope.

## Local installation verification

The reviewed source was loaded with `./start.sh --restart --no-open` after confirming no active Director turns or media attempts. The authenticated real studio displayed the compact settings and five account-returned Director choices. No selection was saved and no conversation or generation started. Read-only before/after digests match for canonical projects and existing holds/grants/attempts/candidates/approvals/allowances/Director turns/skill locks/selections; all counts are unchanged. Existing approved provider configuration was retained. The account catalog is availability evidence only, not quota or media entitlement.

A production web build retains the Vite warning for its >500 kB main bundle; build/typecheck/tests pass. The selected design-system migration should review component reuse and bundle sizing alongside visual consistency.
