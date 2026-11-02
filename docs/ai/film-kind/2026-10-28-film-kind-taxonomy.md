# filmKind 分类法 `film-kind@1`（2026-10-28）

状态：已在 tool contract 7.0.0 实现（7.0.0 尚未发布，仍可调整）。代码：`packages/core/src/film-kind.ts`。

依据：`docs/ai/skill-architecture/2026-10-28-skill-architecture.md` §3.2（它提出了 `filmKind {kind, subtype, modifiers, audience, source}` 和 8 个 type 包）、`docs/ai/skill-drafts/video-types/index.md`、`docs/ai/skill-drafts/music-video/plan-fields-spec.md`、`docs/ai/v8-plan/2026-10-28-v8-plan.md` 决定 #3，以及下面 §1 的外部调研。

## 0. 结论

- `filmKind` 从一个扁平字符串（18 个值）改成**多轴结构**：`kind`（创作主干）+ `subtype`（按 kind 封闭）+ `tones`（语气/类型片，最多 3 个）+ `format {platform, aspect, lengthBand, targetSeconds}` + `audience` + `source`（画面来源）+ `labels`（`other` 的自由文本）+ `basis`（每个字段是谁定的）。
- 每个枚举都是封闭的，整套分类有版本号 `film-kind@1`；每个开放轴都有 `other`，`other` 必须在 `labels` 里写一个短标签。
- 新增 `kind: "undecided"`（“还没定”），以及字段级的 `basis: stated | asked | inferred | default`，让路由和 UI 能区分“推断的类型”和“人确认过的类型”。
- 开场时**必须定下**的只有两项：`kind`，以及 `aspect`（直接给出，或由有默认画幅的 `platform` 推出）。其他都有默认值。缺了就问一个简短的问题，不要默默猜。
- 给 loader 用的纯函数：`filmKindRouteKey(filmKind) → { typePackage, formatPackages[], toneTags[] }`。
- 和 skill-architecture §3.2 的差异：(1) `social` 成为一个 kind，对应新的 `type-social` 包；`format-social-vertical` 只做格式修饰；(2) 原提案的 `source: stated|inferred` 改名为 `basis` 并下放到字段级，`source` 改指画面来源（生成 / 本人素材 / 混合）；(3) 原 `modifiers: ["social_vertical"]` 由 `format.aspect` / `format.platform` 推出，不再单独存。

## 1. 调研：别的工具怎么分类

| 产品 | 分类方式（入口 / 模板 / intake） | 对我们的启发 |
|---|---|---|
| InVideo AI | 先选 **workflow**：YouTube Shorts、YouTube explainer、Recent events、Script to video、Short ad；再填 prompt，设时长和平台 | 入口是“用途 + 平台”，时长是独立设置 |
| LTX Studio | 按项目和用途：广告（AI Ad Generator）、音乐视频（上传歌曲）、短片、预告片 | 主干类型（广告 / MV / 叙事 / 预告）和我们的 kind 一致 |
| Higgsfield | 按工作室分：Cinema Studio（电影感）、Marketing Studio（商品广告、UGC）、AI Influencer；还有约 50 个 UGC 动作预设（outfit check、morning routine、unboxing）和“爆款结构”预设 | 社媒的子类型（开箱、日常、穿搭）是真实的结构单位，值得做 subtype |
| HeyGen / Synthesia | 按业务用途：销售培训、入职、客服、L&D、营销 | 企业视频归到 `explainer/training`，受众用 `internal` / `professional` |
| CapCut | 模板按内容格式：Daily life / Day in the life、mini vlog、POV trend、meme、funny videos | 社媒子类型：`day_in_the_life`、`pov`、`meme`、`skit`、`trend` |
| Canva | 按用途：promo、marketing、product、inspirational、intro；第三方归纳为社媒 / 商业营销 / 个人活动 / 教育 | “inspirational” 是语气，不是类型：语气应单独成轴 |
| Adobe Express | 可按 theme、aesthetic、niche、video type 搜索；格式另列：IG square post、IG story、IG reel、TikTok、FB post、YouTube、YouTube Shorts | **类型和平台格式是两个轴**，正是我们的设计 |
| Google Vids | 模板可按 Function、Design Style、Color、Industry 排序；例子：how-to、training、product demo、celebration、meeting recap | 用途（function）和风格（style）分开 |
| Hedra / VEED | 说话头像：UGC 广告、社媒内容、L&D 培训、内部沟通、解说 | 同一种画面技术服务多个 kind，所以技术不进 kind |
| OpusClip（Agent Opus）| “video agent”：从想法、链接、脚本、音频出发，自动做研究、脚本、分镜、生成、剪辑；原业务是长视频切片 | `source: own_media / mixed` 是一个真实的维度（从人的素材剪） |
| YouTube 分类 | Film & Animation(1)、Music(10)、Gaming(20)、People & Blogs(22)、Comedy(23)、Entertainment(24)、News & Politics(25)、Howto & Style(26)、Education(27)、Science & Tech(28) | 平台分类混合了题材和语气（Comedy），我们拆开 |
| YouTube 广告 | bumper 6 s 不可跳过；可跳过 in-stream 5 s 后可跳过，常见 15 s–3 min；Shorts 9:16 | 时长档位 `up_to_6s`、`up_to_15s`、`up_to_30s`、`up_to_3min` 有行业依据 |
| 短视频平台 | Shorts 现在最长 3 分钟（2024-10-15 起）；Reels 常见上限 90 s–3 min，各账号不同；TikTok 应用内最长 10 分钟；三者都是 9:16、1080×1920 | 平台决定画幅默认值；长度只给档位默认，不写死平台上限 |

调研结论：

1. 几乎所有产品都把“做什么”（用途 / 类型）和“发到哪里”（平台 / 画幅）分开（Adobe Express、InVideo 最明显）。
2. “搞笑”“励志”这类词在 Canva、YouTube 里被当成类别，但它们和类型正交：搞笑可以是广告、短剧、MV。所以语气单独成轴。
3. 社媒的子格式（skit、POV、meme、day in the life、开箱）在 CapCut、Higgsfield 里都是一等的模板单位，结构差别大，值得做 subtype。
4. 企业 / 教育视频（培训、入职、操作说明）在 HeyGen、Synthesia、Google Vids 里是主要类别，我们归入 `explainer`（`training`、`tutorial`），受众用 `internal`。
5. 素材来源（全部生成 / 用人的素材 / 混合）在切片类 agent 里是核心维度，决定能不能做（Film 现在不能原样放入素材，见 video-types 的 Supplied media 一节）。

## 2. 结构

```ts
interface FilmKind {
  version: "film-kind@1";               // 应用写入；输入可省略
  kind: FilmKindKind;                   // 必填
  subtype?: FilmKindSubtype;            // 必须属于该 kind 的列表
  tones?: FilmKindTone[];               // 0–3 个，有序（第一个是主语气）
  format?: { platform?: FilmKindPlatform; aspect?: FilmKindAspect; lengthBand?: FilmKindLengthBand; targetSeconds?: number /* 1–3600 */ };
  audience?: FilmKindAudience;
  source?: "generated" | "own_media" | "mixed";
  labels?: { kind?; subtype?; tone?; platform?; aspect?; audience? };   // 恰好对应值为 other 的字段，≤80 字符
  basis?: { kind?; subtype?; tones?; platform?; aspect?; lengthBand?; audience?; source?: "stated" | "asked" | "inferred" | "default" };
}
```

### 2.1 `kind`（创作主干）

| `kind` | 含义 | 判断信号（目标 + 主体） |
|---|---|---|
| `undecided` | 还没定，开场必须问 | brief 没有说清用途 |
| `narrative` | 虚构角色、因果、结局 | 娱乐 + 编出来的故事 |
| `music_video` | 歌曲是时间线 | 有歌并且由歌驱动剪辑 |
| `commercial` | 说服：单一主张 + 证明 + 结尾（有 CTA 或品牌态度） | 卖 / 推广 / 品牌 |
| `social` | 为信息流而做的原生短内容：钩子、节奏、可循环 | 发到 TikTok / Reels / Shorts，用途是娱乐、互动、涨粉 |
| `explainer` | 让人懂或会 | 讲解 / 教学 / 培训 |
| `documentary` | 真实的人、事、地方 | 记录 / 证言 / 活动回顾 / 致敬 |
| `showcase` | 把一个真实主体拍好看 | 商品 / 服装 / 地点 / 食物本身 |
| `trailer` | 只暗示不揭晓，推广还没来的东西 | 预告、teaser |
| `narrated_story` | 旁白带画面：历史、清单、传说（无脸频道） | 声音主导的知识 / 故事 |
| `other` | 都不合适；`labels.kind` 写清楚 | — |

`social` 和 `commercial` 的区分：成功标准是“卖出 / 点击 CTA”就是 `commercial`（发在 TikTok 也是，竖屏由 format 表达）；成功标准是“笑了 / 分享 / 关注”就是 `social`。

### 2.2 `subtype`（按 kind 封闭）

| `kind` | `subtype` |
|---|---|
| `narrative` | `short`、`micro_drama`（竖屏短剧）、`kids_story`、`visual_poem`、`other` |
| `music_video` | `performance`、`narrative`、`concept`、`lyric`、`dance`、`other` |
| `commercial` | `ad`、`brand_film`、`app_promo`、`ugc_ad`、`other` |
| `social` | `skit`、`pov`、`meme`、`trend`、`day_in_the_life`、`storytime`、`tips`、`before_after`、`other` |
| `explainer` | `concept`、`tutorial`、`training`、`other` |
| `documentary` | `mini_doc`、`testimonial`、`event_recap`、`tribute`、`other` |
| `showcase` | `product`、`fashion`、`place`、`food`、`other` |
| `trailer` | `trailer`、`teaser`、`other` |
| `narrated_story` | `history`、`list`、`legend`、`other` |
| `undecided`、`other` | 无 |

### 2.3 `tones`（语气和类型片，同一轴）

类型片：`comedy`、`drama`、`horror`、`thriller`、`romance`、`action`、`sci_fi`、`fantasy`、`mystery`。
语气：`wholesome`、`inspirational`、`heartfelt`、`nostalgic`、`epic`、`calm`、`energetic`、`luxurious`、`playful`、`serious`、`satirical`、`dark`。
外加 `other`（需要 `labels.tone`）。最多 3 个，第一个是主语气。语气决定节奏、表演、音乐和结尾的写法；画面风格（色调、镜头、质感）归 `visualStyle`，不放在这里。

### 2.4 `format`

- `platform`：`tiktok`、`ig_reels`、`ig_stories`、`ig_feed`、`yt_shorts`、`youtube`、`facebook`、`linkedin`、`x`、`douyin`、`xiaohongshu`、`wechat_channels`、`bilibili`、`web`、`tv`、`cinema`、`presentation`、`other`。
- `aspect`：`9:16`、`16:9`、`1:1`、`4:5`、`21:9`、`other`（例如 3:4，写在 `labels.aspect`）。
- `lengthBand`：`up_to_6s`（bumper）、`up_to_15s`、`up_to_30s`、`up_to_60s`、`up_to_3min`、`up_to_10min`、`over_10min`。每档包含“大于上一档上限、不超过本档上限”的长度。
- `targetSeconds`：可选的具体秒数（1–3600）。同时给了档位就必须落在档位里；只给秒数时应用自动补档位。

平台默认画幅（`PLATFORM_DEFAULT_ASPECT`）：

| 平台 | 默认 `aspect` |
|---|---|
| `tiktok`、`ig_reels`、`ig_stories`、`yt_shorts`、`douyin`、`xiaohongshu`、`wechat_channels` | `9:16` |
| `ig_feed`、`facebook` | `4:5` |
| `linkedin` | `1:1` |
| `youtube`、`bilibili`、`web`、`tv`、`presentation`、`x` | `16:9` |
| `cinema` | `21:9` |
| `other` | 无（要问） |

### 2.5 `audience`、`source`、`basis`

- `audience`：`general`、`kids`（约 8 岁以下）、`teens`、`adults`、`professional`（B2B）、`internal`（员工）、`other`。
- `source`：`generated`（全部生成）、`own_media`（用人自己的照片、素材、录屏）、`mixed`。决定 documentary / testimonial / event recap 这类依赖真实素材的类型能否原样完成；Film 目前不能原样放入素材时，按 video-types 的规则把它记成缺口。
- `basis`（每个字段）：
  - `stated`：人在 brief 或附件里自己说了；
  - `asked`：人回答了开场问题；
  - `inferred`：Director 从信号推断，并在回复里用一行说明；
  - `default`：用了本文 §3 的默认值。
  只能给已经设置的字段写 basis；`kind: "undecided"` 的 basis 只能是 `default` 或不写。

## 3. 开场（intake）：什么必须问，什么可以默认

纯函数 `filmKindIntake(filmKind) → { ask: ("kind" | "aspect")[], defaults }`，7.0.0 的 `read_context` 在 `project.filmKindIntake` 里给出。

### 3.1 规划前必须定下

| 字段 | 为什么必须 | 什么情况算“已定” |
|---|---|---|
| `kind` | 决定结构、加载哪个 type 包、必拍镜头 | 不是 `undecided`、也不缺失。推断（`inferred`）也算已定，前提是信号清楚（见 video-types “Identify the type”）；信号不清就问 |
| `aspect` | 每张关键帧的构图都取决于它，后改要重出图 | 直接给了 `aspect`，或给了有默认画幅的 `platform` |

### 3.2 可以默认（用了默认就写 `basis: "default"`，在回复里用一行说明）

| 字段 | 默认 |
|---|---|
| `subtype` | 不设；按 brief 推断（`inferred`）。只有两个 subtype 结构差别大且都说得通时才问（例如 social 的 skit 和 POV） |
| `tones` | 不设；按 brief 推断 |
| `platform` | 不设（画幅已定时不需要） |
| `lengthBand` | `ig_stories` → `up_to_15s`；其他竖屏平台 → `up_to_30s`；否则按 kind：`commercial`、`social`、`showcase` → `up_to_30s`；`trailer` → `up_to_60s`；其余 → `up_to_3min`（MV 以歌曲长度为准） |
| `audience` | `general` |
| `source` | `generated`；有附件素材时推断 `mixed` |

### 3.3 一个简短的开场问题

只问 `ask` 里缺的字段，加上真正有歧义的 subtype；最多三问，一条消息里问完；每问 2–4 个选项，并写明“不回答就用默认”。等回答期间可以先存 `kind: "undecided"`（加上已知的平台、长度），UI 和路由据此显示“未定”。

中文：

> 开始之前确认两点（不回复我就按默认做）：
> 1. 想做哪种视频？A. 社媒短视频（段子 / POV / 日常）B. 广告或产品推广 C. 讲解或教程 D. 故事短片 —— 默认 A
> 2. 发在哪里、什么画幅？A. 抖音 / Reels / Shorts 竖屏 9:16 B. YouTube / B 站横屏 16:9 C. 朋友圈 / 小红书方形或 4:5 —— 默认 A
> 3. （只在不清楚时）大概多长？A. 15 秒内 B. 30 秒内 C. 1 分钟内 —— 默认 B

English:

> Two quick things before I start (I'll use the defaults if you skip them):
> 1. What are we making? A. A social short (skit / POV / day in the life) B. An ad or product promo C. An explainer or tutorial D. A short story film — default A
> 2. Where will it go, and which shape? A. TikTok / Reels / Shorts, vertical 9:16 B. YouTube, horizontal 16:9 C. Feed post, square or 4:5 — default A
> 3. (only if unclear) About how long? A. Up to 15 s B. Up to 30 s C. Up to 1 min — default B

选项按 brief 调整：brief 已经说“广告”就不问第 1 问；说了“发 IG”就只在 Reels 和 Feed 之间有歧义时才问第 2 问。

### 3.4 回答怎么存

- 用 `prepare_change` 的 `creative.project.filmKind` 写**整条记录**（不是局部合并）：先用 `read_context` 读当前记录，改动后整体写回。改 `filmKind` 本身没有媒体影响，直接应用并返回回执。
- 回答的字段写 `basis: "asked"`；人没回答而用了默认的写 `"default"`；从 brief 里读到的写 `"stated"`。
- `version` 可省略，应用写入 `film-kind@1`；只给 `targetSeconds` 时应用补 `lengthBand`。
- 应用校验：subtype 属于 kind；`other` 必须有 label、非 `other` 不能有 label；`targetSeconds` 落在档位里；basis 只描述已设置的字段。违反返回 `VALIDATION_ERROR`，什么都不保存。
- 改动 `filmKind` 会让 `intake` 阶段重新要求确认（`requiredStages` 用 digest 比较整条记录）。

## 4. 路由：`filmKindRouteKey`

```ts
filmKindRouteKey(filmKind) → { typePackage: string | null; formatPackages: string[]; toneTags: string[] }
```

- `typePackage`：按 `kind` 查下表；`null` 表示用 release 的 fallback（core + `craft-story` + `craft-shot-prompting` + `craft-visual-style`）。subtype 不改变包，只决定包内读哪个 reference（loader 直接读 `filmKind.subtype`）。
- `formatPackages`：`aspect` 是 `9:16` 时，或没有 `aspect` 但 `platform` 是竖屏优先平台时，加 `format-social-vertical`。`aspect` 优先于平台（TikTok 上发 1:1 不加）。
- `toneTags`：保存顺序的封闭 tone id，丢掉 `other`（自由文本不是路由输入）。loader 可把它们映射成 `when` 事实（例如以后的 `tone:comedy`）。
- 接受旧字符串（先规范化）；缺失或无法识别 → `{ typePackage: null, formatPackages: [], toneTags: [] }`。

| `kind` | `typePackage` | 优先级（沿用 skill-architecture） |
|---|---|---|
| `music_video` | `type-music-video` | P0 |
| `commercial` | `type-commercial` | P1 |
| `social` | `type-social`（**新增**） | P1 |
| `explainer` | `type-explainer` | P1 |
| `narrative` | `type-narrative` | P1 |
| `narrated_story` | `type-narrated-story` | P1 |
| `showcase` | `type-showcase` | P2 |
| `documentary` | `type-documentary` | P2 |
| `trailer` | `type-trailer` | P2 |
| `undecided`、`other` | `null`（fallback） | P0 |

`type-social` 的内容来源：social-vertical 草稿里“结构”的部分（钩子、单一笑点或反转、循环结尾）加上 skit / POV / meme / day in the life 等 subtype 的 reference；草稿里“格式”的部分（安全区、字幕、首帧钩子时间、画幅）留在 `format-social-vertical`。在 `type-social` 写出来之前，release 可以让它暂时落到 fallback + `format-social-vertical`，`filmKindRouteKey` 不用改。

## 5. 现有草稿和 type 包的映射

| 草稿文件（video-types / music-video） | `kind` | `subtype` | 其他轴 | type 包 |
|---|---|---|---|---|
| narrative-short.md | `narrative` | `short` | | `type-narrative` |
| kids-animated-story.md | `narrative` | `kids_story` | `audience: kids` | `type-narrative` |
| （候选）竖屏短剧 | `narrative` | `micro_drama` | `aspect: 9:16` | `type-narrative` + vertical |
| （候选）visual poem | `narrative` | `visual_poem` | | `type-narrative` |
| commercial-ad.md | `commercial` | `ad` | | `type-commercial` |
| brand-film.md | `commercial` | `brand_film` | | `type-commercial` |
| app-promo.md | `commercial` | `app_promo` | | `type-commercial` |
| （候选）UGC 广告 | `commercial` | `ugc_ad` | 通常 `aspect: 9:16` | `type-commercial` + vertical |
| product-showcase.md | `showcase` | `product` | | `type-showcase` |
| fashion-lookbook.md | `showcase` | `fashion` | | `type-showcase` |
| place-film.md | `showcase` | `place` | | `type-showcase` |
| explainer.md | `explainer` | `concept` | | `type-explainer` |
| tutorial.md | `explainer` | `tutorial` | | `type-explainer` |
| （HeyGen / Synthesia 类）培训、入职 | `explainer` | `training` | `audience: internal` | `type-explainer` |
| mini-doc.md | `documentary` | `mini_doc` | 常见 `source: own_media / mixed` | `type-documentary` |
| testimonial.md | `documentary` | `testimonial` | 同上 | `type-documentary` |
| event-recap.md | `documentary` | `event_recap` | 同上 | `type-documentary` |
| tribute.md | `documentary` | `tribute` | 同上 | `type-documentary` |
| trailer-teaser.md | `trailer` | `trailer` 或 `teaser` | | `type-trailer` |
| narrated-story.md | `narrated_story` | `history` / `list` / `legend` | | `type-narrated-story` |
| social-vertical.md（作主干） | `social` | 按内容 | `aspect: 9:16` | `type-social` + `format-social-vertical` |
| social-vertical.md（作修饰，例如 “TikTok 精华液广告”） | 主干的 kind（如 `commercial`） | 主干的 subtype | `platform: tiktok` | 主干包 + `format-social-vertical` |
| music-video.md（performance / narrative / concept 三种 mode、lyric video） | `music_video` | `performance` / `narrative` / `concept` / `lyric`（另加 `dance`） | | `type-music-video` |

plan-fields-spec.md 里的 `modeMix`、`performanceType` 等是 MV 内部的计划字段，不进 `filmKind`；`subtype` 只记录主导 mode。

## 6. 例子：老板要测的那句

> “a 20 s funny social video to post on IG, to make people laugh”

```json
{
  "version": "film-kind@1",
  "kind": "social", "subtype": "skit", "tones": ["comedy"],
  "format": { "platform": "ig_reels", "aspect": "9:16", "lengthBand": "up_to_30s", "targetSeconds": 20 },
  "audience": "general", "source": "generated",
  "basis": { "kind": "stated", "subtype": "inferred", "tones": "stated", "platform": "inferred", "aspect": "default",
             "lengthBand": "stated", "audience": "default", "source": "default" }
}
```

- “social video” → `kind: social`（stated）；“to make people laugh” 没有卖东西 → 不是 commercial。
- “funny” → `tones: ["comedy"]`（stated）；没说是 POV 还是梗图，短段子最通用 → `subtype: skit`（inferred，在回复里说一句，人可以改成 `pov` / `meme`）。
- “post on IG” + 视频 → `ig_reels`（inferred；IG 上的视频帖默认是 Reels）→ 默认画幅 `9:16`。
- “20 s” → `targetSeconds: 20`，档位 `up_to_30s`。
- `filmKindIntake` → `ask: []`，不用问，直接规划。
- `filmKindRouteKey` → `{ typePackage: "type-social", formatPackages: ["format-social-vertical"], toneTags: ["comedy"] }`。

对比：“帮我做个视频” → `kind: undecided`，`ask: ["kind", "aspect"]`，按 §3.3 问。“做个 TikTok 广告卖我们的精华液” → `commercial/ad`、`platform: tiktok`，`ask: []`，路由 `type-commercial` + `format-social-vertical`。

## 7. 旧值规范化

7.0.0 没有发布，但开发库里可能存了旧的扁平字符串。`Store.getProject` / `listProjects` 读取时调用 `normalizeStoredFilmKind`，在内存里换成结构化记录（`basis.kind: "inferred"`，因为旧值没记录是谁定的），存储体不改，下次保存时写成新形状。`parseChangeProposal`（应用侧兼容 schema）也接受旧字符串，以便已经挂起的 proposal 还能被接受；7.0.0 catalog 本身只接受结构化记录。

| 旧值 | 新记录 |
|---|---|
| `narrative_short` | `narrative/short` |
| `kids_animated_story` | `narrative/kids_story`，`audience: kids` |
| `commercial_ad` | `commercial/ad` |
| `brand_film` | `commercial/brand_film` |
| `app_promo` | `commercial/app_promo` |
| `product_showcase` | `showcase/product` |
| `fashion_lookbook` | `showcase/fashion` |
| `place_film` | `showcase/place` |
| `explainer` | `explainer/concept` |
| `tutorial` | `explainer/tutorial` |
| `mini_doc` / `testimonial` / `event_recap` / `tribute` | `documentary/<同名>` |
| `social_vertical` | `social`，`format.aspect: 9:16` |
| `trailer_teaser` | `trailer` |
| `narrated_story` | `narrated_story` |
| `music_video` | `music_video` |

## 8. 用到它的地方

- `packages/core/src/film-kind.ts`：枚举、`filmKindInputSchema`、`filmKindProblems` / `parseFilmKind`、`normalizeFilmKind` / `normalizeStoredFilmKind` / `decidedKind`、`filmKindIntake`、`filmKindRouteKey`、`lengthBandFor`、`PLATFORM_DEFAULT_ASPECT`、`FILM_KIND_TYPE_PACKAGES`。
- `packages/core/src/workflow/index.ts`：7.0.0 `creative.project.filmKind` 的 schema；`applyCreativePatch` 校验并保存；`requiredStages` 用 digest 比较。
- `apps/server/src/application/context-projection.ts`：7.0.0 的 `read_context` 在 `project` 里给出 `filmKind`（未设为 `null`）和 `filmKindIntake`；6.0.0 及更早不变。
- `apps/server/src/narration/music-video.ts`：`isMusicVideoProject` 读 `decidedKind(...) === "music_video"`；`undecided` 和缺失时才回退到文字识别（配乐默认规则因此跟着新形状走）。
- `apps/server/src/persistence/store.ts`：读取时规范化旧值。

## 9. 未决问题

1. `type-social` 是新包，需要 skill-arch 负责人确认并把 `routes.kinds` 的覆盖校验加上 `social`。
2. 是否要把 `toneTags` 变成 manifest 的 `when` 事实（`tone:comedy`），还是只作为 reference 选择的提示。建议先只作提示，等 eval 证明有用再加。
3. `aspect` 现在只是意图字段，渲染画幅还没有读它；关键帧生成接入画幅时，以 `filmKind.format.aspect` 为准。
4. 第 §3.3 的问题模板应该进入 `type`/core 的 `routing.md`（skills v8），并加入路由 eval 集（skill-architecture §10 的 100–150 条中英 brief，标注 kind、subtype、format 和“该不该问”）。

## 来源

- InVideo AI workflows：[help-ai.invideo.io](https://help-ai.invideo.io/how-can-i-generate-a-video-with-invideo-ai/)、[cohorte.co](https://cohorte.co/ai-articles/the-only-ai-video-tool-wed-actually-build-a-channel-around)、[primalvideo.com](https://primalvideo.com/?p=2102823)
- LTX Studio：[AI music video generator](https://ltx.studio/platform/ai-music-video-generator)、[AI video examples](https://ltx.studio/ai-video-examples)、[TechRadar review](https://www.techradar.com/pro/software-services/ltx-studio-ai-video-production-review)
- Higgsfield：[OpenAI customer story](https://openai.com/index/higgsfield)、[How to make AI UGC videos](https://higgsfield.ai/blog/how-to-make-ai-ugc-videos)、[novoads review（竞品，仅作旁证）](https://novoads.ai/blog/higgsfield-review)
- HeyGen / Synthesia：[HeyGen onboarding template](https://www.heygen.com/template/customizable-onboarding-video)、[HeyGen sales training template](https://www.heygen.com/template/create-sales-process-training-videos)、[Synthesia examples](https://www.synthesia.io/examples/employee-onboarding-video-antisel)
- CapCut：[Daily life templates](https://www.capcut.com/template/record/daily-life)、[POV trend templates](https://www.capcut.com/explore/pov-trend)、[Daily mini vlog](https://www.capcut.com/explore/daily-mini-vlog)
- Canva：[Video templates](https://www.canva.com/videos/templates/)、[Promo](https://www.canva.com/video-editor/templates/promo/)、[Inspirational](https://www.canva.com/video-editor/templates/inspirational/)
- Adobe Express：[Video templates](https://www.adobe.com/express/templates/video)、[Social video](https://www.adobe.com/express/create/video/social)
- Google Vids：[Workspace templates & themes](https://support.google.com/a/answer/13135006)、[Zapier on Google Vids](https://zapier.com/blog/google-vids/)
- Hedra / VEED：[Hedra uses](https://hedra.com/uses)、[VEED AI avatar](https://www.veed.io/tools/ai-avatar)
- OpusClip / Agent Opus：[AI Agent Index](https://theaiagentindex.com/agents/opus-clip)、[sacra.com](https://sacra.com/c/opusclip/)
- YouTube 分类：[YouTube Data API videoCategories](https://developers.google.com/youtube/v3/docs/videoCategories/list)、[mixedanalytics 列表](https://mixedanalytics.com/youtube-video-category-id-list/)
- YouTube 广告格式：[Google Ads: About video ad formats](https://support.google.com/adwords/answer/2383007?hl=en)、[QuickFrame YouTube specs 2026](https://quickframe.mountain.com/blog/youtube-video-ad-specs)
- 短视频长度与画幅：[TechCrunch: Instagram Reels length](https://techcrunch.com/?p=2182549)、[Social video specs 2026](https://blitzcutai.com/blog/social-video-specs-2026)、[Kontentino: Reels length](https://www.kontentino.com/q-and-a/how-long-can-instagram-reels-be/)
- 营销视频类型占比（Wyzowl 2026，转引自 skill-architecture §3.1）

调研限制：Kapwing、Runway、Pika 的模板分类没有找到可靠的一手页面；Instagram 时长上限各来源说法不一（90 s 到 3 min 以上，按账号分批开放），所以 `lengthBand` 只做档位默认，不写死平台上限。Higgsfield 预设数量来自第三方，未核实。
