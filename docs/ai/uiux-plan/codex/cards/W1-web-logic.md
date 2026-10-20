# Card W1: web logic fixes from the deep review

Read `_review-common.md` in this folder first. This card edits `apps/web` logic, models, fixtures, tests and catalogs. Keep markup and CSS changes minimal; the lead owns visual design.

Do not touch these; the lead is changing them in parallel:
- `apps/web/src/next/model/note-banner.ts`, `apps/web/src/next/keyframes/NoteBanner.tsx` and the notes catalog
- `apps/web/src/next/views/film/**`
- `apps/web/src/next/model/film-export.ts` and the film catalog

The new contract fields exist in `packages/core/src/studio-api.ts`. The server halves arrive from other cards, so build against the types and the fixture (`apps/web/src/next/fixtures/**`). Update the fixture so it produces the new fields the way the server will.

Use the exact copy given here (en and zh). Put new keys next to their siblings.

1. **ui-1.** A narration edit opened from a Director note or a check is settled whenever Save succeeds, including the composite path (text plus mode, or text plus voice).
   - `runNarrationEdits` returns the command id of the text edit (or the last edit).
   - NarrationPanel calls an `onSaved(commandId)` callback before it closes. KeyframesView runs `notes.editSaved` and the check-settle logic in it.
   - Tests: a note on an undecided-mode shot, and line plus voice changed together.
2. **ui-3.** Keep one "Choose a file…" button at a stable place in the tree and move only the refusal text, so focus stays on the button when the refusal appears or clears. Test (fake DOM) if feasible; otherwise explain in the report.
3. **ui-4.** During scene clip playback, a shot whose clip is no longer ready is skipped: Preview calls onEnded once, keyed on the shot and clip availability. Test.
4. **keyframes-regenerate-identity-ignores-replacement.** keyframeJob includes the replacement's state, attemptId and failure.at, so a running or failed replacement proves the earlier press landed. Test.
5. **keyframes-voice-only-make-keyframes-label.** The Make label counts only shots whose keyframe is not ready.
   - When only voice lines are missing:
     - label `panel.make_voice_lines` en "Make {count, plural, one {# voice line} other {# voice lines}}", zh "生成 {count} 条配音";
     - note `panel.make_voice_lines_note` en "The keyframes are ready. Make the voice lines, then confirm.", zh "关键帧已就绪。先生成配音，再确认。";
     - breakdown `panel.each.voice_lines` en "{count, plural, one {# voice line} other {# voice lines}} at about {each}", zh "{count} 条配音，每条约 {each}".
   - When both are missing: breakdown `panel.each.keyframes_voices` en "{keyframes, plural, one {# keyframe} other {# keyframes}} and {voices, plural, one {# voice line} other {# voice lines}}", zh "{keyframes} 张关键帧和 {voices} 条配音".
   - Tests.
6. **plan-impact-clip-unpriced and narration-voice-price-missing (web half).**
   - `clipUnit`, `unitPrices` and `voiceUnit` prefer `scene.quotes.oneClip` and `quotes.oneVoice`, falling back to any scene's.
   - The last-ferry fixture must send the server's real shape: a confirmVideo with zero units for a fully made scene, plus oneClip and oneVoice.
   - Tests: a fully made scene prices a clip remake and a voice remake.
7. **narration-fit-contract-drift (web half).**
   - The extend target is `shot.narration.fitSeconds`. Remove the web's own `ceil(line + 0.3)` rule.
   - An estimated line (no measuredSeconds) gets no Make or Keep. It shows `check.narration.estimated_body` en "{label}'s line looks longer than the shot. Make its voice line to measure it, or shorten the words.", zh "{label} 的旁白估计比镜头长。先生成配音来测量长度，或缩短台词。", with only the Edit narration action.
   - Align the fixture's fit rule with the server's (narrationFitFrames, no pad, measured lines only).
   - Tests.
8. **narration-keyframes-run-invisible (web half).**
   - The video panel reads `scene.keyframesRun` as well as `scene.confirmation` for the current step and the stop reason. Use the existing voice-step copy where it fits; otherwise `panel.voice_run.making` en "Making voice lines…", zh "正在生成配音…".
   - Make keyframes is disabled while it runs (blocker confirmation_running).
   - Inspector Regenerate is disabled while the scene has `confirmation_running` (the server now refuses it), with `error.CONFIRMATION_RUNNING` as the reason if that entry exists, else add en "The scene is being confirmed. Wait for it to finish.", zh "这一场正在确认中，请等它完成。".
   - Tests.
9. **video-02 and video-04 (web half).**
   - `takenOff: "confirmation_stale"` shows `card.video.confirmation_stale` en "Not made: the scene changed after you confirmed. Confirm again.", zh "未生成：确认后这一场有改动。请重新确认。".
   - `ingestionIssue` shows `card.video.download_issue` en "Finished at the service, not saved yet: {reason}", zh "服务端已完成，但还没保存：{reason}".
   - The reasons go in errors.ts:
     - OUTPUT_DOWNLOAD_LOCATOR en "the download address is not on the allowed list", zh "下载地址不在允许列表中";
     - OUTPUT_DOWNLOAD_EXPIRED en "the download link expired", zh "下载链接已过期";
     - OUTPUT_DOWNLOAD_ADDRESS en "the download address was refused", zh "下载地址被拒绝";
     - fallback en "the download failed; the studio keeps trying", zh "下载失败，studio 会继续尝试".
   - Never offer give-up for an ingestion issue. Tests.
10. **film-length-inflight-clip (Keyframes inspector half).** `editImpact` for a duration or motion edit while the shot's clip (or a clip replacement) is running says `inspector.outdates.running_clip` en "The clip being made will still be charged and come back out of date.", zh "正在生成的视频仍会计费，回来后会是过期的。". The lead does the Film view. Test.
11. **plan-delete-shot-running-job (web half).** The shot's delete action is disabled while the shot has running or no-answer work, with the reason from `error.ATTEMPTS_RUNNING`. Test.

Checks: `pnpm build`, `node scripts/run-tests.mjs apps/web/test/*.test.mjs apps/web/test/next/*.test.mjs`, `pnpm -r typecheck`, then the full `pnpm test`. You may edit browser scenarios under `scripts/browser/` if a text or flow they assert changes, but never run them; list which ones the lead should run.
