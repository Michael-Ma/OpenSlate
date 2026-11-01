# 调研：剪辑、转场、文字与声音

证据等级：**实测**（本次在 8 段片段上跑过）、**论文**、**官方**、**行业**（指南或二手转述）、**经验**（我的判断）。

## 结论

1. **生硬的主因是切错了地方，不是缺转场。** 模型把动作铺满整段片段，比计划平均晚 1.33 秒，而计划只取开头。7 段明显切早，clip-1 也差约 2 帧。躺倒、转身拒绝、大舔、吃掉那粒狗粮、无辜眼神，全部被切掉了。
2. **这个问题今天就能修，不用改渲染器。** 现有 `startFrame/durationFrames` 足够，缺的是导演看不见画面。
3. **无声会让每个切点更显眼。** Smith 2017 发现去掉音轨后 edit blindness “mostly disappearing”。所以声音和字幕排在 `xfade` 前面。
4. **字幕用 PNG 加 `overlay`，已跑通。** `@napi-rs/canvas` 已在依赖树里，MIT 许可，中文可用。
5. **原生音频存在，但不能当音床。** Viggle 原始文件 10 个全带音轨，从频谱看是每段不同的配乐和类人声。

## 1. 七个切点为什么硬

先看源片段。动作都比 prompt 写的晚：

| 片段 | 关键动作 | 计划完成 | 实际完成 | 滞后 | 成片出点 | 被切掉的内容 |
|---|---|---|---|---|---|---|
| clip-1 | 鼻子碰哑铃 | 3.0s | f92 / 3.07s | +0.07s | f90 | 接触瞬间，差约 2 帧 |
| clip-2 | 躺倒 | 2.8s | f150 / 5.00s | +2.20s | f120 | 整个躺倒（f125–150），片中第一个笑点，只差 5 帧 |
| clip-3 | 转身趴下 | 4.0s | f178 / 5.93s | +1.93s | f120 | 盯镜头（f125–140）和拒绝（f142–178） |
| clip-4 | 抬头 | 2.0s | f118 / 3.93s | +1.93s | f60 | 盯住狗粮后的抬头 |
| clip-5 | 到碗 | 5.0s | f172 / 5.73s | +0.73s | f150 | 入碗。另外本镜前 3 秒原地不动，占 60% |
| clip-6 | 舔嘴 | 4.0s | f156 / 5.20s | +1.20s | f120 | 大舔（f146–156）和抬头看镜头 |
| clip-7 | 吃掉那粒 | 4.5s | f172 / 5.73s | +1.23s | f150 | 吃掉，以及最好的侧目（f188–196） |
| clip-8 | 下巴落地 | 2.0s | f100 / 3.33s | +1.33s | f90 | 全片结尾：无辜眼神（f120 起） |

时间由我逐帧读出，这是后文的地面实况。

| 切点 | 旧 out → in | 为什么硬 | 更好的点 |
|---|---|---|---|
| 3s | c1 f89 → c2 f0 | 动作本来接得上，但头还在动，大狗突然变小狗 | c1 f100 → c2 f50，同一动作换角度 |
| 7s | c2 f119 → c3 f0 | 躺倒前 5 帧切走；狗目测放大近 3 倍；换地点没有提示 | c2 f170 → c3 f10，躺倒完成再走 |
| 11s | c3 f119 → c4 f0 | 吐舌途中切到远处微笑，情绪和姿态同时跳变 | c3 f178 → c4 f44，趴接趴 |
| 13s | c4 f59 → c5 f0 | 趴变站；切后运动全片最低（0.79），画面像卡住 | c4 f119 → c5 f112，抬头接迈步 |
| 18s | c5 f149 → c6 f0 | 最接近顺接，但鼻子未到碗，下一镜已在碗里 | c5 f172 → c6 f12，碗的大小几乎不变，位置接近 |
| 22s | c6 f119 → c7 f0 | 舔到一半切到走出几步的背影 | c6 f174 → c7 f3，看完镜头再走 |
| 27s | c7 f149 → c8 f0 | 差一点吃到就切到坐着笑，结尾停在下趴途中 | c7 f197 → c8 f34，结尾停在无辜眼神 |

剪辑修不了的是房间不一致：地毯、沙发、挂画仍会跳。这部分归连续性方向。

两个顺带发现（实测）：`fit:"contain"` 让每帧上下各有约 15px 黑边；Viggle 原片是 24 fps，归一化到 30 fps 后每 5 帧重复 1 帧。

## 2. 什么让切点顺

| 手法 | 依据 | 等级 | 在 Tofu 上怎么用 |
|---|---|---|---|
| 切后要有运动 | 去掉切后运动，切点更容易被发现；去掉切前运动无影响（[Smith 2017](https://ualresearchonline.arts.ac.uk/id/eprint/21152/)） | 论文，好莱坞片段的检测任务 | 入点放在动作进行中 |
| 有声音 | 同上，无音轨时 edit blindness 大部分消失 | 论文 | 补音轨本身就在修切点 |
| Match on action | 遵守连续性规则的切点更难被发现（[Smith & Henderson 2008](https://doi.org/10.16910%2Fjemr.2.2.6)） | 论文 | 切点 3s、18s |
| 情绪优先于位置 | Rule of Six：情绪 51%、故事 23%、节奏 10%，eye-trace 和空间合计 16%（[Murch，转述](https://nofilmschool.com/2016/11/6-rules-good-cutting-according-oscar-winning-editor-walter-murch)） | 行业，未读原书 | 笑点完整比位置匹配重要 |
| 动作重叠 | Dmytryk 主张 3–5 帧，Anderson 约 2 帧（[Hecht & Kalkofen 转引](https://experimental.psychologie.uni-mainz.de/files/2024/06/2009hecht-kalkofen.pdf)）；但重复或缺失最多半秒几乎不影响流畅感（[Zhu 等 2025](https://experts.illinois.edu/en/publications/action-mismatches-across-movie-edits-minimally-impact-perceived-s/)） | 行业、论文 | 不必追帧级重叠 |
| J / L cut、sound bridge | [Adobe 指南](https://www.adobe.com/creativecloud/video/discover/j-cut-and-l-cut) | 行业 | 狗粮声先响；咀嚼声盖住 jump cut |
| Dissolve | 常用于表示时间流逝（[Wikipedia](https://en.wikipedia.org/wiki/Dissolve_(filmmaking))）；本片中点帧出现两只狗、两个碗 | 行业、实测 | 默认不用 |
| 音效卡点 | Tony Zhou 分析 Edgar Wright，画面、剪辑、音效共同制造笑点（[转述](https://laughingsquid.com/how-to-do-visual-comedy-an-analysis-of-director-edgar-wrights-humorous-cinematic-styles-and-techniques/)） | 行业，文字稿 403 未读到 | 落地、舔嘴、吃掉 |

没查到“短喜剧里 dissolve 是否有害”的专门研究。默认不用是根据上面的实测和经验：它拖慢节奏，还暴露房间差异。只有构图基本相同的镜头才值得用。

## 3. 自动选入出点

| 方法 | Tofu 实测 | 可靠程度 | 用途 |
|---|---|---|---|
| `scdet`、`select=scene` | 成片 7 个切点全中（13.4–15.9），片段内 0 个（最高 3.04） | 找切点完全可靠，找入出点没用 | 渲染后 QA |
| PySceneDetect | 未安装未跑。[官方文档](https://www.scenedetect.com/docs/api/detectors.html)说明它同样检测帧间突变 | 推断结果同上 | 不引入 |
| `freezedetect` | n≤0.01 无结果，n=0.05 把走动也算进去，AI 画面有持续微动 | 不可靠 | 不用 |
| 帧差和运动能量（`tblend` + `signalstats`，9 帧平滑） | 找得到空闲段和动作起点。但 clip-2、clip-7 的旧出点都在低能量处，笑点分别在 5、8 帧后才来 | “安静”不等于“完成” | 候选点和空闲过滤 |
| 视觉模型读 contact sheet | Haiku 盲测 16 个事件（0.5 秒一格）：中位误差 7.5 帧，12/16 在 15 帧内，两次语义错误（32、48 帧） | 能理解动作，单轮不够 | 主方法 |
| 视觉选点再吸附运动候选 | 中位误差 8.5 帧，没有改善 | 假设被否定 | 不做 |

这只是一个评分者、一部片的结果，不能当成统计结论。按 Zhu 2025 的容忍度，±8 帧大概够用，但这是推论。[Gemini 官方](https://ai.google.dev/gemini-api/docs/video-understanding)默认 1 fps 采样，对这种短动作偏粗，未测。

建议流程：用 ffmpeg 抽帧，用 canvas 标帧号，每 0.5 秒一格，附运动曲线；视觉模型标事件，再看 ±15 帧的细图定点；规则检查切后运动；`scdet` 核对切点数。

## 4. 渲染器功能排序

渲染耗时实测：concat、重剪、8 条字幕、7 处 `xfade` 都在 7–13 秒，差异是并发噪声，超时预算约 156 秒。

| 排名 | 功能 | 实测或依据 | 判断 | 工作量 |
|---|---|---|---|---|
| 1 | 选起始帧 | 已支持，下文 EDL 全靠它 | 影响最大，缺的是可见性 | 0（渲染器） |
| 2 | 字幕 | 8 条光栅化 55–61ms，`overlay` 通过 | 让内容读得出来 | 3 天 |
| 3 | 音效 | `audio` 放置已支持，12 个音效用等价滤镜图实测通过 | 缺音源，不缺能力 | 2–3 天 |
| 4 | 响度和 fade-in | 占位混音只有 -24.6 LUFS；现在只有 `fadeOutSamples` | 必需的小改动，`loudnorm` 可用 | 0.5 天 |
| 5 | 定帧、整段变速 | 2× `setpts` 约 0.3 秒，分两行即可做 ramp | 喜剧常用；重复帧的观感未验证 | 1 天 |
| 6 | 固定 punch-in | Laplacian 方差：1.2× 降 28%，1.4× 降 48%，1.4× 目测仍可用 | 一段素材得到第二种景别 | 0.5 天 |
| 7 | `xfade` | 830 帧精确，但重影明显 | 整部片最多用一处，推迟 | 2 天 |
| 8 | `acrossfade` | 音频放置独立于画面，J/L cut 已可做 | 不需要 | 0 |
| 9 | `minterpolate`、`tmix` | 2 秒素材要 9.6–19.1 秒，全片约 144–286 秒，接近或超过预算 | 不做 | 0 |

文字方案对比：

| 方案 | 中文 | 确定性 | 代价 | 判断 |
|---|---|---|---|---|
| canvas 生成 PNG + `overlay` | 可用 | 同机重复逐字节一致，跨平台未测 | 要把可选依赖改为直接依赖，要固定字体 | **推荐** |
| `resvg-js` + 子集字体 | [README 示例](https://github.com/thx/resvg-js)用中文字体，可关系统字体 | 文档未承诺跨平台确定性 | 新增原生依赖 | 备选 |
| 自编 ffmpeg（libass） | 排版最好 | `toolchainDigest` 可控 | 各平台都要发布构建 | 不值得 |
| `drawbox` 点阵（Demo 水印） | 只有几个西文字形 | 完全确定 | 字库不现实 | 不行 |
| 让图像或视频模型写字 | 字形不可控 | 否 | 付费 | 不行 |

PNG 方案的好处是渲染器不碰字体，字幕只是带 hash 的素材，符合现有 manifest 思路。代价有三点：
- 测试用的 macOS 字体不能分发，要换 OFL 字体并把字体 hash 写进 identity。
- 中文字体文件大，需要子集化。
- 现有 `INPUT_OPTIONS` 会拒绝 PNG（实测 rc 234），要给 PNG 输入单独加 `png_pipe`（已验证）。

字幕规格：[Netflix 简中规范](https://partnerhelp.netflixstudios.com/hc/en-us/articles/215986007-Chinese-Simplified-Timed-Text-Style-Guide)是每秒 9 字、每行 16 字。竖屏大字我建议每秒不超过 7 字、每行不超过 8 字（经验）。TikTok 不公布固定像素安全区，第三方数字互相矛盾；我用 y≈300、左右留 120px，发布前对官方模板核对。

## 5. 声音

**重要程度。** 能查到的数据大多来自平台自己：TikTok 称 [88% 用户认为声音至关重要](https://ads.tiktok.com/business/en-US/blog/evolution-of-sound-volume-1)（Nielsen 2020），同页又写 9 成，且与喜剧无关。没查到音效提升短喜剧笑果的实验。我的判断是，这部片音效比音乐更关键，因为笑点全靠动作，声音要告诉观众“这里好笑”。字幕也不能省，它同时覆盖静音观看。

**音乐。** Lyria 的 BPM 似乎只能写在 prompt 里（[第三方](https://aicybr.com/blog/google-lyria-3-5-gemini-api-guide)），有 `bpm` 参数的是流式的 [Lyria RealTime](https://ai.google.dev/gemini-api/docs/realtime-music-generation)。所以要先生成音乐，用已有的 `analyzeSongFile` 测节拍，再在片段余量内把切点吸附到节拍。它目前没有接到 Code plan。不必每刀都卡拍，3–4 个关键笑点卡住即可，盯镜头时让音乐停下，这是经验。

**音效来源：**

| 来源 | 授权 | 成本 | 判断 |
|---|---|---|---|
| Kenney 音效包 | [CC0](https://opengameart.org/content/interface-sounds)，官网未取到，要核对包内 license.txt | 免费 | 首选，挑 30–50 个进仓库 |
| Freesound | 每个声音单独授权；[API 商用需个案协商](https://freesound.org/help/tos_api) | 网站免费 | 人工挑 CC0 补缺，不接运行时 API |
| ElevenLabs Sound Effects | [价目页](https://elevenlabs.io/pricing/api)写 royalty-free，未查到完整条款 | 同页两次读取分别是 $0.12 每次和每分钟，[帮助页](https://help.elevenlabs.io/hc/en-us/articles/25735337678481)是 40 credits/秒 | 定制备选，先核实账单 |
| `aevalsrc` 合成 | 自有 | 0 | 仅作占位 |

Pixabay、Sonniss、Zapsplat 未核查。

**原生音频（实测，未试听）。** 8 段 Tofu 原始文件都有 AAC 32 kHz 音轨，响度 -12 到 -28 LUFS。频谱显示 clip-1/3/4/8 有音节状的类人声，clip-2/5/6/7 是持续音加规律脉冲，像配乐。逐段剪开后声音每刀都换，不能当音床。结论：继续剥离。当前 Viggle 请求没有传音频参数，厂商是否支持未查；`deriveClipAudio` 没接到 Code plan。Seedance 和 Veo 的音频评价都来自[厂商博客](https://www.atlascloud.ai/blog/guides/ai-video-models-native-audio-compared)，没有宠物内容的证据，试用时单独测一段。

## 6. Tofu 重剪

只用现有 8 段，全部切点落在 15 帧网格上（120 BPM）。S3、S6 用同一片段两行 timeline 做 jump cut，今天的 API 就能表达。

| 镜 | 源片段 | 入–出 | 成片时间 | 接法 | 字幕 | 声音 |
|---|---|---|---|---|---|---|
| S1 | clip-1 | f25–100 | 0–2.5s | 开场就在动 | 减肥第一天 | 音乐起 |
| S2 | clip-2 | f50–170 | 2.5–6.5s | 同一动作换角度 | 今日运动：完成 | 5.7s 落地闷响 |
| S3 | clip-3 | f10–44、f92–178 | 6.5–10.5s | 硬切，碗声先入 | 健康餐？ / 告辞。 | 7.9s 吐舌；8.7s 音乐停，盯镜头 |
| S4 | clip-4 | f44–119 | 10.5–13s | 趴接趴 | 等等… | 10.1s 狗粮声先响（J-cut），解释他为什么看过来，音乐重入 |
| S5 | clip-5 | f112–172 | 13–15s | 抬头接迈步 | 这才叫有氧 | 12.9s whoosh，脚步 |
| S6 | clip-6 | f12–54、f96–174 | 15–19s | 鼻入碗 match on action | 无 | 咀嚼声连续盖住 jump cut；18.2s 舔嘴 |
| S7 | clip-7 | f3–198 | 19–25.5s | 硬切 | 还有一粒！ | 21.4s 叮；24.4s 吃掉；25.2s 侧目 |
| S8 | clip-8 | f34–169 | 25.5–30s | 硬切，停在无辜眼神 | 减肥，明天再说 | 29.3s 收尾 |

| 指标（实测） | 旧版 | 重剪 |
|---|---|---|
| 切点后 10 帧运动均值 | 1.45 | 2.76 |
| 切点后运动低于 1.0 的切点 | 2/7 | 0/7 |
| 平静帧占比 | 35% | 26% |
| 动作完成后才切的片段 | 0/8 | 8/8 |

字幕和时间已渲染，音频是占位合成，只用来核对位置，不代表音色。我听不到声音，节奏也需要你看片判断。S2 到 S3 仍是时间跳跃，房间差异仍然可见。

- 重剪加字幕（无声）：`/private/tmp/claude-501/-Users-michael-SideProject-OpenSlate/72ad4e96-05c6-43a3-b1fc-50ac771fee4e/scratchpad/editing-research/render/c-captions.mp4`
- 带占位音频：`/private/tmp/claude-501/-Users-michael-SideProject-OpenSlate/72ad4e96-05c6-43a3-b1fc-50ac771fee4e/scratchpad/editing-research/render/e-with-placeholder-audio.mp4`
- 原生音频试听：`/private/tmp/claude-501/-Users-michael-SideProject-OpenSlate/72ad4e96-05c6-43a3-b1fc-50ac771fee4e/scratchpad/editing-research/render/g-native-audio-listen.mp4`

## 7. 落点

| 优先级 | 改动 | 位置 | 影响 | 工作量 |
|---|---|---|---|---|
| P0 | 写入剪辑规则：动作默认晚 1–2 秒；入点在动作中；笑点完成后再留 6–12 帧（match on action 除外）；可用两行 timeline 去掉中段；默认硬切 | `skills/code-plan/SKILL.md`，`editPolicy` 模板 | 高 | 0.5 天 |
| P0 | 让导演看片：每段给 contact sheet 和空闲段摘要，改为两轮（先生成，看片后写入出点） | `apps/server/src/code-plan/view.ts`，`read_film` | 最高 | 2 天 |
| P1 | 字幕 `overlays`（PNG artifact、起止帧、位置） | `media/types.ts`、`local-media.ts`、`local-timeline.ts`、`studio.d.ts` | 高 | 3 天 |
| P1 | 音效库和 `ctx.sfx` | `studio.d.ts`、`code-plan/models.ts`，CC0 素材目录 | 高 | 2–3 天 |
| P1 | `fadeInSamples` 和响度归一 | `local-media.ts` | 中 | 0.5 天 |
| P2 | 音乐先行，接 `analyzeSongFile` 吸附切点 | `code-plan/view.ts`，`SKILL.md` 音乐段落 | 中 | 1 天 |
| P2 | 比例差小于 2% 时默认 `cover` | `SKILL.md` | 小 | 0.1 天 |
| P2 | 定帧、变速、punch-in | `local-media.ts`，`studio.d.ts` | 中 | 1.5 天 |
| P2 | 渲染后 QA：`scdet` 核对切点数，检查切后运动 | `local-media.ts` | 小 | 0.5 天 |

“切后运动 ≥1.0”只来自这一部片，要多看几部再定。

## 限制

地面实况是我一个人读帧得到的；盲测只有一个评分者；渲染测试用的是与渲染器等价的 ffmpeg 命令，没有跑 `LocalMediaService`；所有音频判断都没有试听；Smith 的结论来自好莱坞片段，用到 AI 短片是外推；ElevenLabs 价格未能确认；Lyria 的 BPM 行为未实测。
