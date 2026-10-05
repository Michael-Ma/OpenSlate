# Current implementation status

Reconciled October 5, 2026. OpenSlate is an early single-user local studio. The implementation supports human testing; a complete production release and real-provider acceptance are not established.

## Available behavior

| Area | Implemented scope | Remaining boundary |
|---|---|---|
| Director | Native/fake runtime, saved context, questions, scoped changes, locked skills/tools and Stop/recovery | Complete native conversation-to-film acceptance |
| Studio UI | Selected A / OpenSlate Light on Radix Themes, shared tokens/controls/dialogs, focused storyboard, resizable Director and state-derived Saved / Next card | Subjective usability acceptance and further refinements against actual production work |
| Storyboard | Editable treatment/scenes/shots, import proposal/confirmation, reorder/delete/undo and stable IDs | More advanced editing and subjective usability acceptance |
| Planning/execution | Restricted declarative compiler, scoped reuse, exact reviews, durable intents/attempts and unknown-outcome recovery | Longer real production and provider-specific acceptance |
| Silence/audio | Explicit no narration, compact script/recording review, short accepted within-shot voiceover and owned library | Real speech/transcription acceptance and richer mixing |
| Timeline/export | Synchronized picture/accepted narration/music preview; local FFmpeg assembly | Advanced trimming, transitions, waveforms and streaming |
| Personal voice | Consent/revocation registry and existing eligible OpenAI custom-ID dispatch | **Creating a new clone from a recording is not implemented** |
| Local operation | Source launcher, pairing, doctor/private config, migrations and media-inclusive same-root recovery | Installer/bundled runtime, more OS/clean-machine checks and relocation |

Requested workflow items 1–5 are implemented. Item 6 is partial because provider voice-ID synthesis does not create a new voice clone. Item 7 has local setup tooling; broader packaging remains separate. The [October 1 code review](V1-COMPLETION-REVIEW.md) records fixes and scope.

## October 5 Light workspace

The user-selected **A · Light workspace** is implemented as [OpenSlate Light](../design/OPENSLATE-LIGHT.md), with Radix Themes as its React component foundation. Shared semantic tokens govern actions, fields, selections, dialogs, guidance and focus states. The Director remains on the left with its remembered drag/keyboard width; the storyboard emphasizes a selected shot alongside compact supporting cards. Film direction stays available in a disclosure, with empty-project writing visible. Stable IDs and scene/shot labels survive selection and reordering.

The current-plan card replaces the generic activity/Continue rows with **Saved / Next** derived from the canonical snapshot, current Director state, exact frame review, job evidence and request-owned holds. Eligible unfinished edits show their actual scope and saved direction; **Resume this edit** creates an explicit new scoped Director request. Running work, pending answers, Stop and uncertain/in-progress media each have their own next action and suppress Resume. Direct storyboard edits are shown as saved changes needing a matching plan. The card does not infer a creative Change / Keep promise from conversation text.

**Models for this project** presents Director, Keyframes, Video and Narration in a compact Radix dialog, with optional setup and existing voices. Separate Director/media commands, exact zero-impact saves, actual impact review and same-command recovery remain authoritative. Protected saves block dismissal; narrow layouts retain a reachable footer. Image inspection shows the complete frame with its actual motion and duration, and approval requires the exact current image to load successfully. See [October 5 review](OCTOBER-5-LIGHT-WORKSPACE.md).

## Post-migration review

The separate [post-migration review](OCTOBER-5-POST-MIGRATION-REVIEW.md) repaired current-versus-historical job guidance, wider/deleted scope recovery, stale recording focus and approval focus restoration. It consolidated inspection/navigation logic and component styling, and removed retired UI implementations. The latest full gate passed **2,232 tests, zero failures, one optional native skip**; the offline restart/edit demo and before/after desktop/phone checks passed. Application authority and saved live state remain unchanged.

## October 3 refinement

October 3 delivered persistent/clamped drag/keyboard Director sizing, a vertically resizable composer and safe GFM Markdown. Background SSE refresh preserves connection/content and request-owned holds. Settings introduced the four main jobs with optional setup, actual returned Director choices, separate durable saves, validated zero-impact apply, pending-work impact review and same-command recovery. Automatic compatible V1–V3 → V4 fresh-turn guidance is implemented and offline-tested; ordinary storyboard/script writing needs no generation/spending permission. A bounded native check exposed historical/current skill inventory overlap before dispatch. Per-turn activation disables verified historical snapshot entries while retaining their bytes and exact catalog checks. The repaired native rerun completed one V3 → V4 scoped script-writing turn, preserving other work and creating zero grants/media attempts.

The October 3 integrated gate passed after the response-order and native inventory fixes. The later Light workspace adopts the selected visual system and state-derived plan card described above. See the dated [refinement review](OCTOBER-3-REFINEMENT-REVIEW.md) and current [remaining work](../design/IMPLEMENTATION-PLAN.md).

## Verified evidence

- **October 5:** `pnpm check` passed **2,222 tests, zero failures, one optional native skip** (2,223 total), with builds/typechecks under Node 24.15.0. Actual React browser checks used disposable fixture state for desktop storyboard/frame approval/scoped edits, keyboard resizing, settings saves/impact/unknown-response recovery, focus and 390×844 settings layout. This UI migration makes no new real-provider media acceptance claim. [Scope/limits](OCTOBER-5-LIGHT-WORKSPACE.md).
- **October 3:** `pnpm check` passed **2,207 tests, zero failures, one optional native skip**, with builds/typechecks under Node 24.15.0. Disposable React settings/browser and synthetic rapid-SSE checks passed. The native supplement completed one writing turn; zero media-provider calls. The final gate includes both the UI response-order and native inventory fixes. [Scope/limits](OCTOBER-3-REFINEMENT-REVIEW.md).
- **October 1:** `pnpm check` passed 2,173 tests, zero failures, one optional native probe skipped; builds/typechecks passed. Bounded native V4 writing/context and disposable desktop/390px audio/Timeline review passed. Actual synthetic FFmpeg checks covered one-second voice inside six-second picture and 65 audio placements. No paid media calls.
- **October 2 readiness checkpoint:** existing OpenAI key returned a successful model listing, and approved API-image/speech/transcription route activation preserved saved state. No media was generated. This proves local configuration/authentication evidence, not media entitlement, quota or generation acceptance.
- **September 23 real media:** one Codex keyframe, one Viggle H3 job, exact-job download recovery and a six-second 1280×720 export survived reopen without duplicate dispatch. A scripted plan was used; audio was silent.
- Synthetic six-minute workflow/media checks cover structure, timing, reuse and recovery. They do not prove six-minute real-provider quality.

The October 5 gate verifies the integrated Light workspace source; the October 3 gate retains its original UI/runtime scope. Older totals do not verify later edits automatically. [Evidence index](VALIDATION-EVIDENCE.md) preserves exact dated results and limitations.

## Next acceptance

Run [human live testing](MANUAL-LIVE-PRODUCTION.md) with short real API image, stock speech and transcription. Then exercise a full native conversation, a multi-shot scoped replacement and restart/reopen. Confirm user quality before longer production. Provider keys/configuration and old allowances are not blanket permission for new media calls.

Application state, review and execution remain authoritative. Generation origin, finite usage allowance, exact returned-frame/motion approval, accepted audio, edit holds and Stop are separate predicates. Local export is limited to 360 seconds/64 cuts/65 audio placements/eight simultaneous lanes. V0 remains one computer.
