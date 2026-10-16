# B19 — prompt joins

## Done

- **B19** (no separate gap id in the card): added the pure `joinPromptParts` helper in core and exposed it through the browser-safe public entry. Each part is trimmed, whitespace-only/empty parts are omitted, and a separating full stop is added only if the preceding part does not end in `.`, `!`, `?`, `…`, `。`, `！` or `？`. Parts are separated by one space.
- Used the same helper for the server's actual saved image/video prompts, the Plan editor's simultaneous direction/prompt saves, and the mutable fixture transport's single-field, multiple-field and motion edits.
- Preserved the final part's original ending, the direction header/separator and reference details. Ordinary unpunctuated joins retain their previous exact output; text and punctuation inside a part remain verbatim. Existing saved prompts are not migrated.
- Corrected the browser parity expectation to require one stop at both purpose/action and action/framing boundaries. The scenario was syntax-checked only.
- Audited other packages and seed/catalog/skill sources. No frozen fixture, catalog or skill package was found to encode the doubled prompt form. Static seed templates that append motion to an existing prompt already produce correct current text and were left untouched.

## Files

Changed:

- `packages/core/src/public.ts`
- `apps/server/src/storyboard.ts`
- `apps/web/src/next/model/plan.ts`
- `apps/web/src/next/fixtures/routes/plan.ts`
- `apps/web/src/next/fixtures/fixture-commands.ts`
- `apps/web/test/next/plan-model.test.mjs`
- `apps/web/test/next/plan-edit.test.mjs`
- `apps/web/test/next/plan-fixture.test.mjs`
- `scripts/browser/next-plan-parity.mjs`
- `docs/implementation/STATUS.md`

Added:

- `packages/core/src/prompt-parts.ts`
- `packages/core/test/prompt-parts.test.mjs`
- `apps/server/test/storyboard-prompts.test.mjs`
- `docs/ai/uiux-plan/codex/reports/B19-prompt-joins.md`

Deleted: none. The supplied, initially untracked B19 card was left unchanged.

## Tests

Added **18 test cases** before changing composition:

- Core: **11** cases covering all seven terminal marks at intermediate/final positions, trim/empty-only/no parts, Chinese text, unchanged ordinary prompts, single-part endings and preservation of internal whitespace/punctuation.
- Server: **3** cases covering both `shot` and `shotFields`, exact image/video direction and retained reference words, idempotent same-request replay, repeated motion recomposition and whitespace-only legacy parts.
- Web Plan model: **1** case exercising every terminal mark through the browser mirror and preserving reference text exactly.
- Mutable fixture transport: **3** cases covering single-field and multiple-field Plan edits and a Keyframes motion edit, including punctuated framing immediately before camera movement.

Rewritten: **2 existing unit expectations** (`plan-edit` and `plan-fixture`) that required doubled full stops. Updated **1 browser scenario expectation** for the corrected direction. No test cases deleted, disabled or skipped by this change; integrity tests remain.

The pre-fix run reproduced the expected regressions: **54 passed, 10 failed** (including the new helper test file's missing export). After implementation:

| Check | Result |
| --- | --- |
| Node / pnpm / media | Node 24.15.0, pnpm 10.33.0, FFmpeg/ffprobe 8.1.1 |
| `pnpm setup:test-media` | Passed with existing binaries; no download |
| `pnpm check:toolchain` | Passed |
| `pnpm build` | Passed all five packages/apps |
| Touched tests | **74 passed**, zero failures/cancelled/skips/todo |
| `pnpm test` | **3,114 passed**, zero failures/cancelled/todo, **1 optional native-probe skip** (**3,115 total**) |
| `pnpm -r typecheck` | **5 passed**, zero failures: core, providers, director, server and web |
| `node --check scripts/browser/next-plan-parity.mjs` | Passed; no browser launched |

Touched-test command:

```sh
node scripts/run-tests.mjs packages/core/test/prompt-parts.test.mjs apps/server/test/storyboard-prompts.test.mjs apps/web/test/next/plan-model.test.mjs apps/web/test/next/plan-edit.test.mjs apps/web/test/next/plan-fixture.test.mjs
```

The build retains its existing advisory about a web chunk over 500 kB. Independent source/test review found no must-fix issue; the reviewer did not independently run tests or a browser.

The one skipped case is `opt-in native Codex probe never starts a model turn`; B19 did not enable the optional native probe. Changed/new-file whitespace checks also passed.

## Contract changes

None to `packages/core/src/studio-api.ts`. The only new public runtime export is the pure, browser-safe `joinPromptParts` helper; no HTTP shape, schema, migration, catalog or skill package changed.

## Commits

No commits made. Proposed single atomic commit:

`fix(prompts): avoid doubled stops in composed directions`

File list: every changed and added file listed under Files above. Keeping the shared export, all consumers and their tests together avoids a consumer depending on an unavailable helper.

## Open issues

- Browser replay remains with the lead, as required by RULES. No browser check was launched.
- No stored prompt migration or cleanup of punctuation already present inside user-authored/reference text; source recomposition fixes the generated separators on subsequent direction edits.
- No real model/provider call, external network request, credential read, production-state access/restart or port 3001 listener occurred. Checks used existing toolchain binaries, fake transports and disposable test state.
- Process exception: one initial read-only `git status --short` ran before RULES was loaded. No subsequent Git command or Git mutation occurred; baseline snapshots and ordinary file diffs were used for review.
