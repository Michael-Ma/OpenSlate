# Card B19: no doubled full stops in composed prompts

Read `docs/ai/uiux-plan/codex/RULES.md` first and follow it (no git, no Chrome or browser checks).

The lead's visual review found that the composed picture and video directions that the Plan's "Exactly what the models are sent" panel shows (and that are really sent to the models) contain doubled full stops: `one lamp on.. The clerk pulls the shutter halfway down.. Low-angle wide over the counter`. The parts (purpose, action, framing, motion and the like) are joined with ". " even when a part already ends in punctuation. The browser scenario `scripts/browser/next-plan-parity.mjs` even locks the doubled stop into its expected text.

Fix the composition at its source (find every place that joins prompt parts, server and packages, and any web mirror of it): trim each part, skip empty parts, and add a full stop only when the part does not already end in terminal punctuation (`.`, `!`, `?`, `…`, `。`, `！`, `？`). Keep everything else about the text identical, so prompts that had no doubled stop do not change. If a frozen fixture, catalog or skill package encodes the doubled form, report it instead of editing it. Update the browser scenario's expected text (you may edit `scripts/browser/next-plan-parity.mjs` for this; do not run it). Unit tests first: parts ending with each punctuation mark, empty parts, Chinese text, and an unchanged prompt.

Checks: `pnpm build`, the touched test files, the full `pnpm test`, `pnpm -r typecheck`. Report with the RULES headings.
