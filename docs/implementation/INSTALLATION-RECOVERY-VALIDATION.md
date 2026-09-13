# Installation recovery validation

September 12, 2026. All media and project data in this campaign were synthetic. No contributor installation was restored, no native model turn started and no real media API was called.

## Verified outcome

The built local launcher created a two-shot boots demo, completed its initial fixture preview, then prepared a changed first keyframe awaiting review. After shutdown, the offline exporter copied and verified **31 files, 1,613,093 bytes**, including both databases, owned media and exact locked skills. The original synthetic installation was preserved separately; restoration used its original canonical path.

Canonical project JSON and revision were exact after restore. Prior events were preserved, with one explicit restoration event appended. The new installation was paused and quarantined; the old browser token was excluded. Repeating the completed restore preserved its receipt and owner inode. The backup manifest remained unchanged.

The actual built browser exercised this sequence:

1. Connect with the newly generated local token. The old token received `AUTH_REQUIRED`; the new one could inspect the saved workspace.
2. Read both keyframes and the previous preview while project creation, messages, uploads, Resume and frame approvals were disabled. Both 320×180 keyframes decoded. The one-second fixture video decoded at 160×90, ready state 4, with no media error. Review inspection returned no actionable approval ID and added no review record. Nine read-only audit checks passed.
3. Select **Review release**, then **Finish recovery review**. Twelve database checks confirmed exact human release, continued project pause, unchanged film and unchanged requests, holds, grants, candidates, attempts, reservations, allowances and approvals.
4. Resume, discuss only the first shot and select **Wide shot**. A fresh request changed that shot while preserving the second shot exactly. The previous preview remained available and the replacement frame required new review.
5. Approve the exact replacement frame. Two fresh fixture attempts completed: image and video. The fake video bytes are identical across these sample takes, so the existing fixture timeline/render were reused by content. This does **not** demonstrate a newly rendered real video.
6. Reload and reconnect. The saved recovery decision, wide framing, both frame approvals and latest fixture preview remained available. Images/video decoded again; the browser reported no warnings or errors. Both launcher instances closed gracefully.

Visual inspection found and fixed a scrolling issue: loading saved conversation history moved the entire page and obscured the recovery heading. Scrolling now affects only the conversation stream. A fresh connection showed the recovery heading within the viewport. The release text describes the transition in the past tense, so it stays accurate after a project is resumed; retained results may recover after release even while new work remains paused.

Initial ad hoc audit assertions were corrected to separate canonical content from the intentionally advanced event counter and to use the actual authentication/receipt contracts. These were harness assumptions, not a repeated restore or a change to project data. The original source and initial diagnostic were retained.

## Automated and independent evidence

- Full checkout: **899 tests passed**, zero failures/skips, all builds/typechecks, with the installed Codex probe enabled and no model turn. Final UI-only scroll correction: web build/typecheck and **45 web tests passed**.
- Backup and restore: **20 exporter/inspection tests and 10 restore/CLI tests passed**. An independent run added the actual launcher incomplete-restore test for **31 checks**; a separate review reproduced initial marker interruption and late cancellation.
- Actual child processes were killed during copying and after namespace publication. Same-bundle retry retained the owner inode and already published content. Corrupt progress, changed published bytes, different bundles, existing installations, symlinks, out-of-root paths and oversized input were rejected.
- Historical V1/V2 snapshots remain unchanged during export. Staged migration, retained diagnostics, committed WAL pages, filesystem-only completions, immutable skill modes, token exclusion and re-export with permanent authority fences are covered.
- The independent post-browser audit passed **27/27 checks**, recomputing original fence hashes and exact release binding, inspecting both databases after shutdown and verifying current owned artifact bytes. See the [sanitized audit](INSTALLATION-RECOVERY-VALIDATION.json).
- Independent application review passed **8 HTTP/startup/UI-model checks** and **32 restored-spending checks**. These overlap the full suite. Provider guard tests use injected responses to verify exact known-task recovery, unknown liability and zero imported first POST.

Permanent regressions are in the server's `installation-backup`, `installation-restore`, `installation-recovery`, `installation-recovery-http` and `installation-recovery-startup` test files, plus the web recovery/spending tests. Reproduce with Node 24 and pnpm 10.33.0:

```sh
OPENSLATE_CODEX_PROBE_BINARY=/absolute/path/to/codex pnpm check
```

## Limits

This is same-root offline recovery on the verified macOS installation. It does not prove relocation, online backup, installation merging, all operating systems, physical power-loss behavior or performance at the 256 GiB/100,000-file ceilings. The browser used fixture media; real media billing, expired-result recovery and provider account access remain separate live gates. File-picker behavior was not exercised. Private databases, bundles, tokens and raw operational evidence are not repository artifacts.

See [the recovery contract](INSTALLATION-RECOVERY.md) and [current status](STATUS.md).
