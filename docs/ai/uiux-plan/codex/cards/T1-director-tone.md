# Card T1: the Director says what got done, not what it can't do

Read `_review-common.md` in this folder first, with one exception: like N1 and P1, this card may amend tool contract 6.0.0 host guidance and skills v7 in place (never released; keep the current 6.0.0 catalog and v7 package identities in the shipped-identity list so projects saved on this branch still upgrade, and extend the pin test). Guidance text only: no tool schema, server behaviour or `apps/web` change.

The owner read real Director replies and found them full of negative, defensive statements. Examples (verbatim, from the owner's test studio):

- "本条不代表画面审核通过，因此不能评价新版人物一致性、实景质感或构图。"
- "人物及实景参考图仍未绑定，本次未启动生成。"
- "人物与实景 reference 仍未绑定，这次不能视为已完成参考图一致性方案。"
- "工具未返回报价，我没有重试。"
- "我不会按旧稿重生成这四镜。"
- "聊天里的批准不能替代这个应用操作，我也不能绕过它直接覆盖已有媒体。" (already removed by P1)

The owner's rule: **the person wants to know what was done and what happens next, not a list of what the Director didn't do, can't do or isn't claiming.**

1. **Find the sources.** Read skills v7 (`skills/v7/**`), the 6.0.0 host guidance (`film-planning-guidance.ts`, `director-input.ts`, `director-shipped-guidance.ts` and anything else that injects reply-style instructions for contract 6.0.0) and list every sentence that pushes the model toward disclaimers: "say that it does not mean…", "state that you did not…", "never imply approval…", "report that nothing started…", "do not claim…" written as an instruction to *say* the negative. List them in the report with file:line.
2. **Rewrite the reply guidance** into one short, positive reply style, placed once (where reply style lives today), e.g.:
   - Lead with what is done now, concretely (what changed, what started, with price when the app returned one).
   - Then what happens next or the one thing the person needs to do, as a plain next step ("Open 1.2 in Keyframes and press Give up to clear the old video job"), not as a refusal.
   - Mention something that did *not* happen only when the person asked for it and it didn't happen, once, with the reason in a few words and the way forward. Never list things the person didn't ask about (no "this does not mean the picture is approved", no "I can't judge consistency", no "I did not retry").
   - Don't restate app rules or limits the person didn't ask about.
   - Keep the honesty rules that protect money and truth: never claim something started, was accepted or was saved unless the app reported it; an unknown outcome is described as "waiting for the service's answer", with the next step. These stay as rules for what the Director *does*, not sentences it must *say*.
   - Same in Chinese: concise, no "不代表/不能视为/不能评价/我不会/我没有" boilerplate.
3. Remove or rewrite the sentences found in step 1 so nothing still instructs disclaimers; don't add exceptions on top. Keep 5.0.0 and older guidance untouched.
4. **Fake director** (`fake-director.ts`): if its scripted replies contain such disclaimers, make them follow the same style.
5. **Tests:** guidance tests assert the new reply style is present in v7 and the 6.0.0 host guidance and that none of the disclaimer instructions remain (pick robust phrases); identity pins updated as in N1/P1; existing money/truth tests (never claim started, unknown outcome) still pass.

Files: `skills/v7/**`, `apps/server/src/application/film-planning-guidance.ts`, `director-input.ts`, `director-shipped-guidance.ts`, `fake-director.ts`, `packages/director` catalog/skills tests, `apps/server/test/director-guidance-maintenance.test.mjs` and related guidance tests. In the report, show before/after of the reply-style section.
