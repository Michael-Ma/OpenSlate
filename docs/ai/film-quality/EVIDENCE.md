# 视频质量证据包：Tofu 片（2026-11-01）

所有调研都以这份材料为起点。

## 用户原话

> 现在编排出来的视频质量非常差，出来的视觉效果一般，看不出来具体要表达的内容，而且过渡生硬。prompt 写的质量比较差，里面中英文夹杂，不合理。

原始需求只有一句话：「做一个 30s 的搞笑视频，主角是一只可爱的柯基，名字叫 Tofu，目的是发社交媒体，需要有配乐」。

## 材料

- `evidence/sheet-film.jpg`：成片每秒一帧，共 30 帧，从左到右、从上到下。
- `evidence/sheet-cuts.jpg`：7 个切点。上排是切点前一帧，下排是切点后一帧，同一列是同一个切点。
- `evidence/steps.json`：这一版用到的 16 张关键帧和 8 段视频的完整 prompt。
- `evidence/plan-v6.ts.txt`：导演写的计划代码。
- 成片 `/private/tmp/claude-501/-Users-michael-SideProject-OpenSlate/72ad4e96-05c6-43a3-b1fc-50ac771fee4e/scratchpad/quality/film.mp4`，8 段原始片段 `/private/tmp/claude-501/-Users-michael-SideProject-OpenSlate/72ad4e96-05c6-43a3-b1fc-50ac771fee4e/scratchpad/quality/clips/`。需要时用 ffmpeg 抽帧，不要读二进制。
  `SCRATCH=/private/tmp/claude-501/-Users-michael-SideProject-OpenSlate/72ad4e96-05c6-43a3-b1fc-50ac771fee4e/scratchpad`

## 成片事实

- 竖屏 1080×1920，30 秒，30 fps，8 个镜头，时长 3/4/4/2/5/4/5/3 秒，**没有任何音轨**（需求要配乐，这部旧片的模型列表里没有音乐）。
- 片段都是 Viggle MiniMax-H3，768×1344，请求 6 秒、实际 6.6 秒，`quality=low`，`enhance=false`。
- 用关键帧作参考图，每个镜头 1 张。关键帧由 Codex 图像模型生成，每镜 2 张备选，每张单独生成。
- 成片按固定秒数截取每段片段的**开头**，切点没有看过实际画面。

## 初步观察（待你验证，不要当结论）

1. **场景不连续。** 同一公寓在每个镜头都不一样：沙发、靠垫、挂画、地毯、窗户都在变；哑铃和碗的位置在切点瞬移。
2. **切点跳变。** 看 `sheet-cuts.jpg`：狗的位置、大小、朝向、姿态都在切点重置，动作接不上。多数切点上一镜的动作并没有完成。
3. **内容读不出来。** 想讲的是「减肥第一天：只对吃饭有动力」，但成片看起来是一只狗在客厅走动。没有字幕、音效、配乐来传达笑点。狗常对镜头微笑，看不出偷懒和反差。
4. **视觉单调。** 8 个镜头几乎都是同一种低机位，景别变化少。
5. **Prompt 差。** 每段视频都是同一大段英文模板，加中文逐秒动作（精确到 0.7 秒），有大量「不要什么」，中英混杂。关键帧 prompt 也重复大段描述，还写了「10 cm」「10 percent safe margins」这类模型做不到的约束。
6. **导演没有创作指引。** `skills/code-plan/SKILL.md` 只讲 API。`docs/ai/skill-drafts/`（craft-comedy、video-types、visual-styles、characters）和 `skills/production/`、`skills/plan-authoring/` 里有创作内容，但 Code plan 导演读不到。

## 系统现状

- 导演写 TypeScript 计划，`ctx.image / video / music / speech / render / choose`。接口见 `skills/code-plan/references/studio.d.ts`，指引见 `skills/code-plan/SKILL.md`。
- 视频支持四种输入：`references`（默认）、`firstFrame`、`firstFrame+lastFrame`、纯文字。
- **渲染器：** `apps/server/src/media/local-timeline.ts`、`local-media.ts`。只有硬切（`transition: "cut"`），30 fps，最多 8 条音轨。没有字幕或文字叠加能力。
- **本机 ffmpeg 8.1.1：** 有 `xfade`、`acrossfade`、`minterpolate`、`tmix`，**没有** `drawtext` 和 `subtitles`（没编 freetype、libass）。
- **模型和价格：** Viggle H3（5–15 秒，六种比例，768p 参考图 $0.05/秒、首帧 $0.03/秒，`quality=high` 不加价但更慢）。Seedance 2.x 和 fal（Kling、Veo、Wan）已接入但没实测。Lyria 音乐 $0.08/首。Codex 图像走订阅。
- **预算：** 默认每部片 $1，用户能接受一部片几美元。
- 导演目前看不到片段画面，只知道尺寸和状态。

## 调研要求

- 只做调研，不改代码，不调用付费 API。
- 引用来源要给链接，分清官方文档、实测和个人经验。没查到就直说。
- 每条建议都要落到具体位置：导演指引、Studio 接口、渲染器或模型配置，并估算影响和工作量。
- 用 Tofu 片给出修改前后的具体例子。
- 报告用中文，保留英文关键词，写到 `docs/ai/film-quality/research-<方向>.md`，不超过 1500 字加表格。
