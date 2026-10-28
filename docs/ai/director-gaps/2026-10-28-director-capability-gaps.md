# Director 能力缺口审计（2026-10-28）

- 范围：`feature/last-ferry-ui` @ `78aac6e`。Web 仅审 Last Ferry（`apps/web/src/next`）；Server 审全部 HTTP 写路由；Director 审 tool contract `6.0.0`（`packages/core/src/tools.ts`）及其分发 `apps/server/src/application/tool-invocations.ts`。
- 方法：只读。逐个列出人能触发的写操作（按钮 → `store.command`/`#press` → server route），再对照 Director 工具的真实 schema 与 handler，而不是工具名。未运行服务，未调用 provider。
- 原则（产品负责人）：人能在应用里做的事，Director 都应能做，只要有人的同意。免费动作直接做；花钱或不可逆的动作在明确确认后做。
- 触发事件：Director 回复“当前聊天工具暂不支持直接设置配乐”。这一点已确认：没有任何 Director 工具会写 `project.soundtrack`（见 §2.5 F1）。

同意类别记号：

| 记号 | 含义 |
|---|---|
| **免费** | 免费且可撤销（有 Undo 或可直接改回） |
| **花钱** | 会调用付费 provider |
| **破坏** | 不可逆，或破坏性但有 Undo（删除类） |
| **设置** | 涉及凭据、模型/运行时设置或身份同意 |

---

## 1. 摘要表

### 1.1 能力对照总表

“Director”一列：**可** = 今天能做；**部分** = 只能做一部分或只能间接做；**否** = 不能做；**设计上人类** = 有意只给人做，建议保持。

| # | 区域 | 人的操作 | Director | 通过的工具 | 同意类别 | MV 优先级 |
|---|---|---|---|---|---|---|
| P1 | Plan | 编辑 brief / story | 可 | `prepare_change` `creative.brief/story` + `apply_change` | 免费 | — |
| P2 | Plan | 改场景标题 | 可 | `prepare_change` `updateScenes.title` / `propose_change` | 免费 | — |
| P3 | Plan | 改场景 purpose | 可 | 同上 `updateScenes.purpose` | 免费 | — |
| P4 | Plan | 新增场景 | 部分 | `createScenes`（只能追加到末尾，不能指定位置） | 免费 | P2 |
| P5 | Plan | 新增镜头 | 部分 | `createShots`（只能追加，不能插到指定位置） | 免费 | P1 |
| P6 | Plan | 改镜头字段（purpose/action/framing/prompt/videoPrompt/motion/时长） | 可 | `prepare_change` `updateShots`；有媒体的镜头必须走 `propose_change` 再由人接受 | 免费（可能让已付费媒体过期） | — |
| P7 | Plan | 改镜头旁白（文本/模式/stock vs personal） | 可 | `updateShots.narration` | 免费 | — |
| P8 | Plan | 场景上移/下移/拖动 | **否** | — | 免费 | **P0** |
| P9 | Plan/Film | 镜头移动（含跨场景、Film 的 Earlier/Later） | **否** | — | 免费 | **P0** |
| P10 | Plan | 删除场景（连同镜头） | **否** | — | 破坏（有 Undo） | P1 |
| P11 | Plan | 删除镜头 | **否** | — | 破坏（有 Undo） | P1 |
| P12 | Plan | Undo 一次 storyboard 编辑 | **否** | — | 免费 | P1 |
| P13 | Plan | 发送书面计划导入 | 部分 | 导入请求里只能用 `prepare_change` 做解读 | 免费 | P3 |
| P14 | Plan | 确认/丢弃导入 | 设计上人类 | — | 破坏（整体改写计划） | — |
| P15 | Keyframes | Narration fit：拉长镜头 / 保持长度并淡出截断台词 | 部分 | 拉长 = `desiredFrames`；截断台词无工具 | 免费 | P2 |
| K1 | Keyframes | Make keyframes | 可 | `make_keyframes`（仅限新的人类编辑请求所点名的场景/镜头） | 花钱 | — |
| K2 | Keyframes | 重做某镜头关键帧 | 可 | `make_keyframes` `regenerate:true` + `shotIds`，需人明确要求；否则记 `regenerate_keyframe` 选项 | 花钱 | — |
| K3 | Keyframes | 打开帧（frame-view 记录“人已看过”） | 设计上人类 | — | — | — |
| K4 | Keyframes | Confirm frames & generate video | 部分 | `record_notes` 的 `confirm_video` 选项；人点击才执行 | 花钱 | P1（已基本合规） |
| K5 | Keyframes | 重试失败的视频 | 部分 | 同 K4（Inspector 的 retry 调的就是 confirm） | 花钱 | P2 |
| K6 | Keyframes | 使用更早的关键帧 take | **否** | — | 免费（让视频过期，重做视频要花钱） | P1 |
| K7 | Keyframes/聊天 | 接受/拒绝 held proposal | 可 | `accept_proposal` / `reject_proposal`（用户消息明确时） | 免费 | — |
| K8 | Keyframes/聊天 | Undo 已接受的 proposal | **否** | — | 免费 | P1 |
| K9 | 聊天 | 按 Director note 的选项处理 | 设计上人类 | Director 是提出者 | — | — |
| N1 | Narration | 给镜头上传/录制旁白录音 | **否** | — | 免费 | P2 |
| N2 | Narration | 设置影片默认 narrator 声音 | **否** | — | 免费 | P2 |
| N3 | Narration | 注册 personal voice | 设计上人类 | — | 设置（本人声音同意） | — |
| N4 | Narration | 撤销 personal voice | **否** | — | 破坏/设置 | P3 |
| N5 | Narration | 生成配音台词 | 部分 | 随 `make_keyframes` / 场景确认一起排队；单独生成只能留 pending suggestion | 花钱 | — |
| A1 | Assets | 导入图片/视频/音频/文档 | 否（无字节来源） | 聊天附件由人上传，走同一批路由 | 免费 | P3 |
| A2 | Assets | 导入时把音频标为 music / upload | **否** | — | 免费 | P1（并入 F1） |
| F1 | Film | 选择/清除配乐 | **否**（本次触发点） | — | 免费 | **P0** |
| F2 | Film | 调配乐起点 | **否** | — | 免费 | **P0** |
| F3 | Film | 调配乐增益 | **否** | — | 免费 | **P0** |
| F4 | Film | 配乐静音/恢复 | **否** | — | 免费 | **P0** |
| F5 | Film | 调镜头时长 | 可 | `updateShots.desiredFrames`（有媒体时走 proposal） | 免费 | — |
| F6 | Film | 读取音乐库（名称、role、时长） | 部分 | `read_context narration.audioLibrary` 只有 id/sha/采样数，没有名称和 role；当前 soundtrack 只在 `filmPlanning` 里 | 只读 | **P0** |
| F7 | Film | 开始导出 | **否** | — | 免费（本地渲染） | **P0** |
| F8 | Film | 取消/恢复导出 | **否** | — | 免费 | P1 |
| E1 | 执行 | Stop（停止整部影片的新生成） | 部分 | `control_execution {action:"pause"}` 只在本请求范围内加 hold | 免费 | P2 |
| E2 | 执行 | Continue（恢复） | 设计上人类（目前） | — | 花钱（恢复已排队的付费工作） | P2 |
| E3 | 执行 | 放弃一个结果未知的提交 | **否** | — | 花钱（可能重复扣费） | P3 |
| E4 | 执行 | 释放 Director 设下的 edit hold | **否** | — | 免费 | P3 |
| E5 | 安装 | 恢复审查释放（recovery release） | 设计上人类 | — | 设置 | — |
| S1 | Settings | 模型 preview / apply | **否** | — | 设置（改变后续价格） | P3 |
| S2 | Settings | Director setup / change | 设计上人类 | — | 设置（运行时/凭据） | — |
| S3 | Settings | Director 关键帧自动审阅开关 | **否** | — | 设置 | P3 |
| S4 | Settings | 界面语言 | 不适用（仅浏览器本地） | — | — | — |
| S5 | Settings | Provider 凭据 | 不适用（只读环境变量，无写 UI） | — | 设置 | — |
| M1 | 项目 | 新建影片 / Demo | 否（Director 绑定单个项目） | — | 免费 | P3 |
| M2 | 项目 | 重命名影片 | **否** | — | 免费 | P3 |
| M3 | 项目 | 归档/取消归档 | **否** | — | 免费（可逆） | P3 |

### 1.2 音乐 MV 工作流的前十个缺口（按优先级）

| 名次 | 缺口 | 同意类别 | 建议工具 |
|---|---|---|---|
| 1 | 设置配乐：选择/清除、起点、增益、静音（F1–F4，含 A2 的 music 标记） | 免费：直接做，给 Undo | `set_soundtrack` |
| 2 | 读取音乐库：名称、role、时长、当前 soundtrack（F6） | 只读：无需确认 | `read_context` 新增 `audio_library` 段 |
| 3 | 重排镜头/场景，并可把新镜头插到指定位置（P8、P9、P4、P5） | 免费：直接做，给 Undo | `move_shot`、`move_scene`，`createShots.beforeId` |
| 4 | 开始导出（F7） | 免费：直接做（本地渲染，不调用付费 provider） | `start_export` |
| 5 | 删除镜头/场景（P10、P11） | 破坏（有 Undo）：先确认 | `delete_shots` / `delete_scene` |
| 6 | Undo：storyboard 编辑、已接受的 proposal、Director 自己 apply 的改动（P12、K8） | 免费：直接做 | `undo_edit` |
| 7 | 使用更早的关键帧 take（K6） | 免费，但会让视频过期：确认时说明后果 | `use_take` |
| 8 | 取消/恢复导出（F8） | 免费：直接做 | `cancel_export` / `recover_export` |
| 9 | 整片 Stop / Continue（E1、E2） | Stop 免费，直接做；Continue 可能花钱，需确认 | `control_execution` 扩展 `stop`、`resume` |
| 10 | Narration fit 截断台词、镜头录音、默认 narrator 声音（P15、N1、N2） | 免费：直接做，给 Undo | `fit_narration`、`attach_shot_recording`、`set_narrator_voice` |

---

## 2. 详情与证据

### 2.0 Director 今天真正有的工具（contract 6.0.0）

分发表在 `apps/server/src/application/tool-invocations.ts:254-319`：

| 工具 | 实际行为 | 证据 |
|---|---|---|
| `read_context` | 分段只读：overview/shots/scenes/plan/aliases/grants/receipts/narration/audio_operations/notes | `tool-invocations.ts:261`；`context-projection.ts:18,68` |
| `prepare_change` + `apply_change` | creative patch 只有 `brief`、`story`、`createScenes`、`updateScenes`、`createShots`、`updateShots`，另有 `source`（编译计划）和 `stages`。**没有删除、移动、soundtrack、undo** | `packages/core/src/workflow/index.ts:52-60, 88-93, 106-111`；`tool-invocations.ts:262-290` |
| `propose_change` | 只有 `updateShots`（时长、motion、prompts、narration、purpose、action、framing）和 `updateScenes`（title、purpose） | `packages/core/src/tools.ts:105-114, 129-136` |
| `accept_proposal` / `reject_proposal` | 由用户消息明确要求时决定 held proposal | `tool-invocations.ts:257`；`tools.ts:166-167` |
| `record_notes` | 记 note 与选项（accept/proposal/regenerate_keyframe/edit_field/reply/confirm_video），选项要由人点 | `tools.ts:91-103, 137-141` |
| `make_keyframes` | 付费关键帧，范围限于新的人类编辑请求 | `tool-invocations.ts:184, 255`；`tools.ts:144-151, 165` |
| `control_execution` | 只有 `{action:"pause"}`，实际是 `holdRequest(..., renew=true)`，只作用于本请求范围 | `tools.ts:46`；`tool-invocations.ts:292`；`service.ts:929-936` |
| `inspect_artifact` | 只读 | `tool-invocations.ts:291` |
| `revise_narration_draft` | 按段改旁白草稿 | `tool-invocations.ts:318` |
| `prepare_narration_speech` | 只留 pending suggestion，人按下才花钱 | `tool-invocations.ts:309-317` |
| `prepare_recording_transcription` | 对本条人类消息附带的音频可直接付费转写，否则只留 suggestion | `tool-invocations.ts:293-308` |

额外约束：keyframe-review 请求只能用 `read_context`/`record_notes`/`propose_change`（`tool-invocations.ts:185`）；plan-import 请求只能 `read_context`/`prepare_change`/`inspect_artifact`/`control_execution`（`tool-invocations.ts:252`）。

**根本原因**：人在 Plan 和 Film 里做的所有轻量编辑都走 `POST /api/projects/:projectId/storyboard`（`apps/server/src/storyboard.ts:519`），其 `Edit.kind` 有 14 种（`storyboard.ts:15-40`）。这个路由的命令作用域固定为 `local-user:${projectId}:storyboard`（`storyboard.ts:59`），Director 的工具没有一个能走到 `editStoryboard`。所以 `deleteScene`、`moveScene`、`deleteShot`、`moveShot`、`undo`、`soundtrack` 这 6 种 kind 对 Director 完全不可用。其余 8 种（`treatment`/`scene`/`sceneTitle`/`addScene`/`addShot`/`shot`/`shotFields`/`narration`）由 `prepare_change` 的 creative patch 等价覆盖。

**提示词也挡住了配乐**：`director-input.ts:50` 写着“Music and other paid generation remain human actions”，`film-planning-guidance.ts:38` 写着“Do not generate replacement music…Read the saved soundtrack choice when assembling.”。技能文本把 soundtrack 描述为 Film 里的东西（`skills/v7/production/SKILL.md:32`，`skills/v7/plan-authoring/SKILL.md:18`）。结果模型会把“选一首已有的歌”当成人类动作，于是说出触发事件里的那句话。选已有录音并不花钱，这条措辞把“生成音乐”和“选配乐”混在了一起。

### 2.1 Plan

| # | 人的入口（web） | Server 路由 | Director 现状与证据 |
|---|---|---|---|
| P1 | `PlanView.tsx:329` `{kind:"treatment"}` | `storyboard.ts:96` | 可：`creative.brief/story`（`workflow/index.ts:89, 132-133`） |
| P2 | `PlanView.tsx:339` `sceneTitle` | `storyboard.ts:112` | 可：`updateScenes.title`（`workflow/index.ts:105, 109`；`tools.ts:134-135`） |
| P3 | `PlanView.tsx:350` `scene` | `storyboard.ts:104` | 可：`updateScenes.purpose` |
| P4 | `PlanView.tsx:407` `addScene` | `storyboard.ts:134` | 部分：`createScenes` 一律 push 到末尾（`workflow/index.ts:141-145`） |
| P5 | `PlanView.tsx:392` `addShot` | `storyboard.ts:141` | 部分：`createShots` 一律 `next.shots.push`（`workflow/index.ts:159-168`），没有 `beforeId` |
| P6 | `PlanView.tsx:508`、`store.ts:401-457`（`shot`/`shotFields`） | `storyboard.ts:164` | 可：`updateShots`；有媒体的镜头要求先 `propose_change`（`service.ts:640` `assertDirectorProposalRequired`） |
| P7 | `NarrationPanel.tsx:247-250`、`plan-edit.ts:163-167` | `storyboard.ts:233-285` | 可：`updateShots.narration {mode,text,voice: stock\|personal}`，与人的取值一致（`storyboard.ts:250-260`） |
| P8 | `PlanView.tsx:363` `moveScene` | `storyboard.ts:127` | **否** |
| P9 | `PlanView.tsx:375`、`film.ts:435-444`、`Tools.tsx:77-78` `moveShot` | `storyboard.ts:203-232` | **否** |
| P10 | `PlanView.tsx:422` `deleteScene withShots` | `storyboard.ts:117` | **否** |
| P11 | `PlanView.tsx:436` `deleteShot` | `storyboard.ts:197-202`（先 `assertNoRunningAttempts`） | **否** |
| P12 | `PlanView.tsx:545`、`store.ts:345`、toast Undo | `storyboard.ts:344` | **否** |
| P13 | `views/plan/commands.ts:122-129`、`start-commands.ts:139` | `plan-imports.ts:9` | 部分：Director 只在导入请求里做解读（`service.ts:304-306`） |
| P14 | `commands.ts:131-141` | `plan-imports.ts:42, 45` | 设计上人类（`service.ts:305` 明确写“the human confirms the exact draft in Film plan”） |
| P15 | `store.ts:320-332`（`make-fit`/`keep-fit`） | `narration-fit.ts:71` | 部分：只能用 `desiredFrames` 拉长；“保持长度并淡出截断台词”没有工具 |

**建议工具**

- `move_shot { shotId, sceneId, beforeId?, expectedHeadVersion }` 和 `move_scene { sceneId, beforeId?, expectedHeadVersion }`。免费，直接执行，回执带 `commandId`，聊天里给 Undo。实现时用 Director actor 调 `editStoryboard` 的同一分支，不另写逻辑。
- `createShots`/`createScenes` 增加可选 `beforeId`，补齐 P4/P5。
- `delete_shots { shotIds[], expectedHeadVersion }`、`delete_scene { sceneId, withShots, expectedHeadVersion }`。破坏类：Director 记一个带 `confirm_delete` 选项的 note，卡片列出将移出时间线的已付费关键帧/片段数量；人点击后执行，结果仍可 Undo。镜头有运行中任务时保留 `ATTEMPTS_RUNNING` 拒绝。
- `undo_edit { commandId }`。免费。只允许撤销本项目内的 storyboard 命令、已接受的 proposal（复用 `director-proposals.ts:300` 的 undo）以及 Director 自己 `apply_change` 的改动；人的编辑也可撤，但只能在用户消息明确要求时。
- `fit_narration { shotId, fit: "lengthen"|"trim", expectedHeadVersion }`。免费，可撤销（server 回执带 `commandId`，`store.ts:329`）。

### 2.2 Keyframes

| # | 人的入口 | Server 路由 | Director 现状与证据 |
|---|---|---|---|
| K1 | `KeyframesView.tsx:365` → `store.ts:285-299` | `scene-generation.ts:205` | 可：`make_keyframes`（`tool-invocations.ts:255`；授权 `assertDirectorGenerationAuthority`，`tool-invocations.ts:184`） |
| K2 | `KeyframesView.tsx:203` → `store.ts:301-305` | 同上 `regenerate:true` | 可，条件：`shotIds` + 人明确要新 take（`tools.ts:148-150`） |
| K3 | `store.ts:276-283` | `generation-overview.ts:212` | 设计上人类：这是“人看过这帧”的证明，`confirmBody` 要求 `opened`（`model/commands.ts:73-76`） |
| K4 | `KeyframesView.tsx:212` → `store.ts:307-317` | `scene-confirmations.ts:336` | 部分：Director 只能记 `confirm_video` 选项（`tools.ts:139-141`），人在聊天或 Keyframes 点击。符合“花钱先确认”原则 |
| K5 | `Inspector.tsx:258`、`KeyframesView.tsx:335`（`onRetryVideo={confirm}`） | 同 K4 | 部分：同 K4 |
| K6 | `TakesStrip.tsx:37`、`keyframes-takes.ts:67` | `shot-takes.ts:67`（`useShotTake` 写 `storyboard_edit` 带 undo，`shot-takes.ts:42-60`） | **否** |
| K7 | 横幅 Accept/Decline → `store.ts:509-517` | `director-proposals.ts:298, 300` | 可：`accept_proposal`/`reject_proposal` |
| K8 | `store.ts:519` | `director-proposals.ts:300`（`undo`） | **否** |
| K9 | `store.ts:501-506` | `director-notes.ts:185` | 设计上人类：Director 写 note，人选选项 |

**建议工具**

- `use_take { shotId, artifactId }`。本身免费、可 Undo（`shot-takes.ts:57`），但会让该镜头的视频过期（`shot-takes.ts:43, 50`），重做视频要花钱。建议：用户明确说“用第 N 版”时直接执行，回复中说明视频需要重新确认；否则记带 `use_take` 选项的 note。
- K4 维持现状（卡片 + 人点击 + frame-view 证明）。可以改进的是：用户在聊天里看过帧并说“生成视频”时，Director 主动给出新卡片（技能里已有要求，`skills/v7/production/SKILL.md:32`）。

### 2.3 Narration / 声音

| # | 人的入口 | Server 路由 | Director 现状与证据 |
|---|---|---|---|
| N1 | `NarrationPanel.tsx:558`、`narration-media.ts:124-145` | `narration/shot-recording-routes.ts:32` | **否**。聊天附带的音频只会被转写（`tool-invocations.ts:296`），不能放到镜头上 |
| N2 | `VoicePanel.tsx:56`、`settings-voice.ts:151, 162` | `project-library.ts:52`（`settings/voice`） | **否** |
| N3 | `VoicePanel.tsx:87`、`settings-voice.ts:224` | `personal-voice-routes.ts:18`（body 要求 `ownVoice:true, permitSynthesis:true`） | 设计上人类：本人声音的同意声明，只能由本人做 |
| N4 | `VoicePanel.tsx:96`、`settings-voice.ts:251` | `personal-voice-routes.ts:31` | **否** |
| N5 | 随 K1/K4 | `scene-confirmations.ts`（`enqueueKeyframes`，`tool-invocations.ts:121-123`） | 部分 |

**建议工具**

- `attach_shot_recording { shotId, audioId, expectedHeadVersion }`：把本请求附带、已在本片音频库里的录音设为镜头录音。免费，可撤销。只接受本片拥有的 `narration_audio`。
- `set_narrator_voice { voice, expectedHeadVersion }`：免费，可撤销，取值校验与 `project-library.ts:63-66` 相同。
- `revoke_personal_voice` 不建议给 Director：撤销会影响已选该声音的镜头，属于身份/同意范畴。

### 2.4 Assets / 音频库

| # | 人的入口 | Server 路由 | Director 现状 |
|---|---|---|---|
| A1 | `views/assets/ImportSheet.tsx:167`、`upload.ts:181`；聊天附件 `useComposerUploads.ts:56-62` | `media/image-routes.ts:48`、`media/routes.ts:99`、`narration/audio-library-routes.ts:47`、`media/document-routes.ts:34` | 否：Director 拿不到文件字节。聊天附件是人上传的，所以实际不构成缺口 |
| A2 | `ImportSheet.tsx:256-264`（Use as music/upload） | `audio-library-routes.ts:47` `?role=` | **否**。注意聊天附件一律以 `role="upload"` 导入（`useComposerUploads.ts:56-57`），所以用户在聊天里丢进来的歌**不会**出现在 Film 的音乐菜单里，直到被设为 soundtrack（`storyboard.ts:299-300` 会把它改标为 music） |

没有重命名或删除素材的路由，这一项两边都不能做。

**建议**：不单独做标记工具。`set_soundtrack` 选中一条录音时，server 已经会把它标为 `music`（`storyboard.ts:300`），这就覆盖了 A2。

### 2.5 Film：时间线、配乐、导出

| # | 人的入口 | Server 路由 | Director 现状与证据 |
|---|---|---|---|
| F1 | `MusicMenu.tsx:88-95` → `FilmView.tsx:209` → `film.ts:454` | `storyboard.ts:286-311`（`soundtrack.audioId`） | **否** |
| F2 | `FilmView.tsx:192`、`film.ts:446-450` | `storyboard.ts:312-320`（`startFrame` 0–10800） | **否** |
| F3 | `FilmView.tsx:197`、`film-gain.ts:59-76` | `storyboard.ts:327-341`（`gainMilliDb` −60000..0） | **否** |
| F4 | `FilmView.tsx:204`、`film.ts:453` | `storyboard.ts:321-326`（`muted`） | **否** |
| F5 | `FilmView.tsx:170`、`film.ts:423-429` | `storyboard.ts:164` | 可：`desiredFrames` |
| F6 | `film.ts:21`（读 `audio-library?role=music`） | 读路由 | 部分：`read_context narration` 的 `audioLibrary` 只给 `id/sha256/samples/sampleRate/originEvidence`（`context-projection.ts:216-230`），没有 label 和 role；当前 soundtrack 只在 `filmPlanning.soundtrack`（`film-planning-guidance.ts:45`） |
| F7 | `FilmView.tsx:229` | `media/routes.ts:74`（body 只有 `expectedHeadVersion`，`packages/core/src/studio-api.ts:443-445`） | **否** |
| F8 | `FilmView.tsx:233, 237` | `media/routes.ts:84`（`cancel`/`recover`） | **否** |

**建议工具**

- `set_soundtrack { audioId: string|null, startFrame?, gainDb?, muted?, expectedHeadVersion }`
  - 免费，直接执行。server 侧按字段顺序调用 `editStoryboard` 的 `soundtrack` 分支，一次调用一个原子命令，回执带 `commandId` 给聊天 Undo。
  - `audioId` 必须是本片拥有的音频（server 已校验，`storyboard.ts:290-298`），可以是本条消息的聊天附件。
  - 允许在 discuss-only 以外的人类编辑轮次使用；review/automatic 轮次拒绝，和 `make_keyframes` 一样。
  - 同步修改 `director-input.ts:50` 与 `film-planning-guidance.ts:38` 的措辞，把“生成音乐（不支持）”和“选已有录音作配乐（免费，可做）”分开；技能 `assembly.md` 加一句工具用法。
- `read_context` 新增 `audio_library` 段：`{ audioId, label, role, durationSeconds, sha256, isSoundtrack }` 分页列出，外加 `soundtrack {audioId,startFrame,gainMilliDb,muted}`。只读。
- `start_export { expectedHeadVersion }`：免费，直接执行。本地渲染，不调用付费 provider；以前的导出仍列在 Earlier exports。回执给 exportId，完成后在聊天里给下载链接。缺片时返回 server 的拒绝码，Director 照实说。
- `cancel_export { exportId }` / `recover_export { exportId }`：免费，直接执行。

### 2.6 执行控制

| # | 人的入口 | Server 路由 | Director 现状与证据 |
|---|---|---|---|
| E1 | `StopDialog.tsx` → `store.ts:484-487` `{action:"stop"}` | `app.ts:332-341` | 部分：`control_execution` 只有 `pause`，只给本请求加 hold（`tools.ts:46`，`service.ts:929-936`） |
| E2 | `store.ts:489-493` `{action:"resume"}` | 同上 | 设计上人类：工具描述写明“Only a human command can resume execution.” |
| E3 | `GiveUp.tsx` → `store.ts:495-498`（`acknowledgeDoubleCharge:true`） | `app.ts:343` | **否** |
| E4 | `HeldEdits.tsx:26` | `app.ts:88-92` | **否** |
| E5 | `RecoveryReview.tsx` → `store.ts:578-589` | `recovery-routes.ts:16` | 设计上人类（安装级） |

**建议**

- `control_execution` 增加 `stop`（免费，直接执行，与人的 Stop 同一路径）和 `resume`（会继续已排队的付费工作，需确认：Director 记 `confirm_resume` 选项，卡片显示将继续的任务与报价）。
- E3 放弃未知提交：有重复扣费风险，只给卡片选项（`confirm_release_attempt`），不给直接执行。优先级低。
- E4 释放 hold：Director 能释放自己请求的 hold 即可（`apply_change` 已部分做到），不建议开放释放人的 hold。

### 2.7 Settings / 模型 / Provider

| # | 人的入口 | Server 路由 | Director |
|---|---|---|---|
| S1 | `ModelsPanel.tsx:90, 142`、`model/settings.ts:228, 283` | `app.ts:170, 181` | 否 |
| S2 | `ModelsPanel.tsx:163`、`DirectorPanel.tsx:52`、`settings-director.ts:129-130` | `app.ts:212, 218` | 设计上人类 |
| S3 | `DirectorPanel.tsx:65`、`settings-director.ts:206` | `keyframe-review.ts:52-54` | 否 |
| S5 | 无写 UI | `provider-credentials.ts:17-31`（只读环境变量） | 不适用 |

**建议**：S1 可以给 `propose_model_change { kind, profileId }`，只生成与 `settings/models/preview` 相同的预览，人在 Settings 或卡片上 Apply（会改变后续价格）。S2、S5 不给 Director。S3 可做成设置类卡片，优先级低。

### 2.8 项目管理

| # | 人的入口 | Server 路由 | Director |
|---|---|---|---|
| M1 | `start-commands.ts:92, 153, 159` | `app.ts:189, 258` | 否（Director 会话绑定在单个项目里） |
| M2 | `start-commands.ts:34-38` | `project-library.ts:52`（`rename`） | 否 |
| M3 | `start-commands.ts:46-49` | `project-library.ts:52`（`archive`/`unarchive`） | 否 |

**建议**：`rename_film { name, expectedHeadVersion }`，免费，直接执行。归档会让本片离开列表，建议只给卡片选项。

### 2.9 Last Ferry 不用的 server 写路由

下面这些路由两边今天都碰不到（旧 UI `apps/web/src/*.tsx` 才用），不计为 Director 缺口：

- `narration/shot-audio-routes.ts:424` `POST .../narration/shots/:shotId/generate`
- `narration/narration-speech-routes.ts:28` `.../speech`
- `narration/owned-transcription-routes.ts:40` `.../transcriptions`
- `media/routes.ts:126-144` `media/renders` 及 `run/cancel/recover`
- `app.ts:354` `/internal/projects/:projectId/tools/:tool`（Director bridge 本身）
- `studio-sessions.ts:61-74` 会话与登出

---

## 3. Director 能做而人做不了的事

| 能力 | 证据 | 说明 |
|---|---|---|
| 转写聊天里附带的录音 | `tool-invocations.ts:293-308`；Last Ferry 里没有任何转写入口（`apps/web/src/next` 中无 `transcriptions` 路由调用） | 付费。人只能通过让 Director 转写来做到 |
| 新建镜头时绑定参考图 `referenceArtifactIds` | `workflow/index.ts:92, 163`；人的 `addShot` 固定为 `referenceArtifactIds: []`（`storyboard.ts:141-160`），web 没有设置参考图的入口 | 人只能在聊天里 @ 素材，让 Director 建镜头 |
| 新建镜头时绑定旁白 cue `cueId` | `workflow/index.ts:92, 164` | 人的 UI 没有这个入口 |
| 按段增删、重排旁白草稿 | `revise_narration_draft`（`tools.ts:62-64`） | Last Ferry 只按镜头编辑旁白 |
| 只暂停本请求范围（scoped hold） | `service.ts:929-936` | 人的 Stop 是整片级。粒度不同，不算缺口 |
| 写 note、带 Now/After 预览的 proposal、pending 音频 suggestion | `record_notes`、`propose_change`、`prepare_narration_speech` | 属于协作形式，人直接编辑即可 |
| 读 grants、receipts、aliases、编译后的 plan source | `context-projection.ts:18` | 只读内部数据，人的 UI 不展示 |

前三项属于“只能经 Director 做”的功能。按同一原则，Last Ferry 也应补上对应的人类入口（转写按钮、镜头参考图、cue 绑定），或者明确说明它们是 Director 专属。

---

## 4. 实现建议（不在本次改动范围内）

1. **一个通道，复用人的分支**：新增的免费编辑工具（`set_soundtrack`、`move_*`、`delete_*`、`undo_edit`、`use_take`、`fit_narration`、`set_narrator_voice`、`rename_film`）都应调用人已在用的 server 函数（`editStoryboard`、`useShotTake`、narration-fit、project-library），只把 actor 换成 Director，让 Undo、`expectedHeadVersion`、`ATTEMPTS_RUNNING` 等校验保持一致。
2. **授权规则沿用 `make_keyframes`**：只在新的人类编辑请求里可用；review、automatic、read-only、plan-import 轮次拒绝（扩展 `tool-invocations.ts:185, 252` 的白名单）。
3. **同意分级落到卡片**：免费的直接执行，回执带 `commandId` 并在聊天里给 Undo；破坏或花钱的用 `record_notes` 新增的选项 kind（`confirm_delete`、`use_take`、`confirm_resume`），人点击后由 server 执行，和 `confirm_video` 一样。
4. **新 contract 版本**：按惯例加 `7.0.0` catalog，不修改已发布的 6.0.0 descriptors（`tools.ts:91` 注释“Every shipped catalog…remains byte-for-byte unchanged”）。同步更新 `skills/v7/*/openslate.skill.json` 的 `requiredToolIds`、`director-input.ts:50` 的措辞和 `docs/technical/SKILLS-TOOLS.md`。
5. **测试**：每个新工具都要有 server 测试，验证 Director 调用与人的路由产生同一 `storyboard_edit` 记录且可 Undo；review、automatic 轮次被拒绝；聊天附件可以用作 `set_soundtrack` 的音频。
