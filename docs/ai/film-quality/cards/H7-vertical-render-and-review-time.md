# H7 · Three faults found by the first real films with skill 2.2.0

Read `docs/ai/uiux-plan/codex/RULES.md` first; its hard rules apply in full. You own `apps/server/src/code-plan/**`, `packages/core/src/aspect.ts`, `packages/director/src/runtime/policy.ts`, and their tests. Stay out of `skills/**` and `apps/web/**`.

Two real films were made on 2026-11-17 (`data/test-runs/20261117-h-films`). They found these.

## 1. A vertical code film is rendered widescreen

The second film is vertical: its keyframes and clips are 9:16 and its plan renders with `width: 1080, height: 1920`. The render came out 1920×1080, cropping the flowers. The Director saw it in its render review, rendered again and got the same.

Cause: `apps/server/src/code-plan/execution.ts`, at render admission for a Viggle film, replaces the plan's size with `codePlanExportSize(project, resolution)`. That reads the film's aspect from `projectAspect(project)`, which a code film never sets, so it is always 16:9. This came in with G1 (commit `ae17b23e`).

Change: the resolution setting decides how large the export is; the plan decides its shape.

- One pure function gives a code film's render size from the resolution, the render input and the measured sources: when the plan gives `width` and `height`, keep that shape (portrait when the height is larger, square when equal, widescreen otherwise) at the resolution's size; when it gives none, take the shape of the first timeline row whose measured size is known; only then fall back to the film's aspect.
- Use it at render admission, for the `ZOOM_SOFT` finding and for the fit warning, so all three agree.
- A film already rendered keeps its recorded attempts; a new render gets the new size.

Tests: a plan with `width: 1080, height: 1920` at 1080p renders 1080×1920, and at 768p renders 720×1280; a plan with no size and portrait clips renders portrait; a widescreen plan is unchanged; a square plan renders square. Include one end-to-end render through the executor, not only the pure function.

## 2. Cut-list findings before the shots are declared

The first film's plan declared its scene (with `cuts`), then awaited its shared pictures, then declared its shots. At the first dry run only the scene had been reached, and the diff reported `CUTS_UNKNOWN_CLIP: Cuts name undeclared shots: look, grab, escape, payoff` although every one is declared.

Change: report `CUTS_UNKNOWN_CLIP` and `CUTS_UNUSED_SHOT` only when the pass has declared at least one shot. `CUTS_SHAPE` and `CUTS_LENGTH` are unchanged.

Tests: a pass with `cuts` and no shot yet reports neither; the existing cases still pass.

## 3. The review turn runs out of time, and nobody is told

The Director's turn limit defaults to 180 seconds (`CODEX_RUNTIME_LIMITS.runTimeoutMs`). Measured on the two films, with the Director on `gpt-6.1-sol`:

| Turn | Seconds |
|---|---|
| First turn (idea and plan) | 131, 143 |
| Review of the clips | 180 (cut off), 175, 75 |
| Review of the render | 413, 399 |

In the first film the review of the clips was cut off at 180 seconds after it had read all four contact sheets. Reviews then return without stopping, so the film was rendered from the planned ranges and nothing on screen said the footage had not been watched.

Change:

- Raise the default run limit to 600 seconds, the existing maximum. `OPENSLATE_DIRECTOR_RUN_TIMEOUT_MS` still overrides it.
- When a review turn ends without finishing (a timeout or a failure), record one line from the application in the Director's thread, in the same way the repair path already writes "The plan in version N still fails after two automatic repair attempts…": "The review of the clips did not finish, so the film was cut from the planned ranges. Ask the Director to review the clips again." Use the existing mechanism; do not add a new one.

Tests: the default limit; the thread line after a review turn that times out, and none after one that completes.

## Finish

Run `pnpm build`, the touched test files with `node scripts/run-tests.mjs`, and `pnpm -r typecheck`, with exact counts. The lead runs the full suite afterwards. Write `docs/ai/film-quality/reports/H7-report.md`.
