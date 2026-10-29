# Card R7: export finishes on real footage and gives true reasons

Read `_review-common.md` in this folder first. Files: `apps/server/src/media/local-media.ts`, `apps/server/src/media/application.ts`, `apps/server/src/media/routes.ts`, `apps/server/src/media/storyboard-capture.ts`, the audio placement helper it uses, `apps/server/src/narration/shot-audio-routes.ts` (the playback projection only), and `apps/web/src/next/i18n/catalog/errors.ts` (the MEDIA_BUSY entry only). The lead does the other web changes.

1. **film-render-timeout.**
   - Scale the export render's time limit with the manifest: a base plus a per-frame allowance, bounded by the existing maximum.
   - Let the encoder use more than one thread where that does not break the determinism the tests rely on. Check whether any test compares render hashes, and report what you chose and why.
   - Test the limit computation. Add a small acceptance check with detailed, non-flat content that runs in the normal suite within a few seconds.
2. **film-export-media-busy.**
   - An export that finds the shared FFmpeg worker busy waits for it, or stays prepared and retries; it does not fail at once.
   - Add `error.MEDIA_BUSY` (en "Another media job is using FFmpeg. The export starts when it finishes.", zh "另一个媒体任务正在使用 FFmpeg，它结束后导出就会开始。") in case a busy state is still shown.
   - `exportView` prefers an export that is still rendering over a newer failed one as current.
   - Tests.
3. **film-shutdown-marks-cancelled (polish).**
   - A shutdown abort is not a person's cancel: record it as interrupted (cancelRequested false), so the panel reads "OpenSlate restarted while this export was rendering".
   - Keep `media-http.test.mjs` coherent: rewrite its assertion, say so in the report, and keep any test that protects a real person's cancel.
4. **film-mixed-demo-false-reason.**
   - `mixed_demo_media` names the medium that differs, with `medium: "music" | "voice" | "clip"`.
   - A non-demo soundtrack gives one blocker with medium "music" and no shotId, not a blocker on every shot.
   - An own recording gives a blocker on that shot with medium "voice".
   - Mixed clips keep the per-shot clip blocker.
   - Tests for each.
5. **film-absolute-narration-reorder (legacy projects only).**
   - An absolute placement counts as current only when its atSample equals the start of the cut its cue maps to. Otherwise that shot reports `voice_unsettled`, in readiness and in the playback projection alike.
   - Test: reorder, then lengthen.
