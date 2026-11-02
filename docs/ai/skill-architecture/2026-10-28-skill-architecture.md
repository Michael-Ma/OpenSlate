# Director skill 架构：按影片类型拆分 + 共享技艺 skill（2026-10-28）

状态：只做调研和设计，没有改代码，也没有改 `skills/`。基线：`feature/last-ferry-ui` @ `56d154b`。来源见 [sources.md](sources.md)。

相关文档：[v8 计划](../v8-plan/2026-10-28-v8-plan.md)、[video-types 草稿](../skill-drafts/video-types/index.md)、[visual-styles 草稿](../skill-drafts/visual-styles/index.md)、[music-video 草稿](../skill-drafts/music-video/music-video.md)、[characters 草稿](../skill-drafts/characters/)、[音频与对口型](../music-video/audio-and-lipsync.md)、[角色与设定图](../characters/wardrobe-and-reference-sheets.md)、[能力缺口](../director-gaps/2026-10-28-director-capability-gaps.md)。

---

## 0. 结论

1. **从两个包改成一个“发布集”（release），按角色分成四类包**：
   - core：`production` 和 `plan-authoring`，保留原 id；
   - type：每类影片一个创意 skill，一共 8 个；
   - craft：各类型都能用的共享技艺 skill，一共 10 个；
   - format：格式修饰，例如 `format-social-vertical`。

   整个集合用一个 `release.json` 一起钉住版本，项目的 lock 记录的是这个集合。
2. **路由由服务端根据已保存的状态决定，模型不参与**：
   - 已保存的 `project.filmKind` 决定加载哪个 type 包；
   - type 包的 manifest 声明它依赖的共享包（`requires`），以及按条件加载的包（`optional`，条件是封闭枚举）；
   - 同一轮里刚定下的 `filmKind`，Director 用新工具 `read_guidance` 按需读取，下一轮由服务端自动路由。
3. **今天的 references 实际上不是 lazy 的**：`director-input.ts:41` 会把所有被激活包里声明的文件**全部**放进 context。v7 一共约 8.6k 词。四组草稿合计约 26k 词。如果照 v8 计划直接塞进 `production`，每轮大约要多 3.5 万词。所以不管选哪个方案，**都必须先有 `read_guidance`（真正的按需读取）**。这个工具要赶在 contract 7.0.0 冻结前加进去。
4. **Loader 和 lock 的数据结构已经支持多个包**：
   - `SkillCapabilityLock.skills[]` 最多 32 个，`activateSkills` 也能选子集；
   - 真正写死“两个包”的是服务端：`director-capabilities.ts:24-25`、`director-input.ts:35`、`director-shipped-guidance.ts:40,65`、`SHIPPED_DIRECTOR_GUIDANCE` 的行结构，以及 `audioRequests` 要求每个包的主版本号都 ≥5（`director-input.ts:32`）。

   改动集中在这些地方。lock 升到 `schemaVersion: 2`，`skills[]` 的结构保持不变，所以备份校验和旧 lock 的验证都不用改。
5. **v7 项目不受影响**：
   - schema 1 的 lock 照旧从不可变快照里验证，已经开始的 epoch 继续用原来的 lock；
   - v7 lock 仍然一次性注入全部文件，不走新路由；
   - 新的 v8 发布集只在“新的、符合条件的 native 轮次”里，作为后继 lock 追加进去，机制和 V4→V5 一样。
6. **故事/概念开发**（`craft-story`）和**风格 prompt**（`craft-style-prompting`）是两个一等的共享 skill。type skill 不复制它们的内容，只写自己的“专门化表”，例如广告的故事 = 单一主张 + 证明，MV 的故事 = 规则 + 递进。

---

## 1. 现状（代码事实）

| 事实 | 位置 | 对新设计的影响 |
|---|---|---|
| manifest 只允许 6 个固定字段（`id, version, entry, files, compatibility, requiredToolIds`），多一个字段就报错 | `packages/director/src/skills/index.ts:129-135` | 要加 `role`、`requires`、`routes`，需要 manifest `schemaVersion: 2`；旧 manifest 没有 schemaVersion 字段，按 v1 处理 |
| 同一个 catalog 里所有包的 `compatibility` 必须完全相等，`requiredToolIds` 必须都能用 | `index.ts:136-140, 284-309` | 一个发布集只能对应一个 tool contract，这正合适 |
| lock 已经是 `skills[]`（≤32）、`prompts[]`（≤128）、`bindings[]`，`lockDigest = digest(body)` | `index.ts:34-38, 311-333` | 多个包在数据结构上已经支持 |
| activation 用 `selectedSkillIds` 从 lock 里选子集；只有选中的包才能读文件 | `index.ts:355-382` | 想按需读没选中的包，需要 activation v2 |
| 服务端只加载 `production` 和 `plan-authoring` 两个根目录，并全部选中；stage prompt 的 id 是 `production/<stage>@1` | `apps/server/src/application/director-capabilities.ts:22-26` | core 保留 `production` 这个 id，stage prompt id 和 `STAGE_CONTRACTS_DIGEST` 就都不用动 |
| 每轮固定选这两个包，然后把**所有声明的文件**通过 mediated read 读进 context | `apps/server/src/application/director-input.ts:35-42` | 今天没有 lazy；多包以后必须改 |
| 一个 epoch 只捕获一次 activation（“An epoch can never select again”） | `apps/server/src/application/director-context.ts:70` | 同一轮里 filmKind 变了，只能靠 `read_guidance` |
| “当前是否已是最新发布版本”的判断写死了 `lock.skills.length === 2` 和两个 digest 列 | `apps/server/src/application/director-shipped-guidance.ts:19-45, 65` | 新行改成以 releaseDigest 为键；旧行保留不动 |
| `audioRequests` 要求每个包的主版本号都 ≥5 | `director-input.ts:32` | **所有 v8 包的主版本号都必须是 8**，不能有 `craft-story@1.0.0` 这种版本 |
| fresh-turn 自动后继目前只处理 6.0.0 内部的修订 | `director-tools-upgrade.ts`（`currentForFreshTurn`） | 6.0.0→7.0.0 / v7→v8 要扩展这条路径 |
| Codex native：激活的包作为 `{type:"skill",name,path}` 输入项传进去；运行时检查 native 看到的 skill 列表必须和固定输入完全一致；setup 默认把其他 skill 都设成 `enabled:false` | `packages/director/src/runtime/codex.ts:215, 298-301, 337-340`、`setup.ts:249` | 只启用路由选中的包；其余包只通过 `read_guidance` 读，不进 native 发现 |
| 备份校验会检查每个 lock 里 `skills[].packageDigest` 对应的快照是否存在，以及 activation 里 `skills[].entryPath` 的哈希 | `apps/server/src/persistence/installation-backup-closure.ts:555-560` | v2 必须保留 `skills[]` 的结构；20 个包都要有快照 |
| 草稿规模（词数，不含 sources）：video-types 12.2k、music-video 7.1k、visual-styles 6.1k、characters 1.0k；v7 两个包合计 8.6k | `wc -w` | 平均每个类型实际只用到 3–6k 词，所以必须按需加载 |

---

## 2. 调研：成熟的 skill 库是怎么组织的

### 2.1 各家做法

| 来源 | 要点 | 对 OpenSlate 的启示 |
|---|---|---|
| Agent Skills 开放规范（agentskills.io） | 一个 skill 就是一个目录，里面的 `SKILL.md` 带 `name`/`description` frontmatter，可选 `references/ scripts/ assets/`；可选 `compatibility`、`metadata`、实验性的 `allowed-tools`。三层渐进披露：启动时只加载 metadata（约 100 token），激活后加载正文（建议 < 5000 token、< 500 行），资源按需加载。引用只走一层，不要嵌套 | 我们的 `SKILL.md` + `references/` 已经符合。entry 要短，references 要按主题拆开、文件小 |
| Anthropic best practices | 简洁是第一原则（context 是“公共品”）；按脆弱程度决定给模型多少自由；description 用第三人称，写清“做什么 + 什么时候用”；超过 100 行的 reference 开头放目录；按领域组织（`reference/finance.md`…），互斥的内容放在不同文件；**先写 eval 再写正文**；用不同模型测试 | 共享技艺可以给较高自由度，权限和工具规则给低自由度。每个 type 包都要有 eval（见 §10） |
| Anthropic Engineering（2025-10-16） | 渐进披露是核心设计原则；多个 skill 并存、各自选择加载；互斥的上下文分文件 | 和“type 包 + 共享包”的拆法一致 |
| Claude API Skills | 一个请求最多 20 个 skill；可以写 `latest`，也可以钉具体版本，官方建议生产环境钉版本；多个 skill “compose together” | 我们本来就钉 digest，比 `latest` 更严格。20 这个数量级的包是可行的 |
| Claude Code skills | `description` + `when_to_use` 截断到 1,536 字符；正文加载后一直留在 context；有 `disable-model-invocation`、`paths` 这类显式和条件触发的开关；skill 之间**没有**依赖声明；plugin 才有 `dependencies`（semver 区间，取交集后选最高版本） | 依赖解析可以借鉴 plugin 的做法，但我们的发布集整体钉死，不需要在运行时解析区间 |
| OpenAI Codex skills | 发现范围有 REPO/USER/ADMIN/SYSTEM 四层；隐式调用靠 description 匹配，显式调用用 `$skill`；skill 列表默认只占 context 的 2%（或 8000 字符），超出时先截短 description；`agents/openai.yaml` 里有 `policy.allow_implicit_invocation` 和 `dependencies.tools`（声明 MCP 依赖）；文档没有讲版本 | 我们的 runtime 走的是**显式输入项**，不依赖隐式匹配，这样更可控。`dependencies.tools` 和我们的 `requiredToolIds` 是同一个意思 |
| LangChain Deep Agents | 由 middleware 扫描 skill 目录，把 name/description 注入 system prompt，正文按需读 | 也是“元数据先给、正文按需读”，由应用层而不是模型来托管 |
| RAG-MCP（arXiv 2505.03275） | 工具一多，选择准确率就下降；先检索候选再交给模型，prompt token 减少一半以上，准确率从 13.6% 提到 43.1% | 路由交给确定性的服务端（相当于“检索”），模型只在小集合里选，避免把 20 个包全塞给模型 |

### 2.2 四个设计问题的结论

- **路由**：业界有三种做法：靠 description 隐式匹配（Codex/Claude）、显式调用（`$skill` 或 API 列表）、检索（RAG-MCP）。OpenSlate 有 `filmKind` 这个**已保存的结构化事实**，用它做确定性路由最可审计，activation 里也能记下原因。隐式匹配只作为补充：模型在 `read_guidance` 里自己挑 reference。
- **组合**：业界普遍没有 skill 级别的依赖，组合靠模型“同时加载”。我们的权限边界严格，需要**声明式依赖**，在发布时校验成闭包、不能有环，在运行时由服务端展开。优先级：core 的权限和工具规则 > type > craft > format。craft 包里不能写权限规则（§6.0 的 lint）。
- **控制 context 大小**：entry 短、references 小、按需读，这几点各家一致。我们额外设一个每轮注入预算（§7）。
- **版本**：各家要么用 `latest`，要么钉版本号。我们继续钉 digest，增加一层“发布集版本”。单个包可以独立升 minor，但主版本号必须等于发布集的主版本号（受 `audioRequests` 那条检查约束）。

---

## 3. 视频分类：验证与调整

### 3.1 结论

[video-types/index.md](../skill-drafts/video-types/index.md) 的做法是“目标 + 主体选 spine，目的地决定格式，一个 spine 加若干修饰”，这个思路是对的，保留。18 个类型文件作为**内容单元**也保留，但**不做 18 个包**。按“结构相似、必拍镜头相似、风险相似”归成 8 个 type skill、1 个格式修饰，每个 type skill 内部用 `subtype` 选 reference。

外部数据（Wyzowl 2026，营销团队最常做的视频）：社媒 69%、解说 68%、证言 57%、演示/广告各 48%、预告 45%、产品演示 39%。也就是说，解说和广告最常见。但证言类依赖真人、真实素材，用生成画面风险最高，所以优先级要往后放。

### 3.2 type skill 与 filmKind 的映射

| type 包 | `filmKind.kind` | `subtype`（对应草稿文件） | 为什么合并 | 优先级 |
|---|---|---|---|---|
| `type-music-video` | `music_video` | `performance` / `narrative` / `concept` / `lyric`（对应 music-video.md 里的三种 mode 和 lyric video） | 歌曲就是时间线；需要专门的工具和对口型 | **P0**（v8 主线） |
| `type-commercial` | `commercial` | `ad`（commercial-ad）、`brand_film`、`app_promo` | 都是“说服”：单一主张 + 证明 + 结尾 | P1 |
| `type-explainer` | `explainer` | `concept`（explainer）、`tutorial` | 都要让观众“懂”或“会”，旁白主导，节奏服从清晰度 | P1 |
| `type-narrative` | `narrative` | `short`（narrative-short）、`kids`（kids-animated-story），以后加 `micro_drama` | 角色、因果、结局；kids 只是受众修饰 | P1 |
| `type-narrated-story` | `narrated_story` | `history` / `list` / `legend`（narrated-story） | 声音带画面，最接近现有的 `narrated-video@1` recipe | P1 |
| `type-showcase` | `showcase` | `product`（product-showcase）、`fashion`（fashion-lookbook）、`place`（place-film） | 都是“把一个真实主体拍好看”：hero、细节、环境；核心风险都是忠实还原主体 | P2 |
| `type-documentary` | `documentary` | `mini_doc`、`testimonial`、`event_recap`、`tribute` | 都依赖真实人物、事件和用户提供的素材，伦理风险相同；Film 目前不能原样放入素材 | P2 |
| `type-trailer` | `trailer` | `trailer`、`teaser`（trailer-teaser） | 结构独特：只暗示不揭晓、节奏递进、标题卡 | P2 |
| `format-social-vertical`（format 包，也能当 spine） | 修饰：`modifiers: ["social_vertical"]`；当 spine 用时 `kind: "social_post"` | social-vertical | 草稿本身就说它“通常是修饰” | P1 |
| （无 type 包） | 未设置，或 `kind: "general"` | — | 回退：core + `craft-story` + `craft-shot-prompting` + `craft-visual-style`，行为等于 v7 加上风格能力 | P0 |

调整：

- **把 `filmKind` 从 `"film" | "music_video"`（audio-and-lipsync §5.3）扩成结构化字段**：

  ```ts
  interface FilmKind {
    kind: "general" | "music_video" | "commercial" | "explainer" | "narrative" | "narrated_story" | "showcase" | "documentary" | "trailer" | "social_post";
    subtype?: string;                 // 来自 type 包声明的封闭列表
    modifiers: ("social_vertical")[];  // 以后可加 "cutdowns"
    audience?: "general" | "kids";
    source: "stated" | "inferred";     // 人明说的，还是 Director 推断的
  }
  ```

  `isMusicVideoProject` 先读这个字段，读不到时才回退到文字识别。这个字段需要写进 7.0.0 的 core 契约，是需要和 7.0.0 负责人协调的点。
- **新增候选类型**（暂不建包，放进研究清单）：
  - `micro_drama`：竖屏短剧，中文市场的重要格式，作为 `type-narrative` 的 subtype；
  - `visual_poem`：艺术短片，可能归入 MV 的 concept mode，或 narrative；
  - UGC 风格广告：commercial + social，但需要逼真的“真人”，风险高。
- **cut-downs（多尺寸、多长度交付）**不单独成包。规则放在 core 的 `shared-planning.md` 里（草稿 Hybrids 一节已经写了）。

---

## 4. 目标包布局

```text
skills/v8/
├── release.json                         # 发布集：包列表、各包 digest、core 集合、路由表、注入预算（不可变，钉 digest）
├── production/                          # role: core（保留 id，stage prompt id 不变）
│   ├── SKILL.md                         # 权限、工具、回复风格、stage 表、guidance 目录（所有包的 name + 一句话）
│   └── references/
│       ├── current-contract.md          # 7.0.0 契约（必读，注入）
│       ├── notes.md                     # 笔记与人类决定（必读，注入）
│       ├── keyframes.md  narration.md  audio-proposals.md
│       ├── routing.md                   # 类型识别：信号、映射、同义词、何时提问（来自 video-types/index.md）
│       ├── shared-planning.md           # 镜头预算、屏幕文字、提供的素材、生成风险、cut-downs（来自 index.md 的共享规则）
│       ├── edits.md                     # move/delete/undo/use_take/export 这类新工具的用法（来自 director-gaps）
│       └── stages/{intake,story,scene_plan,shot_plan,narration,storyboard,video,assembly,review}.md
├── plan-authoring/                      # role: core（只管 timeline/render source）
│
├── craft-story/                         # 故事与概念开发（一等共享）
├── craft-visual-style/                  # 选择和维持风格：风格库、推荐短名单、plan 字段、场景变化、风格漂移
├── craft-style-prompting/               # 把风格写成关键帧和运动 prompt（一等共享）；按风格家族分文件
├── craft-shot-prompting/                # 镜头内容的 prompt 结构：keyframe.md、motion.md、clip-windows.md
├── craft-characters/                    # 身份、按场景服装、设定图
├── craft-continuity-review/             # 连续性检查、看图评审、重做建议
├── craft-narration/                     # 旁白写作、字数预算、声音选择、画外音与出镜
├── craft-music-timing/                  # 音乐分析结果怎么用、段落映射、按拍切、配乐设置
├── craft-performance/                   # 唱歌与对口型、舞蹈、乐器、乐队（来自 MV 草稿）
│
├── type-music-video/
├── type-commercial/                     # references/{ad,brand-film,app-promo}.md
├── type-explainer/                      # references/{explainer,tutorial}.md
├── type-narrative/                      # references/{narrative-short,kids}.md
├── type-narrated-story/
├── type-showcase/                       # references/{product,fashion,place}.md
├── type-documentary/                    # references/{mini-doc,testimonial,event-recap,tribute}.md
├── type-trailer/
└── format-social-vertical/
```

一共 20 个包，不超过 `SKILL_LIMITS.packages = 32`。每个包里的文件数远低于 64。包 id 符合 `ID` 正则（小写加连字符，不能有 `/` 或 `:`），所以用 `type-`、`craft-`、`format-` 前缀来表示角色。

### 4.1 manifest v2

```json
{
  "schemaVersion": 2,
  "id": "type-music-video",
  "version": "8.0.0",
  "role": "type",
  "entry": "SKILL.md",
  "files": ["SKILL.md", "references/section-map.md", "references/ratio-and-intercut.md", "references/escalation.md", "references/intake.md", "references/plan-fields.md"],
  "compatibility": { "toolContract": "7.0.0", "planLanguage": "1.0.0", "workflowContract": "1.0.0" },
  "requiredToolIds": ["read_guidance", "analyze_music", "set_soundtrack"],
  "routes": { "kinds": ["music_video"], "subtypes": ["performance", "narrative", "concept", "lyric"] },
  "requires": ["craft-story", "craft-music-timing", "craft-performance", "craft-visual-style", "craft-style-prompting", "craft-shot-prompting"],
  "optional": [
    { "id": "craft-characters", "when": "has_characters" },
    { "id": "craft-narration", "when": "narration_planned" }
  ]
}
```

规则：

- `role` 取 `core | type | craft | format`。只有 type 和 format 包可以有 `routes`。
- craft 包只能 `requires` 其他 craft 包。type 包可以 requires craft 和 format 包。依赖必须是 DAG，深度不超过 2，不允许依赖 type 包。
- `requires` 和 `optional` 只写 id，不写版本区间。版本由 `release.json` 钉住，同一个发布集里只有一个版本，用不着运行时解析区间（plugin 的 semver 区间是为“各自独立发布”的场景设计的，我们没有这个场景）。
- `when` 是封闭枚举，由服务端根据已保存的事实计算：
  - `has_characters`
  - `has_soundtrack`
  - `narration_planned`
  - `has_visual_style`
  - `modifier:social_vertical`
  - `audience:kids`
  - `stage:<stageId>`

  不允许写表达式。
- manifest 也在 packageDigest 范围内，所以路由数据是被钉住的。

### 4.2 release.json

```json
{
  "schemaVersion": 1,
  "release": "8.0.0",
  "toolContract": "7.0.0",
  "core": ["production", "plan-authoring"],
  "packages": [{ "id": "production", "version": "8.0.0", "packageDigest": "…" }, { "id": "craft-story", "version": "8.0.0", "packageDigest": "…" }],
  "fallback": { "kind": "general", "inject": ["craft-story", "craft-shot-prompting", "craft-visual-style"] },
  "budget": { "injectedWords": 10000, "entryWords": { "core": 1600, "type": 1100, "craft": 600, "format": 700 }, "referenceWords": 2500 }
}
```

发布时要校验：

- 每个包的 digest 都匹配；
- `routes.kinds` 在所有 type/format 包之间不重复，且覆盖 `FilmKind.kind`；
- 依赖闭包完整；
- 预算不超（用一个 CI 测试，不放在运行时）。

`releaseDigest = digest(canonical(release.json))`。

---

## 5. 路由

### 5.1 规则（5 行）

1. 服务端读取已保存的 `project.filmKind`（没有的话就是 `general`），只选中 core。
2. 选中的集合 = core ∪ `routes` 匹配 kind（和 subtype）的 type 包 ∪ `modifiers` 对应的 format 包。kind 为 `general`、或者没有匹配的 type 包时，改为加上 `release.fallback.inject`。
3. 再加上这些包 `requires` 的闭包，以及 `optional` 里 `when` 为真的包。结果确定、有序，原因记进 activation。
4. 只注入选中包的 `SKILL.md`，以及 core 的两份必读 reference。其余文件（包括没选中的包）由 Director 用 `read_guidance` 按需读取，每次读取都留 `skill_read` 记录。
5. intake 时由 Director 按 `routing.md` 判断类型，把 `filmKind` 写进计划，并在 brief 里写一行说明。同一轮里用 `read_guidance` 读新类型的包；下一轮由服务端自动路由；人可以随时改。

### 5.2 细节

- **intake 怎么写 `filmKind`**：
  - 改 `filmKind` 本身不产生媒体影响，按“无媒体影响的纯文本”处理，用 `prepare_change` 直接应用，带回执；
  - 但如果同时改了已有媒体镜头的 prompt，就走 proposal。
  - 人明确说了类型，记 `source: "stated"`；Director 推断的，记 `"inferred"`，在回复里用一行说明，方便人纠正。
- **混合类型**：只选一个 spine（草稿规则：“成功的衡量标准是哪个”）。借用其他类型的段落时，用 `read_guidance` 读对方的某个 reference，不改 `filmKind`。
- **跑题保护**：
  - `read_guidance` 只能读 lock 里有的包；
  - 每轮读取有上限，建议 24 次、总计 120k 字符，超限会被拒绝；
  - 读到的内容就是 lock 快照的字节，模型不能指定路径之外的东西。
- **v7 lock 不走新路由**：schema 1 的 lock 继续按 `["production","plan-authoring"]` 加全部文件的方式运行。
- **原因记录示例**：

  ```json
  {
    "routing": {
      "ruleVersion": 1,
      "inputs": { "kind": "music_video", "subtype": "performance", "modifiers": ["social_vertical"], "facts": ["has_characters"] },
      "selected": ["production", "plan-authoring", "type-music-video", "format-social-vertical", "craft-story", "craft-music-timing", "craft-performance", "craft-visual-style", "craft-style-prompting", "craft-shot-prompting", "craft-characters"],
      "reasons": { "type-music-video": "route:music_video", "craft-characters": "when:has_characters", "craft-story": "requires:type-music-video" }
    }
  }
  ```

---

## 6. 每个 skill 里写什么

### 6.0 所有包的写法约束

- **entry 只放“决策和流程”**，细节放 references；超过 100 行的 reference 开头加目录。
- **权限只在 core 里写**：
  - craft、type、format 包里禁止出现“可以开始付费工作”“可以接受”这类授权语句；
  - 涉及工具时只写“用 `X` 做 Y，具体权限见 core”；
  - 加一个 lint 测试：非 core 包里不能出现 `regenerate: true`、`accept_proposal` 这类调用说明。
- **不在多个包里重复规则**。例如“屏幕文字不靠生成像素”只写在 core 的 `shared-planning.md`，type 包只引用。草稿里每个 type 文件都有 Generation caveats 和 Narration 小节，这些要拆开：类型特有的留在 type 包，通用的归入 core 或 craft。
- **type 包的固定结构**（沿用草稿的小节）：Purpose、Format、Structure、Scenes and shots、Pacing、Must-have shots、What matters most、Narration/text/music、Common mistakes、Generation caveats、Intake questions，外加两节：
  - **Story 专门化**：本类型的故事单位、框架和产出格式，对应 `craft-story`；
  - **Style 倾向**：推荐哪些风格、避开哪些，对应 `craft-visual-style`。

### 6.1 core 与 craft 包

| 包 | 内容 | 来自 | 还缺什么 |
|---|---|---|---|
| `production`（core） | v7 的 SKILL.md 和 contract、notes、keyframes、narration、audio-proposals、stages；新增 `routing.md`、`shared-planning.md`、`edits.md`；entry 里列出 guidance 目录 | v7、video-types/index.md、director-gaps §1.2 | 7.0.0 的工具名和拒绝码；`read_guidance` 用法；确认卡片（删除、用旧 take） |
| `plan-authoring`（core） | 不变，只升版本并加 `read_guidance` | v7 | — |
| `craft-story` | 见 §6.3 | story.md、各 type 的 Structure 节、MV 的 mode 和递进 | 见 §10.2 |
| `craft-visual-style` | 风格库索引；推荐 2–3 个（稳妥 / 有区别 / 可选大胆）；`project.visualStyle` 字段；场景变化轴；风格漂移评审；每个风格的 Traits、Suits、Failure modes | visual-styles/index.md、current-house-style.md 和各家族文件的选择相关部分 | 7.0.0 的 `visualStyle` 写法；“没说就默认 `grounded-realism`”的措辞（v8 决定 7） |
| `craft-style-prompting` | 见 §6.4；按家族分文件：`realism.md`、`film-and-period.md`、`stylized-live-action.md`、`2d-illustrated.md`、`3d-and-tactile.md`、`motion-graphics.md`，每个风格写 Image template、Negatives、Motion、Consistency | visual-styles 各家族文件的 prompt 相关部分 | 每个风格在 Codex image 和 H3 上的实测 |
| `craft-shot-prompting` | `keyframe.md`：关键帧 prompt 的结构（主体、动作、构图、本镜头的光，不写全片风格）；`motion.md`：一个动作 + 一个机位运动，写清速度、方向和结束状态，用正面措辞；`clip-windows.md`：一个 6 s 片段能用几刀 | index.md 的 Motion prompts 节、MV 的节奏节、storyboard 和 shot_plan stage | H3 能否稳定执行“结束状态”；片段裁切在 Film 里是否可用 |
| `craft-characters` | 身份写法；按场景服装；不要把服装复制进 imagePrompt；设定图何时提供、批准只能由人做、关键帧过期怎么说明、报价 | characters 两份草稿、wardrobe-and-reference-sheets §4 | 7.0.0 的角色工具名；3:2 设定图（`codex-image-turn-v2`） |
| `craft-continuity-review` | 连续性检查顺序：先对风格锚点，再对角色，再对相邻镜头；看图评审只基于附带的画面；说清漂移的具体表现；只提供重做选项，不自己重做 | continuity-review.md、review stage、visual-styles 的“变化”节、characters 的连续性节 | 视频片段（不只是关键帧）的评审方法 |
| `craft-narration` | 字数预算（成人约 2.5 词/秒，儿童或教学约 2 词/秒）；旁白和画面要说不同的事；配音选择；有媒体时改旁白要走 proposal | v7 narration.md、index.md 的 Narration 节 | 中文的字数预算（字/秒）；`set_narrator_voice` 和 `fit_narration`（缺口 N2、P15） |
| `craft-music-timing` | 怎么读 `analyze_music` 的结果（tempo、拍点、段落、歌词）；段落→场景映射；速度→镜头时长表；`set_soundtrack` 的默认规则（MV 0 dB，其他 −18 dB；人选过“不要音乐”就先问） | music-video.md 的节奏和段落节、plan-fields-spec、audio-and-lipsync §3、§5.1 | 增强 analyzer（STRATA / All-In-One）的段落标签准确率 |
| `craft-performance` | `singing.md`、`dance.md`、`instruments.md`、`band.md`（原样从 MV 草稿迁过来）；`performance: "singing"` 字段 | music-video/performance-*.md | H3 Max lip-sync 的 A/B 结果；大动作镜头的判断标准 |

### 6.2 type 包（内容来自同名草稿，下面只列迁移重点和缺口）

| 包 | 迁移重点 | 缺口 |
|---|---|---|
| `type-music-video` | 三种 mode 和比例表；段落→场景；穿插剪辑；副歌递进；intake 六问；规划清单。性能指南移到 `craft-performance`，节奏表移到 `craft-music-timing`，这里只留“MV 怎么用它们” | 歌词视频的字幕要在后期加（Film 还不支持叠字）；艺人肖像授权的提问 |
| `type-commercial` | 草稿里 commercial-ad、brand-film、app-promo 三个文件分别成为 `subtype` 的 reference；共同的“主张 + 证明 + 结尾”放进 entry | CTA 结尾卡片在不能叠字时怎么做；广告声明的合规（生成画面不能当效果证据）；app 屏幕录像不能原样放入 |
| `type-explainer` | explainer、tutorial；“观众会不会自己动手”是区分标准 | 图解、信息图类画面的可靠性；步骤正确性（手部动作） |
| `type-narrative` | narrative-short、kids；kids 的节奏和安全规则 | 无对口型时怎么处理对白；10–30 个镜头的角色一致性；竖屏短剧结构 |
| `type-narrated-story` | narrated-story；声音主导，画面作证据 | 平台对“重复、批量生产内容”的变现政策；保持观看的结构 |
| `type-showcase` | product、fashion、place；“忠实于主体”的规则放进 entry | 材质（布料、反光）表现；房产展示失实的风险 |
| `type-documentary` | mini-doc、testimonial、event-recap、tribute；“真实素材优先、不伪造真人和事件”放在 entry 开头 | Film 原样放入素材的支持；合成重演的标注 |
| `type-trailer` | trailer-teaser；只暗示、节奏递进、标题卡 | 不能叠字时的标题卡；音乐铺底 |
| `format-social-vertical` | 安全区、钩子时间、字幕需求、循环；当 spine 时适用的原生帖子模式 | 各平台 2026 年的安全区和 AI 标注要求 |

### 6.3 一等共享 skill：`craft-story`（故事与概念开发）

**目标**：从 brief 里找到“核心”（一句话加一个画面），再把它展开成 beats，并且对非叙事类型同样适用。今天的 `stages/story.md` 只有 126 词，没有方法。current-house-style.md 也指出，“recurring visual idea”没有任何结构，模型只能自己编。

**entry 流程**（检查清单格式，可以直接照做）：

1. **先列已知条件**：目标、主体、受众、时长、必须出现的事实和素材、已经定下的决定。从 brief、附件和项目里推断，不重复提问。
2. **写出核心**：观众看完应该记住的**一句话**，以及能代表这句话的**一个画面**（core image）。
   - 广告里，这句话叫单一主张（single-minded proposition）；
   - 叙事片里叫主题或 controlling idea；
   - MV 里叫规则（rule）。
3. **发散**：brief 比较开放时，给出 2–3 个方向不同的概念，例如字面的、隐喻的、从角色出发的、从形式出发的。每个写一句 logline（who / what / where）、一个核心画面、一个风险。用 `record_notes` 给人做选择。brief 已经很具体时跳过这一步。
4. **收敛**：用这几条标准筛选：
   - 时长装得下吗（镜头预算）；
   - 生成风险高吗（手、文字、真人、长动作）；
   - 现有素材能支撑吗；
   - 有没有能反复出现的母题（motif）。
5. **写结构**：从下面的框架表里选本类型的框架，把 beats 写进 `story`，每个 beat 写清它的工作（对应场景的 `purpose`）。
6. **角色弧**（有角色时）：
   - 写出想要（want）和需要（need）；
   - 用开头和结尾两个**镜像画面**展示角色的变化；
   - 短片里只放一个变化。
7. **自查清单**：
   - 一句话能说清吗？
   - 核心画面在第几个镜头？
   - 每个 beat 都有可见的动作吗？
   - 去掉旁白，画面还讲得通吗？
   - 有没有编造产品功能或事实？

**框架参考**（放进 `references/frameworks.md`，每个框架附一个 30–60 s 的示例）：

| 框架 | 用在哪里 | 形式 |
|---|---|---|
| Story Spine（Kenn Adams） | narrative、kids、tribute | Once upon a time / Every day / Until one day / Because of that ×n / Until finally / Ever since then |
| ABT（Randy Olson） | explainer、brand film、mini-doc、narrated story | And（背景）/ But（问题）/ Therefore（解决） |
| 单一主张 + 证明 | commercial、showcase | 一个主张、2–3 个证明画面、一个结尾动作 |
| Hook → 承诺 → 正文 → 兑现 → 循环 | social、trailer | 0–2 s 钩子；结尾能接回开头 |
| 规则 + 变化 + 递进 | MV 的 concept mode、visual poem | 一个视觉规则，每段副歌变一个维度 |
| 起承转合（Kishōtenketsu） | kids、brand、tribute（不需要冲突的结构） | 起 / 承 / 转（意外的并置）/ 合 |
| Logline + treatment | MV、trailer | who / what / where 一句话，加 150–300 词的 treatment |
| 列表 / 倒数 | narrated story（top-N） | 由弱到强，最后一项回扣开头 |

**type 包怎么专门化**：type 包只写一张小表，不复制方法。

| type | 故事单位 | 核心叫什么 | 首选框架 | 不要做的事 |
|---|---|---|---|---|
| music-video | 歌曲段落 | 规则 / 意象 | mode 比例 + 递进；narrative mode 用 Story Spine 的残片 | 把歌词逐句画成插图 |
| commercial | 主张和证明 | 单一主张 | SMP + PAS / 问题→解决 | 两个主张；编造效果 |
| explainer | 概念步骤 | 一句话解释 | ABT | 旁白和画面说同一件事 |
| narrative | 场景（因果） | 主题 | Story Spine、三幕微结构 | 60 s 里放两个转折 |
| narrated-story | 段落 / 条目 | 问题或谜题 | ABT、列表 | 画面只是装饰 |
| showcase | 主体的面（整体→细节→环境） | 一个感受词 | hero → detail → context → hero | 叙事过多，盖过主体 |
| documentary | 真实人物的声音 | 真实的一句话 | ABT、起承转合 | 合成“证词” |
| trailer | 递进的暗示 | 悬念 | hook → 升级 → 标题 | 剧透结局 |

### 6.4 一等共享 skill：`craft-style-prompting`（风格 prompt）

**和 `craft-visual-style` 的分工**：

- `craft-visual-style` 负责**选择和维持**风格：推荐短名单、存进 plan、场景变化、评审漂移；
- `craft-style-prompting` 负责**把风格写成文字**：生成 `imageBlock`（≤60 词）和 `motionBlock`（≤20 词），给出每种风格的镜头 prompt 示例。

应用在编译阶段把两者拼起来：

```text
image prompt = 镜头内容 + 场景变化 + imageBlock + negatives
video prompt = 镜头动作 + 机位运动 + motionBlock
```

镜头 prompt 里不重复写全片风格（visual-styles/index.md 的方案）。

**entry 规则**（来自草稿和各家 prompt 指南）：

- **look 由关键帧承担**：image-to-video 模型从首帧拿画面风格。Runway、Kling 的官方指南都说 i2v 的 prompt 只写运动；场景描述和首帧差得太多，会导致跳切。所以 motion prompt 先写主体动作，再写机位运动和速度，最后最多加一句风格提醒（介质 + 帧率感）。
- **每个 prompt 最多 2–3 个风格词**：互相冲突的词（比如 photoreal + cel-shaded）会被平均成一团糊。
- **用正面措辞**：视频模型大多不理会否定。写“camera holds still”，不写“no camera movement”。只有支持 negative 字段的图像模型才保留否定列表。
- **一个 6 s 片段只放一个机位运动、一个主体动作**。有些 Hailuo Director 模型支持方括号命令和多个运动，但 H3 是否支持要实测；在实测之前，统一按“一个运动”写。
- **不写人名、工作室名或作品名**，翻译成特征来描述（palette、light、lens/medium、texture、composition、production design）。
- **语言**：prompt 用项目的工作语言写，技术词（35mm、f/2、12 fps、cel-shaded）可以保留英文。中英文 prompt 哪个效果更好，需要实测。

**每个家族文件的模板**：

```markdown
## <styleId>
- Image template：介质/镜头 + 光 + 调色 + 质感 + 构图（≤60 词，变量用 {subject} {action} {setting}）
- Motion：帧率感、运动幅度、允许的机位语法（例如定格动画：locked-off、逐格；anime：一拍二、停顿帧；纪录手持：轻微抖动）
- Negatives（正面写法）
- Consistency：哪些词每个镜头都不能变；锚点图怎么用
- 3 组示例：镜头内容 → 编译后的关键帧 prompt → motion prompt
- Model notes：Codex image / H3 的已知问题（实测后填写）
```

type 包在“Style 倾向”一节里只写推荐和禁用的 styleId，不写模板：

- commercial、showcase 用 `glossy-commercial` 或 `grounded-realism`，有真实产品时禁用 `watercolor-ink`；
- kids 用 `pastel-storybook`、`stylized-3d-feature`、`paper-cutout`；
- documentary 用 `documentary-handheld`，禁用风格化；
- MV 可以用全部风格，concept mode 优先 stylized；
- explainer 用 `minimal-motion-graphics`、`cel-flat`，有屏幕文字需求时禁用 `pixel-art`。

---

## 7. Context 预算

| 组成 | v7（今天） | v8（每轮） |
|---|---|---|
| core entry + 必读 reference（contract、notes） | 全部 v7 文件约 8.6k 词 | 约 3.5k 词 |
| type entry | — | ≤1.1k |
| craft entry ×（3–7） | — | 每个 ≤0.6k，最多约 4.2k |
| format entry | — | ≤0.7k |
| guidance 目录（20 个包，每个一句） | — | 约 0.4k |
| 合计注入 | 约 8.6k 词，而且随草稿增长 | **≤10k 词，硬上限**（最坏情况 MV + vertical + 7 个 craft：3.5+1.1+4.2+0.7+0.4 ≈ 9.9k） |
| 按需读取 | 无 | 每次 0.5–2.5k 词，有 `skill_read` 记录 |

预算写进 `release.json`，由 CI 测试强制。超出时只能把内容拆到 reference 里，不能提高上限。要不要由服务端按 stage 预先注入 reference（例如在 `shot_plan` 时自动注入 `craft-shot-prompting/motion.md`），等 eval 里测出“模型不主动读”再决定（§11 风险 3）。

---

## 8. Loader 与 lock 的改动

### 8.1 `packages/director/src/skills/index.ts`

1. **manifest v2 解析**：有 `schemaVersion: 2` 时，额外允许 `role`、`routes`、`requires`、`optional`。没有 schemaVersion 时，严格按今天的 6 个字段处理，所以旧包的字节和 digest 都不变。
2. **新增 `loadSkillRelease(options & { releaseRoot })`**：读取 `release.json`，然后：
   - 校验各包 digest 和 `expectedReleaseDigest`；
   - 校验 compatibility 完全相同；
   - 校验依赖是封闭的 DAG（深度 ≤2，craft 包不能依赖 type 包）；
   - 校验路由不重复、并覆盖所有 kind；
   - 校验所有包主版本号都等于发布集主版本号；

   最后发布快照，返回 `SkillRelease { releaseDigest, catalog, graph }`。预算检查放在 CI 测试里，不放运行时。
3. **lock schema 2**：

   ```ts
   interface SkillCapabilityLockV2 {
     schemaVersion: 2; id: string; lockDigest: string; compatibility: SkillCompatibility;
     release: { version: string; releaseDigest: string };
     skills: { id: string; version: string; packageDigest: string }[];   // 结构和 v1 相同，包含发布集里的全部包
     bindings: SkillCapabilityBinding[]; prompts: LockedSkillPrompt[];   // prompt id 仍是 production/<stage>@1
   }
   ```

   `lockBody` 按 schemaVersion 分支，v1 的分支一个字节都不改。`verifySkillLockSnapshots` 对 v2 额外重新计算 releaseDigest（从各快照的 manifest 加上 release 快照）。`release.json` 本身也要按 digest 快照，放在 `skill-snapshots/release/<digest>.json`。
4. **新增纯函数 `routeSkills(release, facts): RoutingDecision`**：输入是封闭的事实（kind、subtype、modifiers、facts[]），输出有序的 `selected` 和 `reasons`，还有 `ruleVersion`。纯函数可以直接做表驱动测试。
5. **activation schema 2**：

   - 多出 `routing` 字段（输入、输入 digest、选中的包、原因）；
   - `skills[]` 结构不变，只包含注入的包，备份校验能照常遍历 `entryPath`；
   - 多出 `readable: "lock"`，表示 lock 里所有包都可以读。

   `readActivatedSkillFile` 对 v2 允许读任何 lock 里的包（包括 `SKILL.md`），读取记录里多一个 `via: "inject" | "read_guidance"`。v1 的行为不变。
6. **`SKILL_LIMITS`**：packages=32 够用。建议加 `guidanceReadsPerActivation: 24` 和 `guidanceReadBytes: 120 * 1024`。

### 8.2 服务端

| 文件 | 改动 |
|---|---|
| `director-capabilities.ts` | `createDirectorSkillLock` 增加 `7.0.0 → guidance "8"` 的映射；guidance ≥8 时走 `loadSkillRelease`，所有包都进 lock（`selectedSkillIds` = 全部）；prompts 不变（仍属于 `production`）；bindings 里的 handler 改用 7.0.0 catalog |
| `director-shipped-guidance.ts` | `ShippedGuidance` 改成联合类型：旧行保留 `productionDigest`/`planAuthoringDigest`（不改动），新行是 `{toolContract:"7.0.0", guidanceVersion:"8.0.0", handlerDigest, releaseDigest}`。`isCurrentShippedDirectorGuidance` 按 lock 的 schemaVersion 分支，v2 比较 releaseDigest 和 handler，不再检查 `length === 2` |
| `director-input.ts` | v2 lock 时：从项目状态算出事实，调用 `routeSkills`，再调 `capture(..., {selectedSkillIds: decision.selected, routing})`，只注入 entry 和 core 必读文件。v1 lock 照旧。`audioRequests` 的判断保持不变（v8 包都是 8.x，判断成立） |
| `director-context.ts` | `capture` 把 routing 写进 activation；`readSkill` 接收 v2 的 lock 内读取；新的 `read_guidance` 工具 handler 调用 `readSkill` 并记录 `skill_read` |
| `director-tools-upgrade.ts` | `currentForFreshTurn` 支持“v7 的任意已发布身份 → v8 发布集”的后继（6.0.0→7.0.0 是只增不改的工具变化），保护条件和现在一样（不忙、没有进行中的 epoch、配置没变）。`status()` 的 `availableVersion` 改成 7.0.0。手动 `upgrade()` 的目标列表加上 7.0.0 |
| Codex runtime（`codex.ts`、`setup.ts`） | 只把 `decision.selected` 作为 native skill 输入项和 `enabled:true`；其他包的快照**不**发布进 native 的 `.agents/skills`（或者发布但保持 `enabled:false`），避免被隐式调用。“native 看到的列表必须和固定输入一致”这条检查保留 |
| `installation-backup-closure.ts` | v2 lock 的 `skills[]` 结构不变，现有循环可以直接用。新增：v2 lock 的 release 快照文件必须存在 |
| `narration/music-video.ts` | `isMusicVideoProject` 先读 `filmKind.kind === "music_video"`，读不到再回退到文字识别 |

### 8.3 从 v7 两包 lock 迁移、已保存的 lock 和 digest

- **已保存的 v7 lock**：
  - 行不改写，`lockDigest` 不变；
  - 已经开始的 epoch 继续用它（`director_epoch_lock`）；
  - 历史快照照常验证；
  - v1 的 activation 和 skill_read 记录也不变。
- **后继**：在下一次符合条件的新 native 轮次，`currentForFreshTurn` 用 `createDirectorSkillLock(configuration, "7.0.0", "8", expectedRelease)` 生成 v2 lock，插入新的 `director_skill_lock` 行，写 `director.lock_installed` 事件（`source: "application_compatible_upgrade"`，带 `previousLockId`）。这条路径已经存在，只是扩展适用范围。
- **项目字段**：老项目没有 `filmKind`，路由就落到 `general`（core + fallback 注入），行为等于 v7 加上风格能力。Director 在这一轮会判断类型并写入 `filmKind`（纯文本、无媒体影响、不问人，在回复里用一行说明），下一轮自动路由。
- **hold 住的 proposal**：6.0.0 下创建、还没决定的 proposal，必须能在 7.0.0 的 epoch 里被 `accept_proposal` 接受。需要专门的测试；做不到的话，后继要等这些 proposal 都决定之后再进行。
- **digest 的影响**：
  - 每个新包有自己的 `packageDigest` pin；
  - 发布集多一个 `releaseDigest` pin；
  - lock v2 的 `lockDigest` 覆盖 release 和全部包；
  - activation digest 覆盖 routing；
  - 已有的所有 pin 都不改；
  - v8 发布以后，任何内容改动都要发新版本（单个包升 minor，发布集升 minor），没变的包 digest 相同，`publish()` 会按 digest 去重。
- **降级**：旧版 OpenSlate 读到 v2 lock 会在严格解析时失败，提示 `DIRECTOR_GUIDANCE_UNSUPPORTED`，已保存的作品不受影响。不支持降级，要在 release notes 里写明。

---

## 9. 和 tool contract 7.0.0 的关系

v8 计划第 1 步定义的 7.0.0 工具，和各包的 `requiredToolIds` 对应如下：

| 包 | requiredToolIds（7.0.0） | 依赖的 context 段或字段 |
|---|---|---|
| `production` | v7 manifest 的 13 个 + `read_guidance`、`move_shot`、`move_scene`、`delete_shots`、`delete_scene`、`undo_edit`、`use_take`、`start_export` | `filmKind`、`read_context.audio_library` |
| `plan-authoring` | v7 的 12 个 + `read_guidance` | — |
| `craft-story` | `read_guidance`（只用 core 的读写工具） | `brief`、`story` |
| `craft-visual-style` | `record_notes`、`propose_change` | `project.visualStyle`、`scene.styleVariation` |
| `craft-style-prompting` | — | 由应用编译 `imageBlock`、`motionBlock` |
| `craft-shot-prompting` | `propose_change` | 镜头字段 |
| `craft-characters` | `make_character_sheets` | `read_context.characters`、`createCharacters`、`characterIds`、笔记选项 `approve_character_sheet` |
| `craft-continuity-review` | `inspect_artifact`、`record_notes`、`make_keyframes` | — |
| `craft-narration` | `revise_narration_draft`、`prepare_narration_speech`、`prepare_recording_transcription`（以后加 `set_narrator_voice`、`fit_narration`） | — |
| `craft-music-timing` | `analyze_music`、`set_soundtrack` | `audio_library` |
| `craft-performance` | — | `shot.performance`；对口型在场景确认的视频配方里 |
| `type-music-video` | `analyze_music`、`set_soundtrack` | `musicVideo.*` 字段（plan-fields-spec） |
| 其他 type 和 format 包 | `read_guidance` | — |

要点：

1. **`read_guidance` 必须进 7.0.0**：
   - 它是免费、只读的工具，在 review、automatic 和只读轮次里也能用；
   - 输入 `{skillId, path?}`，path 省略时读 `SKILL.md`；
   - 返回 `{content, sha256, packageDigest}`。

   v8 计划第 1 步现在的列表里没有它，需要马上告诉 7.0.0 的负责人。如果 7.0.0 已经冻结，就得出 7.1.0。
2. **`filmKind` 要按结构化定义**（§3.2），不能只是 `"film" | "music_video"`。
3. `compatible()` 要求 lock 里每个包的 required tools 都可用，所以 v8 发布集只能和 7.0.0 一起出现，6.0.0 项目不会误加载。
4. manifest 只能声明工具 id，不能声明“需要某个 context 段或字段”。今天靠 toolContract 完全相等来间接保证，这已经够用了。是否加 `requiredCapabilities`（例如 `"section:audio_library"`）等以后真的出现跨 contract 共用包时再定，现在不加。

---

## 10. 进一步调研（按优先级）

### 10.1 横向的（先做，因为决定架构是否成立）

1. **路由和类型识别的 eval 集**：100–150 条中英双语 brief，标注 kind、subtype、modifiers 和“该不该提问”，量 `routing.md` 的准确率和提问率。按 Anthropic 的建议，先写 eval 再写 skill。
2. **按需读取会不会真的发生**：在 Codex native 上测 Director 有没有在该读 reference 的时候调用 `read_guidance`，用 `skill_read` 记录来统计。不读的话，就改成按 stage 预先注入。
3. **注入预算实测**：10k 词注入加上 context 快照，在当前模型上的延迟和成本，以及和 v7 全量注入相比的质量差异（同一批项目做 A/B）。
4. **多包指令冲突**：type 和 craft 包规则相左时，模型会不会遵守优先级。为此写冲突用例。

### 10.2 故事 / 概念开发（`craft-story`）

1. 每个框架准备 30–60 s 的正反例：同一个 brief，用框架写和不用框架写，对比产出（eval）。
2. 发散时给几个方向、什么时候跳过发散：测人的选择负担，2 个还是 3 个更合适。
3. 中文创意写作的习惯：起承转合，短剧的“钩子—反转—悬念”节奏，需要中文资料。
4. 非叙事类型（MV concept、showcase、visual poem）怎么找“核心画面”：需要一个方法和示例库。
5. 短时长里角色弧的最小单位，比如 15 s 是否只能有“状态对比”。

### 10.3 风格 prompt（`craft-style-prompting`）

1. **24 个风格逐一实测**：Codex image 出关键帧，H3 出片段，每个风格 3 个镜头，记录漂移、失败模式和需要重做的次数，结果填进 Model notes。
2. H3（MiniMax）能否稳定执行“结束状态”、方括号机位命令和多个运动；官方 H3 prompt 文档要找到并核实。
3. 中文 prompt 和英文 prompt 在 Codex image 和 H3 上的差异。
4. 风格锚点图（style reference）在 Codex image 里怎么和主体参考图分开传。
5. 动画风格（一拍二、定格）在 i2v 下能不能保持帧率感，还是需要后期处理。

### 10.4 各类型（按 type 包优先级）

| 类型 | 调研项（按重要性） |
|---|---|
| music-video（P0） | 1. H3 Max lip-sync 与 sync.so 的 A/B（已计划，约 $2）；2. STRATA 或 All-In-One 的段落标签准确率，以及 “Astra” 到底指什么；3. Film 能否裁切片段（clip window 规则的前提）；4. H3 上舞蹈和大动作的可行性；5. 歌词字幕怎么做（Film 还不支持叠字）；6. 艺人肖像同意的提问方式 |
| commercial（P1） | 1. 不能叠字时怎么做 CTA 和价格；2. 产品参考图在 Codex image 里的还原度；3. 生成画面在广告里的合规标注（各平台规则、广告法）；4. 6/15/30 s 剪短版的结构；5. 屏幕录像的放置（app promo） |
| explainer（P1） | 1. 图解、信息图画面的可靠性；2. 隐喻库；3. 旁白主导的节奏实测（中文字/秒）；4. motion-graphics 风格在 H3 上能不能用；5. tutorial 的步骤正确性和手部动作 |
| narrative（P1） | 1. 竖屏短剧（micro-drama）的结构和市场惯例；2. 没有对口型时怎么处理对白；3. 10–30 个镜头的角色一致性（配合设定图）；4. 儿童内容的安全和节奏 |
| narrated-story（P1） | 1. YouTube 等平台对“重复、批量内容”的变现政策；2. 保持观看的段落结构；3. 声音选择 |
| social-vertical（P1） | 1. 2026 年各平台的安全区和 AI 标注要求；2. 钩子时长的证据；3. 循环结尾的做法 |
| showcase（P2） | 1. 布料、金属、玻璃的材质表现；2. 服装上身的还原；3. 房产、旅游展示的失实风险 |
| documentary（P2） | 1. Film 原样放入素材（阻塞项）；2. 合成重演的标注和伦理；3. 证言类绝不合成真人 |
| trailer（P2） | 1. 标题卡；2. 音乐铺底和节奏；3. 只暗示不揭晓的结构库 |

---

## 11. 分阶段上线（v7 项目始终可用）

| 阶段 | 内容 | 退出条件 |
|---|---|---|
| 0 | 本文档，以及和 7.0.0 负责人确认 `read_guidance` 和结构化 `filmKind` | 负责人确认 |
| 1 | Loader：manifest v2、`loadSkillRelease`、lock v2、activation v2、`routeSkills`，都有测试；v7 的 pin 和已保存 lock 的 fixture 全部通过 | `packages/director/test/skills.test.mjs` 加上新表驱动测试；旧 digest 不变 |
| 2 | 7.0.0 catalog 加 `read_guidance` 和 `filmKind`；服务端路由、注入、读取；后继路径扩展 | 服务端测试：v7 lock 的 epoch 不受影响；v2 lock 能路由、读取有记录；hold 住的 proposal 能跨版本接受 |
| 3 | **v8.0.0 发布集（P0）**：`production`、`plan-authoring`、`craft-story`、`craft-visual-style`、`craft-style-prompting`、`craft-shot-prompting`、`craft-characters`、`craft-continuity-review`、`craft-narration`、`craft-music-timing`、`craft-performance`、`type-music-video`；其他 kind 一律落到 fallback | 路由 eval ≥90%；MV 的浏览器场景通过；预算测试通过 |
| 4 | 在新轮次启用自动后继（先只对新项目，再对老项目） | 观察 `DIRECTOR_GUIDANCE_*` 错误率，以及 v7 和 v8 的 A/B |
| 5 | v8.1：P1 类型（commercial、explainer、narrative、narrated-story、social-vertical） | 每个类型 3 个以上 eval |
| 6 | v8.2：P2 类型（showcase、documentary、trailer） | 同上；documentary 要等 Film 能放入素材 |

**后备方案**：阶段 1 的 loader 如果来不及，就按 v8 计划原来的做法，先把草稿作为 references 放进 `production` 8.0.0，但必须**同时上线 `read_guidance` 并停止全量注入**。文件路径按目标布局组织（`references/types/music-video/…`、`references/craft/story/…`），以后拆成独立包时只是机械地搬文件，路由规则不变。

---

## 12. 风险

1. **context 膨胀**：草稿还在增长。缓解：发布时的预算测试、entry 字数上限、按需读取，都在 CI 里强制。
2. **路由出错**：类型判断错了。缓解：判断结果写在 brief 里，人一句话就能改，下一轮生效；`source: "inferred"` 可以审计；用 eval 集衡量。
3. **模型不主动读 reference**：缓解：用 `skill_read` 统计；必要时按 stage 预先注入；entry 里用明确的条件写“什么时候读哪个文件”（Anthropic 的 conditional details 模式）。
4. **包之间指令冲突，或权限规则泄漏到 craft 包**：缓解：权限只写在 core；做 lint；写冲突用例；在 entry 里写明优先级。
5. **7.0.0 时间窗口**：如果 `read_guidance` 没赶上 7.0.0，就要多出一个 7.1.0。这正是 v8 计划想避免的“多个 contract 版本”。缓解：立刻协调（阶段 0）。
6. **硬编码的地方漏改**：`length === 2`、两个 digest 列、`selectedSkillIds` 写死、`audioRequests` 的主版本检查、guidance 版本映射、native skill 启用、备份校验。缓解：§8.2 的清单逐项写测试。
7. **pin 变多**：20 个包加 1 个发布集，维护负担加重。缓解：没变的包 digest 复用；pin 测试自动从 `release.json` 生成，但不能自动改写历史 pin。
8. **自动后继跨越了 tool contract**：6.0.0→7.0.0 不是“同 contract 修订”。缓解：工具只增不改，6.0.0 的回执用 6.0.0 handler 对账；hold 住的 proposal 写专门测试；先只对新项目启用。
9. **native 隐式调用**：如果把所有包都发布进 `.agents/skills` 并启用，Codex 可能根据 description 自己调用。缓解：只启用路由选中的包，保留“native 列表必须和固定输入一致”的检查。
10. **合并过头**：一个 type 包装几个 subtype，entry 可能变得很笼统。缓解：subtype 的内容放在独立的 reference 里，entry 只写共同部分；eval 不达标就拆成独立 type 包（id 加一个就行，不影响其他包）。
11. **版权和真人**：风格不写人名；documentary 和 testimonial 不合成真人证词。这些规则写在 core 的 `shared-planning.md`，type 包不能放宽。
12. **不能降级**：旧二进制读不了 v2 lock。在 release notes 里写明；已保存的作品不受影响。

---

## 13. 需要负责人决定

1. 同意 8 个 type 包加 1 个 format 包的合并方式（§3.2），而不是 18 个包。
2. 同意把 `read_guidance` 和结构化 `filmKind` 加进 7.0.0（§9）。
3. 同意 core 保留 `production` 这个 id，而不是改名成 `director-core`。改名会连带改动 stage prompt id 和 `STAGE_CONTRACTS_DIGEST`，收益不大。
4. 自动后继先对新项目开启，还是同时对老项目开启。
5. 首选完整方案，还是 §11 的后备方案（单包加按需读取），取决于 loader 工作的排期。
