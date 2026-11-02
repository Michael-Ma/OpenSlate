# 连续性与画质调研（research-continuity）

范围：视觉连续性、镜头设计、模型设置。故事、prompt 语法、剪辑由其他方向负责。只读调研，未调用付费 API。来源标注见文末，方括号是来源编号。

## 结论

1. **房间变化不是视频模型造成的。** 背景低通匹配：同一片段内平均 0.886（最低 0.708），跨切点平均 0.403（最高 0.511）。H3 在片段内基本守住了场景，问题出在 8 张互不相干的关键帧。
2. **连续性应在图像阶段解决，这一步不花钱。** 先出角色图和空房间 plate，每张关键帧都从它们生成。`ctx.image` 的 `references` 已经能走通，只是接口和指引都没写。但代码模式出不了竖图，这一条要先修。
3. **模型先不换。** `quality=high` 同价，应设为默认。H3 与 Seedance 2.0 在公开盲测中置信区间重叠，价格约五分之一。Veo 不要再投入：fal 端点 11 月 17 日弃用。

## 1. 断点目录

原因代号：**K** 关键帧独立生成，**S** 没有共享场景参考，**R** 每片段只有 1 张参考，**V** 视频模型，**T** 按固定秒数盲截（本次新增）。

| 切点 | 场景和道具 | 狗的动作 | 主因 |
|---|---|---|---|
| 01→02 | 3 幅挂画变 2 幅，左侧出现窗帘，毯子换款 | 鼻子刚碰到哑铃，下一镜退回远处站立 | S K |
| 02→03 | 白色小杯（黄色食物）变大碗（一朵西兰花），蓝碗从沙发旁移到垫子远端 | **趴倒没进片**：4 秒时还在下坐，5.5 秒才趴下 | T，其次 S K |
| 03→06 | 龟背竹出现；一朵西兰花变满满一碗；白碗从地板移到垫子上 | 转身趴下没进片，下一镜已趴在垫子上 | T，其次 S K |
| 06→04 | 蓝碗下出现地毯，白碗和哑铃换位 | **起身缺失**：计划要"刚撑起"，片段开场已站立 | R（reference 不锁开场），K |
| 04→07 | 地毯消失 | 5 秒时还没到碗前，约 6.3 秒才到，下一镜已在吃 | T |
| 07→08 | 书架和台灯出现，蓝碗跳到左下角，白碗消失 | 正面舔嘴切到背面走路 | S K |
| 08→05 | 书架消失，毯子花纹变，新增玻璃杯西兰花 | 贴地低头切到居中坐姿微笑 | S K |

| 断点类型 | 判定 | 依据 |
|---|---|---|
| 房间陈设、窗、挂画 | S + K，**不是 V** | 片段内 0.886，跨切点 0.403 |
| 道具位置和数量 | S + K | `identity` 只列名字不给位置。02 画面有 4 个碗 1 个罐，计划只有 2 个碗 |
| 空间方位翻转 | S + K | 01、02 蓝碗在垫子后方（沙发侧），06 起到了垫子前方（镜头侧），狗的路线不成立 |
| 姿态重置 | K + T，R 次要 | 每张关键帧只写本镜起始，不知道上一镜结尾。至少 3 镜动作发生在截取点之后 |
| 围巾跑到背上 | V | clip-5 第 4 秒起，下一镜又回到脖子 |

R 不是主因：关键帧同房间时 1 张参考足够；关键帧不同房间时，4 张也救不了（本人推断）。

**证据缺口：** 16 张关键帧不在证据包里，我用片段第 0 帧代替，所以开场画面上 K 和 V 分不开。低通指标含狗入画干扰，只作方向判断。

## 2. 业界做法与方案对比

公开做法基本一致：先锁定定妆图和场景，所有静帧从同一组参考出，再做动画 [17][20]。**没有查到比较这些方法的量化测试**，下表可靠性是定性判断。

| 方案 | 额外成本 | 可靠性与依据 | 模型支持 | 仓库现状 | 用法 |
|---|---|---|---|---|---|
| 角色设定图 | $0 | 高。Kling 官方建议正面图加 1–3 张其他角度 [6] | 图像阶段 | 图模式有 `characterSheetPrompt`，代码模式没有 | **必做** |
| 环境 plate，同向镜头共用 | $0 | 预期高。Hailuo 称之为"空间唯一真相" [17]，无实测 | 图像阶段 | 可用 | **必做，核心** |
| 所有关键帧同一组参考 | $0 | 中高，取决于图像模型守不守背景，**待测** | Codex ≤8 张 | 可用但未公开 | **必做** |
| 视频多参考 | Viggle $0.05/秒，首帧 $0.03/秒 | 中。不锁开场。Viggle 文档没写顺序和引用语法 [2] | Viggle 4 [2]、Seedance 9 [11]、Kling O3 7（带视频时 4）[5]、Veo 3 [7] | Viggle、Seedance 可用；fal 适配器只有帧模式 | 只用于开场不重要的镜头 |
| 末帧接下一镜首帧 | $0 | **低**。H3 个人实测（本地 8 步 Turbo，非 Viggle）：第 2 段细节 77–80%，第 4 段 61–65%，错误物体延续 7 段 [13] | 任何首帧模型 | Viggle 无抽帧；Seedance 返回 last frame | 连续动作最多 1 跳 |
| 首尾帧 | Viggle $0.05/秒 | 中高，落点可控，无量化测试 | Viggle、Seedance 2.x、Kling | 可用，但末帧不裁切（见下） | 2–3 个关键切点 |
| 单次生成多镜头 | 省片段数 | 中低。H3 Max 测试中切后道具变了 [16] | H3、Kling、Seedance | 写 prompt 即可 | 仅小额测试 |

**`ctx.image` 的真实情况（已读代码，并用 `dist` 离线跑过计划层，未跑真实 Codex turn）：**

| 项目 | 现状 | 位置 |
|---|---|---|
| `references` | 能用。`resolveInputs` 放入 `request.inputs`，再以 `localImage` 传给 Codex | `execution.ts:287`、`codex-image.ts:362` |
| 限制 | ≤8 张、PNG、单张 ≤4 MiB、总量 ≤24 MiB | `codex-image-authority.ts:115` |
| 校验 | 计划阶段不查：9 张、video artifact 都能提交，到派发才失败 | `identity.ts` 只校验 video |
| 接口 | `studio.d.ts` 未声明，靠索引签名碰巧通过 | `studio.d.ts:11` |
| **竖图** | `aspect` 和 1024×1536 都被拒，永远请求 1024×1024；图模式已能出 1024×1536 | `provider-input.ts:43` |
| **首帧裁切** | 静默中心裁切：方图只留 56% 宽度，1024×1536 留 84% | `viggle-h3-execution.ts:447` |
| **末帧** | 不裁切，首尾帧构图会错位 | 同上 |

v6 关键帧的实际尺寸未知，它走 reference 模式所以没被裁。**直接切到 firstFrame 而不修竖图，会损失画面。**

## 3. 镜头设计

初步观察 4 需要修正：景别其实在变（全景和中景交替），不变的是机位高度和方向。8 镜全是低机位朝沙发墙，机位角度几乎不变而画面内容全变，每个切点都接近跳切。30 度规则正是这个问题 [19]。

| 项目 | 可控度 | 控制点 | 导演要规划 |
|---|---|---|---|
| 景别 | 高 | 关键帧 | 相邻镜头差一档以上 |
| 机位高度、方向 | 高 | 每个方向一张 plate | 3–4 个机位，不是 8 个 |
| 180 度线、屏幕方向 [18] | 静帧高，运动中 | 关键帧朝向 | 写明轴线和"去食物 = 向右" |
| 视线 | 中 | 关键帧筛选 | 写明看向哪里，狗默认看镜头 |
| 镜内运镜 | 中低 | prompt | 默认固定。连续运动指令可能被 H3 Max 拆成切镜 [16] |
| 动作时长 | 低 | 看画面选入出点 | 不要写到 0.7 秒，交给剪辑 |

模型不知道轴线，每次生成只看当前这一镜 [20]。写进 prompt 不等于做到 [21]，所以规则要落在关键帧上，图像阶段拒绝一张不花钱。竖屏里侧面的柯基放不下，纵深运动更合适（本人判断）。

**Tofu 修改前后：**

| 镜头 | v6 | 建议 |
|---|---|---|
| 01 | 低机位中全景 | **A 全景**，交代垫子在左、蓝碗在右 |
| 02 | 低机位侧面 | B 地板近景推哑铃，趴倒换 **C 俯拍** |
| 03 | 低机位中景 | B 碗边近景，向左转开 |
| 06 | 前景蓝碗 | **E 眼睛特写**，浅景深省掉场景 |
| 04 | 前景蓝碗 | **D 反打**，从碗边看狗冲向镜头 |
| 07 | 中近景 | C 俯拍碗内 |
| 08 | 全景 | **A 同机位**，离开向左，折返向右 |
| 05 | 中景 | **A 同机位**收尾 |

A 用三次，这三镜背景一致。

## 4. 模型设置

**`quality=high`：** 官方只说 low 更快、high 保真更高、同价 [1][2]。**没有找到任何公开对比，提升幅度未知。** 不加价，风险只有变慢，建议测一次后设为默认。

**分辨率：** 现在是 768×1344 放大 1.41 倍，`contain` 还留下上下约 15 像素黑边（成片实测 1080×1890 内容区）。MiniMax 官方只列 768P 和 2K [4]。Viggle 没说 1080p 怎么来的，第三方的 1080p 是 768p 精修 [16]，不能直接等同。锁首帧时构图跨档位不变，2K 细节更好，但只是单次测试 [14]。1080p 到 2K 只差 $0.01/秒，要升级就先测 2K。

| 模型 | 6 秒价格 | AA I2V Elo（95% CI）[12] | 判断 |
|---|---|---|---|
| Viggle H3 | 768p 首帧 $0.18、参考 $0.30；1080p 首帧 $0.30；2K 首帧 $0.36 | 1128（1112–1144） | **保持默认** |
| Seedance 2.0 | Mini 720p $0.45；720p $0.91；1080p $2.25 | 1136（1119–1153） | H3 走路不行再测 |
| Kling 3.0 | Standard 720p $0.50 | Pro 1000（基准），Omni 1000 | 不优先，O3 未接入（fal $0.084/秒 [10]） |
| Veo 3.1 Fast | $0.60 | 937（920–954） | **不投入**。Gemini Preview 已于 10-22 关停 [8]，fal 端点 11-17 弃用 [9] |

**可靠性：** AA 是盲测配对投票，是最好的公开证据。但它是通用偏好、含音频，不针对动物。H3 分数来自 AA 的 768p 配置，与 Viggle `low` 的对应关系未知。旧榜排序不同，厂商博客结论互相矛盾。**没有找到任何真实动物或狗的横向测试**，不能断言谁的狗最好。

**小额测试：** 用同一张首帧测 04（起身加小跑）。每格只跑一次，只认明显差异。

| 阶段 | 内容 | 价格 | 看什么 |
|---|---|---|---|
| 0 | Codex 出角色图、plate、3 张关键帧 | $0 | 房间和道具守不守得住，不行则试 Viggle Image（$0.02/张，8 张参考 [3]） |
| 1 | Viggle 5 秒首帧：768p low、768p high、1080p high、2K high | $0.15、$0.15、$0.25、$0.30，共 $0.85 | 步态、围巾、耗时、背景稳定 |
| 2 | 仅阶段 1 步态失败时：Seedance Mini 5 秒、2.0 720p 4 秒、Kling 5 秒 | 共约 $1.40 | 同上 |

## 5. Tofu 流水线

| 步骤 | 产物 | 调用 | 成本 |
|---|---|---|---|
| 0 | 平面图、机位表、道具状态表 | `ctx.scene` 声明 | $0 |
| 1 | `tofu-sheet` 四视图，灰底平光 | `ctx.image` 无参考，`ctx.choose` 确认 | $0 |
| 2 | `props` 蓝碗、白碗加一朵西兰花、哑铃 | `ctx.image` | $0 |
| 3 | `plate-A` 空房间，无狗 | `references: [props]`，`ctx.choose` 确认 | $0 |
| 4 | `plate-C`、`plate-D` 同房间换方向 | `references: [plateA, props]` | $0 |
| 5 | 每镜关键帧 | `references: [plate, sheet, props, 上一镜关键帧]` | $0 |
| 6 | 片段 | 默认 `firstFrame`；03→06、06→04、04→07 用首尾帧 | 约 $1.80 |
| 7 | 补拍两镜 | 同上 | 约 $0.60 |

合计约 $2.40，高于默认 $1 上限，在用户可接受范围内。人工确认放在角色图和 plate 上，影响最大。参考图光线会带进新场景 [15]，所以角色图用平光。

平面图示例：沙发靠后墙，窗在左墙，薄荷垫居左，蓝碗居右，白碗在垫子右端，轴线是垫子到蓝碗。道具状态：哑铃 02 后前移并固定，西兰花全片一朵，地上狗粮 08 被吃掉。

```ts
// 修改前（v6）
ctx.image({ model: "codex-keyframes", prompt: identity + shot.frame, variant });
ctx.video({ references: [frame], prompt, durationSeconds: 6, aspectRatio: "9:16" });

// 修改后（简写，省略 ok 判断；aspect 需先实现）
const key = await ctx.image({ shot: "tofu-08", aspect: "9:16",
  references: [plateA, tofuSheet, props],
  prompt: "Keep the room, camera and props exactly as in image 1. Add the dog from image 2 beside the blue bowl, facing left." });
const clip = await ctx.video({ shot: "tofu-08", firstFrame: key, durationSeconds: 6, aspectRatio: "9:16",
  prompt: "Tofu walks left, notices the kibble, turns back and eats it." });
```

## 6. 改动落点

| 优先级 | 位置 | 改动 | 影响 | 工作量 |
|---|---|---|---|---|
| P0 | `provider-input.ts` | 代码模式图像支持 `aspect`，出 1024×1536 | 高，是切 firstFrame 的前提 | 0.5 天 |
| P0 | `studio.d.ts`、`identity.ts` | 声明 `image.references`，计划阶段校验数量和类型 | 高 | 0.5 天 |
| P0 | `skills/code-plan/SKILL.md` | 资产优先流程、平面图、机位表、道具表；连续镜头默认 firstFrame，取代"references 默认" | **最高** | 0.5 天，含指引 digest 和测试 |
| P0 | `SKILL.md` | 澄清并发规则：资产先完成，依赖上一镜的关键帧要串行 | 高 | 含上 |
| P1 | `provider-catalog.ts` | `VIGGLE_PROFILE` 改 `quality: "high"`（阶段 1 后） | 中 | 0.5 小时 |
| P1 | `viggle-h3-execution.ts` | 末帧与首帧同样裁切，**使用首尾帧前必须修** | 中 | 0.5 天 |
| P1 | 导演指引 | 竖屏用 `fit: "cover"`，只裁约 1.6% 宽度，消除黑边 | 小而确定 | 0.5 小时 |
| P1 | `fal-video-i2v.ts` | 11-17 前移除或迁移 Veo | 防止失效 | 小 |
| P2 | Studio 接口 | `ctx.frame` 抽帧，支持切点检查和单跳接续 | 中 | 1–2 天 |
| P2 | Viggle profile | 若 2K 胜出，新增 2K 配置，先核实适配器全链路 | 待测 | 0.5 天 |

## 没查到的内容

- Viggle `high`/`low` 的公开对比和耗时；Viggle 1080p 是否原生。
- 真实狗或四足动物的跨模型测试。
- 连续性方案之间的量化对比。
- Seedance 官方页无法读取，9 张上限来自 N6 卡片和 ComfyUI 文档 [11]，适配器按此实现。
- AA 无音频榜 v2.1 未读到；榜单页没有更新日期。

## 来源

官方：[1] [Viggle 定价](https://docs.viggle.ai/v1/pricing.md)；[2] [Viggle H3 参数](https://docs.viggle.ai/v1/api-reference/videos/create-from-text.md)；[3] [Viggle Image](https://docs.viggle.ai/v1/guides/quickstart-image.md)；[4] [MiniMax 视频指南](https://platform.minimax.io/docs/guides/video-generation)；[5] [Kling 3.0 Omni 指南](https://kling.ai/quickstart/klingai-video-3-omni-model-user-guide)；[6] [Kling Element Library](https://kling.ai/quickstart/klingai-element-library-3-user-guide)；[7] [Google Veo 3.1 公告](https://developers.googleblog.com/introducing-veo-3-1-and-new-creative-capabilities-in-the-gemini-api/)；[8] [Gemini 视频文档](https://ai.google.dev/gemini-api/docs/video)；[9] [fal Veo 3.1 Fast](https://fal.ai/models/fal-ai/veo3.1/fast/image-to-video)；[10] [fal Kling O3](https://fal.ai/models/fal-ai/kling-video/o3/standard/reference-to-video)。

第三方文档：[11] [ComfyUI Seedance 节点](https://docs.comfy.org/zh/built-in-nodes/ByteDance2ReferenceNode)。

独立盲测：[12] [Artificial Analysis I2V v2.1](https://artificialanalysis.ai/video/leaderboard/image-to-video)。

个人实测：[13] [Kazennov：H3 末帧链式测试](https://dev.to/nefayran/chaining-image-to-video-clips-from-the-last-frame-what-10-links-did-to-a-face-minimax-h3-46e0)（2 条主链，单模型）。

厂商实测（有销售立场，样本小）：[14] [Atlas：2K vs 768P](https://www.atlascloud.ai/blog/tips/minimax-h3-2k-vs-768p)；[15] [Atlas：H3 参考图](https://www.atlascloud.ai/blog/tips/minimax-h3-reference-to-video)；[16] [Fuser：H3 指南](https://fuser.studio/articles/minimax-h3-prompt-guide)。

厂商经验：[17] [Hailuo 空间逻辑指南](https://hailuoai.video/pages/knowledge/director-guide-shot-reverse-shot-spatial-logic)；[20] [invideo：运镜与镜头类型](https://invideo.io/faq/how-do-you-describe-camera-movements-and-shot-types-in/)；[21] [Quest Studio：180 度规则](https://queststudio.io/blog/ai-video-180-degree-rule-guide)。

百科：[18] [180 度规则](https://en.wikipedia.org/wiki/180-degree_rule)；[19] [30 度规则](https://en.wikipedia.org/wiki/30-degree_rule)。

本地测量：`/private/tmp/claude-501/-Users-michael-SideProject-OpenSlate/72ad4e96-05c6-43a3-b1fc-50ac771fee4e/scratchpad/continuity-scripts/lowpass.py`（top 30% 画面高斯模糊后缩到 48 宽，容忍 ±10% 平移的归一化相关）；黑边用 ffmpeg `cropdetect`。
