# Card B18: a conflict is a changed value, not a moved head

Read `docs/ai/uiux-plan/codex/RULES.md` first and follow it, with one change: this card edits apps/web (the owner asked Codex to do testing and fixing). Do NOT launch Chrome or run browser checks (RULES item 3); the lead runs them outside the sandbox.

## Problem (found by the lead reviewing B17)

B17 binds long-lived drafts to the head version they were opened at, and treats any later head as a conflict:

- Inspector edits: `store.ts` `saveEdit` refuses with `EDIT_BASELINE_CHANGED` when `original.expectedHeadVersion !== snapshot.project.headVersion`, and `Inspector.tsx` shows the conflict alert ("keep my text / use the saved one") whenever `draft.expectedHeadVersion !== snapshot.project.headVersion`.
- Music level: `model/film-gain.ts` `gainConflict` compares `headVersion` as well as `audioId` and `gainDb`.

The head moves on every project save: a keyframe or clip landing, narration speech, another shot's edit, a Director change elsewhere. So a person editing 2.3's prompt while Scene 2 generates sees a false "someone changed this" alert and Save fails again and again. That is a regression in the main flow.

## Rule (the lead's decision)

A draft conflicts only when **the values it edits** changed since it began. The head is not a value.

1. When Save is pressed (and when the inspector renders), read the edited fields from the displayed projection at `displayedHead(...)`:
   - prompt / image prompt: that field;
   - the motion form: `motion` and `durationFrames` together;
   - narration: `narration.text`;
   - music level: `audioId` and `gainDb`.
2. Equal to the draft's baseline: **no alert**. Save sends the current displayed head as `expectedHeadVersion` (rebase silently).
3. Different: the existing conflict alert with the saved value; nothing is sent until the person chooses (B17 behaviour, keep it).
4. `displayedHead` is null (snapshot and overview disagree for a moment): neither a conflict nor a refusal toast. Save is disabled with the existing "updating" style reason, or waits for the next consistent projection; never show `EDIT_BASELINE_CHANGED` for this.
5. The server refuses a stale head (another save landed between render and press): keep the draft, refresh, and re-apply rules 2/3 against the fresh projection. If the field is still equal to the baseline, the person's next press saves; no conflict alert. Do not loop automatically.

Put the comparison in a pure model function (for example `model/edit-conflict.ts`: `editConflict(draft, overview, head) → { kind: "none" | "changed" | "waiting"; saved?: ... }`) used by both the store and `Inspector.tsx`, and use the same idea in `film-gain.ts`. Keep every other B17 guarantee: film/epoch fencing, revision fencing of late replies, drafts kept across navigation, no overwrite of a newer saved value.

Also check the other B17 baselines against this rule and report each: Plan (`model/plan-conflict.ts` is already field-level; confirm), Director settings (digest; confirm it is per-selection, not per-head), FilmView instant edits (`runEdit` uses the head shown at press; acceptable, but `writable` must not flicker to disabled on every refresh during generation: only disable while the projections actually disagree).

## Tests (unit, failing first)

- Edit 2.3's prompt at head 12; another shot's keyframe lands (head 13, 2.3 unchanged): no conflict, Save posts `expectedHeadVersion: 13`, the draft closes with the Saved toast.
- Same, but 2.3's prompt changed at head 13: conflict alert with the saved text, no POST until a choice; "keep my text" then Save posts with head 13.
- Motion form: duration changed elsewhere → conflict; only another field of the same shot (e.g. narration) changed → no conflict.
- Projections disagree: no POST, no error toast, no alert; Save works once they agree.
- Stale-head refusal from the server: draft kept, no alert when the field is unchanged, next press saves.
- Music level: head moves while dragging → no conflict; `gainDb` or `audioId` changed → conflict.

## Browser scenario (write it, the lead runs it)

In `scripts/browser/next-keyframes.mjs` add `next-keyframes-edit-while-generating`: open 2.3's prompt edit, type, make the fixture advance the head with an unrelated change (another shot's keyframe or a storyboard edit on 2.1 through the fixture's own routes), press Save → "Saved" toast, no `[data-act="edit-conflict"]`. Then a second edit where the fixture changes 2.3's own prompt → the conflict alert shows, keep my text, Save → saved.

## Checks

`pnpm build`, `node scripts/run-tests.mjs apps/web/test/*.test.mjs apps/web/test/next/*.test.mjs`, `cd apps/web && pnpm typecheck`, `node --check` on the scenario files you touched, then the full `pnpm test`. Report per rule: the test, the fix, files.
