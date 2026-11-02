# B16 merged-branch verification and fixes

Implemented on `cx/b16` on October 16, 2026. This report follows `codex/RULES.md` and card B16's permission to edit the web app. Changes remain uncommitted for lead review. The fixed Last Ferry design and browser-facing contract are unchanged.

## Done

The initial required sequence passed: `pnpm build`, `pnpm test` (**3,222 passed, zero failures, one optional native-probe skip; 3,223 total**) and `pnpm -r typecheck` (**five packages passed, zero errors**). No unit test failure or stale merged-card expectation required repair. The fixes address all ten scenarios recorded by the lead in `codex/browser-failures.md` (155/165 passed at commit `5503b99`).

### Preview picture action: seven scenarios

Affected scenarios:

- `next-director-pictures`
- `next-director-pictures-scope`
- `next-director-pictures-refused`
- `next-director-pictures-limit-and-ffmpeg`
- `next-director-pictures-no-ffmpeg`
- `next-director-draft`
- `next-director-parity-chinese`

All seven timed out clicking the same Show the Director button. Its absolute top-right placement at z-index 2 overlapped the newer preview header's media/navigation group at z-index 3. This was a real layout bug. The button now participates in the existing wrapping header row; obsolete absolute positioning is removed. Eligibility, picture identity and candidate validation are unchanged.

Files: `apps/web/src/next/keyframes/Preview.tsx`, `apps/web/src/next/keyframes/keyframes.css`, `apps/web/src/next/director/director.css`, `scripts/browser/next-director-parity.mjs`.

The existing scenarios retain their normal clicks and assertions. Added browser checks use real geometry and `elementFromPoint` to require unobscured, nonoverlapping controls at 1440px and 390px, including a shot with media toggles. The control is scrolled into view before hit testing. These layout assertions require the lead's browser rerun; node unit tests cannot verify rendered geometry.

### Export dates: two scenarios

`next-film-export` and `next-film-chinese` assumed the latest fixture export always read Today. The preset creates an export thirty minutes before now, so running near local midnight correctly renders the previous calendar date. The renderer was correct; the browser assertions depended on the wall clock.

Both scenarios now fix only the browser's Date to local noon and reload before opening Film, rebuilding the preset under that same clock. Timers still run normally, and the original exact Today/copy assertions remain. A new bilingual unit case checks both the previous-day midnight boundary and the same-day noon result.

Files: `scripts/browser/next-film.mjs`, `apps/web/test/next/film-export.test.mjs`.

### Disconnected draft handoff: one scenario

`next-recovery-shell-disconnect-draft-live` exposed a real duplicate restoration. The new tab consumed the one-shot Disconnect carry, but the original tab's Retry independently restored a second copy from the ordinary per-film composer cache.

The original page now remembers which projects it relinquished through a successfully stored handoff. Its draft watcher skips restoring or removing those shared cache entries until this page takes an unconsumed carry itself or has its own new draft. The receiving tab's words, chips and picture references remain cached. The existing cache synchronization is extracted into a node-testable watcher. The scenario waits for `data-draft-ready` instead of sleeping for 500 ms.

Files: `apps/web/src/next/boot.tsx`, `apps/web/src/next/store/react.tsx`, `apps/web/src/next/director/DirectorColumn.tsx`, `apps/web/src/next/director/useComposerDraft.ts`, new `apps/web/src/next/director/composer-draft.ts`, new `apps/web/test/next/composer-draft.test.mjs`, `scripts/browser/next-recovery-shell.mjs`.

Six new watcher cases cover consumed-origin suppression across refresh/remount; receiver reload and untouched cache/pictures; explicit unconsumed carry; self-claimed carry with cached pictures/chips; ordinary reload, film switching and separate sample keys; new origin words ending the exclusion; and blocked/full/unavailable storage. Some cases cover several related boundaries.

## Verification

Pinned **Node 24.15.0**, **pnpm 10.33.0**, **FFmpeg/ffprobe 8.1.1**. `pnpm setup:test-media` and `pnpm check:toolchain` passed with installed binaries and no download.

After fixes, `pnpm build` passed, then the required touched-file test runner plus related regression files passed **86/86, zero failures/skips/todo**:

```text
node scripts/run-tests.mjs apps/web/test/next/composer-draft.test.mjs apps/web/test/next/film-export.test.mjs apps/web/test/next/shell-states.test.mjs apps/web/test/next/director-parity.test.mjs apps/web/test/next/keyframes-parity.test.mjs
```

`node --check` passed for all three changed browser scenario modules. Seven node cases were added; no tests were deleted. Browser scenarios were strengthened or made deterministic, without weakening generation, money or integrity checks.

Two consecutive complete post-fix sequences passed, in the required order each time:

| Command | Round 1 | Round 2 |
| --- | --- | --- |
| `pnpm build` | Five packages passed; zero failures | Five packages passed; zero failures |
| `pnpm test` | 3,229 passed, zero failed/cancelled/todo, one skipped; 3,230 total | 3,229 passed, zero failed/cancelled/todo, one skipped; 3,230 total |
| `pnpm -r typecheck` | Five packages passed; zero errors | Five packages passed; zero errors |

Full test durations were **236,257 ms** and **234,219 ms**. The sole skip in each run was the existing `opt-in native Codex probe never starts a model turn`; no model run was enabled. The initial full suite took **232,967 ms**. All command processes exited zero. Builds retained the existing nonblocking Vite chunk-size warning.

Final `git diff --check` passed. Full logs were kept in `/tmp/openslate-b16-baseline-{build,test,typecheck}.log`, `/tmp/openslate-b16-round{1,2}-{build,test,typecheck}.log` and `/tmp/openslate-b16-targeted-test.log`.

Independent read-only review found no outstanding must-fix issue in the preview, handoff, readiness or date changes. Tests use disposable state and fake transports. No browser launch/check, real provider/model call, external network request, credential read, production-state access/restart or port 3001 listener occurred.

## Files

Changed:

- `apps/web/src/next/boot.tsx`
- `apps/web/src/next/director/DirectorColumn.tsx`
- `apps/web/src/next/director/director.css`
- `apps/web/src/next/director/useComposerDraft.ts`
- `apps/web/src/next/keyframes/Preview.tsx`
- `apps/web/src/next/keyframes/keyframes.css`
- `apps/web/src/next/store/react.tsx`
- `apps/web/test/next/film-export.test.mjs`
- `scripts/browser/next-director-parity.mjs`
- `scripts/browser/next-film.mjs`
- `scripts/browser/next-recovery-shell.mjs`
- `docs/implementation/STATUS.md` (final verification entry)

Added:

- `apps/web/src/next/director/composer-draft.ts`
- `apps/web/test/next/composer-draft.test.mjs`
- `docs/ai/uiux-plan/codex/reports/B16-verify-and-fix.md`

Deleted files: none. No server source, schema, frozen tool catalog or skill package changed.

## Contract changes

None. `packages/core/src/studio-api.ts` is unchanged. The readiness data attribute is a local browser-test hook.

## Proposed commits

No commit, stash, checkout or reset was run. Proposed split for the lead:

1. `fix(web): keep preview picture action clear of navigation`
   - `apps/web/src/next/keyframes/Preview.tsx`
   - `apps/web/src/next/keyframes/keyframes.css`
   - `apps/web/src/next/director/director.css`
   - `scripts/browser/next-director-parity.mjs`
2. `fix(web): avoid duplicate disconnected draft restoration`
   - `apps/web/src/next/boot.tsx`
   - `apps/web/src/next/store/react.tsx`
   - `apps/web/src/next/director/DirectorColumn.tsx`
   - `apps/web/src/next/director/useComposerDraft.ts`
   - `apps/web/src/next/director/composer-draft.ts`
   - `apps/web/test/next/composer-draft.test.mjs`
   - `scripts/browser/next-recovery-shell.mjs`
3. `test(web): stabilize film export date assertions`
   - `scripts/browser/next-film.mjs`
   - `apps/web/test/next/film-export.test.mjs`
4. `docs: record B16 verification and remaining browser handoff`
   - `docs/implementation/STATUS.md`
   - `docs/ai/uiux-plan/codex/reports/B16-verify-and-fix.md`

## Open issues

- Browser rerun is reserved for the lead by RULES.md item 3. The recorded ten failures have source/scenario fixes, but their rendered results and the new hit-target assertions have not been executed here. No new browser pass count is claimed.
- Decision: keep the draft fix scoped to the reported same-page reconnect. Relinquishment survives store replacement, film switching and watcher remounts for the lifetime of this page. A full reload of the original tab retains the established shared per-film cache behavior and may restore the shared draft. This card does not introduce durable per-tab draft ownership.
- Decision: keep actual calendar-date formatting. The browser test clock, rather than product copy or fixture production logic, removes the midnight assumption.
- No questions or external access were required. Changes remain uncommitted for lead review as the card rules require.
