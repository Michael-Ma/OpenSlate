# October 7 English / Chinese interface review

## Delivered language support

The startup page and workspace header offer **English** and **Simplified Chinese**. Preference precedence is valid `lang=en|zh-CN` URL (with `zh` accepted as an alias), saved browser choice, supported browser language, then English. Selection persists only to a browser preference and updates `html.lang` and the current URL in place. Mode, view, fragment and unrelated URL context are retained.

The same React app/provider tree remains mounted. Selected shots, per-project unsent drafts/references, reply state, editing fields, protected tools and exact pending command registries remain independent of interface language. No locale field was added to project records, provider inputs or server authority.

Localized surfaces cover the workspace/appearance/navigation, preview/inspector/scene shelves, reference picker, timeline/assets, model/settings/account setup, project editing/plan import, plan/recovery guidance, scene decisions, narration/speech/transcription/personal voice, owned media imports, shared dialogs and safe Markdown fallback labels. English nouns/counts are contextual rather than inferred solely from a shared Chinese term.

Static interface copy uses explicit bilingual pairs. Controlled derived states/errors/counts have exact whitelists and bounded presenters. Parameter values are inserted once and retained as written. Project names, scene/shot creative prose, prompts, recording names, transcripts/scripts, human/Director question content, conversation messages, provider model/voice names, hashes and protocol IDs are not translated. Unknown provider/service diagnostics remain original unless registered as sanitized interface copy. The pure locale context is separate from JSX/browser setup so safe Markdown remains directly renderable and testable.

## Review and repairs

Independent review confirmed no locale-dependent component keys/remounts, input replacement, generation-authority changes or pending command resubmission. The settings reviewer compared all **60** command-builder/request/run/send/action calls in its assigned surfaces with the preceding source: no argument changes. Workbench review identity remains based on exact project/revision/shot/artifact/hash and current loaded media; localizing labels cannot qualify another frame.

Actual browser review corrected ambiguous English singular/plural labels, then a missing account-count placeholder. A narrower desktop pane also exposed an inherited sizing mismatch: the inspector height cap was removed by a container query even though the preview/inspector were still side by side. The cap now lifts at the actual ≤1000px stacked-layout breakpoint. The latter has explicit 1/2-account English/Chinese regression coverage; a parameter audit found no remaining missing literal translation values. Safe Markdown's independently rendered module was separated from the JSX locale provider, preserving its direct Node tests and adding a Chinese absent-alt test. Authored message/alt content stays unchanged and remote images still render as links.

## Verification

- Final `pnpm check`: **2,401 passed, zero failed, one optional native probe skipped** (2,402 total). All builds/typechecks passed with Node 24.15.0 and pnpm 10.33.0.
- Final frontend gate after the CSS-only repair: **253 passed**, zero failures; web typecheck passed.
- New locale suites: **24** preference, interpolation, controlled-copy/content, scope/retry, plan-state, provider/configuration and account-count checks. Markdown rendering has **5** checks, including localized missing-alt versus original authored text. Independent final correction review reran **15** settings/Markdown checks successfully.
- Required offline restart/edit demo: **4 initial + 2 edited fake accepts**, zero duplicates after restart; unaffected shot preserved.
- Built disposable actual React browser: switching EN → 中文 → EN retained the exact bilingual draft, selected Shot 1.2 and resource reference chip. HTML language and URL changed; saved project writing remained in its original language.
- Deliberately delayed offline model preview: the language menu remained usable while settings close, project switching, creation, conversation submission and conflicting generation stayed disabled. Switching to Chinese and pressing Ctrl+Enter retained the draft unsent. SQLite recorded zero prohibited shortcut messages. The intentionally unavailable metadata-only profile produced a definite setup failure, not a successful real model/provider acceptance claim.
- 390×844 Day/Chinese and Night/English: one active pane, reachable language/theme controls and zero document horizontal overflow. English footer/help content wrapped within its owning surface. Phone language switching retained the active view and original content.
- Fixture attempts remained **eight**, the prior Day/Night campaign count. This language campaign added zero generation attempts, native model turns or paid media calls; original saved Prompt content and two-scene/four-shot structure remained intact.
- The final CSS-only breakpoint repair was rebuilt and visually verified at 1207×849 (bounded side-by-side inspector), 900×850 (uncapped stacked inspector), and 390×844 (phone), all with zero document overflow. The repaired 1-account label was checked in both languages in the final built browser.
- The existing live installation was refreshed only after a read-only zero-active-media/zero-queued-or-running-Director check. Final IB Project UI was inspected in both languages; inspection did not request generation.

Full gate: `/private/tmp/openslate-locale-final-check.log`. Offline demo: `/private/tmp/openslate-locale-demo.log`. Rendered captures stay outside the repository under the task's `outputs/openslate-locale/` directory. Private launcher/pairing material is not published. See [sanitized evidence](language-evidence.json).

## Scope

This is interface localization. Switching language does not translate stored creative work or request translated model replies. Prompts/conversation already accept Unicode and retain their original language. Provider language/quality support remains a separate real-production acceptance boundary. Unknown diagnostics may retain their original language. No new real-provider generation was used for verification.
