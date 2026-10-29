# Card D1: the Director must not inherit the person's own Codex instructions

Read `_review-common.md` in this folder first.

**What happened.** The owner's real Director turns now fail at start with `RUNTIME_INSTRUCTIONS_UNEXPECTED` (`packages/director/src/runtime/codex.ts`, the `instructionSources` check after `thread/start`). They were not dispatched. Since 10/23 the owner's Codex home (`~/.codex`) holds a personal `AGENTS.md`. The native Director runs with that home as `CODEX_HOME`, because it needs the ChatGPT sign-in kept there, so Codex loads the file as a user instruction source. `project_doc_max_bytes: 0` only disables project documents. The check is right to refuse; the Director just must never pick such files up. The person sees only "The Director stopped with an error", with no reason.

Do not read or change anything in the owner's `~/.codex` besides what this card describes. Never read, copy or print `auth.json` or any token. Tests use temporary homes.

1. **A private Codex home for the Director.**
   - The native runtime (setup and every turn) runs with a `CODEX_HOME` the studio owns, under the installation's storage. It must not overlap the existing projection, snapshot and storage path checks in `packages/director/src/runtime/setup.ts`.
   - That home contains only what Codex needs to use the person's sign-in: a symbolic link to the selected home's `auth.json` (never a copy, so no token is written by the studio), plus the config the studio already passes.
   - It contains no `AGENTS.md`, `AGENTS.override.md`, prompts, rules, skills or other instruction files, and no other settings from the person's home.
   - Token refresh writes through the link into the person's own file. Verify that Codex accepts a linked `auth.json`, both for reads and for refresh writes. If it does not, report it and propose the safest alternative without implementing a token copy.
   - Recreate the link if it is missing or points elsewhere; refuse with a clear setup error if the selected home has no sign-in.
2. **Keep the check, and explain it.**
   - If Codex still reports instruction sources, keep refusing.
   - Record the reported sources as safe metadata on the turn: the file names and the folder they came from, with the home folder shown as `~`, never contents. Map the error to a native diagnostic the web can show.
   - en: "Codex loaded extra instruction files ({files}), so the Director did not run. Nothing was sent or charged."
   - zh: "Codex 带进了额外的指令文件（{files}），导演为安全没有运行。没有发送任何内容，也没有计费。"
   - Put the copy in `apps/web/src/next/i18n/catalog/errors.ts`, and map it where the web turns Director failures into messages. Name the web files you touch.
3. **Setup and selection** use the same private home, so Settings' Codex check and the turns agree. Existing installations upgrade to it automatically on the next start; no person action is needed.
4. **Tests**:
   - a selected home that holds `AGENTS.md` and a linked `auth.json`: the Director starts with no instruction sources, using a fake native runtime that reports sources from its `CODEX_HOME`;
   - the link is created, repaired and never a copy (check with `lstat`);
   - a missing sign-in gives the setup error;
   - a runtime that still reports a source is refused with the new diagnostic and copy;
   - nothing reads `auth.json` contents.
   - Keep the existing native tests green.

Report how you verified Codex's handling of a linked `auth.json` (the exact Codex version, and which checks ran against the real binary without any network). The lead will run one real Director turn with the owner's permission afterwards.
