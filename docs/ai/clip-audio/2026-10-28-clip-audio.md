# 片段原声（clip audio）：保留生成片段自带的声音

日期：2026-10-28 · 分支基于 `origin/feature/last-ferry-ui`（5a48a2f 之后）

## 1. 背景

MiniMax H3（经 Viggle）生成的每个片段都自带原生音频：音效（SFX）、环境声。喜剧和社交短视频非常依赖这些声音（见 `docs/ai/skill-drafts/craft-comedy/short-form-comedy.md` 第 49 行：一声吱嘎、一下撞击常常就是笑点）。此前 Film 视图把片段声音一律静音（`apps/web/src/next/model/film-audio.ts` 写着 "Clip audio is always muted"），导出也从不混入。

根本原因在导入：`LocalMediaService.importMedia` 对视频使用 `silent-h264-30fps-v1` 配方（`-an`），规范化后的 mp4 没有音轨；但未改动的原始文件仍以 `blobs/<originalSha256>.source` 保存在媒体库里，所以原声并没有丢。

## 2. 数据模型

### 2.1 每个镜头：`ShotRecord.clipAudio`

```ts
clipAudio?: { keep: boolean; gainMilliDb?: number }   // gainMilliDb: -60000..0（整数 milli-dB）
```

- 可选字段；没有它时按项目默认（见 2.2）。旧项目没有 `filmKind`、也没有 `clipAudio`，因此默认静音，导出与以前完全一致。
- 这是**混音选择**，不改变镜头的 `revisionId`、`promptIntent` 或任何媒体；片段不会过期，只有上一次导出会因 `shots` 指纹变化而显示"已改动"。
- 类型在 `packages/core/src/contracts.ts`，`ShotClipAudio` 定义在 `packages/core/src/clip-audio-mix.ts`。

### 2.2 项目默认：`clipAudioDefault(project)`

`packages/core/src/clip-audio.ts`，返回 `{ keep, gainMilliDb, reason }`：

| 条件（按顺序） | keep | reason |
| --- | --- | --- |
| `filmKind.kind === "music_video"` | false | `music_video`（歌曲就是音轨，即使 tones 含 comedy） |
| `filmKind.kind === "social"`（`skit` 是 social 的 subtype） | true | `social` |
| `filmKind.tones` 含 `"comedy"` | true | `comedy` |
| 其他，或没有 filmKind | false | `none` |

默认电平 `gainMilliDb = -6000`（`CLIP_AUDIO_BED_GAIN_MILLI_DB`）。

- 服务端只通过一个 helper 读取 filmKind：`clipAudioFilmKind(value)`，内部调用 core 的 `normalizeFilmKind`（film-kind@1，旧字符串如 `social_vertical` 也能读），任何异常值都按"没有 kind"处理。合并 filmkind 时若字段形状再变，只需改这一处。
- 规则本体 `clipAudioDefaultFor({ kind, tones })` 是纯函数，放在浏览器安全的 `clip-audio-mix.ts`，由 `@openslate/core/public` 导出，Web 端（`apps/web/src/next/model/clip-sound.ts`）复用同一规则，测试 `apps/web/test/next/clip-sound.test.mjs` 校验两端一致。
- 目前没有存储的项目级覆盖字段；默认完全由 filmKind 推出。若以后需要"整部片默认保留/静音"，建议加可选 `project.clipAudioDefault?: { keep, gainMilliDb? }`，`clipAudioDefault()` 先读它。

### 2.3 Storyboard 命令 `shotClipAudio`

`POST /api/projects/:projectId/storyboard`，`{ kind: "shotClipAudio", id: <shotId>, field, value, expectedHeadVersion }`：

| field | value | 结果 |
| --- | --- | --- |
| `keep` | `"true"` / `"false"` | `clipAudio.keep`；保留已有的 `gainMilliDb` |
| `gainMilliDb` | `"-60000"`..`"0"` 整数 | 设电平；`keep` 沿用已有值，否则取项目默认 |
| `default` | 省略或 `""` | 删除 `clipAudio`，回到项目默认 |

- 和 `soundtrack` 一样不加 hold（`holdFree`），只让 timeline/render 节点脱钩；image/video 节点不受影响。
- 可 Undo（通用 `undo` 恢复 `before` 快照）。`recordHumanFields` 会记录 `clipAudio` 字段，Director 的 human-edit fence 因此生效。
- Fixture studio（`apps/web/src/next/fixtures/routes/plan.ts`）实现同样的命令和校验。

## 3. 混音规则（导出与预览共用）

纯函数在 `packages/core/src/clip-audio-mix.ts`：

1. **对齐与裁剪**：保留的片段原声从片段第 0 个 sample 开始，放在该镜头起点（`cut.startFrame * 1600`），长度 `min(原声 samples, 镜头 samples)`，绝不越过镜头。
2. **电平**：镜头自己的 `gainMilliDb`，否则 -6 dB。
3. **与音乐的关系（选择并记录）**：片段音效**高于**音乐床。音乐默认 -18 dB（`storyboard.ts`），片段 -6 dB，高 12 dB，适合喜剧/社交短片里音效当笑点。音乐本身**从不被压低**——当前混音里没有任何既有的 ducking 规则（`docs/technical/TIMELINE-RENDERING.md` 也写明 looping/fades/ducking 未实现），所以"沿用既有规则"即音乐固定电平不变。音乐视频默认静音片段原声；若有人手动保留，歌曲（0 dB）仍不被压低。
4. **在旁白/台词下压低（duck）**：所有 voice placement（canonical narration 的 cue placement，以及 demo 的 fixture voice）合并成区间；片段原声在这些区间里再降 12 dB（`CLIP_AUDIO_DUCK_MILLI_DB`，下限 -60 dB），区间外恢复原电平。旁白和音乐电平不变。
5. **实现方式**：渲染器只支持固定增益的 placement（`volume=...dB`），所以 duck 用 `clipAudioSegments()` 把一个片段的原声切成若干首尾相接的固定增益段。每段 `startSample` 连续，不会重复或漏掉 sample。同一镜头的段和相邻镜头的段首尾相接，共用一条 lane。电平跳变发生在旁白起止的 sample 上；目前没有交叉淡化（以后可以加 `afade`）。
6. **限制**：每个镜头最多 3 段 + 每个片段 1 个音源，所以 `LocalMediaService` 默认上限改为 `maxAudioPlacements 260`、`maxAudioSources 130`（原 65/65；构造参数仍可设得更低）。同时发声的 lane 上限 8 不变。

## 4. 导出流程

- `captureStoryboard`（`apps/server/src/media/storyboard-capture.ts`，只改了几行）：
  - 新字段 `capture.clipAudio = { shots, voices }`，由 `captureClipAudio()`（`apps/server/src/media/clip-audio.ts`）生成，只包含实际保留且有片段的镜头。
  - shot 指纹只在保留时加 `clipAudio: { keep: true, gainMilliDb }`；静音（包括显式 `keep:false`）的镜头指纹与以前**逐字节相同**，因此旧项目的 `film.shots` digest 不变。
  - 渲染尺寸等其他部分没有改动（避免和 "aspect" agent 冲突）。
- `MediaApplicationService.freezeExport`（`apps/server/src/media/application.ts`）：在 fixture 片段之后、`freezeManifest` 之前，对每个保留的镜头调用 `LocalMediaService.deriveClipAudio(video)`，再用 `clipAudioPlacements()` 生成 placement 追加到 `renderInput.audio`。
- `deriveClipAudio`（`apps/server/src/media/local-media.ts`）：校验视频 descriptor → 读 `blobs/<originalSha256>.source` 并核对 hash → ffprobe；没有音轨则缓存 `{ reason: "no_audio_stream" }`；有则规范化成 48 kHz stereo `pcm_s16le`，`-t` 截到片段画面长度，作为新的 audio `SuppliedMedia`（`artifactId = clip-audio_<video.id>`）安装并缓存到 `clip-audio/<digest>.json`。同一片段只解码一次。
- **跳过与原因**：没有音轨（`no_audio_stream`）、原始文件不可用（`source_unavailable`）、解码失败（`derivation_failed`，例如 `MEDIA_TOOL_FAILED`）都不会让导出失败，静默跳过；原因记在 `MediaRenderJob.clipAudio[]`（`{ shotId, state: "mixed" | "skipped", reason?, pieces? }`），并追加事件 `media.clip_audio_skipped`。没有保留任何镜头时 job 上没有 `clipAudio` 字段。
- 旧项目：`capture.clipAudio.shots` 为空，manifest 的 audio 与以前一致；`RenderManifestInput`、`FrozenRenderManifest`、渲染器的 ffmpeg 图都没变。

## 5. 浏览器预览（Film）

- `GET /api/projects/:projectId/narration/playback` 现在在 `placements` 里额外带上保留的片段原声：`{ id: "clip:<shotId>", kind: "clip", audioId: <视频 artifactId>, sha256, startSample: 0, durationSamples, atSample, gainMilliDb, gainSteps, shotIds }`。`gainSteps` 就是导出用的同一组分段电平。片段列表在同一个事务里读取，只有原声派生是异步的；媒体 worker 忙时最多等约 4 秒，否则这次先不放（`apps/server/src/media/clip-audio-playback.ts`）。
- 新路由 `GET /api/projects/:projectId/clip-audio/:artifactId/content` 返回派生的 wav（校验 sha256，`X-Content-SHA256`），已加入 recovery 只读白名单。
- Web：`film-audio.ts` 的 `AudioPlacement` 增加 `kind?: "clip"` 和 `gainSteps`，`audioAt()` 按 `gainSteps` 取当前电平；`useLiveAudio` 对 `kind: "clip"` 改从 clip-audio 路由加载。视频元素仍然静音（`clipTarget` volume 0），声音来自单独的 audio 元素，和旁白、音乐一样跟着 film clock 同步。

## 6. Web UI

- `apps/web/src/next/views/film/ClipSound.tsx`：独立组件 `ClipSoundControl`，包括"Keep clip sound / 保留片段原声"开关，以及保留时的电平滑块（-60..0 dB，步长 1，与音乐音量一致；最后一次按键或松开后 400 ms 保存，一串步进是一次编辑、一次 Undo）。默认来源会注明原因（"社交短视频默认保留"等），保留时注明"旁白时自动压低"。
- 目前挂在 Film 视图选中镜头的工具行（`FilmView.tsx`）。组件是自包含的，只需要 `shotId / label / sound / writable / saving / onEdit` 这几个 props，"ui-v8" 合并 inspector 时可以直接放进 shot inspector，一行即可。
- Film 时间线：保留原声的镜头块在时长旁边显示一个小喇叭（`data-act="clip-sound-mark"`），可访问名称后面加 "· Clip sound kept"。
- 文案在 `apps/web/src/next/i18n/catalog/film.ts`（`film.clip_sound.*`、`film.toast.clip_sound_*`），中英文齐全。
- Fixture 一致性：fixture studio 支持同一命令、校验和 Undo；样片 Last Ferry 没有 filmKind，所以默认静音。

## 7. Director：如何设置（本次不改工具目录）

工具目录 7.0.0 由其他 agent 负责，这次**没有**改 `packages/core/src/tools.ts`。

**现在就能用的路径**：

1. 设 filmKind 就能得到默认值：`prepare_change` 的 `creative.project.filmKind` 设为 `{ kind: "social", subtype: "skit" }`，或在 `tones` 里加 `"comedy"`，整部片默认保留原声；`music_video` 默认静音。这是 Director 最主要的杠杆。
2. 单个镜头的覆盖目前只能由人在 Film 里切换（`shotClipAudio` 是 storyboard 命令，不在 Director 工具里）。Director 可以在回复或 note 里建议："3.2 的撞门声是笑点，请在 Film 里打开 Keep clip sound"。

**建议的 7.x 规范**（给拥有工具目录的 agent）：在 `prepare_change` 的 `updateShots[]` 里加一个字段：

```jsonc
"clipAudio": {
  "type": ["object", "null"],              // null = 回到项目默认（等同 field "default"）
  "additionalProperties": false,
  "required": ["keep"],
  "properties": {
    "keep": { "type": "boolean" },
    "gainMilliDb": { "type": "integer", "minimum": -60000, "maximum": 0 }
  }
}
```

- 应用层直接写 `ShotRecord.clipAudio`；和 `shotClipAudio` 一样不改 `revisionId`、不让媒体过期，只让 timeline/render 节点脱钩。
- 走现有 human-edit fence：`recordHumanFields` 已经记录 `clipAudio`，人改过之后 Director 再改会得到 `HUMAN_EDITED_FIELD`。
- `read_context` 里建议给出每个镜头的有效值 `{ keep, gainMilliDb, source: "shot" | "default" }`，以及项目的 `clipAudioDefault(project)`，这样 Director 能区分"默认"和"人的决定"。
- craft-comedy skill 可以把 "clip SFX wanted" 从 finishing gap 改成：社交/喜剧默认已保留；只在某个镜头需要静音（例如音效和旁白冲突）时才提出。

## 8. 测试

- `apps/server/test/clip-audio.test.mjs`：filmKind 默认（social / skit / comedy / music_video / 旧字符串 / 异常值）；分段 duck 的合并和裁剪；旧项目 `film.shots` digest 与旧公式一致、manifest 没有片段 placement、显式静音时混音与 manifest 内容不变；keep=true 时三个镜头的原声出现在正确偏移（解码后按频率检测），旁白下压低约 12 dB 且旁白高于片段原声；有音乐时音乐和旁白 placement 不变；没有音轨的片段被跳过并记录原因和事件、结果有缓存；命令校验、不改 revisionId、只让 `shots` 过期、Undo、无 hold；预览的 `gainSteps` 与导出一致，content 路由返回派生音频。
- `apps/server/test/media-audio-scale.test.mjs`：超限用例改为显式 `maxAudioPlacements: 65`，并新增默认 260 的边界。
- `apps/web/test/next/clip-sound.test.mjs`：Web 与 core 默认规则一致；fixture 命令、校验与 Undo；中英文文案；预览 `gainSteps`。
- `scripts/browser/next-film.mjs` 新增 `next-film-clip-sound`：开关、喇叭标记、电平步进为一次编辑、Undo、toast 不遮挡工具行、无横向滚动。

## 9. 已知限制与后续

- 电平在旁白起止处是阶跃变化，没有淡入淡出；如果有爆音，可以给 placement 加 `fadeInSamples`，或在相邻段之间做 10 ms 交叉淡化。
- 原声若比画面晚开始（容器里 audio start_time > 0），目前从解码后的第 0 个 sample 起放，可能有几十毫秒的偏差。
- 预览第一次打开保留了原声的片子时要派生音频（每个片段一次 ffmpeg），之后走缓存。
- Fixture/demo 片段在预览里不放原声（样片没有原声）；导出时 fixture 片段一样会尝试派生。
