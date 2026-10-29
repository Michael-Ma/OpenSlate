# 来源（访问日 2026-10-28）

## Skill 库的组织方式

- Agent Skills 开放规范：<https://agentskills.io/specification>。涵盖 frontmatter 字段、三层渐进披露、`SKILL.md` 建议 < 500 行 / < 5000 token、引用只走一层。
- Anthropic, Skill authoring best practices：<https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices>。涵盖简洁、自由度、description 写法、按领域拆分 reference、给长 reference 加目录、先写 eval、多模型测试。
- Anthropic Engineering, “Equipping agents for the real world with Agent Skills”（2025-10-16）：<https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills>
- Claude API Skills guide：<https://platform.claude.com/docs/en/build-with-claude/skills-guide>。每个请求最多 20 个 skill；可钉版本或用 `latest`；多个 skill 可以组合使用。
- Claude API skill versions：<https://platform.claude.com/docs/en/api/beta/skills/versions/create>
- Claude Code skills：<https://code.claude.com/docs/en/skills>。涵盖 description 截断到 1,536 字符、`disable-model-invocation`、`paths`、skill 之间没有依赖声明。
- Claude Code plugin dependencies：<https://code.claude.com/docs/en/plugin-dependencies>。semver 区间，取交集后选最高版本。
- OpenAI Codex skills（`developers.openai.com/codex/skills` 已重定向到这里）：<https://learn.chatgpt.com/docs/build-skills>。涵盖发现范围、隐式与显式调用、skill 列表占 2% context 的预算、`agents/openai.yaml` 里的 `policy` 和 `dependencies.tools`。
- LangChain Deep Agents skills：<https://docs.langchain.com/oss/python/deepagents/skills>
- RAG-MCP: Mitigating Prompt Bloat in LLM Tool Selection via Retrieval-Augmented Generation, arXiv 2505.03275：<https://arxiv.org/html/2505.03275v1>

## 视频分类

- Wyzowl, Video Marketing Statistics 2026（检索结果给出的页面）：<https://www.wyzowl.com/sovm-results-2016>；二手汇总：<https://piktochart.com/blog/video-marketing-statistics-2026.md>。营销团队最常做的视频类型：社媒 69%、解说 68%、证言 57%、广告和演示 48%、预告 45%、产品演示 39%。数字转引自二手汇总，应以原报告为准。
- 仓库内：`docs/ai/skill-drafts/video-types/index.md` 及其 sources.md。

## 故事与概念开发

- Kenn Adams 的 Story Spine：NPR 访谈 <https://www.npr.org/transcripts/nx-s1-5750619>；SessionLab 上的介绍 <https://www.sessionlab.com/methods/story-spine>
- Randy Olson 的 ABT（And, But, Therefore）：<https://crtc.wustl.edu/the-abt-and-but-therefore-narrative-framework-training-with-randy-olson-phd/>；书：*Houston, We Have a Narrative*（University of Chicago Press, 2015）
- 单一主张（single-minded proposition）：Howard Ibach, *How to Write a Single-Minded Proposition*；ANA 课程 <https://www.ana.net/training/course/id/CD-SMP-V-HI>
- 创意简报模板：<https://saylordotorg.github.io/text_launch-advertising-and-promotion-in-real-time/s11-05-the-creative-brief.html>
- MV treatment 的写法（logline 的 who/what/where，150–300 词的 pitch）：<https://robinpiree.com/blog/how-to-write-music-video-treatment>；<https://www.wrapbook.com/blog/music-video-treatment>
- 根据作者已有知识、尚未逐条核对网页的（写成 skill 前要补引用）：起承转合（Kishōtenketsu）；Blake Snyder, *Save the Cat!*；Robert McKee, *Story* 中的 controlling idea；PAS / AIDA 广告结构。

## 风格与运动 prompt

- Runway image-to-video 提示指南：<https://help.runwayml.com/hc/en-us/articles/39789879462419>；Gen-4 官方页面：<https://help.runwayml.com/hc/en-us/articles/37327109429011-Creating-with-Gen-4>。i2v 的 prompt 只写运动，用正面措辞。
- Kling image-to-video 快速入门：<https://kling.ai/quickstart/image-to-video-guide>。主体加运动；描述和首帧差得太多会导致跳切。
- Google Veo（Vertex AI）提示指南：<https://docs.cloud.google.com/vertex-ai/generative-ai/docs/video/video-gen-prompt-guide>
- MiniMax Hailuo Director 模型的机位命令（第三方资料，H3 是否支持待核实）：<https://minimax-ai.chat/models/minimax-hailuo-director-models/>；<https://www.veed.io/learn/hailuo-prompts>
- 仓库内：`docs/ai/skill-drafts/visual-styles/` 及其 sources.md。

## 仓库内证据（`feature/last-ferry-ui` @ 56d154b）

- `packages/director/src/skills/index.ts`：manifest、lock、activation、读取
- `apps/server/src/application/director-capabilities.ts`、`director-input.ts`、`director-context.ts`、`director-shipped-guidance.ts`、`director-tools-upgrade.ts`
- `apps/server/src/persistence/installation-backup-closure.ts:555-560`
- `packages/director/src/runtime/codex.ts:215, 298-301, 337-340`、`setup.ts:249`
- `apps/server/src/narration/music-video.ts`
- `skills/README.md`、`skills/v7/{production,plan-authoring}`、`docs/technical/SKILLS-TOOLS.md`
