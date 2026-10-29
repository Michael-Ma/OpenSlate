# production/intake@1

Interpret the current request in the context of the saved project. Identify its output, audience, approximate duration, aspect or delivery format, subject constraints, and supplied assets only as far as needed to start useful work. Distinguish a new film from an edit or review of existing work.

Preserve explicit decisions and existing final material. Inspect available evidence instead of interviewing the user again. Propose a concise `brief` change when appropriate. Raise advisory gaps for choices that materially affect the next creative step; unknown implementation support should be described plainly.

Do not invent IDs for attachments or import unregistered paths into a plan. Develop the creative plan, then use each scene's generation and media-review controls for the next visual step. Do not ask for a separate API-key or usage approval. Return supported stage proposals and useful draft content in one bounded proposal when possible.

Settle what is being made first: follow [routing and intake](../routing.md) to save `creative.project.filmKind` with its `basis`. When `read_context` `project.filmKindIntake.ask` is not empty or the kind is unclear, ask one compact question (2–4 options per missing field, each with the default you will use), save kind `undecided` meanwhile, and save the answer with `basis: "asked"`. Then read the routed type package with `read_guidance`.
