# 影片画幅：竖屏 9:16 和其他比例（2026-10-28）

目标：OpenSlate 从关键帧、视频到导出，整条链路都按项目画幅出片。验收用例是一条 20 秒、9:16 的搞笑 IG Reels。

分支：`feat/aspect-ratio`，基于 `origin/feature/last-ferry-ui`（089a982）。

## 1. 一个读取入口：`projectAspect(project)`

代码在 `packages/core/src/aspect.ts`，由 `@openslate/core` 导出。

- 数据来源是 `project.filmKind?.format`（film-kind@1，见 `feat/film-kind-taxonomy` 和 `docs/ai/film-kind/2026-10-28-film-kind-taxonomy.md`）。读取时做了防御：本分支上 `filmKind` 还是字符串枚举，所以按 `unknown` 读。
  - 有 `format.aspect` 时用它；没有时按 `format.platform` 取平台默认值（本文件里有一份 `PLATFORM_DEFAULT_ASPECT` 的副本，合并 filmkind 分支后应改成从 core 导入）。
  - 旧字符串 `"social_vertical"` 视为 9:16（filmkind 在 `Store.getProject` 里也会这样归一化）。
- 返回值只有三种：`"16:9" | "9:16" | "1:1"`（`PROJECT_ASPECTS`）。
- **4:5 不支持**：Viggle H3 的 `aspect_ratio` 只有 `16:9 / 9:16 / 1:1 / 4:3 / 3:4 / 21:9`（`packages/providers/src/viggle-h3.ts:11`），Codex 也没有 4:5 画布。所以下面几种比例是有意映射过去的：
  - `4:5`（ig_feed、facebook）→ `1:1`，这是最接近的已支持比例，内容不会被裁成竖条；
  - `21:9`（cinema）→ `16:9`；
  - `other` → `16:9`。
  - `projectFormat(project).requested` 会保留原来要的比例（比如 `"4:5"`），之后界面要提示 “4:5 按 1:1 出片” 时可以用。
- **旧项目不变**：没选过格式的项目（没有 `filmKind`、`filmKind` 是字符串、或者有 `kind` 但没有 `format`）读出来是 16:9，但 `explicitProjectAspect()` 返回 `null`。规划层只在画幅是显式选择时才改尺寸和参数；没有显式画幅时，节点参数、`specDigest`、`graphDigest`、执行请求、回执和导出都和以前完全一样（有测试覆盖）。

## 2. 各环节尺寸

| 画幅 | 关键帧（Codex） | 视频（Viggle `aspect_ratio`） | 导出 |
|---|---|---|---|
| 未选格式（旧项目） | 1024×1024，`codex-image-turn-v1` | 来自 profile 设置（通常 16:9） | 1280×720 |
| 16:9 | 1536×1024，`codex-image-turn-v2` | `16:9` | 1280×720 |
| 9:16 | 1024×1536，`codex-image-turn-v2` | `9:16` | 720×1280 |
| 1:1 | 1024×1024，`codex-image-turn-v2` | `1:1` | 720×720 |

- 导出默认短边 720：视频是 768p 生成，1080×1920 只是放大，没有多出细节，所以默认取 720×1280。Director 写的 `p.render(...)` 仍然可以显式给 `width/height`（例如 1080×1920），显式值优先。
- 9:16 的关键帧是 1024×1536（2:3），不是严格的 9:16。gpt-image 没有 9:16 画布；Viggle 按 `aspect_ratio` 出片时会自行适配首帧。

## 3. 关键帧：`codex-image-turn-v2`

- `packages/providers/src/codex-image.ts`：
  - `CodexImageInput` 增加可选 `aspect`。**没有 `aspect` 就是 v1**：body 与原来逐字节相同（`version: 1`、`policy: "codex-image-turn-v1"`、只接受 1024×1024），旧回执的 `turnInputDigest` 照旧对账；turn 文本也和原来一样。
  - 有 `aspect` 就是 v2：body 是 `{ version: 2, policy: "codex-image-turn-v2", ..., aspect }`，只接受该比例的画布（`CODEX_IMAGE_V2_CANVASES`：16:9→1536×1024、9:16→1024×1536、1:1→1024×1024）。v2 的 1:1 和 v1 的 digest 不同，不会混淆。
  - v2 的 turn 文本会写明 “Compose it for a 9:16 portrait frame and generate it at 1024x1536”。
- Codex 0.153.4 的尺寸支持：用 `codex app-server generate-ts` 生成协议看过，`turn/start` 和 `ImageGenerationItem` 都**没有尺寸参数**，尺寸只能通过 turn 文本作为偏好传达（所以原来就写着 “Requested dimensions are preferences”）。二进制自带的 imagegen 指南列出 gpt-image 常用尺寸 `1024x1024`、`1536x1024`（横）、`1024x1536`（竖），v2 只用这三种。没有做任何真实生成。
- 规划层：
  - `p.image(...)`（`packages/core/src/planning/index.ts`）：镜头关键帧 + `codex-image` profile + 显式画幅时，默认宽高取画布，并在参数里加 `aspect`。source 里显式写了别的尺寸（比如改画幅之前保存的 1024×1024 关键帧）时，照原样编译、不加 `aspect`，digest 不变，这样改画幅不会让整份计划编译失败；这张旧关键帧会在视频阶段被首帧形状检查拒绝（见第 4 节），重新 Make keyframes 即可得到新画布。
  - Make keyframes 的场景编排（`scene-composition.ts`）同样按画布写宽高。
  - 其他 adapter（fake、openai-image）和不挂镜头的图（角色设定图）不变。
- 服务端（`apps/server/src/execution/codex-image-receipts.ts`、`codex-image-execution.ts`）：新增 `codexImageTurnCanvas(args)`，从请求参数得出 v1/v2 画布；预检、执行、mapping 对账都用它，原来写死的 `width:1024,height:1024` 只在 v1 路径上保留。**profile 定义不变**（仍是 `width:1024,height:1024`），所以 profile digest、capability lock 都不变。
- 角色设定图保持 1:1 / v1，没有改。要做 3:2 的设定图，只需让设定图节点带上 `aspect`（v2 加一个 `3:2` 画布 1536×1024），本次没做。

## 4. 视频

- Viggle：视频节点在显式画幅时参数里多一个 `aspect`（只对 `viggle-h3` adapter 加）。服务端用 `viggleH3RequestAspect(args, profile)` 决定发出的 `aspect_ratio`：有 `aspect` 用它，没有就用 profile 的 `aspectRatio`（旧请求不变）。`aspect` 在 `request.args` 里，所以进入请求 digest 和 `specDigest`；transport 描述里本来就有 `aspectRatio`，因此 `requestDigest` / `bodySha256` 也跟着变。旧 attempt 没有这个字段，mapping 检查对它们和以前一样。
- 首帧形状检查：`assertViggleH3FirstFrameAspect`（`viggle-h3-receipts.ts`）。带 `aspect` 的请求，首帧宽高比和目标比例相差超过 1.2 倍就拒绝（`VIGGLE_H3_FIRST_FRAME_ASPECT`），在准备阶段发生，记录为 `LOCAL_INPUT_INVALID`，**不会 POST、不花钱**。容差 1.2 允许 2:3 关键帧配 9:16、3:2 配 16:9，拒绝方图配 9:16、横图配竖片。没有 `aspect` 的旧请求不做这个检查（旧项目本来就是方形关键帧配 16:9 视频）。
- fal H3 Max lip-sync（`packages/providers/src/fal-h3-lipsync.ts`）：请求只有 `image_url`、`audio_url`、`resolution`，**没有 aspect 参数**，输出跟随图片比例（图片比例要求在 0.4–2.5 之间）。所以对口型镜头的画幅由关键帧决定：9:16 项目的关键帧是 1024×1536，出片就是竖的。本次没有改 fal 路由。
- MiniMax H3 直连（`minimax-h3.ts`）也是 `aspectRatio: "input_image"`，跟随首帧。

## 5. 导出

- 故事板导出（`apps/server/src/media/storyboard-capture.ts`）用 `projectExportSize(project)`：显式画幅按上表，旧项目 1280×720。渲染器本来就会校验输出画面和冻结的尺寸一致（`local-media.ts:444`），测试里实际渲染了一个 720×1280 的 MP4 并用 ffprobe 验证。
- `p.render(...)` 的默认尺寸同样跟随画幅；旧项目默认仍是 1280×720。

## 6. 报价

- Codex 关键帧是 ChatGPT 计划额度，`unitCostMicros` 为 0，与尺寸无关。
- Viggle 按 profile 的单条报价（由 `resolution` 和时长决定），`aspect_ratio` 不影响价格；本次没有改分辨率。
- fal lip-sync 按分辨率和秒数计价，与比例无关。
- 所以**报价不变**。

## 7. 网页

- `GenerationOverview.frame?: { aspect, width, height }`：只有显式画幅时服务端才给（`generation-overview.ts`），旧项目的 overview JSON 不变。
- 模型函数（`apps/web/src/next/model/film-export.ts`）：`filmFrame(overview)` 给出画幅和导出尺寸；`frameAspectAttr(overview)` 给 Keyframes / Film 工作区的 `data-aspect`（只在 9:16、1:1 时设置）。
- Film 顶部那行时长前面显示画幅（`data-act="film-aspect"`，例如 “9:16 · 20 s · 6 shots …”）；Export 面板的尺寸行前也显示画幅（`data-act="export-aspect"`），尺寸显示 720 × 1280。旧项目不显示画幅，和原来一样。
- 预览形状：沿用现有 `object-fit: contain` 的做法。竖屏和方形项目的关键帧卡片、Keyframes 舞台、takes、Film 播放器和时间线缩略图都显示完整画面，不再裁成 16:9；窄屏下 Film 播放器改成 9:16 / 1:1 的框，高度不超过 70vh。16:9 项目的框不变。
- 这部分刻意做得很少，ui-v8 在做其他 UI。

## 8. 测试

- `packages/core/test/aspect.test.mjs`：画幅读取和映射（含平台默认、4:5→1:1、旧字符串）、首帧匹配、9:16 项目编译出 1024×1536 + `aspect` 的 Codex 关键帧、`aspect: "9:16"` 的 Viggle 视频、720×1280 的 render；Make keyframes 编排；旧项目参数和 digest 不变。
- `packages/providers/test/codex-image-policy.test.mjs`：v1 body / digest / turn 文本逐字节不变、v1 只收方图；v2 每种画布、错配拒绝。
- `packages/director/test/codex-image.test.mjs`：v2 竖图 turn 只发一次 `turn/start`，文本带 1024x1536 和 v2 policy。
- `apps/server/test/codex-image-execution.test.mjs`：9:16 项目的 attempt 以 v2 1024×1536 执行、对账、reconcile 成功；旧项目仍是 v1 1024×1024；预检拒绝 v1 下的非方图和不匹配画布。
- `apps/server/test/viggle-h3-execution.test.mjs`：9:16 项目 multipart 里 `aspect_ratio=9:16`、竖首帧通过；旧项目仍发 profile 的 16:9；横首帧配 9:16 在 POST 前被拒；`aspect: "4:5"` 预检拒绝。
- `apps/server/test/storyboard-export.test.mjs`：旧项目 1280×720，9:16 项目 720×1280，实际渲染并 ffprobe 验证。
- `apps/web/test/next/film-export.test.mjs`：`filmFrame` / `frameAspectAttr`。

## 9. 改动过的共享文件

- `packages/core/src/index.ts`（导出 `aspect.js`）、`packages/core/src/studio-api.ts`（`GenerationOverview.frame`）
- `packages/core/src/planning/index.ts`、`packages/core/src/planning/scene-composition.ts`
- `packages/providers/src/codex-image.ts`
- `apps/server/src/execution/codex-image-receipts.ts`、`codex-image-execution.ts`、`viggle-h3-receipts.ts`、`viggle-h3-execution.ts`
- `apps/server/src/media/storyboard-capture.ts`、`apps/server/src/generation-overview.ts`
- `apps/web/src/next/model/film-export.ts`、`views/film/FilmView.tsx`、`views/film/ExportPanel.tsx`、`views/film/film.css`、`keyframes/KeyframesView.tsx`、`keyframes/keyframes.css`
- 测试夹具：`apps/server/test/codex-image-execution-fixture.mjs`（`seed` 可带 `filmKind`）、`apps/server/test/viggle-h3-execution-fixture.mjs`（`filmKind`、`pngSize`）

没有碰：工具目录、loader 和技能、Gemini analyzer、角色路由、`skills/`。

## 10. 合并注意

- 和 filmkind 分支合并后：`aspect.ts` 里的平台默认表改为导入 `PLATFORM_DEFAULT_ASPECT`；`ProjectRecord.filmKind` 变成对象后，这里的防御读取仍然成立。
- filmkind 说过：画幅未设时 `filmKindIntake(filmKind).ask` 会包含 `"aspect"`，Director 应在规划前问。本分支对没选画幅的项目保持旧尺寸，问完之后才会切到新尺寸。
- 一个已有项目中途改画幅：关键帧节点参数变化，旧关键帧和视频会过期，需要重新生成，这是预期行为。
