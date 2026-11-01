# 故事与可读性调研：Tofu 片

2026-11-01。只调研，未改代码，未调用付费 API。来源标注：**官方**（平台文档）、**研究**（论文或机构发布）、**创作者**（本人访谈）、**二手**（转述）、**实测**（本次抽帧）、**经验**（行内经验或我的判断）。

## 结论

1. **想讲的「懒」没有进片。** 关键动作发生在保留窗口之后：tofu-02 的躺倒在原片 4.4–5.0s，入片只到 4.0s；tofu-03 的转身拒绝在 4.7s 之后，入片也只到 4.0s。观众因此看到一只配合运动、吃了西兰花的狗。
2. **「快」被计划自己写没了。** 计划要求「正常速度」「不夸张」，并禁止「长时间发呆」，等于关掉了 exaggeration、beat-before 和反应停顿。全部进片也不成立。
3. **创作指引已经发布，只是导演拿不到。** `skills/v8.1.0/` 里有 craft-story、craft-comedy、type-social。Code plan 导演被锁在单个 `code-plan` 技能上。最缺的是几条能卡住 Tofu 的硬规则：proof frame、carrier 审查、否定动作改写成状态、cold read。

## 1. 陌生人实际看到什么

方法（实测）：原始片段按 1.5 fps 抽帧，tofu-02 在 3.0–5.2s 加密到 5 fps，另用帧差算每 0.5 秒运动量。运动量只是粗信号，下表判断都回到画面确认。

| 镜头（入片） | 导演想讲 | 入片部分实际发生 | 读到的是 | 结果 |
|---|---|---|---|---|
| tofu-01 0–3s | 建立减肥目标 | 走近哑铃，低头闻 | 狗闻东西 | 只立了主题 |
| tofu-02 3–7s | 推一下就躺倒 | 闻哑铃，抬头。**躺倒在 4.4–5.0s，入片到 4.0s** | 狗还在闻 | 核心笑点被切掉 |
| tofu-03 7–11s | 闻后嫌弃转身 | 鼻子埋碗，3s 露舌。**转身在 4.7s 后，入片到 4.0s** | 狗吃了西兰花 | **读反** |
| tofu-06 11–13s | 发现狗粮复活 | 趴着，低头望向蓝碗 | 狗看见饭 | 可读，但前后接不上 |
| tofu-04 13–18s | 运动没力，吃饭飞快 | 前 3.3s 站着对镜头笑，之后普通走路，约 5.5s 才到碗，入片到 5.0s | 开心的狗走过来 | 反差为零 |
| tofu-07 18–22s | 一口不耽误 | 低头吃。舔嘴在 4.7s，被切掉 | 狗吃饭 | 可读，不好笑 |
| tofu-08 22–27s | 一粒狗粮引它折返 | 走开又回来，鼻子刚碰地就切 | 狗在遛弯 | 第二笑点没读出来 |
| tofu-05 27–30s | 减肥明天，吃饭今天 | 对镜头笑后趴下。哑铃几乎出画，碗仍是满的，西兰花进了玻璃杯 | 狗吃完趴下 | 没有落点 |

8 段里 6 段的运动峰值落在保留窗口之外。动作普遍比 prompt 晚 1–3 秒，模型像是把动作摊满了整段 6 秒。这补上了 [system 报告](research-system-codex.md) 说接触表证明不了的部分：动作确实拍到了，是被固定秒数切掉的。

**Cold read（实测）：** 两个无上下文模型只看 `sheet-film.jpg`。两位都说狗吃了西兰花，都没看到偷懒。一位猜标题 "Corgi's Diet Starts Tomorrow" 但表示不确定；另一位猜 "Corgi Gym Day, Then Dinner"，说没有 punchline。所以道具能暗示「运动和吃」的主题，比 EVIDENCE 第 3 条说的好一点；缺的是笑点的前半段。限制：只有 2 个样本，是模型不是真人，一次看全 30 帧也比顺序观看容易。

计划层面的缺陷，即使全部进片也读不出来：

| 缺陷 | 证据 | 后果 |
|---|---|---|
| 否定动作没有落成状态 | 偷懒、拒绝都写成过程 | 过程一旦被切，什么都不剩 |
| 夸张被关掉 | 「正常速度」「自然小口进食，不夸张吞食」`safe comfortable behavior` | 懒和快都在普通狗的范围内 |
| 停顿被禁止 | `camera`：「禁止慢推镜和长时间发呆」 | 没有 beat-before，也没有反应停顿 |
| 反差被拉开 | 懒在 3–7s，快在 13–18s | 看不出是同一件事的两面 |
| 命题靠猜 | 无秤、无软尺、无旁白、无字幕 | 「减肥第一天」只存在于 scene title |
| 状态没有变化 | 末帧碗还是满的 | 没有「吃完了」这个结果 |
| 道具进了遮挡区 | 那粒狗粮宽约 4%，在画面高度 89% 处 | 落在 Reels 底部 UI 区 |
| 结尾是句子不是画面 | 「减肥明天，吃饭今天」 | 没有 punch image |
| 脸一直开心 | 三镜张嘴对镜头笑 | 与「累瘫」相反 |

镜头数不是问题：旧片 8 镜、均长 3.75s，在草稿给的 30s 8–14 镜范围内（经验）。

## 2. 成功的短视频喜剧怎么做

结构上，一个 premise，第一帧提出问题，拍、拍、破（rule of three），punch 落在切点，反应停 1–2 秒，结尾接回第一帧。这些是 craft-comedy 已写明的行内经验。下表是能查到来源的部分。

| 原则 | 依据 | 等级 |
|---|---|---|
| 内容要让不认识你的人看懂，前 3 秒要有 hook | [Instagram for Creators，2025-02](https://creators.instagram.com/blog/helping-creators-of-all-sizes-break-through) | 官方 |
| 3 秒内亮出命题，6 秒内放 hook | [TikTok Ads，2025-06](https://ads.tiktok.com/help/article/creative-best-practices) | 官方，针对广告 |
| 前几秒抓住注意力，文字用来强调重点 | [YouTube Blog，2025-04](https://blog.youtube/creator-and-artist-stories/your-guide-to-getting-started-with-youtube-shorts/) | 官方 |
| 为转发和看完而写：Reels 最看重转发、看完、点赞、进音频页 | [Mosseri，2023-05](https://about.instagram.com/blog/announcements/instagram-ranking-explained) | 官方，年份较早 |
| 字幕用来提供上下文 | [TikTok Ads](https://ads.tiktok.com/help/article/creative-best-practices) | 官方，针对广告 |
| Reels 默认开声；音乐加旁白比无声高 15 分 | [Meta 广告页](https://www.facebook.com/business/ads/facebook-instagram-reels-ads)、[Meta 2023-10](https://www.facebook.com/business/news/reels-ads-updates-performance-features-automated-creative-suitability-solutions) | 官方自研，针对广告 |
| **观众按情境判断狗的情绪，而不是狗本身的行为** | [ASU 发布，Molinaro & Wynne，Anthrozoös](https://news.asu.edu/20250311-science-and-technology-think-you-understand-your-dog-dont-be-so-sure) | 研究 |
| 切到物体能给中性的脸赋予含义（Kuleshov），但重复实验结果不一 | [Mobbs 2006](https://academic.oup.com/scan/article/1/2/95/2362814)、[Frontiers 2017](https://www.frontiersin.org/articles/10.3389/fpsyg.2017.01684/full) | 研究，证据不一 |
| Staging：把一个想法呈现到毫不含糊；Exaggeration：忠于现实但推到极端 | [Thomas & Johnston，经 Wikipedia](https://en.wikipedia.org/wiki/Twelve_basic_principles_of_animation) | 工艺经典，二手 |
| 笑点靠入画出画、走近又退回、卡点音效、音乐同步 | [Tony Zhou 论 Edgar Wright，经 MovieMaker](https://www.moviemaker.com/edgar-wright-visual-comedy-video/) | 工艺，二手 |
| 笑点要在画内完成，用动作而不是字幕推进 | [Tony Zhou 论 Keaton，经 Mental Floss](https://www.mentalfloss.com/article/544803/buster-keaton-crafting-the-perfect-gag) | 工艺，二手 |
| 动物不靠台词；每片先画粗分镜当 visual script；声音单独用一周 | [Simon Tofield 访谈](https://www.skwigly.co.uk/simons-cat/) | 创作者 |
| 同题材案例：猫为早饭把主人弄醒（[Cat Man Do](https://en.wikipedia.org/wiki/Simon%27s_Cat)）；金毛装死，肉条一拿就起身，超 600 万观看（[报道](https://thelondoneconomic.com/lifestyle/dog-playing-dead-video-breaking-the-internet-26669/amp)） | 见链接 | 二手 |
| AI 宠物短剧靠拟人角色、反转和字幕音效，先写剧本再出图 | [36Kr](https://eu.36kr.com/en/p/3464619080652422) | 二手，数据未核实 |
| 喜剧生成可在渲染前用 LLM critic 评剧本 | [COMIC 摘要](https://arxiv.org/abs/2603.11048) | 研究，只读了摘要 |

**对 Tofu 最有用的是 ASU 研究。** 狗的脸不可靠，意义来自旁边的物体，所以每一拍都要把原因和对象放进画面。

**没查到：** 短视频镜头时长或切点密度的可靠数据，只有营销博客；YouTube 和 Instagram 关于 loop 的官方指引；宠物喜剧创作者的节拍级拆解；30s 是否劣于 15–20s 的证据。文中的镜头数只能算经验。

## 3. 导演在生成前要做什么

全部是文字工作，免费，顺序不能换：

1. **Logline**：一句话，含 target、violation、why safe。brief 开放时用 `ctx.choose` 给 2–3 个 premise。
2. **先写 punch image**，再倒推最短的 setup。
3. **Beat sheet**：每拍写 role、陌生人应说出的一句话、proof frame、carrier、秒数。
4. **Carrier 审查**：logline 的每个关键词都要有画面或声音承载。
5. **否定改状态，过程改状态**：拍「瘫平」「屁股对着碗」，不拍「偷懒」「拒绝」。一镜一个可读动作，笑点放在两个状态之间的切点。
6. **声音先于画面**：旁白、静音点、音乐切入写进 beat sheet。
7. **Cold read**：关键帧走订阅，不花视频钱。只给图不给 prompt，让读者复述。说不出 premise 就改 beat。

现有资产（路径在 `skills/v8.1.0/` 下）：

| 需要 | 已有 | 可否复用 |
|---|---|---|
| 核心句和核心画面 | `craft-story/SKILL.md` 第 2–7 步 | 直接移植 |
| Premise 生成与打分 | `craft-comedy/references/premises-and-beats.md` | 移植，但「Wordless 0 分淘汰」要改成 carrier 审查 |
| Punch-first 节拍图 | 同上 | 只有 20s 示例，缺 30s 版 |
| 时间规则 | `craft-comedy/references/comedy.md` | 直接移植 |
| AI 能力边界，「Put the timing in the cut」「Keyframe the punch」 | `craft-comedy/references/short-form.md` | 直接移植，正是旧片违反的 |
| Hook、安全区、loop | `format-social-vertical`、`type-social` | 移植规则，去掉 `prepare_change`、`read_guidance` 等工具名 |
| 自查清单 | `craft-comedy/references/review-checklist.md` | 改写，它是作者自查，不是 cold read |
| `skills/production/` | 一段式 stage prompt | 太薄，不必移植 |
| `skills/plan-authoring/` | 旧声明式语法 | 没有创作内容 |
| `docs/ai/skill-drafts/` | v8 包的草稿 | 用已发布版；草稿的 6s 不裁切假设已过时 |
| proof frame、carrier 审查、否定改状态、cold read、30s 节拍 | **无** | 需新写 |

这里修正 EVIDENCE 第 6 条：有价值的内容在 v8.1.0，不在 `skills/production/`。不要照搬，`craft-comedy` 写「Clip sound is kept」，而 code-plan 的片段是静音的。导演读不到是硬限制：`director-capabilities.ts:33` 只选 `code-plan`，`director.ts:126` 断言 `lock.skills.length === 1`，工具里也没有 `read_guidance`。

## 4. Tofu 修改前后

**修改前：** 只有标题「减肥第一天：只对吃饭有动力」，加 8 件依次发生的事。

**修改后：**

- **Logline：** Tofu 减肥第一天：碰一下哑铃就累瘫，西兰花不看一眼，一听到开饭，飞过哑铃冲向狗粮。
- **Premise：** target 是人人都有的「减肥从明天开始」；violation 是全身没力气的狗为吃饭破了纪录；safe 是只有体重受伤。
- **机制：** rule of three（运动、健康餐、狗粮），加一本正经的旁白被画面打脸。
- **Punch image：** Tofu 腾空越过那只碰一下就让它累瘫的黄色哑铃。

| # | 时间 | 节拍 | proof frame：必须看得见的状态 | 声音 | 陌生人应说出 |
|---|---|---|---|---|---|
| 1 | 0–3 | Hook | Tofu 坐在无数字的指针体重秤上，屁股溢出秤面，低头看指针 | 严肃铜管进行曲；VO「减肥第一天。」 | 这狗在减肥 |
| 2 | 3–6 | 第一试 | 瑜伽垫上，鼻尖碰黄色哑铃（tofu-01 已拍成过） | VO「今日训练量：一下。」 | 它要运动了 |
| 3 | 6–10 | **破 1** | 硬切同机位：侧躺，四腿伸直，舌头外露，哑铃原位 | 音乐硬停，静 1 秒；VO「练完了。」 | 碰一下就累瘫 |
| 4 | 10–13 | 第二试 | 同一姿势，西兰花碗在脸前，只有眼睛转过去 | VO「午饭：西兰花。」 | 该吃健康餐了 |
| 5 | 13–16 | **破 2** | 硬切同机位：屁股对着碗 | 静音 | 它不吃 |
| 6 | 16–19 | Beat before | 大特写：闭着眼，一只耳朵竖起，一只眼睛睁开 | VO 压低「这时，厨房传来一个声音。」 | 要出事了 |
| 7 | 19–20.5 | 原因 | 狗粮倒进蓝碗的特写 | 静音（有音效后换狗粮声） | 开饭了 |
| 8 | 20.5–24.5 | **Punch** | 全速冲向镜头，腾空越过黄色哑铃，耳朵后飞 | 音乐全速切回 | 刚才是装的 |
| 9 | 24.5–27 | 证明 | 脸埋进碗，切到空碗，舔嘴 | 音乐延续，27s 硬停 | 全吃光了 |
| 10 | 27–30 | Button，loop | 同第 1 镜构图：指针比开头更靠右，Tofu 抬眼看镜头不动 | 静音；VO「明天，减肥第一天。」 | 永远是第一天 |

| 关键词 | 旧片 carrier | 新版 carrier |
|---|---|---|
| 减肥 | 道具暗示 | 体重秤加 VO |
| 第一天 | 无 | VO，首尾呼应 |
| 没力气 | 被切掉 | 瘫平状态，靠硬切成立 |
| 只对吃饭有动力 | 普通走路 | 飞过哑铃加空碗 |

字段对比。旧（tofu-02）：`completeAction: "0–1秒：鼻子把哑铃向前推约10厘米；1–2.8秒：收回头…"`。新（第 3 镜）：`{ role: "break-1", strangerSees: "碰一下就累瘫", proofFrame: "侧躺，四腿伸直，舌头外露，哑铃原位", carriers: ["picture", "silence", "vo"], seconds: 4 }`。

声音今天就能做：同一首音乐放两段 `audio` placement（0–6s、20.5–27s），中间留空就是 cut-to-silence。旧 brief「轻快滑稽拨弦」是提前告诉观众这很好笑，改成严肃进行曲才有反差。

成本：10 段 5s 首帧 $1.50，参考图 $2.50，Lyria $0.08，speech 另算，超默认 $1，在用户可接受范围内。这份 beat sheet 未经生成验证。第 8 镜跳跃风险最高，退路是贴着哑铃冲过去。

## 5. 建议

| # | 位置 | 做什么 | 影响 | 工作量 |
|---|---|---|---|---|
| 0 | 现有素材 | 先免费重剪验证：tofu-02 留到 5.6s，tofu-03 留到 5.6s，tofu-04 取 3.0–6.4s，tofu-07 留到 4.8s，删 tofu-08，约 27s，再加 VO 和音乐 | 中：救回「懒」，救不回「快」 | 不到 0.5 人日，约 $0.08 加 speech |
| 1 | 导演指引：新建 `skills/code-plan/references/film-craft.md`（约 6 KB），改 manifest `files` 和 `CODE_PLAN_GUIDANCE_DIGEST` | 移植第 3 节七步和可复用内容，补 30s 节拍；所有文件每轮注入，所以写短 | 高 | 1 人日，并入 system 报告第 1 项 |
| 2 | 导演指引：`skills/code-plan/SKILL.md` 第 34–35 行 | 放开 `firstFrame`/`lastFrame`，用于 punch 和结果状态，不必等用户要求 | 中高 | 0.25 人日，与 system 报告一致 |
| 3 | Studio：`ctx.shot` 的 dry-run，`apps/server/src/code-plan/index.ts:335` | comedy 片要求 `role`、`strangerSees`、`proofFrame`、`carriers`、`seconds`，缺字段时 `submit_plan` 拒绝，并校验总秒数。自由文本的 `meaning` 已证明拦不住 | 高 | 1–2 人日 |
| 4 | Studio：cold read | 先用 `ctx.choose` 让用户看整组关键帧；再加只给图不给 prompt 的 LLM 读者。本次 2 个模型都读出了「吃了西兰花」 | 中高 | `choose` 只改指引；LLM 读者 2–3 人日，依赖视觉通路 |
| 5 | 渲染器：字幕 | 见 system 报告第 3 项；premise 文字可同时走 VO 和字幕 | 高 | 2–4 人日 |
| 6 | 模型配置：音效 | 保留 clip audio 或接入音效库，第 7 镜最需要 | 中 | 未估，先确认片段静音的来源 |

不建议一开始就给 code-plan 接 `read_guidance` 加整套 v8.1.0：要改 lock 不变量和工具目录，内容里的工具名和 clip sound 也不适用。

## 6. 依赖其他方向

- **剪辑：** proof frame 是否在切点内，必须看到片段才能判断，依赖 system 报告的 `read_clip_frames`。`SKILL.md` 现在又取消了片段审批，这一步目前没有人负责。
- **连续性：** 第 2→3、4→5、1→10 的同机位硬切本身就是笑点，机位和道具一变就失效。
- **Prompt：** 第 3、5、8、10 镜要把结果状态写进关键帧，具体语法由 prompt 方向定。
- **字幕和音效：** 上表第 5、6 项。没有它们，VO 必须成立；静音观看时第 1、3、5 镜要靠画面撑住。
