# Card B20: one truthful story for waiting clips, own recordings and restarts

Read `docs/ai/uiux-plan/codex/RULES.md` first and follow it, with these changes: this card may edit apps/web (logic and models; the lead owns visual design, so keep markup/CSS changes minimal), and do NOT edit `docs/implementation/STATUS.md` (put your report only in `docs/ai/uiux-plan/codex/reports/B20-state-truth.md`). No git, no Chrome or browser checks (RULES item 3); you may edit browser scenarios, the lead runs them.

The lead's visual review and UI fix batches found three logic problems.

## 1. Server: "review" is used for things that are not a person's review (server half)

In `apps/server/src/generation-overview.ts`, `slot()` returns state `queued` with waiting code `review` for any bound candidate without an attempt. `review` is also used for `INPUT_PENDING` on a clip whose narration is not pending, and as the fallback for a missing or unknown wait (`codes[wait?.code] ?? "review"`). `SceneOverview.state` then counts every queued slot, including those waiting for the person's scene confirm, as `making_video` (`shots.some(s => ["running","queued"].includes(s.video.state))`), while the scene row says `videoPending=false` and `canStop`/the web's film model treat them as not running. The web (merged UI fixes) now treats `review` as "waits for the person's confirm" and offers that confirm.

Fix: `making_video` comes only from running attempts and from queued work that is actually going to run (not from slots waiting for the person). `INPUT_PENDING` and unknown/missing waits get their own honest codes instead of `review` (a minimal `WaitingReason` addition in `packages/core/src/studio-api.ts` is allowed; list it under Contract changes), and the web models (`apps/web/src/next/model/{keyframes,film,shell-states}.ts` and wherever waiting codes are mapped to copy, both en and zh catalogs) handle the new codes with plain wording. Tests on both sides.

## 2. Web: your own recording upload shows the edit-conflict alert (B18 regression)

Adding a recording through the inspector's narration panel immediately shows the conflict box ("This shot changed while you were editing… Saved value: Uploaded narration recording", Keep my text / Use saved text). The person's own successful write must move the draft's baseline to the values it saved (as an own Save does), never be treated as someone else's change. Find every own-write path in the narration panel (recording add, recording words, voice or mode change, fit choices) and check the same. Unit test first; add an assertion to the recording-added browser scenario in `scripts/browser/next-narration.mjs` that no `[data-act="edit-conflict"]` shows after Add recording.

## 3. Web: the restarted live film contradicts itself

In the live studio after a restart (scenario `next-shell-restart` in `scripts/browser/next-shell.mjs`, Scene 1 of the fake-provider film): the scene line says "Scene 1 · 2 shots · needs attention" directly above a green "✓ Nothing to check in this scene." row, and nothing in the scene row says what needs attention (the reason is only in the restart banner). The video panel counts 1.1 as opened ("1 of 2 frames opened") and offers "Confirm frames & generate video" while 1.1's pill says "No answer from the service" and the banner warns its clip "may still arrive and be charged". Make the scene line, the check row and the panel agree: a shot with an unknown outcome is named where the person looks (check row or panel), and the scene's confirm is not offered (or says what it will and will not redo) while a paid outcome is unknown. Keep the existing money rules: no blind resubmission of an unknown outcome.

## Checks

`pnpm build`, the touched tests, `node scripts/run-tests.mjs apps/web/test/*.test.mjs apps/web/test/next/*.test.mjs`, the full `pnpm test`, `pnpm -r typecheck`, `node --check` on changed scenario files. Report with the RULES headings.
