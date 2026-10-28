# 音乐视频：默认配乐、跟随歌曲的时长与对口型

日期：2026-10-28 · 分支：`worktree-agent-a447eb6d43842548f`（基于 `feature/last-ferry-ui` 78aac6e 快进）

## 0. 一句话结论

- **默认配乐（已实现）**：在 Assets 里以「音乐」（`role=music`）导入的录音，如果这部影片**从未选过音乐**，就会自动成为影片配乐。实现上直接复用人的 `soundtrack` storyboard 命令，所以校验、Undo 和事件都和人手动选择一样。如果是音乐视频，音量会再设为 0 dB。
- **影片时长跟随歌曲（已实现）**：本地分析歌曲的时长、BPM、节拍网格和段落起点，并给出「镜头时长拟合」：
  - 新的 `shotTiming` storyboard 命令一次改多个镜头，只有一个 Undo。
  - Film 视图的音乐工具栏新增「镜头对齐歌曲 / Fit shots to song」。
  - 音乐视频的 Director 规划上下文新增 `musicVideo` 块。
- **对口型（只做了 seam）**：
  - 推荐流程：先用 Viggle 生成表演片段，再用「视频 + 音频」lip-sync 做第二遍，输入是人声分轨里这个镜头对应的歌曲片段。
  - 首选服务：sync.so `lipsync-2-pro`，约 **$4.02–4.98 / 分钟输出**（随订阅档位变化）。
  - 已实现与服务商无关的 seam（片段切分、尝试状态机、显示规则、fake adapter）。没有真实 adapter，没有凭证，没有网络调用。
- **需要 catalog / skill 版本升级的仅规格项**：`set_soundtrack` 工具、`read_context` 的 `audio_library` 小节、`filmKind`、镜头 `performance` 字段、lip-sync 执行节点，以及 V8 skill 指南。见 §5。

---

## 1. 现状梳理（改动前）

### 1.1 音乐链路：导入 → 选为影片音乐 → 导出混音

| 环节 | 位置 | 行为 |
|---|---|---|
| 导入音频库 | `apps/server/src/narration/audio-library-routes.ts` `POST /api/projects/:id/audio-library/uploads?role=music\|voice\|upload&name=` | FFmpeg 规范化为 48 kHz 立体声 PCM16 WAV，写入 `narration_audio` 和 `audio_library_label{role}`。不修改项目，请求文本明确写着 "No narration or music placement is selected." |
| Web 导入 | `apps/web/src/next/views/assets/ImportSheet.tsx`、`model/assets-import.ts` | 用户在导入时选择 "music"（影片音乐）或 "upload"（其他音频）。`AudioUse` 的注释本来就写的是 "the film's music"，但导入后**并不会**自动选中。 |
| 选择影片音乐 | `apps/server/src/storyboard.ts` `editStoryboard` 的 `kind:"soundtrack"`，字段 `audioId \| startFrame \| gainMilliDb \| muted` | `project.soundtrack = {audioId, gainMilliDb(默认 -18000), startFrame?, muted?}`；`audioId:""` 设为 `null`，即「不要音乐」。`soundtrack` 是 hold-free 命令，可以 Undo。 |
| Web 选择 | `views/film/MusicMenu.tsx`、`useMusicLibrary.ts`、`model/film.ts` `musicChoiceEdit` | Film 视图里的 "Change music / No music"。 |
| 试听 | `narration/shot-audio-routes.ts` `/narration/playback` 和 `soundtrack-placement.ts` | 音乐从 `startFrame` 开始播放，在影片结尾截断。 |
| 导出混音 | `media/storyboard-capture.ts`、`media/timeline-capture.ts` 和 `soundtrackPlacement` | 按保存的 gain 混入。**影片比歌短时歌曲被截断，影片比歌长时后面是静音**。 |
| Director | `tool-invocations.ts`、`film-planning-guidance.ts:38`、`director-input.ts` | **没有任何工具能写 `soundtrack`**。`prepare_change` 写不到它，guidance 把音乐描述成人的操作。 |

**真实运行失败的根因**：

1. 歌曲导入音频库后没有被选中，Director 又没有能写音乐的工具，于是回答「无法设为影片音乐」。
2. 用户没有在 Film 视图手动选择，所以导出的 MP4 没有音乐。
3. coordinator 的 gap audit（56fb92b）还发现：在聊天里附带的音频会被归为普通 upload，不算音乐。

### 1.2 项目怎么知道自己是音乐视频？

**目前不知道。**

- `ProjectRecord` 没有 film kind 或 genre 字段。
- intake、plan 和 skill 里都没有 "music video" 概念（检索了 `apps/server/src`、`packages/core/src`、`apps/web/src/next` 和 `skills/v7`）。
- 唯一的信号是用户自己写在 `name`、`brief`、`story` 里的文字。

本次用 `isMusicVideoProject()` 做文字识别：

- 中英文短语，例如 music video、lyric video、音乐视频、音乐录影带、歌曲视频。
- 大写整词 `MV`。小写的 `mv` 不算，避免误识别 shell 命令。

显式字段 `filmKind` 列为仅规格项（§5.3）。

---

## 2. 设计：默认配乐（default soundtrack）

### 2.1 规则（`apps/server/src/narration/music-video.ts` `defaultSoundtrackDecision`）

| 条件 | 结果 |
|---|---|
| 导入时 `role !== "music"` | 不选 |
| `project.soundtrack === undefined`（从未选择过） | **自动选中**。音乐视频再把 gain 设为 0 dB；其他影片保持现有的 -18 dB 默认值 |
| `project.soundtrack === null`（人选过「不要音乐」） | 尊重这个选择，不选 |
| 已经有配乐 | 不替换 |

设计要点：

- **复用人的命令语义**：
  - 自动选择就是调用 `editStoryboard(kind:"soundtrack", field:"audioId")`，音乐视频再调用一次 `field:"gainMilliDb", value:"0"`。
  - 两次调用的命令键都由导入身份派生（`audio-library-default:<importId>:audioId|gain`）。
  - 所以 Undo、`storyboard.edited` 事件、`recordHumanFields`、项目版本和 hold-free 行为都与人手动选择一致。
  - `soundtrack` 命令本身**一字未改**。
- **导入不会因为选中失败而失败**：以下情况下，录音照常导入，只是不选中：
  - 有待确认的 plan import（`IMPORT_PENDING`）；
  - 恢复模式；
  - 两次版本冲突。

  这时会写入事件 `audio_library.default_soundtrack_skipped{code}`。
- **回执**：`recording.selectedAsMusic: boolean` 由当前状态计算，所以同一个 key 重放会得到相同回执。Web toast 会显示「已导入 X，已设为影片音乐。」
- **人仍然可以更换或移除**：Film 视图的 Change music 和 No music 不变。选「不要音乐」之后再导入新的音乐，也不会被自动选中。
- 只有 Assets 导入（`role=music`）会触发。聊天附件触发不了，需要 Director 工具（§5.1）。

### 2.2 为什么音乐视频用 0 dB

-18 dB 是给旁白垫的背景乐。音乐视频里歌曲就是主音轨，片段音频本来就全部静音（`film-audio.ts`："Clip audio is always muted"），所以用 0 dB 不会和其他声音冲突。

---

## 3. 设计：影片时长与镜头节奏跟随歌曲

### 3.1 歌曲分析（`apps/server/src/media/song-timing.ts`，纯本地、确定性）

- **输入**：规范化后的 48 kHz 立体声 PCM16 WAV。以 1 MiB 为块流式读取，6 分钟的歌也不会整段放进内存。
- **包络**：每 10 ms（480 个样本）计算一次能量，得到 100 Hz 的包络。
- **起音强度（onset）**：先对 log 能量做半波整流差分，再减去局部均值。
- **速度**：
  - 在 60–200 BPM 范围内做去均值自相关，按 log2 偏好 120 BPM，用来解决倍频歧义。
  - 用抛物线插值细化，再用全曲 comb 微调周期，避免长歌的累积误差。
  - 置信度低于 0.12 时 `bpm=null`，`beatFrames=[]`。噪声、无节拍或自由速度的歌都属于这种情况。
- **节拍相位**：用 comb 打分选出，再换算成 30 fps 帧。
- **段落**：
  - 以小节（4 拍，没有节拍时用 2 s）为窗口，计算 log 能量的前后 4 窗差，作为 novelty。
  - 取超过 mean + std 的局部峰，相邻段落至少间隔 8 s，最多 12 段，并吸附到最近的拍上。
- **输出**：`SongTiming{version:"song-timing@1", durationSamples, durationFrames, bpm, beatFrames, sectionStartFrames}`。
- **缓存**：导入 `role=music` 时计算一次，存入 `song_timing` 实体，以 `audioId` 为键并校验 sha256。分析失败不影响导入。

### 3.2 拟合（`fitShotsToSong`，纯函数）

- **目标长度** = `soundtrack.startFrame` + 歌曲长度，上限为 `min(maxFrames, 10800)`。
- **比例**：保持现有镜头之间的时长比例。每个镜头限制在 90–450 帧（3–15 s），并支持每个镜头的下限 `minFrames`（已接受的 within_shot 旁白）。
- **切点吸附**：
  - 场景结束处优先吸附到段落起点，容差 ±3 s。
  - 其他切点吸附到节拍，容差为一拍。
  - 吸附必须保证当前镜头和后面所有镜头仍然可行。
- **镜头不够或太多时**：
  - 镜头不够长时报告 `shortfallFrames`，需要加镜头。
  - 镜头太多太长时报告 `overflowFrames`，需要删镜头。
  - 这两种情况都不会偷偷加删镜头。

### 3.3 落地方式

- **服务端**：
  - `GET /api/projects/:projectId/audio-library/:audioId/timing` 返回 `{timing, fit(当前故事板), musicVideo, selected, headVersion}`。
  - 新增 storyboard 命令 `kind:"shotTiming", timings:[{id, desiredFrames}]`。它是一条命令，只有一个 Undo。
    - 每个镜头的效果与单镜头修改 `desiredFrames` **完全相同**：只让视频意图和视频片段过期，关键帧和 prompt 保留；会记录 `HUMAN_EDITED_FIELD`；遵守旁白时长下限。
    - 有待确认的 plan import 时拒绝。
- **Web**：
  - 选中音乐轨后，工具栏显示「歌曲 76 秒 · 影片 48 秒」和「镜头对齐歌曲」。
  - 按钮的 title 说明已生成的视频片段会过期，toast 带 Undo。
  - 如果拟合结果已经过期（headVersion 不同），或者没有任何变化，就不发送。
  - Fixture（last-ferry）同步实现了 timing 路由和 `shotTiming` 命令。
- **Director**：
  - 当项目是音乐视频且已有配乐时，`filmPlanningGuidance` 多一个 `musicVideo` 块，包含：
    - 规则：按歌曲规划场景和镜头；
    - 歌曲的秒数、BPM、段落起点；
    - 拟合出的每个镜头的 `desiredFrames`，以及 shortfall / overflow。
  - 这是 host guidance，不属于工具或 skill 契约。没有媒体的镜头可以直接用现有的 `prepare_change` 写入，有媒体的镜头仍然走 `propose_change`。
  - 其他影片不加这个块（键不存在），已有的 guidance 不受影响。

---

## 4. 对口型调研（2026-10-28 网络调研；页面多无日期，按访问日计）

### 4.1 Viggle（当前视频服务商）

- 公开 API（`POST /v1/renders`）只支持「图像 + 动作视频」驱动，**文档里没有音频驱动或 lip-sync 端点**。价格约 1 credit/s，相当于 $0.60/分钟。
- Viggle **App** 有 "Mic" / "Rap" 功能（图像 + 音频，可以导入音乐）。这个功能**没有开放 API**。
- 结论：现有 Viggle adapter 做不了对口型，需要第二家服务。

### 4.2 候选对比

| 服务 / 模型 | 输入 | 单次最长 | USD / 分钟输出 | 唱歌质量 | API |
|---|---|---|---|---|---|
| **sync.so** lipsync-2 / **lipsync-2-pro** / sync-3 | 视频 + 音频 | 按订阅档：Free 15 s、Hobbyist 1 min、Creator 5 min、Growth 10 min、Scale 30 min | 2: $2.40–3.00；**2-pro: $4.02–4.98**；sync-3: $6.42–7.98（fal 上 sync-3 为 $8.00） | **唯一明确在文档里支持唱歌的服务**，建议先做人声分离；长视频自动按 30–40 s 分块 | 公开 REST，自助 key，有 Python SDK；轮询或 webhook；按 25 fps 输出帧计费；失败是否扣费没有写明 |
| Kling LipSync（fal） | 视频 + 音频 | 视频 2–10 s，音频 ≤60 s，≤5 MB | 约 $0.17 | 未验证，偏向说话 | fal 队列 + webhook；Kling 官方 `/v1/videos/advanced-lip-sync` 的限制未验证 |
| Kling AI Avatar v2（fal） | 图像 + 音频 | 跟随音频长度，上限未标明 | Std $3.37 / Pro $6.90 | 未验证 | fal |
| Hedra Character-3 | 图像 + 音频 | 600 s | ≥ $1.50（API 钱包「2.5¢/s 起」，精确价格未验证） | 有歌手示例，但没有官方唱歌说明 | 公开 REST，预付；轮询、SSE 或 webhook；支持幂等键 |
| OmniHuman v1.5（fal / BytePlus） | 图像 + 音频（+ mask、prompt） | 720p <60 s，1080p <30 s | $9.60 | fal 指南：唱歌需要在 prompt 里写明 | fal 队列 |
| Wan 2.2-S2V（开放权重 / fal） | 图像 + 音频 + prompt | 按帧数 | 480p $6 / 720p $12 | 未验证 | fal 或自托管 |
| InfiniteTalk（开放 Apache-2.0 / fal） | 图像或视频 + 音频 | V2V 号称不限长度，I2V 约 1 min 后会色漂 | fal 480p $12 / 720p $24 | 未验证 | fal 或自托管 |
| LatentSync（开放，ByteDance / fal） | 视频 + 音频 | 未标明 | $0.20 一口价到 40 s，之后 $0.005/s（约 $0.30/min） | 未验证 | fal、Replicate |
| MuseTalk 1.5 / Hallo3（开放） | MuseTalk：视频 + 音频；Hallo3：图像 + 音频 | 未验证 | MuseTalk 在 Replicate 约 $0.05/次（第三方数据） | 未验证 | 社区托管 |
| Runway Act-Two / Avatars | Act-Two 由表演视频驱动，**不由音频驱动**；Avatars 由脚本或实时会话驱动 | 未验证 | act_two $3.00 | 不适用 | 公开 REST |
| Veo 3.1 / Gemini Omni | 文本或图像，**音频由模型自己生成** | Omni 可延长到 40 s | 带音频 $24（经 Runway） | **不能用给定的歌驱动**（文档："Uploading audio references is unsupported."）。Gemini API 的 Veo 3.1 Preview 已于 2026-10-22 下线 | 不适用 |
| HeyGen Avatar IV / Captions / Tavus | 照片 + 音频或脚本 | 未验证 | HeyGen 约 $3/min（第三方数据） | 面向说话人头像 | 未深入调研 |

> 未标注来源的数字都来自服务商定价页或 fal 模型页，访问日为 2026-10-28。来源 URL 见 §7。「未验证」表示没有在一手资料里确认。

### 4.3 人声分离

推荐做人声分离。

- sync.so 官方建议唱歌素材先分离人声，因为伴奏会干扰口型。
- 做法：
  1. 用 Demucs htdemucs 的 `--two-stems=vocals` 在本地离线分离。
  2. 只把 vocals 分轨送去 lip-sync。
  3. 成片仍然混**原始全混音**（配乐），lip-sync 输出片段里的音频照常静音。
- 服务商侧也有分离：Runway `eleven_voice_isolation` 是 $0.01 / 6 s，Hedra 是 10¢/min 起。
- 风险：vocoder、talkbox 这类重度处理的人声，以及分离伪影，仍然可能导致口型不好。没有找到量化对比。

### 4.4 推荐管线

**先生成表演片段，再做 lip-sync**，而不是改成音频驱动生成：

1. Viggle 按现有流程生成唱歌镜头的表演片段，包括身体动作和角色一致性。现有的关键帧确认和视频确认两次决策不变。
2. 对 `isSingingShot` 的镜头（以后改为 `performance: "singing"`），把歌曲的 vocals 分轨按这个镜头在影片时钟上的位置切片。
3. 把「片段 + 人声切片」交给 video+audio lip-sync（推荐 **sync.so lipsync-2-pro**），得到同步后的片段，作为这个镜头的新视频输出。
4. 导出时混原歌全混音，片段一律静音（现状不变）。

理由：

- 保留 Viggle 的身体动作和已经过人审的关键帧，lip-sync 只改嘴部。
- 「图像 + 音频」的 avatar 模型（Hedra、OmniHuman、Kling Avatar）会**替换** Viggle 的整段生成，失去角色动作控制，单价也更高（$3–10/min）。
- sync.so 是唯一在文档里明确支持唱歌的服务，单次长度远大于 15 s 的镜头上限，REST、webhook、按帧计费都清楚。
- 便宜的备选：
  - Kling LipSync（约 $0.17/min），但视频不能超过 10 s，15 s 的镜头要拆开。
  - LatentSync（约 $0.30/min，开放权重）。

  两者唱歌质量都未验证，只适合做 A/B 试验。

**成本估算**：一段 60 s 的 MV，如果约一半是唱歌镜头，sync.so lipsync-2-pro 大约 0.5 × $4.5 ≈ **$2.3**（不含 Viggle）。

### 4.5 每个镜头的歌曲切片

`songSegmentForShot(project, shotId, song)`，已实现：

- 镜头在影片时钟上占 `[start, start + desiredFrames)` 帧，帧按故事板顺序（场景顺序，再按场景内镜头顺序）累加，与导出的 `storyboardAudioCuts` 是同一个函数。
- 歌曲从 `soundtrack.startFrame` 开始播放。两段区间取交集，换算成 48 kHz 样本：`startSample`（在歌曲里的位置）、`durationSamples`、`shotOffsetSamples`（音乐比镜头晚开始时，切片在镜头内的起始偏移）。
- 以下情况返回 `null`，不做 lip-sync：已静音；音乐不是这首歌；这个镜头时段里没有歌声（比如在前奏之前或尾奏之后）。
- 仅规格：
  - 给服务商的音频要补静音到与片段等长（前补 `shotOffsetSamples`，后补到镜头结束）。
  - vocals 分轨作为 `audio-derivation` 按歌曲 sha 缓存一次。
- **lip-sync 输出会绑定到这个切片**。如果之后移动镜头、改镜头时长、改音乐起点或换歌，切片的 `(audio sha, startSample, durationSamples)` 都会变，输出就应该过期。这一点要写进执行节点的 intent digest（仅规格，§5.5）。

### 4.6 失败与已扣费如何显示（与现有 attempt/outcome 规则一致）

已实现于 `apps/server/src/execution/lip-sync.ts`：

- **独立 attempt**：lip-sync 的 attempt 有自己的身份，与表演片段的 attempt 分开。也就是说 candidate 和 attempt 仍然分离，lip-sync 失败不会污染已有片段。
- **状态迁移**（`lipSyncTransition`）。它使用服务商通用的 `ExecutionOutcome`（accepted / completed / failed / rejected / unknown），所以接入 engine 时可以复用现有的 ingestion 和对账：
  - `rejected`（not_accepted）：**未扣费**。只有技术性拒绝（限流等）才提供「重试」，其他情况要人工再按一次。
  - accepted 之后 `failed`：如果服务商文档写明会退款，记为未扣费；否则记为 **「可能已扣费」**（`charged:"unknown"`）。sync.so 和 Hedra 都没有写明退款，fal 只说 5xx 不计费。
  - `unknown`：等待服务的回答。有 task id 时只做轮询，**绝不盲目重新提交**。没有 task id（提交的回复丢失）时，按现有 `SUBMISSION_RESPONSE_LOST` 的规则视为已花费，只能由人再按一次，生成新的 attempt。
  - 调用抛异常时记为 unknown，不记为失败，避免诱发重提。
  - spool 版本 2 的完成记录目前不被这个 seam 信任，记为 unknown。
- **显示**（`lipSyncDisplay`）：`syncing`、`synced`、`failed(charged, retry: offered | human_press)`、`no_answer`。**在同步成功之前，镜头一直显示原表演片段**（`keepsOriginalClip`）。
- **前置检查**：切片超过服务商的单次上限时，在任何调用之前就拒绝。

---

## 5. 仅规格（需要 catalog、skill 或 core 契约版本升级，由 coordinator 排期）

### 5.1 Director 工具 `set_soundtrack`（与 gap audit 56fb92b 对齐）

名称和语义沿用 audit 的提议：免费、可逆，**复用人的 soundtrack 命令**。

```jsonc
// set_soundtrack 输入（建议放进下一版 catalog，例如 7.0.0）
{
  "audioId": "<owned narration_audio id>" | null,   // null = 不要音乐；省略 = 不改
  "startFrame": 0,          // 可选，0..10800 整数帧
  "gainMilliDb": 0,         // 可选，-60000..0
  "muted": false            // 可选
}
// 结果：{ soundtrack: ProjectRecord["soundtrack"], headVersion, commandIds: [...] }
```

- **实现方式**：每个提供的字段对应一条 `editStoryboard(kind:"soundtrack", field)`，以 Director 请求为 actor，命令键由 callId 派生。
  - 失败码与人的命令相同：`NOT_FOUND`、`VALIDATION_ERROR`、`IMPORT_PENDING`、`REVISION_CONFLICT`。
  - 不需要生成授权，不需要花费额度。
- **附件**：`audioId` 可以是任何本片拥有的录音，包括聊天附件（附件会被归为普通 upload）。现有命令在选中时会把 label 的 role 改成 music，正好解决 audit 的第 3 点。
- **建议的 skill 指南**：如果是音乐视频，人提供了一首歌，而 `soundtrack` 还没选过（undefined），就调用 `set_soundtrack({audioId, gainMilliDb: 0})`。如果人选过「不要音乐」（null），先询问。
- 同步要改 `director-input.ts:50` 和 `film-planning-guidance.ts:38` 的措辞，不再说「音乐是人的操作」。这两处属于 director-gaps 的范围，本分支**没有修改**这两句。

### 5.2 `read_context` 的 `audio_library` 小节（与 audit 同名）

按页列出 `{id, label, role, origin, durationSeconds, sha256, selectedAsMusic}`。对 music-role 的录音，再附上已缓存的 `songTiming` 摘要 `{bpm, sectionStartSeconds}`。数据来源与 `GET /audio-library` 和 `/timing` 相同。

### 5.3 `ProjectRecord.filmKind?: "film" | "music_video"`（core 契约）

- 由 intake 或 Director 显式设置，`isMusicVideoProject` 改为优先读这个字段，文字识别只作为回退。
- 需要 core 契约变更和一个新工具字段（例如 `prepare_change` patch 的 `project.filmKind`），所以属于 catalog 升级。

### 5.4 可选工具 `fit_shots_to_song`

现在 Director 可以根据 guidance 的 `musicVideo.fit.timings` 用 `prepare_change` 或 `propose_change` 写入 `desiredFrames`。如果希望一步完成，可以加一个工具，由服务端拟合，再走 `shotTiming`；有媒体的镜头走 proposal。

### 5.5 Lip-sync 接入 plan 和 engine（新的执行节点）

- **新节点**：`lipsync`，输入是 video 节点的输出和 `soundtrack` 端口（vocals 分轨的切片）。
  - intent digest = `(video candidate, song sha, startSample, durationSamples, provider profile)`。
  - provider profile 进入 `provider-catalog`，带价格和 `maxSegmentSamples`。
- **触发**：
  - 镜头字段 `performance?: "singing" | "none"`，属于 core 契约，Plan 卡片上有开关。
  - 在场景确认的「视频配方」里同时列出 lip-sync 的价格，仍然是同一次场景确认，不新增审批关卡。
- **人声分离**：`audio-derivation` 新增 `vocals@demucs-htdemucs` 的本地派生（需要本地工具链，不在 v0 默认依赖里）。
- **真实 adapter**：例如 `sync-lipsync-execution.ts`，按现有 receipts、lineage、authority 的模式实现，并需要单独授权的真实测试范围。

### 5.6 Skill V8

在 production skill 里加入「音乐视频」参考：

- 按段落规划场景，镜头时长遵从 `musicVideo.fit`；
- 唱歌镜头标注 `performance`；
- 说明默认配乐和 `set_soundtrack` 的用法。

shipped package 不可变，所以只能以新版本发布。

---

## 6. 本次实现与验证

### 6.1 新文件

| 文件 | 内容 |
|---|---|
| `apps/server/src/media/song-timing.ts` | `SongEnvelope`、`analyzeSongTiming`、`analyzeSongFile`、`fitShotsToSong` |
| `apps/server/src/narration/music-video.ts` | `isMusicVideoProject`、`defaultSoundtrackDecision`、`MUSIC_VIDEO_GAIN_MILLI_DB` |
| `apps/server/src/narration/music-video-guidance.ts` | Director 的 `musicVideo` 规划块 |
| `apps/server/src/execution/lip-sync.ts` | `songSegmentForShot`、`isSingingShot`、`LipSyncAdapter`、`lipSyncTransition`、`advanceLipSync`、`lipSyncDisplay`、`FakeLipSyncAdapter` |
| `apps/server/test/music-video-soundtrack.test.mjs` | 节拍和段落、无节拍噪声、拟合、识别与默认决策、HTTP 导入（MV 0 dB、重放、第二首不替换、「不要音乐」后不选、非 MV 用 -18 dB、pending import 不选）、timing 路由、guidance、`shotTiming` 的 Undo 与校验 |
| `apps/server/test/lip-sync-seam.test.mjs` | 切片（含起点偏移、尾部、静音、换歌）、唱歌识别、提交一次只轮询、丢失回复不重提、扣费与重试显示、超长切片前置拒绝 |
| `apps/web/test/next/film-song-fit.test.mjs` | `songLength`、`songFitEdit`、fixture 拟合与 Undo、导入 toast（中英文）、fixture 默认配乐规则 |

### 6.2 修改的共享文件（合并时需要注意）

| 文件 | 改动 |
|---|---|
| `apps/server/src/storyboard.ts` | 新增 `shotTiming` kind（类型、分支、HTTP schema、affected 和 outdated 字段映射）。`soundtrack` 命令不变 |
| `apps/server/src/narration/audio-library-routes.ts` | 导入 `role=music` 后执行默认配乐规则和歌曲分析；回执新增 `selectedAsMusic`；新增 `GET …/:audioId/timing` |
| `apps/server/src/application/film-planning-guidance.ts` | 只加了一行：项目是音乐视频且有配乐时，展开 `musicVideo` 块。**措辞没有改动** |
| `apps/web/src/next/model/film.ts` | `FilmEdit` 加 `shotTiming`；新增 `SongTimingView`、`songLength`、`songFitEdit`；`editPressId` |
| `apps/web/src/next/views/film/FilmView.tsx`、`views/film/Tools.tsx` | 「镜头对齐歌曲」 |
| `apps/web/src/next/model/assets-import.ts`、`views/assets/ImportSheet.tsx`、`views/assets/AssetsView.tsx` | `importedAsFilmMusic` 和对应 toast |
| `apps/web/src/next/i18n/catalog/film.ts`、`i18n/catalog/assets.ts` | 新文案（en / zh） |
| `apps/web/src/next/fixtures/routes/film.ts`、`routes/plan.ts`、`routes/assets.ts` | fixture 同步：timing 路由、`shotTiming`、导入时的默认配乐 |

**没有改动**：任何 `skills/**`、`packages/core/src/tools.ts`（catalog）、`tool-invocations.ts`、`director-input.ts`、`ProjectRecord` 契约。

### 6.3 验证

- `pnpm -s build` 和 `pnpm -s typecheck`：全部通过。
- 服务端新测试 8 + 6 通过。相关旧测试 167 通过：`audio-library-http`、`storyboard*`、`director-guidance-maintenance`、`director-successor-host`、`plan-imports`、`soundtrack-placement`、`timeline-capture`、`asset-library`。
- Web 全部 `node --test`（932 个）通过。
- 浏览器检查：在 5199 端口用 vite 跑 fixture（`?ui=next&fixture=last-ferry`），没有使用 3001。
  - 选中音乐后显示「Song 76 s · film 48 s · Fit shots to song」。
  - 点击后影片变为 76 s，toast 带 Undo。
  - Undo 后恢复为 48 s，3 个片段恢复。

### 6.4 已知限制

- 节拍和段落算法是轻量的能量法。对没有鼓点的抒情歌，`bpm` 可能是 null，这时只按段落和比例拟合。段落检测基于响度变化，没有做和声或旋律分析。
- 拟合会让已有的视频片段过期（按钮 title 有说明）。最理想的用法是在生成视频之前做拟合，Director 规划阶段用 guidance。
- 文字识别音乐视频有误判的可能，应该由 §5.3 的 `filmKind` 取代。
- 非音乐视频项目导入 `role=music` 也会被自动选中（-18 dB）。这个行为与 UI 上「影片音乐」的含义一致，但范围略大于任务里只针对音乐视频的描述。如果不希望这样，在 `defaultSoundtrackDecision` 里把非 MV 改为 `adopt:false` 即可。

## 7. 调研来源（访问日 2026-10-28）

- Viggle：https://viggle.ai/tools/ai-lip-sync · https://docs.viggle.ai/introduction · https://docs.viggle.ai/v1/pricing
- sync.so：https://sync.so/docs/models/lipsync · https://sync.so/docs/billing · https://sync.so/docs/api-reference · https://support.sync.so/articles/7391977257-sync-support-faq · https://fal.ai/models/fal-ai/sync-lipsync/v3
- Kling：https://fal.ai/models/fal-ai/kling-video/lipsync/audio-to-video · https://fal.ai/models/fal-ai/kling-video/ai-avatar/v2/pro · https://fal.ai/models/fal-ai/kling-video/ai-avatar/v2/standard
- Hedra：https://www.hedra.com/docs/api-reference/v3/run-a-model/run-hedra-character-3-hedra-character-3.md · https://www.hedra.com/pricing?product=studio
- OmniHuman：https://fal.ai/models/fal-ai/bytedance/omnihuman/v1.5/llms.txt · https://fal.ai/learn/devs/omnihuman-1-5-prompt-guide
- Wan-S2V：https://fal.ai/models/fal-ai/wan/v2.2-14b/speech-to-video · InfiniteTalk：https://fal.ai/models/fal-ai/infinitalk · https://github.com/MeiGen-AI/InfiniteTalk
- LatentSync：https://fal.ai/models/fal-ai/latentsync · MuseTalk：https://replicate.com/tmappdev/lipsync
- Runway：https://docs.dev.runwayml.com/guides/pricing/ · Veo / Omni：https://ai.google.dev/gemini-api/docs/video · https://ai.google.dev/gemini-api/docs/omni
- fal 可靠性与 webhook：https://fal.ai/docs/documentation/model-apis/inference/reliability · https://fal.ai/docs/model-endpoints/webhooks
- 人声分离：https://syncalong.readthedocs.io/en/latest/reference/vocal_separator/
