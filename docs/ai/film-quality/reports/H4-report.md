# H4 — Skill 2.2.0: format first, then aim

## Implemented scope

Completed H4 items 1–5 in `codex/h4-formats-and-aims`. The lead's four prose files are byte-identical to the starting checkout. No web code, storyboard guidance release, archived code-plan package, tool catalog or browser contract changed.

- Released the code-plan package as **2.2.0**, keeping tool contract **0.3.0**, plan language **1.0.0** and workflow **1.0.0**.
- Declared all six files in the requested order: `SKILL.md`, `references/film-craft.md`, `references/formats.md`, `references/aims.md`, `references/studio.d.ts`, `references/example-plan.ts`.
- Added `format: "Short film"` and `aim: "Calm"` to the example's first scene; every other byte of the example is unchanged. The Studio declaration comment now lists `format` and `aim` first.
- Added request-source-based context filtering and refreshed the generated package digest using the repository's `readSkillPackageFiles` / `skillPackageDigest` implementation.

## Manifest field and turn behavior

The optional field is:

```json
"personTurnFiles": ["references/formats.md", "references/aims.md"]
```

The manifest validator accepts this field on schema 1 and schema 2 packages. It must be a bounded array of unique, safe package paths, each already present in `files`. Undeclared paths, the implicit manifest itself, traversal, duplicate paths, null and non-array values are refused. An empty array is valid. Absence stays absent: the parser adds no default field to historical manifests.

`codeDirectorInput` resolves the persisted request with `projectRequest` and filters **before** reading activated files:

| Request source | Supplied reference files | Recorded read evidence |
|---|---|---|
| `user` | All six, in manifest order | Six supplied files |
| `app` (including clip review, repair and media failure) | SKILL, film craft, Studio API, example | Four supplied files |
| `director` | The same four | Four supplied files |
| Any source, package without the field | Every file in that package | Every supplied file |

The decision uses source, not message wording or the existence of a repair/review marker. Explicitly user-authored application-like text still receives all six files. Existing legacy source projection remains in use.

The lock, activation's package identity and immutable snapshot continue to cover **all six files plus the manifest**, including both omitted references. Tampering with an omitted reference still fails snapshot verification. Filtering does not edit a manifest, snapshot, lock, past context or read record. A later user turn receives the idea files again.

## Release and preservation

New package digest:

`dbb6dade117658792552343f37ae3b87b2b458cb2cbea6717207935b4600c646`

Code-plan is a schema 1 package outside the storyboard release automation. Its release consists of the versioned manifest, exact generated `CODE_PLAN_GUIDANCE_DIGEST` and lock/snapshot/catalog tests. No row is added to `skills/shipped-releases.json`; the storyboard registry and existing release directories remain unchanged.

New code films and eligible fresh current-contract turns use 2.2.0 through the existing guidance-refresh path. Historical locks, snapshots, read evidence, plan source and media identities are not rewritten. Archived contracts 0.1.0 and 0.2.0 retain their packages and catalogs. The preservation regression uses a **synthetic** 2.1.0 predecessor with a templates reference, not a reconstruction of the exact historical release. It verifies the old lock, old reference bytes and saved read survive while the successor gets 2.2.0 without submitting a plan or buying media.

## Factual review and corrections

**Corrections: none.** No facts in the four protected prose files disagreed with the inspected implementation; their prose remains unchanged.

| Checked claim | Implementation evidence and limits |
|---|---|
| Captions carry text; vertical Chinese guidance is feasible | `apps/server/src/media/captions.ts`: at most 64 nonoverlapping captions, 1–80 Unicode code points, at most two measured lines, top/middle/bottom positions, installed CJK font required. Eight Chinese characters per line and seven per second are craft guidance below those bounds. |
| Voice-over can carry spoken lines over pictures | `apps/server/src/code-plan/provider-input.ts`, `models.ts`, and `skills/code-plan/references/studio.d.ts`: configured speech yields owned audio; render audio placements provide independent source trim, timeline position and gain. There is no code-plan lip-sync operation. |
| Music is generated and cannot be cut to heard beats | `packages/providers/src/gemini-lyria.ts`, `apps/server/src/code-plan/identity.ts`, `provider-input.ts`, and `clip-frames.ts`: prompt-based music, optional vocals, requested duration within 360 seconds, measured audio supplied for assembly; the Director receives pictures and motion measures, not an audio-listening/beat-analysis tool. |
| Uploaded photos can be held as stills | `apps/server/src/execution/local-media-executor.ts`: a still resolves any exact owned image of the film through `codePlanArtifacts` and `media.supplyStill`; it does not require a generated image. `identity.ts` limits each still to 1–300 ticks and forbids source start, speed and last-frame hold fields on a still. |
| Timeline limits and cut-only editing | `apps/server/src/code-plan/identity.ts`, `apps/server/src/media/local-timeline.ts`: 64 rows, 360 seconds, 48 kHz, 65 audio placements and eight simultaneous lanes; fixed punch-in, listed positive speeds and last-frame holds. No dissolve, wipe, split-screen or reverse operation. Frame positions remain 1/30-second ticks; code-film output uses 24 fps. |

The SKILL opening's statement that the idea references are supplied on person-started turns is now enforced by the server. The format/aim structures and craft recommendations were not rewritten as part of this factual check.

## Tests changed

**Added: 13 tests.** Eight skill-loader tests cover optional policy identity/snapshot preservation, empty/schema 2 policy verification, and six invalid-policy cases. Four Director tests cover both non-user sources and both archived manifests without the field. One package test checks links and removal of templates references using the actual package validator.

**Updated or strengthened: seven existing tests.** The package inventory/word-budget test replaces the obsolete five-file/9,500-word tripwire. The example test checks format/aim, every non-`own` basis against a bold structure/shape name, and zero findings at initial and completed dry runs. The Director pin and preservation tests expect 2.2.0. Existing repair, media-failure and end-to-end review tests verify the four-file context; review also verifies the four actual read records. **Deleted: zero tests.** Existing charging, replay, unknown-submission and stale-version protections remain.

Word counts use the existing whitespace-token tripwire:

| File | Words |
|---|---:|
| SKILL | 2,875 |
| Film craft | 2,188 |
| Formats | 3,323 |
| Aims | 3,503 |
| Studio API | 842 |
| Example | 1,092 |
| **All six, limit <14,500** | **13,823** |
| **Four application-turn files, limit <7,500** | **6,997** |

## Verification

Pinned toolchain: Node **24.15.0**, pnpm **10.33.0**, FFmpeg/ffprobe **8.1.1**, Hiragino Sans GB for CJK captions. `pnpm setup:test-media` reused the matching installed tools without downloading anything; `pnpm check:toolchain` passed.

| Check | Result |
|---|---|
| Skill/code-plan suites below | Exit 0; **684 passed, 0 failed, 0 skipped/cancelled/todo**, 306.222 s. |
| Final `pnpm build` | Exit 0; **5 workspace builds passed, 0 failed**. Existing Vite dynamic-import and bundle-size advisories only. |
| Final touched-file tests below | Exit 0; **94 passed, 0 failed, 0 skipped/cancelled/todo**, 14.383 s. |
| Direct strict Studio API/example typecheck below | Exit 0; **1 passed, 0 failed**. These reference files are outside workspace compilation. |
| Final `pnpm test` | Exit 0; **5,380 total; 5,379 passed, 0 failed, 1 skipped, 0 cancelled/todo**, 754.926 s. |
| Final `pnpm -r typecheck` | Exit 0; **5 passed, 0 failed**: `@openslate/core`, `@openslate/providers`, `@openslate/director`, `@openslate/server`, `@openslate/web`. |
| Source package / compiled guidance digest | Matched exactly. |
| Protected prose, archived packages, storyboard registry and browser contract | No diff. |
| `git diff --check` | Passed. |

Skill/code-plan suites:

```sh
node scripts/run-tests.mjs scripts/test/skills-release.test.mjs packages/director/test/*skill*.test.mjs packages/director/test/tools.test.mjs apps/server/test/director-guidance-release.test.mjs apps/server/test/director-skills-v8*.test.mjs apps/server/test/provider-catalog.test.mjs apps/server/test/code-plan-*.test.mjs
```

Final touched-file tests:

```sh
node scripts/run-tests.mjs packages/director/test/skills.test.mjs apps/server/test/code-plan-director.test.mjs apps/server/test/code-plan-review.test.mjs apps/server/test/code-plan-skill.test.mjs
```

Direct strict reference typecheck:

```sh
pnpm exec tsc --noEmit --strict --target ES2022 --module NodeNext --moduleResolution NodeNext --types node skills/code-plan/references/studio.d.ts skills/code-plan/references/example-plan.ts
```

Build/test/typecheck logs: `/tmp/h4-build-final.log`, `/tmp/h4-skill-code-plan-tests.log`, `/tmp/h4-touched-tests-final.log`, `/tmp/h4-example-typecheck.log`, `/tmp/h4-full-test.log`, `/tmp/h4-typecheck.log`. An earlier touched-file run passed 93/93 before the final empty-policy/schema 2 test was added; the final runs cover the finished tree.

The full suite is invoked as `env -u OPENSLATE_CODEX_PROBE_BINARY pnpm test` to keep the optional native probe explicitly disabled.
Its sole skip is `opt-in native Codex probe never starts a model turn`. There were no failing runs or unresolved test failures. All build/test/typecheck command processes exited normally.

## Files and proposed commit

Modified (10):

- `apps/server/src/application/director-capabilities.ts`
- `apps/server/src/code-plan/director.ts`
- `apps/server/test/code-plan-director.test.mjs`
- `apps/server/test/code-plan-review.test.mjs`
- `apps/server/test/code-plan-skill.test.mjs`
- `packages/director/src/skills/index.ts`
- `packages/director/test/skills.test.mjs`
- `skills/code-plan/openslate.skill.json`
- `skills/code-plan/references/example-plan.ts`
- `skills/code-plan/references/studio.d.ts`

Added (1): `docs/ai/film-quality/reports/H4-report.md`. Deleted: none.

Proposed single atomic commit: `feat(code-plan): release format-first guidance 2.2.0`, containing all 11 files above. The manifest, package pin, request filter and tests are released together. No commit, stash, checkout, reset or push was run.

## Self-review, contracts and remaining work

Reviewed the complete diff for manifest validation, missing-field compatibility, request-source selection, full-package hashing, read-evidence scope, historical record preservation, all example callers and failure coverage. Fixed the link-validation test's filesystem conversion to use `fileURLToPath`, so checkout paths containing escaped characters work correctly. Added coverage for an empty policy and schema 2 snapshot verification. No further correctness issue was found in the final review.

Contract changes: **none** to `packages/core/src/studio-api.ts` or any tool catalog. The only instruction-package extension is the optional manifest field described above.

The lead owns displaying format and aim in the idea panel. No browser or real-provider check was run. Tests use temporary fixture data and fake providers/transports; they establish local behavior, not subjective film quality or provider acceptance. No application service was launched on port 3001. No personal `.env` files, secrets or `.openslate` data were read. No standalone background service was started for this task.
