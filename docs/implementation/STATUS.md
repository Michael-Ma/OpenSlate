# Implementation status

Updated September 27, 2026. This page describes implemented behavior and verified limits. [Technical designs](../technical/README.md) describe the broader target; [the development plan](../design/IMPLEMENTATION-PLAN.md) tracks remaining work.

## Current capability

| Area | Implemented | Verification / limit |
|---|---|---|
| Local studio | One process, private local state, browser pairing, authenticated SSE, model settings, conversational Stop | Desktop/mobile browser checks; v0 is one user on one computer |
| Direction and planning | Codex or demo runtime, versioned skills/tools, typed stage outputs and restricted plan compiler | Native scoped conversations and contract delivery tested; complete native conversational production still needs acceptance |
| Execution | Durable attempts, exact human grants, spending allowances, uncertain-submission recovery and scoped reuse | Offline regression and restart/recovery checks; no blind retry of unknown paid submissions |
| Visual production | Uploaded images/video, Codex or API image adapters, Viggle and MiniMax adapters, keyframe/motion review | One actual Codex image → Viggle clip → export passed; OpenAI image API live validation remains pending |
| Narration | Drafts, uploaded recordings, speech/transcription proposals, human review, canonical audio/timing and adoption | Implemented and tested with synthetic media/injected providers; real speech/transcription validation remains pending |
| Assembly | Owned media, timeline composition, FFmpeg export, local recovery | Actual six-second provider output and synthetic six-minute workflow verified |
| Review UI | Unified Film plan with brief and scene narration/shots, progress navigation, next action, reviewed text import; Assets and Preview retained | Real native three-scene import, reload and human confirmation; desktop/390px navigation and scope checks; no paid media in this slice |
| Installation recovery | Verified media-inclusive backup, same-root restore, quarantine and human release | Offline and browser recovery evidence; portable relocation and installer packaging remain pending |

## Latest verification

- September 27 Film plan: **2,016 passed, zero failed, one optional native probe skipped**; builds and typechecks passed. A separate native Codex interpreted one synthetic three-scene, three-shot outline; the proposed import survived reload, then human confirmation saved one revision with zero generation grants and zero media attempts. Optional music stayed outside the draft and narration stayed undecided. Phone layout measured 390px content/390px viewport; scoped chat, saved-edit continuation, narration, final navigation and the Markdown file picker passed. Tests cover stale/different drafts, interrupted work, model mutation rejection, idempotency, reopen, restored authority and scoped discard. See [delivered scope and limitations](../design/SIMPLIFIED-VIDEO-FLOW.md).

- September 27 launcher maintenance: builds/typechecks and 20 focused startup/session/ownership tests passed. A disposable real-process run exercised fresh install/build/start, verified restart, reconnect, credential mismatch and Ctrl+C. The launcher smoke test passed with zero model/media calls and graceful ownership release. Documentation file links passed; two obsolete review/approval histories were removed and status/roadmap histories consolidated.

- September 26 full checks: **1,990 passed, zero failed, one optional native probe skipped**; builds and typechecks passed. Final UI-only rerun: 118 passed. See [UI refinement](../design/SIMPLIFIED-VIDEO-FLOW.md).
- September 23 real pipeline: one Codex keyframe, one Viggle submission, exact-job download recovery, six-second 1280×720 export, and reopen without duplicate dispatch. Audio was deliberately silent. See [evidence and limits](LIVE-VALIDATION.md).
- Earlier synthetic tests cover sixty shots, six-minute media processing, selected-shot reuse, uncertain submission and restart. Synthetic footage is not evidence of real-provider long-form quality.
- Required director contract references are delivered through verified native developer instructions. A bounded native read-only rehearsal received all 18 references intact; see [sanitized evidence](director-context-delivery-evidence.json).

These results do not establish commercial quality, a complete conversation-to-film run, or six-minute real-provider acceptance. API keys being configured is not proof of successful provider access. Setup values and old spending allowances are not permanent authorization for further tests.

## Operational boundaries

- Run `./start.sh`; use `--status` to inspect and `--restart` to rebuild with changed code/configuration. See [launcher behavior](LOCAL-LAUNCHER.md).
- Default generation is fake. Real providers require configuration, enabled routes, exact generation permission and separate usage/spending approval. Video also requires exact frame/motion approval.
- App-owned state and execution remain authoritative. Codex proposes validated actions; it does not own grants, budgets or paid-job recovery.
- Stop fences old work. Unfinished edits retain individual ownership; grouping them in the UI does not resolve conflicting edit holds. The IB project's three saved unfinished edits were not discarded during UI cleanup.
- Current generation permission and spending remain separate UI steps. A combined guided review is planned; it must preserve the existing authority and replay guarantees.
- Local rendering is limited to 360 seconds, 64 cuts/64 audio placements, eight distinct audio inputs and eight simultaneous lanes. Embedded clip audio is removed; automatic ducking/limiting is not implemented.
- Supplied media is bounded and fully verified before playback; no range-streaming support yet. Backups contain private project/media records and must be protected.
- Pairing uses a short-lived launch code and HttpOnly browser session. Manual bearer-token entry remains a fallback. Neither mechanism exposes provider API keys to the browser.

## Remaining release gates

1. Short real speech/transcription and OpenAI-image checks with enabled providers and an explicit test budget.
2. Native conversation through brief, narration decision, storyboard, review, generation and export; cover the multi-edit continuation problem without manual state repair.
3. Targeted conversational replacement, restart/reopen and a longer real multi-shot production; user quality acceptance.
4. Packaging, broader clean-machine checks, operational documentation and final v1 acceptance.

Use [manual live production validation](MANUAL-LIVE-PRODUCTION.md) for the next human rehearsal. No new paid provider test was performed during the UI or launcher/documentation maintenance.
