Tofu 质量复盘｜2026-11-01

依据两张接触表、指定源码及当前 STATUS；本次 ffprobe 实测：30s、1080×1920、30fps、无音轨。画面判断来自抽帧，不能据此断言所有亚秒动作；以下排序、阈值和工期是工程判断，未跑付费实验。

**1．诊断，按对这部片的损害排序**

| 排名 | 原因与证据 | 对 EVIDENCE 的判断 |
|---|---|---|
| 1 | setup→payoff 没成立：3–6s 未见明确累倒，7–10s 闻菜近似进食，13–17s 靠近狗粮仍是普通走路。缺少“运动不行、吃饭飞快”的可见反差。 | 同意内容难懂；字幕只能辅助，不能替代没拍出的动作。 |
| 2 | plan-v6 所有 startFrame=0，动作被要求塞进2–5s，余下素材弃用；人工通过只有布尔值，没记录动作证据和剪辑区间。 | 同意切点重置；仅凭接触表不能证明“多数动作未完成”。cut 本身不是根因。 |
| 3 | 每镜独立造关键帧，没有共享视觉锚点；references 提供外观条件，不保证首帧姿态，prompt 却要求保留 starting pose。 | 道具关系跳变比挂画变化更伤叙事；有些背景差异也可能来自换机位。 |
| 4 | 完全无声，直接遗漏用户配乐需求，也丢失节奏提示。 | 旧片缺音乐模型属实；当前 ctx.music 已存在，不能诊断成全系统无配乐能力。 |
| 5 | 低机位、中景、低强度运动重复，30s 缺乏视觉重音。复杂动作链与精确秒表式 prompt 增加失控。 | 同意单调；没有证据证明中英混用、10cm 或 quality=low 单独造成失败。 |

第6项“只讲API”过强：当前 SKILL 已有配乐、尺寸、并发和预算指引；真正缺的是叙事判断标准与视觉反馈。

**2．self-review 闭环**

宿主本地抽每段首尾及1fps帧，标 sourceFrame；切点另给前后各0.25s序列。通过只读 read_clip_frames 返回真正的 MCP image blocks，不能只给路径、poster ID 或 JSON。当前 stdio.ts 把结果全部编码成 text；协议支持图片，不代表本机 Director 已验证可见。

成功片段按 artifact hash、目标动作、rubricVersion 去重排持久化 review turn；决策另绑 planVersion，旧版本失效。Director 先用一句话复述“实际发生什么”，再逐项评0缺失/1存疑/2清楚：动作可读性、笑点反差、人物/道具连续性、切点与节奏、画面完整性；附帧证据和 confidence。另用 probe 硬查时长、尺寸、音轨；静帧不证明声音好听。

先选素材内更好的 in/out，再调整镜序、字幕和音乐；仅当关键动作缺失、身份漂移或没有可用区间时补拍。低置信度先加密抽帧，禁止自动买一次“验证”。单镜最多补拍一次、全片最多两次、最终成片再复审一次；只改失败镜，旧片保留候选。宿主按原请求授权及现有 ceiling 执行；charged、unknown、in-flight 和剩余必需镜头都占预算，未知提交先 reconciliation。

按请求6s的仓内估价：8×6s reference=$2.40；音乐$0.08、两次补拍$0.60，整片预留$3.08，非实账、不含另行计费评审。默认$1应先缩方案，不能靠执行到一半停机。

**3．最小改动，按收益顺序；工期为人日**

| 顺序／位置 | 最小交付与质量收益 | 工期／风险 |
|---|---|---|
| 1 Director：[SKILL](../../../skills/code-plan/SKILL.md)、[example](../../../skills/code-plan/references/example-plan.ts)、guidance digest | 写入 beat、可观察动作、连续性锚点、声音计划、交付检查；每镜一个核心动作，prompt 单语简短。先定共享人物/房间参考，再并行独立镜；连续动作按需用已有 firstFrame，解除“只有用户明确要求才可用”的限制。已有 startFrame/durationFrames 用于看片后剪辑，不新增 trim API。 | 1–2／低；过度串行增加等待 |
| 2 Studio/tool API：[studio.d.ts](../../../skills/code-plan/references/studio.d.ts)、[director.ts](../../../apps/server/src/code-plan/director.ts)、[stdio.ts](../../../packages/director/src/tools/stdio.ts) | 加有帧数/字节限额的 read_clip_frames、上述事件与 review 记录；本地抽帧按 hash 缓存，分批真实图片传输。记录所选区间、失败理由、证据；预算和重拍次数由宿主强制。先验收原生 Director 真能辨认画面。 | 4–6／中高；涉及 catalog、bridge 限额、epoch 和回放 |
| 3 Renderer：[local-timeline.ts](../../../apps/server/src/media/local-timeline.ts)、[local-media.ts](../../../apps/server/src/media/local-media.ts) | 增有时间范围的 caption 数据；宿主用固定 CJK 字体栅格化透明 PNG，再 overlay。字体/图层/区间进入 recipe digest，校验边界。复用现有音频混音与 fadeOut，不先加转场库。 | 2–4／中；字体、alpha、缓存与旧配方兼容 |
| 4 Capability：[models.ts](../../../apps/server/src/code-plan/models.ts)、[video-capabilities.ts](../../../apps/server/src/code-plan/video-capabilities.ts)、[provider-catalog.ts](../../../apps/server/src/application/provider-catalog.ts) | 在已有比例/时长/模式/价格上补有效 quality、参考图数量与约束、原生/归一化音频行为、renderer 字幕/滤镜能力。把 vendor claim 与带样本/日期的 measured result 分开；high 同价仅是报价事实，质量收益待验证，不能静默改旧 profile lock。 | 1–2／低中；声明与实际执行漂移 |

Tofu 修改例：原“推哑铃→屈腿→侧躺→望哑铃，4s”拆成推一下与累趴反应；再用同方向起身冲向蓝碗形成 payoff。英文动作可写 “Tofu nudges the yellow dumbbell once, then stops.” 字幕“今日运动：一下”与“开饭：满血”，按真实动作落点剪辑；凑不齐30s就补有效内容，不机械拉长。

**4．陷阱**

全片 xfade、插帧或升分辨率无法修复因果，还会拖慢喜剧；逐帧视觉满扫、重写所有 prompt 会烧预算并破坏复用。不能把相同 seed 当连续性保证，不能把 references 当首帧锁定，也不能让复审绕过原有权限或新增每段人工验收门槛。

| 来源边界 | 链接与支持范围 |
|---|---|
| 本地证据／源码 | [EVIDENCE](EVIDENCE.md)、[成片表](evidence/sheet-film.jpg)、[切点表](evidence/sheet-cuts.jpg)、[plan-v6](evidence/plan-v6.ts.txt)、[STATUS](../../implementation/STATUS.md)；源码位置见上表。 |
| 官方协议 | [MCP 2025-11-25 Image Content](https://modelcontextprotocol.io/specification/2025-11-25/server/tools#image-content)：支持图片结果；本机视觉链路仍须验收。 |
| 官方工具文档 | [FFmpeg overlay](https://ffmpeg.org/ffmpeg-filters.html#overlay)、[drawtext](https://ffmpeg.org/ffmpeg-filters.html#drawtext)：支持叠图，文字滤镜依赖编译项；本文 PNG 方案是设计建议，未实测。 |
| 报价而非账单 | [Viggle 计价](../../../packages/providers/src/viggle-h3.ts)、[music 指引](../../../skills/code-plan/SKILL.md)；本次没有媒体生成或付费调用。 |
