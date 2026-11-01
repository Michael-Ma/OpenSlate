# Prompt 调研：Tofu 片

标记：**官方**＝厂商文档；**第三方**＝他人实测或文章；**本片**＝我抽帧目测；**推断**＝我的判断，未验证。

## 结论

1. **模型听顺序，不听秒数。** 8 段里 7 段动作顺序对，只有 2 段按时完成。成片又按这些秒数裁切，3 个核心笑点（躺倒、拒绝、发现狗粮）被剪掉了。这是 prompt 里最贵的错误。
2. **中英混杂是症状，不是主因。** 中文动作部分模型其实执行了。没有哪家厂商说过 prompt 混写会伤害画面。该改，但只改这一条，画面不会明显变好。真正的根因是 `prompt: 模板 + shot.action`，把给人看的中文分镜字段直接拼进了 prompt。
3. **`enhance` 建议继续关，但没有对照证据。** 贵 80%，改写结果看不到。先修 prompt，再花 $2.10 做一次 on/off 对照。

## 1. 审计：模型听了什么

方法：8 段全长 6.6 秒，按 0.4–0.8 秒抽帧，与 `steps.json` 逐句对照。**限制：** 证据包没有关键帧原图，关键帧的判断来自片段首帧，只能算间接证据。

| 写法 | 原文 | 画面结果（本片） | 判定 |
|---|---|---|---|
| 动作先后 | `0–1秒…1–2秒…` | 7/8 顺序正确；tofu-06 被读反 | 听了 |
| 逐秒时长 | `0–0.7秒`、`Begin immediately` | 2/8 按时，其余晚 0.8–2.4 秒；tofu-02、tofu-04 前 3 秒基本没走位 | 没听 |
| 结束后保持 | `hold … until 6 seconds` | 2/8 做到，其余把动作摊满整段 | 基本没听 |
| 机位 | `Locked low camera` | 8/8 固定低机位，8 个 `frame` 也全写了低机位 | 听得最彻底，单调由此而来 |
| 格式 | `no text, no borders, no cuts` | 8/8 无字无框无切；没有对照，可能本来就是默认 | 无法判断 |
| 物理尺寸 | `10 cm`、`约10厘米`、`10 percent safe margins` | 哑铃几乎没动；至少 5/8 首帧有狗或道具被画面边缘裁掉 | 没听 |
| 物件清单 | 每张都列全部 5 件道具 | 清单被过度执行：tofu-02 画面有 4 只碗加 1 个罐子；tofu-05 的西兰花跑进玻璃杯 | 过度听 |
| `Same …` | `Same warm pastel apartment` | 每镜房间都不同 | 无效，单次调用没有记忆 |
| 流程用语 | `START pose`、`retained interval`、`safe comfortable behavior` | 看不出作用；模型不知道我们的剪辑窗口 | 无效 |
| 状态写成节拍 | `0–0.5秒：Tofu 趴着` | 狗真的往下趴，0.4–2 秒头持续下沉，正好与「抬头」相反 | 有副作用 |
| 微动作 | `眼睛转向…耳朵立起` | tofu-06 全程看镜头 | 没听 |
| 表情 | 没写，只有 `Adorable` | 4/8 咧嘴笑，看不出偷懒和反差（原因是推断） | 模型默认值 |

| 镜头 | 笑点 | 提示完成 | 实际完成 | 保留 | 成片里看得到吗 |
|---|---|---|---|---|---|
| tofu-01 | 鼻尖碰哑铃 | 3s | ≈3.0s | 3s | 刚好 |
| tofu-02 | 推一下就躺倒 | 4s | 躺倒 ≈4.4s | 4s | **看不到** |
| tofu-03 | 转身拒绝 | 4s | 转身 ≈4.4s，趴下 ≈5.2s | 4s | **看不到** |
| tofu-06 | 发现狗粮 | 2s | 抬头 ≈4.0s | 2s | **看不到**，只见狗往下沉 |
| tofu-04 | 冲到碗边 | 5s | ≈5.8s | 5s | 没到碗边 |
| tofu-07 | 吃完舔嘴 | 4s | 舔嘴 ≈4.8s | 4s | 部分 |
| tofu-08 | 折返吃狗粮 | 5s | ≈5.6s | 5s | 基本 |
| tofu-05 | 趴下看镜头 | 3s | ≈3.2s | 3s | 看得到 |

模板占比：关键帧 73%（726 字符），视频 83–89%（460 字符）。每段视频真正属于本镜的只有 54–97 字符。

## 2. 厂商怎么说

以下为转述。五家**都没有**中英文效果对比。我读到的官方示例基本是单语言，例外都是台词：Kling 英文 prompt 里的中文台词，Seedance 中文 prompt 里的外语台词。

| | MiniMax H3（Viggle） | Seedance 2.x | Kling 3.0 | Veo 3.1 | GPT image |
|---|---|---|---|---|---|
| 语言 | 未规定；中文文档中英示例都有 | 未规定，示例以中文为主；只对**台词**要求别中英混用 | 未规定；台词可混用多语言 | 未查到；示例全英文 | 未规定 |
| 结构 | 无公式，示例一两句 | 主体+动作细节+场景+光影+运镜+风格+画质+约束 | 无公式；示例为场景→角色动作→运镜→台词 | `[Cinematography]+[Subject]+[Action]+[Context]+[Style&Ambiance]` | 场景→主体→细节→约束，写明用途，分短段 |
| 长度 | 7000 字符；Viggle 未写上限 | 无官方数字，要求简洁，别贴完整剧本；第三方数字互相矛盾 | 未写 | 未查到 | 官方未读到；第三方称 32000 字符 |
| 动作 | 未写 | 具体到身体部位，带幅度、速度、力度；写前后承接；优先慢而连贯的小动作 | 按节拍写，停顿也写 | 主体+动词 | 不适用 |
| 镜头 | 关键描述后加 `[static]`、`[pan]` | 用标准术语；每镜只指定 1 种运镜 | 明确写；单镜头声明不切 | 放最前，官方称最有力的手段 | 相机参数只被粗略理解 |
| 参考 | 写明用途：`reference image 1`（MiniMax 示例，Viggle 未规定写法）；Viggle 最多 4 张 | `图片N` 按上传顺序；角色 1–2 张、场景 1 张，别用满 | `@Image1`；我们走 fal 首帧，用不到 | 写明每张图代表谁 | `Image 1: …` 逐张标注，说明关系；固定角色描述可复用 |
| 否定 | 未写；第三方 n=1 测得 `no cuts` 有帮助 | 句末约束短语 | 指南未提；fal 有 `negative_prompt` | 别写 no/don't，用名词列出 | 可以直说 no watermark |
| 时间 | 未写；第三方 n=1 测得时间码偏晚 | 官方明说不稳定，用 `镜头1/镜头2` | `Shot 1 (3s):` | `[00:00-00:02]`，官方示例 2 秒一段 | 不适用 |

Seedance 这句和本片结果完全一致：「模型对精确时间（如 0–3 秒）的支持不稳定」。我读到的官方示例最小单位都是整秒，没有 0.7 秒这种写法。否定词并非都不好：Veo 反对，OpenAI 和 Seedance 接受，所以规则是「一句，只防见过的问题」。

**没查到：** H3 没有官方 prompt 指南，只有零散说明；BytePlus 页面正文抓不到，用的是火山方舟中文原文，Seedance 2.5 指南未读；Veo 的语言和长度限制未读到；Gemini API 称 Veo 3.1 预览版已于 10-22 关停，fal 是否受影响未查。

## 3. 该怎么写

**关键帧（GPT image，60–90 词）**

```text
Film still for <用途>. Photorealistic.
Image 1 is <角色>. Image 2 is <地点>. Keep both unchanged.
Setting: <这一镜在房间哪里，光线>.
Subject: <姿态、朝向、表情>.
Props: <只写本镜需要的，相对主体摆放>.
Framing: <景别、角度、主体位置、四周留多少空间>.
No text, no watermark.
```

**视频，reference 模式（H3，30–70 词）**

```text
<景别>, <角度>, <一种运镜或 static>.
The dog follows reference image 1. <此刻的状态>.
He <主动作：身体部位+速度>, then <一个后续反应>.
He ends <结束姿态和表情>. One continuous shot.
```

词数是经验值，未测。参考模式不固定开场画面，所以 v6 的「START pose」两头落空：要精确开场就用 `firstFrame`（$0.03/秒，更便宜），prompt 只写怎么动；用 `references` 就把关键帧当定妆照，写清机位和动作。

| 模型 | 与模板的差别 |
|---|---|
| H3（Viggle） | 如上；串联动作时保留 `One continuous shot`（第三方：连续运镜被切成 3 个镜头） |
| Seedance 2.x | 按官方公式；用 `图片1`；多动作分 `镜头1/镜头2`，不写秒；大动作少用 |
| Kling 3.0（fal 首帧） | 只写怎么动，不重述画面；多镜头语法 Studio 未开放 |
| Veo 3.1（fal 首帧） | 镜头词放最前；只有 4/6/8 秒；可用 `[00:00-00:02]`；否定写名词 |

**动作容量**（本片：每个可见节拍约 1.2–1.5 秒，另有 0–3 秒起步延迟；属推断，非厂商数据）。节拍是手机屏上看得出的一次身体位置变化，眼神、耳朵、舔嘴只在特写算数。

| 片段长度 | 节拍上限 |
|---|---|
| 成片保留 2–3 秒 | 1 |
| 5 秒 | 2（主动作+反应），连续动作最多 3 |
| 8–10 秒 | 3–4 |

## 4. 改写

**关键帧 tofu-01**

```text
前：[726 字符公共模板] Low medium-wide frontal view. Tofu stands on a mint yoga mat,
nose 10 cm above a tiny yellow foam dumbbell immediately in front of his paws. Full dog,
entire mat and dumbbell visible. Alert focused eyes. Starting pose before touching the toy.

后：Film still for a funny pet video. Photorealistic.
Image 1 is Tofu, a Pembroke Welsh corgi with a teal bandana. Keep him as shown.
Setting: a living-room floor in warm afternoon light, cream sofa behind him.
Subject: Tofu stands on a mint yoga mat, legs braced, head low, staring at a tiny yellow foam
dumbbell just in front of his paws. Mouth closed, deadly serious, like a weightlifter before
a record attempt.
Framing: wide shot from the floor, dog centred, plenty of floor on every side.
No text, no watermark.
```

**简单镜头 tofu-03**（4 拍减到 2 拍，请求 5 秒）

```text
前：[460 字符公共模板] 0–1秒：Tofu 俯身闻白碗里的西兰花；1–2秒：鼻子后撤；
2–3.5秒：头和肩转离白碗；3.5–4秒：朝反方向趴下。白碗始终可见。

后：Medium close-up at the dog's eye level, static camera.
The dog follows reference image 1. He stands over a white bowl with one broccoli floret.
He sniffs the broccoli once, then snaps his head away and turns his whole body from the bowl,
nose in the air.
He ends side-on to the bowl, eyes closed, unimpressed, the bowl still in frame.
One continuous shot.
```

**复杂镜头 tofu-08**（5 拍塞不进 5 秒，拆成两镜，笑点落在定住那一下）

```text
前：[460 字符公共模板] 0–1.5秒：Tofu 转身向垫子走两步；1.5–2秒：发现蓝碗旁地上一粒狗粮，回头；
2–3.5秒：转身走回；3.5–4.5秒：低头吃掉那一粒；4.5–5秒：抬头。狗粮从首帧就存在，不凭空出现。

后 A：Wide shot at floor level from behind the blue bowl, static camera.
The dog follows reference image 1. One kibble lies on the wood floor beside the bowl.
He walks away toward the yoga mat, then stops mid-step, one front paw raised, and slowly turns
his head back toward the kibble.
He ends frozen, eyes locked on the kibble. One continuous shot.

后 B：Close-up at floor level, static camera, on one kibble on a wood floor beside a blue bowl.
The dog follows reference image 1. He trots in from the right, snaps up the kibble in one quick
bite, then lifts his head and licks his lips once.
He ends looking straight into the lens, mouth closed, pleased. One continuous shot.
```

两段 5 秒共 $0.50，比原来一段 6 秒多 $0.20。

## 5. 指引和组合方式

建议加到 `skills/code-plan/SKILL.md`，放在 `Vertical films` 之前：

```md
Writing prompts:
- One language per prompt, English by default. Only quoted dialogue or on-screen text keeps its own language. Titles, `meaning`, `completeAction` and choose questions stay in the person's language. Never paste those fields into a prompt: give each shot separate English `frame` and `motion` text.
- Describe only what is visible in this shot. Leave out pipeline words (start pose, retained interval, safe margins) and the aspect ratio, which parameters already set.
- Most of each prompt must be specific to its shot. If shots share most of their text, rewrite them.
- Identity comes from pictures, not paragraphs. Make one reference picture of each recurring character and place, pass it to every keyframe with `references`, and label it: "Image 1 is Tofu." Text gets at most one short fixed line. "Same room as before" does nothing: no call remembers another.
- Keyframe, 60-90 words: what the still is for, references, setting, subject with pose and expression, only this shot's props placed relative to the subject, framing.
- Clip, 30-70 words: shot size, angle and one camera move; what each reference is for; the subject's current state; the action; the end state. References do not fix the opening picture. If it matters, use firstFrame and describe only the motion.
- Choose shot size and angle per shot for what it must show. Never reuse one camera sentence across a film.
- Action budget: a beat is one change of body position readable on a phone, about 1.5 seconds. A 5-second clip holds 2 beats: main action, then reaction. A kept length of 2-3 seconds holds 1. More beats means more shots. Eyes, ears and licks count only in close-up.
- Write order, not seconds: "does X, then Y". No timestamps or decimals for Viggle, MiniMax or Seedance. Use whole-shot timing only where a model documents it: Kling `Shot 1 (3s):`, Veo `[00:00-00:02]`. A clip may finish late, so never assume its action fits the first N seconds.
- Write states as states ("he lies on the mat"), never as a timed step: a listed step gets animated.
- Use relative sizes, not measurements: "a small nudge", "just in front of his paws", "plenty of floor around him". Name the body part, amount and speed.
- Always name the expression and where the eyes go. Unprompted animals grin at the lens. Put the target of a look off the lens axis so the look reads.
- Constraints: one closing sentence, only for failures you have seen. With chained actions add "One continuous shot". For Veo avoid "no" and "don't".
- Reference syntax: Viggle and MiniMax "reference image 1"; Seedance "图片1"; GPT image "Image 1: ...".
- Changing shared text changes every prompt and pays for every clip again, so keep shared style text out of clip prompts.
```

同时改三处。第 18 行给 `image` 加 `references?`。`studio.d.ts` 同步：`image(input: ShotMediaInput & { prompt: string; references?: Artifact[] })`。`example-plan.ts` 现在示范 `${prompt}. ${motion}.`，把关键帧文字重复进视频 prompt，v6 的拼接习惯很可能由此而来（推断），应改为只传 `motion`。

示意如下，省略 `ok` 判断和选图：

```ts
const shots = [{ id: "tofu-03", title: "转身拒绝", action: "闻一下西兰花，嫌弃地转身", frame: "…", motion: "…" }];
const tofu = await ctx.image({ model, prompt: "Reference photo of Tofu, a Pembroke Welsh corgi with a teal bandana. Full body, side view, plain background." });
const frame = await ctx.image({ model, references: [tofu.artifact], prompt: `Image 1 is Tofu. ${shot.frame}`, shot: shot.id });
const clip = await ctx.video({ model, references: [frame.artifact], prompt: shot.motion, shot: shot.id });
```

**注意：** `ctx.image` 的 `references` 看代码已打通（`provider-input.ts` 允许、`resolveInputs` 收集、Codex 按序附带），但没写进文档，也没找到测试。单张上限 4 MiB，需先实测一次（走订阅，$0）。布景连续性归另一份调研，这里只说 prompt。

## 6. Prompt 上限和 enhance

**上限。** Studio 对所有模型都是 32768 字节，只是防滥用，从未起作用：v6 最长 1039 字符。它是 H3 真实上限 7000 字符的 4 倍多，所以 MiniMax 直连时 Studio 放行的内容，厂商可能拒绝。建议保留，另按模型报 `promptMaxChars`。质量靠词数指引，不靠上限。

| `enhance` | 事实 |
|---|---|
| 作用 | Viggle 称是一次低强度 AI Planner 改写，默认开，参考素材不变（官方） |
| 价格 | reference 768p：off 25、on 45 credits/5 秒，即 $0.05 对 $0.09/秒；v6 的 8 段 $2.40 变 $4.32 |
| 可见性 | 返回字段没有改写后的 prompt，只有 `seed`（官方） |
| H3 自家 | `h3_context_ir` 只返回增强 prompt 不出片；H3-Max 的扩写默认开（官方）。两者与 Viggle Planner 的关系未证实 |

**判断：默认继续关。** 对 v6 这种 prompt，开启可能确实更好，因为厂商默认就走扩写，关掉后 prompt 是模型的全部文字输入。但我没有对照，不能断言。v6 的主要损失是节拍过载、裁切和单调机位，改写修不了裁切和关键帧；还贵 80%，而且看到的 prompt 不再等于发出去的 prompt。

**下一步。** 用改写后的 3 镜，同 `seed` 各跑 on/off，每对 $0.70，共 $2.10。这笔超过 $1，需要你点头。计划不能传 `enhance`，也不能给 Viggle 传 `seed`（`provider-input.ts` 拒绝），所以要写一次性脚本直调 Viggle，不走 Studio。盲看手机尺寸，on 赢 2/3 才开放为按镜头的选项。若有 MiniMax key，更干净的办法是调 `h3_context_ir` 看扩写结果，好的存进计划，仍用 `enhance=false`，这样可见且可重放（价格未标明）。

## 7. 建议清单

| # | 改动 | 位置 | 影响 | 工作量 |
|---|---|---|---|---|
| 1 | 加 `Writing prompts` 段 | 导演指引 `skills/code-plan/SKILL.md` | 高 | 半天 |
| 2 | 示例改为 `frame`/`motion` 分离 | 导演指引 `references/example-plan.ts` | 中高 | 1 小时 |
| 3 | 公开 `ctx.image` 的 `references`，补测试并实测 | Studio 接口 `studio.d.ts`、server 测试 | 高 | 半天到 1 天 |
| 4 | 切点不信任 prompt 秒数，按实际画面选窗口 | Studio 看片能力（他人负责） | 高 | 另计 |
| 5 | Prompt 体检写入 `diff.findings`：混写、小数秒、`cm`/`percent`、公共前缀过半、超词数；只提示不拒绝 | `apps/server/src/code-plan/index.ts` | 中，防回退 | 1 天 |
| 6 | 步骤详情显示 `revisedPrompt`：Codex 图像中间隔一层模型，现在看不到实际发给图像工具的文字 | `apps/server/src/code-plan/step-detail.ts` | 中 | 2 小时 |
| 7 | 按模型报 `promptMaxChars` | 模型配置 `models.ts` | 低 | 半天 |
| 8 | 视频 profile 试 `quality=high`：Viggle 称同价，v6 用的 `low`；更慢 | 模型配置 | 待测 | 配置加 1 次对照 |
| 9 | `enhance` on/off 对照 | 实测 | 未知 | $2.10 |
| 10 | 中英文对照：同 prompt、同 `seed` 各一条 | 实测 | 未知，五家都没数据 | 每镜 $0.50 |
| 11 | fal 开放 `negative_prompt`、`multi_prompt` | fal adapter | 低，模型尚未实测，暂缓 | 半天 |

## 来源

| 类型 | 来源 |
|---|---|
| 官方 | [Viggle reference 接口](https://docs.viggle.ai/v1/api-reference/videos/create-from-reference-video.md)、[Viggle 价格](https://docs.viggle.ai/v1/pricing.md)、[Viggle 响应字段](https://docs.viggle.ai/v1/api-reference/videos/get.md) |
| 官方 | [MiniMax H3 指南（英）](https://platform.minimax.io/docs/guides/video-generation)、[（中）](https://platform.minimax.cn/docs/guides/video-generation)、[H3 创建任务](https://platform.minimax.io/docs/api-reference/video-generation-v2-create.md)、[H3-Context-IR](https://platform.minimax.io/docs/api-reference/video-generation-v2-h3-context-ir.md)、[Hailuo 2.3 运镜指令](https://platform.minimax.io/docs/api-reference/video-generation-t2v) |
| 官方 | [火山方舟 Seedance 2.0 提示词指南](https://docs.volcengine.com/docs/ark/seedance-2-0-prompt-guide?lang=zh)、[BytePlus 同名页（正文未抓到）](https://docs.byteplus.com/en/docs/ModelArk/2222480) |
| 官方 | [Kling 3.0 指南](https://kling.ai/quickstart/klingai-video-3-model-user-guide)、[Kling 3.0 Omni 指南](https://kling.ai/quickstart/klingai-video-3-omni-model-user-guide)、[fal Kling 3.0 参数](https://fal.ai/models/fal-ai/kling-video/v3/standard/image-to-video/api) |
| 官方 | [Veo 3.1 提示词指南](https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-veo-3-1)、[Vertex 视频提示词指南](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/video/video-gen-prompt-guide)、[Gemini API 视频文档](https://ai.google.dev/gemini-api/docs/video)、[fal Veo 3.1 参数](https://fal.ai/models/fal-ai/veo3.1/fast/image-to-video/api) |
| 官方 | [OpenAI 图像提示词指南](https://developers.openai.com/cookbook/examples/multimodal/image-gen-models-prompting-guide) |
| 第三方实测 | [Fuser：H3 实测（样本很小）](https://fuser.studio/articles/minimax-h3-prompt-guide) |
| 第三方文档 | [Evolink H3 文档](https://evolink.ai/docs/cn/api-manual/video-series/minimax/minimax-h3/minimax-h3-overview.md)：称支持中英文、过长时细节可能被忽略 |
| 第三方文章 | [APIYI：图像 prompt 上限](https://docs.apiyi.com/en/api-capabilities/image-long-prompt.md) |
| 本片 | `evidence/steps.json`、`evidence/plan-v6.ts.txt`、8 段原始片段抽帧 |
