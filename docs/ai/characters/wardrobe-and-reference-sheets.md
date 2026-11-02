# 角色服装（按场景）与角色设定图（Character reference sheet）

分支：`worktree-agent-a7a7666578758bb43`（从 `feature/last-ferry-ui` @ `78aac6e` 快进而来）。
范围：(a) 规划阶段给每个角色按场景配服装（character × scene outfit）；(b) 出场不止一次的角色生成一张四视图角色设定图，由人批准，然后作为参考图（reference image）绑定到该角色出现的每一个关键帧。

本文分五部分：现状调查（带 file:line）、设计、已实现部分、只写成规格（spec-only）的部分、改动过的共享文件。

---

## 1. 现状调查

### 1.1 数据模型：没有“角色”这个概念

- `ShotRecord` 只有 `referenceArtifactIds: Id[]`，没有角色、服装、连续性字段：`packages/core/src/contracts.ts:51`（本次改动前）。
- `ProjectRecord` 有 `scenes`、`shots`、`artifacts`，没有 `characters`：`packages/core/src/contracts.ts:85-113`（改动前）。
- 全仓库搜 `character` / `wardrobe` / `continuity`，在 apps、packages 的源码里都没有命中，只有 Director runtime 里无关的 “character” 字样。
- 所以 “服装文字被粘进每一个关键帧 prompt” 是必然结果：服装只能写在每个镜头的 `imagePrompt` 里，Director 只能一遍遍复制。

### 1.2 “参考图绑定”（reference bindings）是什么，为什么一直是空的

“参考图绑定” 就是 `ShotRecord.referenceArtifactIds`。链路如下：

1. Director 创建镜头时 `createShots[].referenceArtifactIds` 是必填项：`packages/core/src/workflow/index.ts:92`；只能指向项目里已有的 artifact：`packages/core/src/workflow/index.ts:163`。
2. `updateShots` 不能改参考图：schema 里没有这个字段（`packages/core/src/workflow/index.ts:93`），v7 技能也明确写着 “Reference and cue updates are unsupported by this patch”：`skills/v7/production/references/current-contract.md:28`。
3. 在 Plan 里人手动新加的镜头一律是空数组：`apps/server/src/storyboard.ts:160`。
4. Director 读 `read_context` 的 `shots` 时会看到 `referenceArtifacts`：`apps/server/src/application/context-projection.ts:253`。项目里能被引用的 artifact 只有用户上传的图片，所以 Director 看到的是空列表，于是在 notes 里写 “参考图绑定仍为空”。
5. v7 技能自己也承认：“Use registered references; text alone does not guarantee identity consistency.”：`skills/v7/production/references/continuity-review.md:5`。但是没有任何途径产生 “registered reference”，所以角色长相在关键帧之间会漂移。

### 1.3 关键帧 prompt 的编译路径

- 场景动作（Make keyframes）通过 `composeScenePlan` 生成 image 节点：`prompt` 就是 `shot.imagePrompt` 原文，`references` 是 `shot.referenceArtifactIds` 逐个 `p.asset(id)`：`packages/core/src/planning/scene-composition.ts:686-700`。
- image 节点的 intent digest 包含 references，但不包含 prompt 字符串：`packages/core/src/planning/index.ts:83-87`（`shotIntentDigest`）。所以改了参考图，旧关键帧会自动变成过期（stale）。
- 编译时会校验 image 节点带齐了镜头要求的参考图：`packages/core/src/planning/index.ts:235`。
- 执行前，Codex 图像的授权检查要求 `node.args.prompt === shot.imagePrompt`：`apps/server/src/execution/codex-image-authority.ts:143-145`。所以**不能在派发时偷偷往 prompt 里拼东西**，角色段落必须写进保存下来的 `imagePrompt`。
- 已有先例：应用会按 `"OpenSlate current direction:"` 头部改写 prompt：`apps/server/src/application/shot-prompts.ts:5-16`（`editedPrompt`）。角色段落沿用同样的 “应用拥有的段落” 写法。

### 1.4 Codex 图像 worker 能不能接收参考图：**能，而且整条链已经打通**

- 传输层类型：`CodexImageInput.images: CodexImageReference[]`，上限 8 张、单张 4 MiB、总共 24 MiB：`packages/providers/src/codex-image.ts:4-8`。
- 每轮的文字说明里写着 “Use the attached references in their supplied order”：`packages/providers/src/codex-image.ts:44-47`。
- worker 把每张参考图写进私有工作区，再逐字节核对：`packages/director/src/media/codex-image.ts:202-207`；`turn/start` 发送 `[{type:"text"}, ...{type:"localImage", path}]`：`packages/director/src/media/codex-image.ts:355-364`。
- 服务端执行：`resolveCodexImageReferences` 从 attempt 的 `inputs` 取参考图，要求是本项目的、非 fixture 的、校验过的 PNG（≤4 MiB）：`apps/server/src/execution/codex-image-authority.ts:121-135`；`prepareInputs` 读出字节再按顺序交给 worker：`apps/server/src/execution/codex-image-execution.ts:163-175`。
- 已有测试覆盖：`packages/director/test/codex-image.test.mjs:107-113`（参考图以 `localImage` 发出）、`:201`（字节被改动时在 turn 之前失败）。
- **限制**：尺寸被锁死在 1024×1024：`packages/providers/src/codex-image.ts:28` 和 `apps/server/src/execution/codex-image-execution.ts:175`。设定图推荐的 3:2 横版目前做不到（见 2.2）。

结论：参考图传入 image worker 这件事**不需要改代码**。真正缺的是 “参考图从哪来” 和 “绑定到哪些镜头”。本次在 core 里加了一个组合测试，证明一张已绑定的设定图会成为关键帧 image 节点的第一个 `reference` 输入（`packages/core/test/characters.test.mjs` 最后一个测试）。

### 1.5 视频（Viggle）：只吃关键帧

- 适配器注释原文是 “text/first/last-frame contract; no reference or animation mode”：`packages/providers/src/viggle-h3.ts:4`；模式只有 `text | first_frame | first_last_frame`：`:131`；multipart 只发 `first_frame_image` / `last_frame_image`：`:150`。
- 场景编译里视频节点的输入只有 `firstFrame: p.approvedImage(...)`：`packages/core/src/planning/scene-composition.ts:660`、`:815`。
- 所以设定图**不会**也不需要进视频；视频里的人物一致性完全来自关键帧。

### 1.6 价格与授权模型

- 报价统一走 `quoteUnits`：Codex 图像记作订阅（`subscription: "codex"`），金额为 0 但不算 “价格未知”；其他零价格 profile 算 `priceUnknown`：`apps/server/src/generation-quotes.ts:20-27`。
- 场景生成接口要求带 `expectedEstimateMicros`、`reviewedHoldDigest` 等，确认的是人看过的价格：`apps/server/src/scene-generation.ts` 中 `/generate` 的 body schema。
- 只有新鲜的人类请求才能启动付费工作（`make_keyframes`）：`skills/v7/production/references/keyframes.md`。

### 1.7 技能与工具目录的约束

- 当前是 production 7.0.0 / tool contract 6.0.0：`skills/v7/production/openslate.skill.json`。
- `changeProposalSchema` 被已发布目录复制，注释写明 “Additions must never mutate it”：`packages/core/src/workflow/index.ts:98`。
- 因此本次**没有**改任何 Director 工具 schema 或技能包；新的工具契约只写成规格（第 4 节），技能指导写成草稿（`docs/ai/skill-drafts/characters/`）。

---

## 2. 设计

### 2.1 计划里的按场景服装

数据（已实现为类型，见 3.1）：

```ts
interface CharacterRecord {
  id; revisionId; name;
  identity: string;          // 跨场景不变：脸、发型、体型、年龄、标志特征。不写衣服。
  baseOutfit?: string;       // 设定图上穿的中性服装；某场景没写服装时的兜底
  wardrobe: { sceneId; outfit; notes? }[];   // 每个场景一条，sceneId 唯一
  sheet: CharacterSheetRef | null;           // 人批准的那张设定图（精确 artifactId + sha256）
}
ShotRecord.characterIds?: Id[]   // 本镜头的出场角色，顺序 = 参考图顺序
ProjectRecord.characters?: CharacterRecord[]
```

要点：
- **身份（identity）与服装（outfit）分开**。设定图只锁身份；服装每个场景独立，所以同一个人可以在雨夜穿风衣、在清晨码头穿黄色雨衣。
- 关键帧 prompt 不再由 Director 复制服装文字。应用根据出场角色 + 当场服装 + 设定图位置，生成一个应用拥有的段落，追加在 `imagePrompt` 末尾：

  ```
  Characters in this shot (OpenSlate):
  - Mara (reference image 1 is their character sheet: match face, hair, build and proportions; ignore the sheet's clothing and pose): <identity> Wearing in this scene: <outfit> (<notes>).
  End of characters.
  ```

  `withCharacterDirection` 幂等替换这一段，其余 prompt 原样保留（与 `editedPrompt` 的头部段落可以共存）。因为它写进了保存的 `imagePrompt`，所以满足 `codex-image-authority.ts:145` 的 prompt 相等检查，PromptsPanel 也能如实显示 “发给模型的就是这段”。
- 改服装或身份 = 改了相关镜头的 prompt。若这些镜头已有媒体，按现有规则走 `propose_change`（人看 Now/After 后接受）；没有媒体的计划可直接保存。

### 2.2 角色设定图：一个 prompt 模板，四视图布局

模板 `characterSheetPrompt(character, { style, aspect })`（已实现）：

```
Character reference sheet for <name>.
<canvas>, left to right: 1) full-body front view; 2) full-body side view, facing left, in profile;
3) full-body back view; 4) face close-up, head and shoulders, facing the camera.
The same person in all four panels, at the same height and scale, standing relaxed with arms slightly
away from the body, head to feet fully visible in panels 1 to 3.
Person: <identity>
Wearing: <baseOutfit 或 "plain, close-fitting neutral grey clothes and simple shoes">.
Neutral expression. Even, soft front light. Plain light-grey seamless background.
No text, labels, logos, props, frames or other people.
Rendering style: <影片视觉风格，可选>
```

- **推荐比例 3:2 横版（1536×1024）**：四个竖条每格约 384×1024（≈1:2.7），正好放下一个站立全身像；第四格放脸部特写。
- **当前只能 1:1（1024×1024）**：Codex worker 的 `describeCodexImageInput` 只接受 1024×1024（`packages/providers/src/codex-image.ts:28`）。模板在 1:1 下仍是四个竖条（每格 256×1024，全身像可用，脸部特写偏小）。要支持 3:2 需要一个新的传输策略版本（见 4.4），不能改 `codex-image-turn-v1`，否则旧回执的 `turnInputDigest` 对不上（`apps/server/src/execution/codex-image-receipts.ts:69`）。
- 设定图穿 `baseOutfit`（中性服装），不穿任何场景的戏服，避免某一场的服装 “粘” 到所有关键帧上。测试里断言了场景服装不会漏进设定图 prompt。
- `characterSheetPromptDigest` 记录生成该图所用 prompt，批准时一并保存，之后可以判断 “身份描述改了，设定图是否已经过时”。

### 2.3 批准与重新生成

- 每次生成或导入都是一条不可变的 take：`character_sheet_take`（`apps/server/src/character-sheets.ts`，已实现）。重新生成只是多一条 take，旧 take 留在 Assets 里。
- **批准是人的动作**，写在角色上：`CharacterRecord.sheet = { artifactId, sha256, promptDigest, approvedAt }`。Director 没有批准工具，只能发一个笔记选项卡（`approve_character_sheet` / `regenerate_character_sheet`），由人在聊天或 Plan › Cast 点击。
- 批准时应用在**同一个 revision** 里：
  1. 设置 `character.sheet`；
  2. 对所有出场镜头调用 `bindCharacterReferences`（设定图按出场顺序排最前，保留镜头原有的其他参考图，移除该角色以前的设定图，最多 8 张）；
  3. 用 `characterDirection` + `withCharacterDirection` 重写这些镜头的角色段落。
  因为参考图进入了 `shotIntentDigest`，已有关键帧会变成过期，Keyframes 显示 “需要新关键帧” 并给出报价；**应用不会自动重做**，由人按 Make keyframes。批准对话框里先显示受影响的镜头数和价格（应用计算的 Now/After）。
- 身份描述改了而设定图没换：`promptDigest` 与当前模板结果不同，Plan › Cast 显示 “设定图可能已过时”，提供 “重新生成”。

### 2.4 设定图作为资产存储

- 新的资产角色 `AssetRole = ... | "character_sheet"`，`AssetItem.characterId` 指向角色（已实现）。
- 服务端 `projectAssets` 看到 `character_sheet_take` 引用的 artifact 时，把它列为 `character_sheet`：按角色编号 take，`current` 表示 “就是这个角色当前批准的那张”，`label` 是角色名（已实现）。
- 网页 Assets 能正确命名（“Mara · character sheet · take 2” / “Mara · 角色设定图 · 版本 2”），排在其他角色之后；暂不加单独的筛选 chip（功能上线时再加，见 2.8）。
- 设定图本身就是一张本项目的、校验过的 PNG，所以 `resolveCodexImageReferences` 的条件（`codex-image-authority.ts:128-132`）天然满足，可以直接作为参考图发送。用户也可以上传一张图作为设定图（`attemptId: null`，`source: "imported"`）。

### 2.5 绑定到关键帧生成

- 绑定顺序：出场角色的已批准设定图（按 `characterIds` 顺序，去重）→ 镜头原有的其他参考图 → 截断到 8 张（`CHARACTER_LIMITS.referencesPerShot` 对应 `CODEX_IMAGE_LIMITS.references`）。超出时报 `TOO_MANY_REFERENCES`。
- 角色段落里的 “reference image N” 与这个顺序一致，而 worker 的轮次文字要求 “按提供顺序使用参考图”，两边对得上。
- 之后什么都不用改：`composeScenePlan` 自动把 `referenceArtifactIds` 变成 image 节点的 `reference` 输入，执行层把字节交给 Codex worker。
- `make_keyframes` / Make keyframes：若某镜头的出场角色是 “出场多于一次” 且没有批准的设定图，返回 `CHARACTER_SHEET_REQUIRED`（阻塞）并列出角色；人可以选择 “先做设定图” 或明确选 “不用设定图继续”。

### 2.6 连续性检查

`characterContinuityIssues(plan, retiredSheetArtifactIds)`（已实现，只读，不启动任何工作）：

| code | 严重度 | 含义 |
|---|---|---|
| `WARDROBE_MISSING` | blocking | 角色出现在某场景，但该场景没写服装，也没有 baseOutfit |
| `SHEET_REQUIRED` | blocking | 出场多于一次的角色没有批准的设定图 |
| `SHEET_NOT_BOUND` | blocking | 有批准的设定图，但某个出场镜头的参考图里没有它 |
| `SHEET_STALE_BINDING` | blocking | 镜头还引用着已被替换的旧设定图 |
| `UNKNOWN_CHARACTER` | blocking | 镜头的出场名单里有不存在的角色 |
| `WARDROBE_PROMPT_MISMATCH` | warning | 镜头 prompt 里写的是别的场景的服装，而不是本场景的（正是 “同一套服装粘贴到所有关键帧” 的症状） |
| `WARDROBE_UNKNOWN_SCENE` | warning | 服装条目指向已删除的场景 |
| `TOO_MANY_REFERENCES` | warning | 参考图超过 8 张 |
| `WARDROBE_UNIFORM` | info | 角色在多个场景穿完全一样的衣服（可能是有意的） |

写入时的校验是 `assertCharacterPlan`：名字唯一（忽略大小写）、每个场景只能一套服装、场景必须存在、出场名单不重复且角色存在、设定图引用必须是精确的 sha256。

这些问题在三处显示：Plan › Cast（角色 × 场景表格里标红的格子）、Keyframes 的 CheckBanner（Make keyframes 之前）、Director 的 `read_context` `characters` 段（规格，见 4.1）。

### 2.7 报价

- `characterSheetQuote(lock, count)`（已实现）：用项目锁定的 image profile，每张设定图算一个 image unit，与关键帧同一套 `quoteUnits`。
- Codex 图像：`{ micros: "0", subscription: "codex", priceUnknown: false }`，界面显示 “包含在你的套餐里 · $0”。按次计费的 profile：单价 × 张数。未配置价格：`priceUnknown`，界面不显示 $0.00。
- 授权模型不变：人按按钮（或新鲜的人类请求让 Director 调 `make_character_sheets`）时，请求带上 `expectedEstimateMicros`，价格变了就拒绝，与 `/scenes/:id/generate` 同一套。
- 批准设定图本身不花钱，但会让已有关键帧过期；批准对话框显示重做这些关键帧的报价（同样是 Codex $0）。

### 2.8 界面落点（UI）

- **Plan › Cast（新区块，在 Story 和 Scenes 之间）**：每个角色一行：名字、identity、设定图缩略图和状态 chip（“需要设定图” / “待审” / “已批准” / “可能已过时”）。展开后是**角色 × 场景服装表**：行是角色，列是该角色出现的场景，每格是可编辑的 outfit + notes；缺失的格子标红（`WARDROBE_MISSING`）。每个镜头行（`ShotRow`）显示出场角色 chip，可增减。
- **设定图审阅**：点缩略图打开审阅面板，复用 Keyframes 的 `Preview` + `TakesStrip`：大图、历史 take、按钮 “批准并用于关键帧” / “再做一张” / “上传一张”。批准前显示 “将影响 N 个镜头的关键帧 · $0”。
- **Keyframes**：场景头部（`SceneHeader`）显示本场出场角色的设定图小头像；Make keyframes 之前若有 blocking 问题，`CheckBanner` 显示 “Mara 出现在 4 个镜头，还没有批准的设定图 —— 做设定图（$0，包含在套餐里）”。镜头 Inspector 的 Prompts 面板能看到应用写入的 “Characters in this shot” 段落，以及绑定了哪些参考图。
- **Assets**：`character_sheet` 资产已能列出和命名；功能上线时加一个 “角色设定图” 筛选 chip，详情里 “在 Plan › Cast 中打开”。
- **Director 聊天**：sheet 返回后出现角色锚定的笔记卡片：“批准” / “再做一张”，与现有 `confirm_video` 卡片同一种交互。

---

## 3. 本次已实现（带测试）

### 3.1 计划里的服装字段（core 类型 + 纯函数）

- `packages/core/src/contracts.ts`：新增 `CharacterWardrobe`、`CharacterSheetRef`、`CharacterRecord`；`ShotRecord.characterIds?`；`ProjectRecord.characters?`。全部是可选字段，旧计划不受影响，现有 digest 不变。
- `packages/core/src/characters.ts`（新文件，从 `@openslate/core` 导出，仅服务端）：
  - `assertCharacterPlan`：写入校验；
  - `wardrobeFor`、`characterAppearances`、`charactersNeedingSheets`；
  - `characterSheetPrompt`、`characterSheetPromptDigest`、`CHARACTER_SHEET_CANVAS`；
  - `bindCharacterReferences`、`characterDirection`、`withCharacterDirection`；
  - `characterContinuityIssues`。
- 测试：`packages/core/test/characters.test.mjs`（8 个），包括一个组合测试：设定图绑定后经 `composeScenePlan` 成为关键帧 image 节点的第 0 个 `reference` 输入，prompt 里带角色段落和本场服装，intent digest 与镜头一致。

### 3.2 设定图资产类型

- `packages/core/src/studio-api.ts`：`AssetRole` 增加 `"character_sheet"`；`AssetItem.characterId?`。
- `apps/server/src/character-sheets.ts`（新文件）：`CharacterSheetTake` 记录类型、`recordCharacterSheetTake`（只接受本项目、精确 sha256 的 PNG，角色必须存在，take 不可覆盖）、`characterSheetTakes`、`isApprovedSheet`、`retiredSheetArtifactIds`。
- `apps/server/src/asset-library.ts`：把设定图 take 列为 `character_sheet`，按角色编号，`current` = 已批准；`?role=character_sheet` 可筛选。
- `apps/web/src/next/model/assets.ts` + `apps/web/src/next/i18n/catalog/assets.ts`：排序、标题（中英）、计数安全（没有专门 chip 时只计入 All）。
- 测试：`apps/server/test/character-sheets.test.mjs`、`apps/web/test/next/character-sheet-assets.test.mjs`。

### 3.3 参考图传入 image worker

- 不需要改：整条链（shot → image 节点 → attempt inputs → `prepareInputs` → worker `localImage`）已经存在并有测试（1.4）。本次补的是**来源和绑定**（`bindCharacterReferences`）以及证明绑定结果会进入 image 节点的测试。

### 3.4 设定图报价

- `apps/server/src/generation-quotes.ts`：`characterSheetQuote(lock, count)`，测试覆盖 Codex $0 订阅、按次计费、价格未知、0 张、越界。

### 3.5 验证

- `pnpm -s build`、`pnpm -s typecheck` 通过。
- core 全部测试 208/208；web `test/next` 全部 916 个通过（含新增 2 个）；server 相关测试（asset-library、character-sheets、storyboard、scene-generation、web-assets、codex-image-execution、generation-overview、r4-generation-projections）全部通过。
- 没有任何真实图像生成或 provider 调用；没有读 `.env*`、secrets、token；没碰 3001 端口和 `.openslate/live-validation`。

---

## 4. 只写成规格（spec-only），需要新版本的工具目录或技能包

### 4.1 Director 工具契约（建议 tool contract 7.0.0）

1. `read_context` 新增 section `characters`：分页返回 `{ id, name, identity, baseOutfit, wardrobe[], sheet: {state: "none"|"pending"|"review"|"approved"|"outdated", takeId?, artifactId?}, appearances: {shotIds, sceneIds}, needsSheet }`，外加 `issues: CharacterIssue[]`。
2. `prepare_change` 的 `creative` 新增：
   - `createCharacters: [{ key, name, identity, baseOutfit?, wardrobe: [{ sceneId, outfit, notes? }] }]`（`sceneId` 可以是同一 patch 里的场景 key）；
   - `updateCharacters: [{ id, name?, identity?, baseOutfit?, setWardrobe?: [{ sceneId, outfit, notes? }], clearWardrobe?: [sceneId] }]`；
   - `createShots[].characterIds`、`updateShots[].characterIds`（可以用同 patch 里的角色 key）。
   - 应用负责重写受影响镜头的角色段落和参考图；Director 不写 `referenceArtifactIds` 里的设定图。
3. `propose_change` 的 patch 新增 `updateCharacters` 和 `updateShots[].characterIds`；当受影响镜头有当前或保留的媒体时，以上改动必须走 proposal（`PROPOSAL_REQUIRED`）。
4. 新工具 `make_character_sheets`：`{ characterIds: Id[], regenerate?: boolean }`，权限与 `make_keyframes` 相同（只有新鲜的人类编辑请求；`regenerate` 只能针对点名的角色）。返回启动的工作和报价。
5. 新笔记选项 `approve_character_sheet { characterId, takeId }` 和 `regenerate_character_sheet { characterId }`；Director 只能提供，不能执行批准。
6. `make_keyframes` 新增拒绝码 `CHARACTER_SHEET_REQUIRED`（附 `characterIds`），以及人类可选的 “不用设定图继续” 覆盖。

### 4.2 服务端（已实现，见 v8 第 3 步）

实现：`apps/server/src/characters.ts`（路由与命令）、`apps/server/src/execution/character-sheet-execution.ts`（不属于镜头的 sheet 节点）、`apps/server/src/application/character-tools.ts`（Director 处理函数）。与下面的原规格不同的地方：
- sheet 绑定放在固定的 `planId: "character-sheets"` 下，不在镜头计划里，安装计划时不会被 retire；每次生成都写一条 `character_sheet_job` 记录，里面是精确的节点。授权检查要求这条记录存在、节点完全一致，且 prompt 等于 `characterSheetPrompt(character, { aspect: "1:1" })`。
- 只支持 `codex-image` 和 fixture（`fake`）两种模型；其他 image 模型返回 `CHARACTER_SHEET_PROFILE_UNSUPPORTED`。
- 上传设定图：先用现有的 `/images/uploads` 上传，再调 `/sheet/import`，传 `{ artifactId, sha256 }`。
- 批准时把设定图加进 `project.artifacts`，这样计划编译器可以把它当作 `p.asset` 引用。
- 生成任务完成后，engine 在同一事务里写入 take（`character_sheet_take`，id 为节点 id），即使任务已被 Stop 或角色已改，也照样写入。

原规格：

- `GET /api/projects/:id/characters`：角色、出场、takes、问题、报价。
- `PUT /api/projects/:id/characters`（人在 Plan 里编辑，走现有 revision/冲突检查，内部调用 `assertCharacterPlan`）。
- `POST /api/projects/:id/characters/:cid/sheet/generate`（带 `expectedEstimateMicros`、`headVersion`）、`/sheet/import`、`/sheet/approve`（同一 revision 内绑定 + 重写段落）。
- **执行层需要一种不属于镜头的 image 节点**：现在 `assertCodexImageCurrentSelection` 要求 image 节点挂在某个镜头上且 prompt 等于 `shot.imagePrompt`（`apps/server/src/execution/codex-image-authority.ts:137-145`）。设定图需要 `node.characterId` + “prompt 等于当前设定图模板结果” 的分支，以及对应的 grant / hold / 回执路径。这是本功能里最大的一块工作，建议单独一张卡。
- 生成完成后写 `character_sheet_take`（调用 `recordCharacterSheetTake`）。

### 4.3 技能（建议 production 8.0.0）

- 草稿（英文）：
  - `docs/ai/skill-drafts/characters/wardrobe-per-scene.md`：Director 怎样写 identity、按场景写 outfit、不要把服装复制进 imagePrompt、何时走 proposal。
  - `docs/ai/skill-drafts/characters/reference-sheets.md`：何时提供设定图、怎样调用 `make_character_sheets`、批准只能由人做、批准后的关键帧过期如何说明、报价怎么说。
- `shot_plan`、`storyboard`、`continuity-review` 三个现有 reference 需要增加一行指向上述两个新 reference。

### 4.4 Codex 图像 3:2 尺寸

- 新增传输策略 `codex-image-turn-v2`，允许 `{1024×1024, 1536×1024, 1024×1536}`；`v1` 保留给已有回执。设定图请求 1536×1024，关键帧保持现状。属于 providers + 执行层的版本化改动，本次未做。

### 4.5 网页界面

- 2.8 节的 Plan › Cast、设定图审阅面板、Keyframes 的 CheckBanner/头像、Assets 筛选 chip、聊天卡片，本次都没有实现（只做了 Assets 的数据与命名）。

---

## 5. 改动过的共享文件

| 文件 | 改动 |
|---|---|
| `packages/core/src/contracts.ts` | 新增角色类型；`ShotRecord.characterIds?`；`ProjectRecord.characters?`（全为可选） |
| `packages/core/src/studio-api.ts` | `AssetRole` 加 `"character_sheet"`；`AssetItem.characterId?` |
| `packages/core/src/index.ts` | 导出 `./characters.js` |
| `apps/server/src/asset-library.ts` | 识别设定图 take；role 查询枚举加 `character_sheet` |
| `apps/server/src/generation-quotes.ts` | 新增 `characterSheetQuote` |
| `apps/web/src/next/model/assets.ts` | `ROLE_ORDER`、`titleMsg` 的 `character_sheet` 分支；`roleCounts` 跳过没有 chip 的角色 |
| `apps/web/src/next/i18n/catalog/assets.ts` | `assets.kind.character_sheet`、`assets.label.character_sheet` |

新文件：`packages/core/src/characters.ts`、`apps/server/src/character-sheets.ts`、三个测试文件、两个技能草稿和本文。

未改动：任何 `skills/` 包、`packages/core/src/workflow/index.ts` 和 `packages/core/src/tools.ts` 的工具 schema、音乐/配乐/对口型/导出相关文件、`packages/director/src/media/codex-image.ts`、`packages/providers/*`。

注意：`asset-library.ts` 和 `apps/web/src/next/model/assets.ts` 里也有 `music` 角色的逻辑，音频相关的 agent 可能同时在改，合并时留意这两处的冲突（本次只加了相邻的几行）。
