# OpenSlate UI/UX 改造实施计划

- 状态：草案，等你确认。没有改动任何产品代码。
- 基线：`main` 2c4b6e3（2026-10-09）。
- 目标设计：[The Last Ferry 原型](prototypes/last-ferry/last-ferry.html)，见 [DESIGN.md](prototypes/last-ferry/DESIGN.md)。布局取自你的第一张参考图，组件和配色取自第二张。
- 证据：[uiux-plan/](uiux-plan/) 下的五份差距分析，共 111 条工作项，每条都对照代码给了文件和行号。本文用条目编号引用它们（DC 导演、GR 生成与审阅、SB 故事板/旁白/导出、WA 前端架构、LG 历史问题台账）。

---

## 0. 一页摘要

**要做什么。** 用选定设计替换现在的界面，并把设计依赖、但后端还做不到的能力补上。同时清掉之前几轮 review 发现的问题，包括第一轮 UI 审查的 16 条、重新设计时挑错发现的阻断问题，以及过度工程的部分。

**总体做法。** 新界面放进独立的 `src/next/` 目录，用 `?ui=next` 切换。旧界面原样移到 `src/legacy/` 继续可用，直到新界面能做旧界面能做的所有事才切换默认并删除旧代码。后端按"先让状态说真话、再接管生成链路、最后升级导演契约"的顺序改，每一步都能单独上线，对旧界面也有好处。

**和后端最大的四个不兼容**（细节见第 3 节）：

1. **导演只能输出文字。** 设计里带字母的笔记、"导演建议"横幅、采纳/拒绝/撤销，在后端都没有对应的记录和接口。导演的改动是当场生效的，它也看不到生成的画面，所以"外套出来是酱红色"这种点评现在做不出来。
2. **任何手动编辑都会打断导演并锁住影片。** "镜头改为 8 秒"、编辑旁白、改提示词都会开启新的编辑请求，撤销正在运行的导演回合，并放下阻止任务和导出的锁。
3. **确认生成视频是浏览器里的多步流程。** 配音长度要到确认时才知道，关掉页面会把已付费的配音卡在半路。
4. **导出依赖导演写的"时间线计划"。** 示例素材也不能导出。

**七个阶段：**

| 阶段 | 内容 | 粗估（单人） | 可单独上线 |
|---|---|---|---|
| P0 清理与安全网 | 删死代码，修旧界面的布局 bug 和空闲时显示的停止按钮，加浏览器测试 | 约 3–4 天 | 是 |
| P1 后端基础 | 不再写假用户消息；付费按下强制幂等；新增总览读接口（含价格和各种状态）；"已查看"存服务端；编辑不打断导演；停止/继续；放弃无回应任务；导演不能自己花钱 | 约 7 周 | 是，旧界面也受益 |
| P2 新界面骨架和关键帧视图 | `src/next/`、单一状态仓库、中英消息 id、设计令牌；关键帧视图（先用应用自己算的检查代替导演建议） | 约 8 周 | 是，在 `?ui=next` 后面 |
| P3 后端接管生成链路 | 关键帧和配音一起生成；确认视频变成一条持久的服务端命令；"改为 N 秒/保持 N 秒"；会恢复素材的撤销；旧 take 可切回；删除浏览器多步流程 | 约 5–6 周 | 是 |
| P4 导演契约 5.0 | 结构化笔记、挂起的建议（现在/之后预览）、采纳/拒绝/撤销、编辑和导演并行、导演看关键帧、关键帧回来后的自动审阅 | 约 10 周 | 是；结束时新界面成为关键帧的默认 |
| P5 其余视图 | 先设计再实现 Plan、Film（时间线、音乐、导出）、Assets、设置、开始页、手机布局；后端按故事板顺序导出、场景和项目管理、素材库、音乐和配音分开 | 约 7 周加设计 | 是 |
| P6 切换和删除 | 新界面成为默认，删除旧界面、Radix Themes、多余的本地草稿缓存、按句子查表的文案 | 约 1–2 周 | 是 |

估算按 S=0.5、M=2、L=4、XL=8 人天累加，合计约 195 人天，不含 P5 的设计工作和真实服务商验证。有 AI 协作会更快，但后端涉及钱和数据完整性的部分不宜压缩测试。

**最需要你先拍板的六件事**（完整列表见第 2 节）：导演的改动是当场生效还是先提建议（D1）；配音是否和关键帧一起生成（D3）；导演看图放在第几阶段（D4）；"已查看"门槛是否保留、记录存在哪（D2）；导出是否改成按故事板顺序（D11）；是否同意新增浏览器测试依赖 playwright-core（D14）。

---

## 1. 范围与原则

**设计已经画到的：** 关键帧阶段的一个场景。包括顶栏和标签、导演栏（对话、@ 指向、字母笔记）、场景标题和场景切换、导演建议横幅（现在/之后对比、可执行选项、撤销）、大图预览和动作预览、镜头信息栏、镜头卡片（已查看/未查看、字母标注）、场景视频面板（计数、带价格的确认）。

**设计还没画到的：** Plan、Assets、Film 三个标签，开始页和新建影片，设置，导出，失败、服务无回应、停止、恢复这些状态在其他视图里的样子，以及关键帧视图以外的手机布局。这些在 P5 先用 design-artifact-studio、在同一套设计系统里设计，再实现。P5 之前，新界面里的这些标签先跳回旧界面。

**不能动的底线**（来自现有系统，新界面必须遵守）：
- 只有人能启动图片和视频生成。视频必须绑定人看过的确切画面（按画面哈希）、运动、时长和模型。
- 不确定是否成功的付费任务绝不自动重发。
- 编辑带版本校验，旧版本的写入会被拒绝，不会被合并。
- 一次按下对应一个请求身份，丢失回复后重试不会重复扣费。
- 服务商密钥不进浏览器。

**工作方式**（你的全局要求）：
- 小步、可回退。每个提交只做一件事，附测试，`pnpm check` 通过才合并；从 P2 起加 `pnpm check:browser`。
- 涉及数据库迁移的提交先做安装备份（`pnpm installation export`）。
- 浏览器测试只连一次性的示例工作室，绝不连你在 3001 端口上的真实实例。
- 文档放在 `docs/ai/`。
- 每个阶段结束时更新 `docs/implementation/STATUS.md`。

---

## 2. 需要你决定的事

每条都附了推荐。你不回复的话，我就按推荐执行；标了"必须确认"的除外。

| # | 决定 | 推荐 | 影响 | 不按推荐的代价 |
|---|---|---|---|---|
| D1 | 导演的改动是当场生效，还是先提建议等你采纳？ | 会让已付费素材过期、或改时长和旁白的改动，作为"导演建议"挂起等你采纳；不影响素材的纯文字改动当场生效，留回执可撤销 | P4 | 全部挂起会让写脚本阶段很啰嗦；全部当场生效则横幅没有用武之地 |
| D2 | "已查看"门槛是否保留？记录存在哪？ | 保留，设计里有，后端也要求绑定看过的画面。记录存服务端，按画面内容（sha256）记，刷新、换标签页或做无关编辑都不清零 | P1、P2 | 存在浏览器里，换设备或标签页就丢 |
| D3 | 配音什么时候生成？ | 和关键帧一起，一次按下，价格合并显示（例如"3 张关键帧和 2 条配音 约 $0.14"）。这样审阅时就知道配音长度，"配音 7.4 秒、镜头 6 秒"才能提前提示 | P3 | 继续在确认视频时才生成，那么"太长"要到花钱时才发现 |
| D4 | 导演看图（如"外套出来是酱红色"）放在哪一阶段？ | 分两步。P2 先上线应用自己算的检查（配音超长、画面没看、时长超出模型限制），用中性样式和导演建议区分开。导演看图放在 P4，在设置里可开关，因为每批关键帧都会多花模型额度。**必须确认**：P4 开始前，用一次有限的真实测试确认 Codex 0.153.4 能接收图片 | P2、P4 | 现在就做，P4 之前设计的核心体验就不完整 |
| D5 | 导演能不能自己启动付费配音和转写？ | 不能，改成建议，由你按下。现在 V5 允许导演直接花钱 | P1 | 保持现状，"只有人能花钱"这句话就不成立 |
| D6 | 停止的含义 | 全片停止，同时卸下还没发出的任务（之后要重新确认）；提供"继续"；文案说明已发出的任务会完成并计费 | P1 | 保持现状，继续时会不经确认把卡住的任务发出去 |
| D7 | 服务没回应的任务 | 提供"放弃并允许重试"，提示可能扣两次费；晚到的结果存为旧 take | P1 | 不做，这个镜头、整个场景的视频，乃至该模型的并发槽都会被一直占住 |
| D8 | 重新生成和旧 take | 重新生成时保留当前画面，直到新画面成功；可以切回旧 take（新增接口） | P3 | 现在是新画面出来前就卸下旧的，失败时镜头没有画面 |
| D9 | 撤销的范围 | 单步撤销，覆盖手动编辑、配音适配决定和采纳的导演建议；会恢复被弄过期的素材；付费任务已经用了这个状态就不再允许撤销 | P3、P4 | 多步历史会多出一大块后端工作 |
| D10 | 导演工作时你编辑了东西 | P1 先做到不撤销导演，只锁住被改的镜头，并在提交时释放；导演的改动如果碰到你刚改过的字段就被拒，以你的为准。完整的并行在 P4 | P1、P4 | 只在界面上拒绝编辑最省事，但会卡住使用 |
| D11 | 导出 | 服务器按故事板顺序组装，只保留一个导出入口，不再依赖导演写的时间线计划。示例影片可以导出，画面带"示例"水印 | P5 | 保持现状，做完所有场景仍可能无法导出 |
| D12 | 主题和语言 | 新界面先只做深色（设计就是深色），颜色按角色定义，以后可加浅色。中英双语，改用消息 id。**必须确认**：中文术语表，例如 Director=导演、keyframe=关键帧、Opened=已查看、Takes=版本、Director recommends=导演建议 | P2 | 继续用英文句子查表，改一个标点中文就会失效 |
| D13 | 还没设计的视图 | P5 之前，新界面的 Plan、Assets、Film 跳回旧界面对应页面；P5 先设计再实现 | P2、P5 | 直接把旧组件塞进新界面，会把旧问题带进来 |
| D14 | 浏览器测试依赖 | **必须确认**：新增 `playwright-core`（固定精确版本）为根开发依赖，用系统里的 Chrome，单独命令 `pnpm check:browser`，不放进 `pnpm check` | P0 | 不加依赖，就只能手写 Chrome DevTools 协议脚本，更脆 |
| D15 | 价格怎么显示 | 用服务商目录里每次操作的固定估算，显示"约 $x"，并注明是本机设置的估算。视频暂不按时长计价。没有价格的模型（如 Codex 图像）显示"无价格" | P1 | 要按时长准确计价，需要每个服务商的报价接口 |
| D16 | 场景和项目管理 | 场景加独立标题，可删除（素材保留在素材库），可排序。项目可改名，删除做成归档。复制项目放到以后 | P5 | 继续把场景"目的"当标题用 |
| D17 | 动作预览 | 运动是自由文本，预览按关键词猜（推近、拉远、横移、下摇），不改后端 | P2 | 加结构化运动类型需要改数据模型和导演指导 |
| D18 | 新界面何时成为默认 | P4 结束、关键帧视图（含导演建议）达到旧界面同等能力时成为关键帧阶段的默认；P6 全部视图齐了再删旧界面；旧界面入口保留一个版本周期 | P4、P6 | 提前切换会让 Plan、Film 这些还在旧界面的功能来回跳 |

---

## 3. 新设计与现有 app、后端的不兼容点

### 3.1 总表

| 设计里的元素 | 现状 | 需要后端改 | 要做的事 | 条目 | 阶段 |
|---|---|---|---|---|---|
| 带字母的导演笔记（a、b），锚定到镜头，带可执行选项 | 导演只能输出文字，8 个工具里没有能记录笔记的 | 是 | 新工具 `record_notes`，加 `director_note` 记录、解决路由和事件 | DC-1、DC-10、DC-18 | P4 |
| 导演建议横幅：现在/之后对比、采纳/拒绝、撤销 | 改动在同一回合里准备并应用；只有导入方案能挂起草稿；预备改动的影响列表对文字改动是空的 | 是 | 新工具 `propose_change` 挂起建议；应用计算预览；采纳/拒绝/撤销路由；基线变了就重算或作废 | DC-2、DC-3、DC-4 | P4（P2 先显示应用自己算的检查） |
| 导演点评画面（"外套是酱红色"） | 导演只能看到人提供的参考 PNG，看不到生成的关键帧；示例画面是 SVG，传不进去 | 是 | 把关键帧（4 张以内，或拼成一张印样）投进导演上下文，记录看过哪张；关键帧回来后自动开一个只读审阅回合 | DC-7、DC-8 | P4 |
| 采纳建议或手动编辑时，导演不被打断 | 每次编辑都会开新请求，撤销导演回合并放下锁 | 是 | 编辑不撤销导演、只锁被改的镜头并在提交时释放（P1）；"并行"请求和人改优先（P4） | SB-1、DC-5 | P1、P4 |
| 对话里没有"假用户消息" | 服务器在约 20 处把应用的话写成用户消息，导演上下文也当成用户的话 | 是 | 请求加 `source` 字段，迁移旧记录，导演上下文区分 | DC-6、GR-15、LG-6 | P1 |
| @ 指向场景或镜头 | 服务器已接受场景 id，前端只发镜头 id | 否 | 前端改 | DC-14 | P2 |
| 每张画面"已查看"，刷新不丢 | 确认时绑定看过的画面；但"已查看"只存在内存里，而且按项目版本记，任何编辑都会清零 | 是 | `frame-views` 记录，按画面 sha 记 | GR-2、SB-7 | P1、P2 |
| 场景切换胶囊带状态（视频已保存、关键帧已回、未开始） | 没有汇总接口，每个场景一次 GET，前后端判断规则不一致 | 是 | 一个总览读接口，统一状态来源 | GR-1 | P1 |
| 按钮上的价格（约 $1.50、约 $0.04） | 只有服务商目录里的固定估算，没有报价 | 是 | 总览里带报价，确认命令校验报价 | GR-5、SB-11 | P1 |
| 确认并生成视频，一次按下 | 浏览器里的 597 行多步流程，用 localStorage 存检查点、跨标签页加锁 | 是 | 一条持久的服务端命令，重启后能续 | GR-3、LG-12 | P3 |
| 审阅时已经知道配音长度 | 配音只在确认时，或在单镜头面板里生成 | 是 | "关键帧和配音一起生成"命令，配音适配就自动接受 | SB-5 | P3 |
| 镜头改为 8 秒 | 时长编辑可以做，没有视频时也免费；但会打断导演；"加长并接受配音"需要多步 | 是 | 一条命令完成；同时依赖 SB-1 | SB-2 | P1、P3 |
| 保持 6 秒（裁掉配音） | 可以按范围接受配音，但需要会话和多步 | 部分 | 做成一条命令 | SB-3 | P3 |
| 编辑旁白 | 新长度只能估算，真实长度要重新付费生成 | 部分 | P2 先估算并标明；P3 一起重新生成 | SB-4 | P2、P3 |
| 重新生成 2.2，旧画面保留，回到未查看 | 可以重新生成；但新画面出来前就卸下了旧的；不能切回旧 take | 是 | 保留当前画面直到成功；新增"使用旧 take"接口 | GR-6、LG-16 | P2、P3 |
| 撤销 | 只能撤销最后一次手动编辑，还会丢掉素材；配音决定和导演改动没有撤销 | 是 | 存下被卸下的绑定，意图一致才重新绑定；给配音决定和建议加撤销 | SB-9、LG-15、DC-4 | P3、P4 |
| 生成中卡片的进度、视频已保存 | 有阶段和开始时间，没有百分比 | 否 | 按阶段和已用时间显示，不显示假百分比 | GR-17 | P2 |
| 场景 3 生成关键帧 | 已支持 | 否 | 前端 | GR-7 | P2 |
| 失败、服务无回应、过期、排队、停止、恢复（原型没画） | 几种状态混在一起；没有放弃路由；停止后界面没有"继续" | 是 | 总览给出明确状态和原因；放弃路由；停止卸下未发出的任务并提供继续 | GR-9 至 GR-14 | P1、P2 |
| 导出（Film 标签） | 依赖导演写的渲染计划，按计划顺序而不是故事板顺序；示例不能导出 | 是 | 按故事板顺序的导出接口，只留一个入口；示例加水印 | SB-16、SB-17、SB-18 | P5 |
| Plan、Assets、Film、设置、开始页 | 未设计；后端缺场景标题、删除、排序，项目改名、删除，素材库没有音频，音乐和配音混在一起 | 是 | 先设计，再补后端 | SB-13、SB-14、SB-19 至 SB-24 | P5 |
| 中英双语 | 用英文整句当键查表 | 否 | 改用消息 id，错误按服务端错误码映射 | WA-13、WA-14 | P2 |

### 3.2 分领域说明

**导演契约（P4）。** 现在的契约（工具契约 4.0.0、V5 指导）只能产出文字、问题和当场生效的改动。设计需要的是可记录、可解决、可撤销的结构化对象。做法是新增工具契约 5.0.0：
- 在 4.0.0 的基础上加 `record_notes` 和 `propose_change`。
- 旧回合继续用旧契约，旧的描述符一个字都不能改，否则摘要会变。
- 配套 V6 指导：什么时候记笔记、提问、提议或直接改；每个提议只改一件事；没有看到画面时不对画面下结论；花钱的选项永远由人按。

选项的文字（如 "Make 2.3 8 s"）由应用根据类型化的动作生成，模型不写，这样不会再出现标签前后不一致。示例导演要能发出同样的笔记和建议，另外需要一个 3 镜头的 Last Ferry 示例，演示才能复现设计（DC-13）。

**生成与审阅（P1、P3）。** 先加一个总览读接口（GR-1），之后场景胶囊、卡片和视频面板都只读它。做法是先把现在算场景行的代码原样抽成纯函数，新旧两套输出用同一批测试对比，再在上面加：
- 状态：未开始、排队、被锁、进行中、失败、无回应、过期（附上一个 take）；
- 原因、报价和"已查看"。

确认视频（GR-3）变成服务端记录加步骤执行器：每一步的幂等键由确认 id 推出，付费步骤绝不重试，停止会取消还没发出的步骤。关键帧和配音一起生成（SB-5）之后，确认时通常已经没有配音步骤，链路更短。

**故事板与旁白（P1、P3）。** 有三件事必须在新界面上线写操作之前改掉，否则新按钮反而会造成伤害：
1. 编辑不再撤销导演、不再锁住全片（SB-1）；
2. 简介、故事、场景方向的编辑只让意图真正变了的镜头过期（SB-12）；
3. 镜头时长不能短于已经接受的旁白，否则整片的旁白播放会出错（SB-8）。

**导出与项目管理（P5）。** 新的导出接口直接从故事板顺序组装：每个镜头取当前视频、接受的配音和音乐。复用现有的渲染、冻结清单和恢复机制。导演写的渲染节点保留给旧项目，前端只调新接口。

**前端架构（P2–P6）。** 新代码在 `src/next/`：
- 一个注入式的 `ProjectStore`，配纯 reducer；
- 一个把快照转成规范化 `Film` 的适配器；
- 每个区域一组纯选择器。选择器返回状态码和消息 id，不返回英文，并决定每个控件能不能用，替代现在的 47 个 `useState`、全局 `disabled` 和空闲时的停止按钮。

样式是一个令牌文件（取自 DESIGN.md 的颜色角色）加 CSS 模块，不用 Radix Themes。Inter 改为本地托管，因为服务器的 CSP（`font-src 'self'`）会挡住原型用的 Google Fonts。旧界面原样移到 `src/legacy/`，它的 28 个 CSS 文件只在旧入口里加载。

---

## 4. 之前 review 问题的处理台账

来源：第一轮 UI 审查（16 条），研究文件里的"偶然复杂度"清单，重新设计时挑错发现的阻断和主要问题。每条都对照当前代码重新核实过，证据见 [gap-ledger.md](uiux-plan/gap-ledger.md)。

| 条目 | 问题 | 处理方式 | 阶段 |
|---|---|---|---|
| LG-1 | 确认场景的弹窗不显示画面；"已查看"只在内存里 | 新的视频面板就在画面旁边；"已查看"存服务端 | P1、P2 |
| LG-2 | 所有工具都是塞在 380 px 对话栏里的卡片；只有图标的工具栏；顶栏的导出打开在对话里；隐藏 select 撑开网格的布局 bug | 新设计没有对话内工具；布局 bug 在 P0 先给旧界面热修 | P0、P2 |
| LG-3 | 输入框有五种指向状态；选中镜头会悄悄改变范围；镜头编号不一致 | 只保留一种显式的 @ 指向，选中不改变范围 | P2 |
| LG-4 | 同一状态在五六处重复；"已保存/下一步"卡片有 13 种状态，中文下有一个动作失效 | 状态只来自总览接口，每处只显示一次 | P2 |
| LG-5 | 内部术语、原始错误码和命名漂移出现在文案里 | 消息 id 加术语表；错误按错误码映射 | P2 |
| LG-6 | 应用写的"用户消息" | 请求加 `source` 字段 | P1 |
| LG-7 | 一个全局禁用开关；每次加载都先进入恢复只读模式 | 逐控件判断可用性 | P2 |
| LG-8 | 死代码和已退役的花费层 | P0 删除前端死代码（约 3,700 行）；服务端额度和预算路由（482 行）等你确认后卸载 | P0 |
| LG-9 | App.tsx 巨型组件；设置和音频界面过大；本地草稿缓存过度设计 | 新界面结构解决；旧代码在 P6 删除；草稿缓存只保留输入框 | P2、P6 |
| LG-10 | CSS 层层叠加的历代主题 | 一个令牌文件加 CSS 模块 | P2 |
| LG-11 | 用英文整句当 i18n 键 | 消息 id 加 ICU 风格复数 | P2 |
| LG-12 | 确认场景是浏览器多步流程；付费按下的请求身份 | 服务端命令；幂等键强制 | P1、P3 |
| LG-13 | 每次编辑都撤销导演并锁住全片 | P1 部分解决，P4 完整解决 | P1、P4 |
| LG-14 | 文字编辑丢掉已付费素材 | 只让意图变了的镜头过期 | P1 |
| LG-15 | 撤销是单步的、只针对最后一次手动编辑，还会丢素材 | 恢复素材的撤销 | P3 |
| LG-16 | 重新生成先卸下当前画面；不能切回旧 take | 保留到新画面成功；"使用旧 take"接口 | P3 |
| LG-17 | 停止：空闲时也显示；全片暂停；没有继续 | P0 修空闲显示；P1 加卸下未发出任务和继续 | P0、P1 |
| LG-18 | 无回应任务没有放弃路由，会卡住镜头、场景和并发槽 | 放弃路由 | P1 |
| LG-19 | 导演能自己启动付费配音和转写 | 改成待人按下的请求 | P1 |
| LG-20 | 导演建议：没有建议记录，导演看不到画面 | 导演契约 5.0 | P4 |
| LG-21 | 状态和活跃度：每场景一次 GET，等待原因被丢掉 | 总览接口 | P1 |
| LG-22 | 价格：每次固定估算，视频不按时长，Codex 图像为零 | 按 D15 显示"约 $x"或"无价格" | P1 |
| LG-23 | 旁白适配：过长、未决定会挡住视频，模型时长限制 | 应用检查（P2），关键帧和配音一起生成（P3） | P2、P3 |
| LG-24 | Film 和导出：依赖导演写的渲染计划，两个导出入口，示例不能导出 | 按故事板顺序导出 | P5 |
| LG-25 | 开始、设置、会话、示例和项目管理都没设计，部分受后端限制 | 先设计再实现 | P5 |

---

## 5. 分阶段实施计划

下面每个提交都是一个小而可回退的改动，附自己的测试。提交信息用约定式格式，结尾加你要求的署名行。每个阶段结束先停下来给你看结果，你确认后再进下一阶段。

### P0 清理与安全网（约 3–4 天，不改变行为）

**目标：** 在动结构之前减负，修掉旧界面两个明显的问题，搭好浏览器测试。

**提交：**
1. `chore(web): remove unreferenced modules`：删除 NarrationPanel 一族等 7 个无人引用的文件和 3 个 CSS，约 3,700 行（WA-19）。
2. `chore(web): remove the retired spending model and its tests`。
3. `fix(web): keep hidden form controls from scrolling the workspace grid`：给对话流加定位上下文，网格改为 `overflow: clip`。修复打开模型设置后整个工作区被顶出屏幕（WA-17）。
4. `fix(web): show Stop only while something can be stopped`：`canStopWork` 不再把"计划节点没有输出"算进去（LG-17 的一部分）。
5. `chore(web): stop proxying the dev server to the live instance by default`：开发代理改为读环境变量，默认不指向 3001（WA-24）。
6. `test: add a browser check against a disposable studio`：示例工作室脚本加 `--port`，新增 `scripts/browser-check.mjs` 和 `pnpm check:browser`（WA-23，需要 D14）。
7. 可选，需你确认：`chore(server): unmount retired allowance, budget and spending routes`（482 行及其测试）。

**测试：** `pnpm check`。`pnpm check:browser` 在旧界面上走一遍：加载、打开镜头、打开模型设置后工作区不移位、空闲时没有停止按钮。

**完成标准：** 全部通过；旧界面行为不变，只修了上面两个问题。

**回退：** 每个提交可以单独回退。

### P1 后端基础：让状态说真话（约 7 周）

**目标：** 不依赖新界面，先把会让新设计"说假话"或"造成伤害"的后端行为改掉。旧界面同样受益。

**提交**（每条附服务端集成测试）：
1. `feat(server): record who started a request`：请求加 `source`（user、app、director）；应用写的按下不再作为用户消息出现；迁移旧记录；导演上下文把应用的话和用户的话分开（DC-6、GR-15）。
2. `feat(server): require an idempotency key on every paid command`（GR-8）。
3. `refactor(server): extract scene row computation as a pure function`：行为不变，新旧输出用现有场景生成测试对比（GR-1 的准备）。
4. `feat(server): add the generation overview read`：`GET /api/projects/:id/generation` 返回每个场景和镜头的状态（含过期时的上一个 take、take 数）、等待原因、失败原因和报价；按游标缓存，事件到达时失效（GR-1、GR-5、GR-9、GR-11、GR-12、SB-11）。
5. `feat(server): record opened frames by content`：`POST /shots/:shotId/frame-views {artifactId, sha256}`，不加锁、不写消息、不产生授权；总览里的 `opened` 只在画面内容一致时为真（GR-2）。
6. `feat(server): let direct edits leave the Director and other shots alone`：不撤销导演、不取代其他请求；与素材无关的编辑（音乐、排序、加场景或镜头）不加锁；镜头编辑的锁在提交时释放；导演基于旧版本的应用继续被拒（SB-1）。
7. `fix(server): outdate only shots whose intent changed on brief, story and scene edits`（SB-12）。
8. `fix(server): refuse a shot shorter than its accepted narration`：返回可读原因和两个可选做法（SB-8）。
9. `feat(server): make Stop detach unsent jobs and add Continue`：`resume` 需要 `expectedAuthorityId`；新增独立的已停止错误码（GR-13）。
10. `feat(server): allow giving up on a job with no answer`：释放该镜头和该模型的并发槽；晚到的结果存为旧 take，不自动启用（GR-10）。
11. `feat(server): turn Director-started paid audio into a request a person presses`（DC-12，需要 D5）。
12. `fix(server): block a paid press only on a Director turn that covers the same shots`（GR-16）。

**测试：**
- 每条都有正反两类测试，例如：停止后卸下的任务不会在继续时自动发出；放弃后晚到的结果不会变成当前画面；没有幂等键的付费请求被拒；简介编辑不让无关镜头过期。
- 重跑 `pnpm demo:headless` 的离线重启、编辑、导出演示。
- `check:browser` 确认旧界面仍然能走完主流程。

**风险与回退：**
- 第 1 条和第 5 条涉及数据迁移：先做安装备份，迁移只向前，需要回退时恢复备份。
- 第 6、9、10 条碰到钱和完整性，每条单独一个提交，带专门测试，出问题单独回退。

**完成标准：** 服务端测试全部通过；总览接口在示例工作室里能正确反映 Last Ferry 式的状态；旧界面没有退化。

### P2 新界面骨架和关键帧视图（约 8 周，在 `?ui=next` 后面）

**目标：** 在不影响旧界面的前提下，做出设计里的关键帧视图。P2 阶段导演建议横幅先显示应用自己算的检查。

**提交：**
1. `refactor(web): move the current UI into src/legacy`：纯 `git mv`，不改内容，保留 blame（WA-1）。
2. `refactor(web): boot into legacy or next by ui mode`：`main.tsx` 只负责启动；CSS 导入移进旧入口；`?ui=next` 写入 localStorage（WA-1）。
3. `refactor(web): share the transport layer`：`api.ts`、SSE 解析、订阅、类型和命令构造移到 `src/shared/`（WA-2、WA-3）。
4. `feat(web/next): add design tokens, local Inter and base components`：颜色角色取自 DESIGN.md；按钮、胶囊、标签、卡片、开关；不用 Radix Themes（WA-15、WA-16）。
5. `feat(web/next): add message-id i18n with English and Chinese catalogs`：ICU 风格复数，服务端错误码映射成消息（WA-13、WA-14，需要 D12 的术语表）。
6. `feat(web/next): add the project store, snapshot adapter and selectors`：纯函数，附 Last Ferry 黄金样例测试（WA-4、WA-5）。
7. `feat(web/next): decide availability per control`：替代全局禁用和空闲停止（WA-6）。
8. `feat(web/next): add the shell`：52 px 顶栏和标签、392 px 导演栏、窄屏抽屉（WA-21）。
9. `feat(web/next): render the Keyframes view read-only`：场景胶囊、预览和动作预览、镜头信息栏、镜头卡片、场景视频面板；只读总览接口；共享的已校验图片缓存（WA-22、GR-17、GR-18、WA-18、D17）。
10. `feat(web/next): record opened frames`：画面解码并显示后才记录（WA-9）。
11. `feat(web/next): add the request-identity registry and the first writes`：重新生成、为场景生成关键帧、信息栏编辑；每个字段会让什么过期，在保存前说明（WA-7、GR-6、GR-7、SB-10）。
12. `feat(web/next): confirm scene video through an interface`：P2 期间先调用现有流程，P3 换成服务端命令（WA-8）。
13. `feat(web/next): show app-computed checks in the banner`：配音超长、画面没看、时长超出模型限制；用中性样式，和 P4 的导演建议区分开（SB-6、D4）。
14. `feat(web/next): add the Director column`：对话、显式的 @ 指向、示例和真实模式、停止和继续、放弃重试、失败状态、刷新后恢复（WA-11、WA-12、DC-14、DC-15、GR-9、GR-10、GR-13、GR-14）。
15. `feat(web/next): link Plan, Assets and Film to the classic view until they are designed`（D13）。

**测试：**
- `node --test` 覆盖 reducer、适配器和选择器，包括 Last Ferry 黄金样例、每种状态的显示、价格和可用性规则。
- `check:browser` 在 next 上跑场景：看画面计数、重新生成、确认视频、停止和继续、放弃重试、窄屏下不横向滚动。

**完成标准：** 在 `?ui=next` 下，关键帧阶段能完成旧界面在这个阶段能做的所有事。旧界面仍是默认。

**回退：** 新界面在开关后面，关掉开关即可。

### P3 后端接管生成链路（约 5–6 周）

**目标：** 把钱和时序都交给服务器，删掉浏览器里的多步流程。

**提交：**
1. `feat(server): make keyframes and voice lines together`：场景生成增加配音；配音回来后服务端自动绑定到镜头，长度合适就接受，过长就标记"太长"（SB-5，需要 D3）。
2. `feat(server): confirm scene video as one durable command`：新增 `scene_confirmation` 记录和步骤执行器，接在 `index.ts` 的循环里。规则：
   - 每一步的键都由确认 id 推出；
   - 付费步骤绝不重试；
   - 遇到画面变了、配音超长或语音失败就停下并说明原因；
   - 停止会取消还没发出的步骤；
   - 重启后能接着做。

   对应 GR-3、GR-4。
3. `feat(server): add 'make shot N s' and 'keep N s' narration-fit commands`（SB-2、SB-3）。
4. `feat(server): restore media on undo`：存下被卸下的绑定，意图、提示词和时长完全一致才重新绑定；配音适配决定也能撤销；付费任务用过这个状态就拒绝撤销（SB-9）。
5. `feat(server): keep the current keyframe until a new take succeeds and allow using an earlier take`（LG-16、D8）。
6. `feat(web): confirm through the server command in both legacy and next`（WA-8）。
7. `chore(web): delete the browser scene saga`：删除 `scene-confirmation-model.ts`、`scene-continuation-cache.ts`、`scene-command.ts` 及对应缓存（LG-12）。
8. `chore: retire the legacy review read and unused take-history paths`（GR-19）。

**测试：**
- 确认进行到一半时重启服务器，或关掉标签页，任务能继续完成，而且不重复扣费。
- 语音超长、画面已变、语音无回应时，链路停在正确的位置并给出原因。
- 撤销只在意图完全一致时恢复素材。
- 重新生成失败时，当前画面不受影响。

**完成标准：** 关掉页面或重启都不会让付费任务卡在半路；浏览器里不再有检查点和跨标签页锁。

### P4 导演契约 5.0：笔记、建议、看图（约 10 周）

**前置：** 用一次有限的真实测试，确认 Codex 0.153.4 能接收图片输入，以及 MCP 工具结果里的图片是否会传给模型（D4，需要你同意这次真实调用）。

**提交：**
1. `feat(core): add tool contract 5.0.0`：在 4.0.0 基础上加 `record_notes` 和 `propose_change`；用一个统一常量列出支持的契约版本，替换散落在约 30 处的版本号（DC-11）。
2. `feat(skills): add V6 production guidance`（DC-11）。
3. `feat(server): store Director notes and their resolutions`（DC-1、DC-10）。
4. `feat(server): hold Director proposals with a live preview, accept, reject and undo`：
   - 提议基于的镜头没变时自动重算，变了就作废；
   - 采纳的权限来自人，所以提议在来源请求被取代后依然有效；
   - 从恢复的备份导入的项目，提议失效。

   对应 DC-2、DC-3、DC-4、D1。
5. `feat(server): run edits and accepts alongside the Director`：这类请求有自己的锁，但不撤销导演回合；导演的改动如果碰到人在回合开始后改过的字段，就以 `HUMAN_EDITED_FIELD` 被拒（DC-5）。
6. `feat(server): let blocking notes gate the scene video confirm`（DC-9）。
7. `feat(server): project keyframes into the Director's context`：最多 4 张，超过就拼成一张印样；记录投了哪些画面，笔记只能引用投过的画面（DC-7）。
8. `feat(server): start a read-only review turn when a scene's keyframes land`：在设置里可开关（DC-8）。
9. `feat(server): report turn progress and endings honestly, and accept structured answers`（DC-16、DC-17）。
10. `feat(server): make the scripted Director emit notes and a proposal, and add a Last Ferry demo`（DC-13）。
11. `feat(web/next): render notes, the recommendation banner, card callouts and undo`（DC-18、WA-10）。

**测试：**
- 工具契约摘要固定，旧回合仍然用旧契约。
- 提议在基线变化时作废；采纳是幂等的；并行请求不撤销回合。
- 一次有限的真实导演测试：给出两条笔记和一个提议，采纳后撤销，全过程没有付费媒体调用。

**完成标准：** 在真实导演下，关键帧视图端到端符合设计。随后新界面成为关键帧阶段的默认（D18）。

### P5 其余视图（约 7 周加设计）

**设计先行：** 用 design-artifact-studio，在同一套设计系统里设计以下内容，每个都做成可点的原型，给你确认后再实现（D13）：
- Plan：简介、故事、场景和镜头列表、导入脚本；
- Film：时间线、音乐、导出；
- Assets；
- 设置：模型、配音、导演、账号与本机设置；
- 开始页和新建影片；
- 失败、停止和恢复状态；
- 手机布局。

**后端提交：**
- 按故事板顺序的导出接口，只保留一个入口（SB-16、SB-17）；
- 示例影片导出带水印（SB-18）；
- Film 里的编辑不加锁，旧导出标为"已过期"但仍可下载（SB-15）；
- 场景加标题、删除和排序（SB-13）；
- 项目改名和归档（SB-14）；
- 素材库加入音频、镜头关联和有意义的名称（SB-21）；
- 音乐和配音分开，加项目默认旁白声音（SB-24）。

**前端提交：** 每个视图单独提交（SB-19 至 SB-23、LG-24、LG-25）。

**完成标准：** 现有产品能力清单（`capabilities.md` 的必须保留项）在新界面里全部能找到。

### P6 切换和删除（约 1–2 周）

**提交：**
1. 新界面成为全部视图的默认，旧界面入口保留一个版本周期；
2. 删除 `src/legacy/` 和 Radix Themes；
3. 本地草稿缓存只保留输入框（WA-20）；
4. 删除按句子查表的文案模块；
5. 更新 `STATUS.md`、`README.md` 和设计文档（WA-25）。

**完成标准：** 仓库里只剩一套界面；`pnpm check` 和 `pnpm check:browser` 全部通过。

---

## 6. 测试策略

- **纯函数**（选择器、reducer、适配器、价格、可用性、服务端的场景行计算）：`node --test`，放在现有测试目录，接入 `scripts/run-tests.mjs`。
- **服务端行为：** 现有集成测试的写法。每个碰钱的改动都要有"不会重复扣费""不会自动重发""未发出的被卸下"这类反向测试。
- **浏览器：** `pnpm check:browser` 用固定版本的 playwright-core 驱动系统 Chrome，连一次性示例工作室。通过 `data-act` 钩子和 `window.__openslate` 操作，不靠等待时间。
- **离线演示：** 每个阶段结束重跑 `pnpm demo:headless`。
- **真实服务商：** 只在 P4 做一次有限的导演测试，P3 结束后建议做一次短片的真实生成验收。都需要你单独同意，已配置的密钥不等于同意花钱。

---

## 7. 风险登记

| 风险 | 在哪 | 应对 |
|---|---|---|
| 服务端确认流程出错导致重复购买配音 | P3 | 每一步的键由确认 id 推出；结果存在记录里；付费步骤不重试；重启和断线测试 |
| 停止和放弃改变了现有语义 | P1 | 写进变更说明；界面文案明确"已发出的会完成并计费""可能扣两次" |
| 编辑不再撤销导演后，导演基于旧故事板发布计划 | P1、P4 | 保留版本校验；P4 加"人改优先"字段检查 |
| 导演看图增加模型成本和延迟，Codex 版本不支持 | P4 | 先做兼容性验证；可开关；4 张以内用单图，超过用拼图 |
| 数据迁移失败 | P1、P3 | 迁移前安装备份；迁移只向前；失败时恢复 |
| 新旧界面并存期间行为不一致 | P2–P6 | 共享传输层和服务端命令；旧界面只修 bug，不加功能 |
| 设计没覆盖的状态在实现时被临时拼凑 | P2、P5 | 先在原型里补设计再实现；临时状态用中性文案并记在 STATUS.md |
| 中文文案质量和术语不一致 | P2 | 先定术语表（D12），中文由你或指定的人审一遍 |

---

## 8. 还没设计的界面

P5 之前要设计的清单，内容要求见 [gap-storyboard.md](uiux-plan/gap-storyboard.md) 的 SB-19 至 SB-23：

- **Plan：** 简介和故事；场景和镜头列表（标题、目的、时长、旁白）；导入脚本（审阅后确认或放弃）；镜头增删、排序、撤销。
- **Film：** 同步播放画面、旁白和音乐；镜头顺序和计划时长；一条音乐轨（选择、起点、音量、静音）；导出和导出历史；"自上次导出以来有改动"。
- **Assets：** 图片、视频、音频；来源（生成或导入）；关联到哪个镜头；导入。
- **设置：** 导演、关键帧、视频、旁白、转写五类模型；默认旁白声音；个人声音（同意和撤回）；本机设置状态；图片看审开关（D4）。
- **开始页：** 没有密钥时的示例路径；导入脚本；新建影片；从示例复制成真实影片；需要重启时的重新连接页。
- **状态：** 失败、服务无回应、停止、恢复只读、会话过期在每个视图里的样子。
- **手机：** 关键帧视图以外的布局。

---

## 附录 A：全部工作项索引

规模：S≈0.5 天，M≈2 天，L≈4 天，XL≈8 天。"现有后端可直接支持"为"是"的条目只需要前端工作，或现有接口已经够用。LG 开头的是台账条目，多数和其他条目重叠，估算时没有重复计入。每条的现状证据、改动、风险和测试见 [uiux-plan/](uiux-plan/) 下对应的 gap 文件。

| 条目 | 标题（英文原文） | 层 | 规模 | 现有后端可直接支持 | 阶段 |
|---|---|---|---|---|---|
| WA-17 | Fix the first audit's layout bug and make it impossible in next | web | S | 是 | P0 |
| WA-19 | Delete dead code now (phase 0) | web | S | 是 | P0 |
| WA-23 | Test strategy: node --test for pure modules, pinned browser checks on a disposable studio | cross-cutting | M | 是 | P0 |
| WA-24 | Dev proxy must not point at the live instance | web | S | 是 | P0 |
| LG-8 | Dead code and the retired spending layer | cross-cutting | S | 是 | P0 |
| DC-6 | No synthetic user messages: request source + legacy migration + Director context split | server | M | 否 | P1 |
| GR-15 | Paid presses must not insert fake user messages | server | S | 否 | P1 |
| LG-6 | Application-authored 'user' messages in the conversation | server | S | 否 | P1 |
| GR-8 | Request identity for every paid press (no double charge on a lost reply) | cross-cutting | S | 否 | P1 |
| GR-1 | One generation overview read (per-scene and per-shot roll-up, one source of truth) | server | L | 否 | P1 |
| LG-21 | Status and liveness projection: one GET per scene, wait reasons discarded, stale vs never generated, Director status not in SSE | server | M | 是 | P1 |
| GR-5 | Price quote on confirm, regenerate and make-keyframes | server | M | 否 | P1 |
| SB-11 | Prices on Regenerate, keyframes, voice lines and scene video | core | S | 是 | P1 |
| GR-9 | Failed state with honest retry and charge info | cross-cutting | M | 否 | P1 |
| GR-11 | Outdated after an edit, showing the previous take | server | M | 否 | P1 |
| GR-12 | Queued, held and waiting reasons | server | M | 否 | P1 |
| GR-2 | Durable per-frame Opened state bound to frame identity | cross-cutting | M | 否 | P1 |
| SB-7 | Opened-frame state resets on every free edit because its key includes the project revision | web | S | 是 | P1 |
| SB-1 | Direct storyboard edits revoke the Director, supersede requests and place holds that block jobs and export | server | L | 否 | P1 |
| LG-13 | Every hand edit supersedes the active request, revokes the Director's turn and places holds that block dispatch and export | server | XL | 否 | P1 |
| SB-12 | Brief, Story and scene-direction edits detach paid media without cause | server | S | 否 | P1 |
| LG-14 | Text edits detach paid media: Brief/Story detach everything, scene purpose detaches the scene, shot title outdates picture and clip, timeline/render detached on every edit; prompt scaffolding | server | M | 是 | P1 |
| SB-8 | Shortening a shot below its accepted narration is allowed and breaks film playback | server | S | 否 | P1 |
| GR-13 | Stop and Continue that tell the truth | cross-cutting | M | 否 | P1 |
| LG-17 | Stop: visible while idle, film-wide pause, no Continue control, provider jobs not cancelled | cross-cutting | M | 是 | P1 |
| GR-10 | No answer from the provider: give up and allow a new try | server | L | 否 | P1 |
| LG-18 | No-answer jobs: no give-up route, block the shot and the whole scene command, occupy provider capacity | server | M | 否 | P1 |
| DC-12 | Director-started paid audio becomes a recommendation, not an action | server | M | 否 | P1 |
| LG-19 | The Director can start paid speech and transcription by itself | cross-cutting | M | 否 | P1 |
| GR-16 | A press blocked by an unrelated Director question, and a press superseding the Director | server | L | 否 | P1 |
| LG-22 | Cost display: flat per-job estimates, video ignores duration, Codex images zero with unknown quota, spending layer retired | web | S | 是 | P1 |
| WA-1 | Two entry trees behind one boot: legacy (classic) and next | web | M | 是 | P2 |
| WA-2 | Shared session module and a next Connect screen | web | S | 是 | P2 |
| WA-3 | Keep the transport layer (StudioApi, SSE parser, ProjectSubscription) as is | web | S | 是 | P2 |
| WA-4 | Single injected ProjectStore with a pure reducer | web | L | 是 | P2 |
| WA-5 | Snapshot adapter and pure, code-returning selectors | web | L | 是 | P2 |
| WA-6 | Per-control availability replaces the global disabled flag and the idle Stop | web | M | 是 | P2 |
| WA-7 | One request-identity registry for every write, especially paid presses | web | M | 是 | P2 |
| WA-9 | Opened state that survives reload and unrelated edits | web | S | 是 | P2 |
| WA-11 | Composer with one explicit @ target; selection never changes scope | web | M | 是 | P2 |
| WA-12 | No synthetic user messages in the thread | cross-cutting | S | 否 | P2 |
| WA-13 | i18n by message id with ICU-style plurals | web | M | 是 | P2 |
| WA-14 | Errors mapped from server codes to messages | web | S | 是 | P2 |
| WA-15 | One CSS token system matching DESIGN.md colour roles | web | M | 是 | P2 |
| WA-16 | Do not use Radix Themes in the new tree | web | M | 是 | P2 |
| WA-18 | Shared, refcounted artifact cache for verified images | web | S | 是 | P2 |
| WA-21 | Shell layout: 52 px top bar, 392 px Director column, narrow drawer | web | M | 是 | P2 |
| WA-22 | Keyframes view components built on selectors and actions | web | L | 是 | P2 |
| GR-6 | Regenerate one shot's keyframe as a new take; earlier takes kept; shot back to Not opened | web | M | 是 | P2 |
| GR-7 | Make keyframes for a scene that has none (Scene 3) | server | S | 是 | P2 |
| GR-14 | Recovery after reload or server restart | web | S | 否 | P2 |
| GR-17 | Per-card progress while clips are made, and the scene's video-saved state | web | S | 是 | P2 |
| GR-18 | Scene video panel model (pure) replacing conversationSceneState | web | S | 否 | P2 |
| SB-4 | 'Edit narration' can only estimate length; measuring means paid speech again | web | S | 是 | P2 |
| SB-6 | The narration-fit recommendation is derivable; it must not be a Director question | core | S | 是 | P2 |
| SB-10 | Inspector edits: which media each field outdates, plus Regenerate and Takes | web | M | 是 | P2 |
| DC-14 | @-pointing composer with scene and shot scope; scope never follows selection | web | M | 是 | P2 |
| DC-15 | Scripted vs real Director modes in the thread and header | web | S | 是 | P2 |
| LG-1 | Scene video confirmation hides the frames and keeps 'viewed' proof in memory | web | M | 是 | P2 |
| LG-2 | Tools as cards in a 380 px chat column, icon-only toolbar, Export opening in chat, Radix select scroll bug, phone space | web | L | 是 | P2 |
| LG-3 | Composer targeting: five states, selection silently changes scope, inconsistent shot labels | web | M | 是 | P2 |
| LG-4 | The same status in five or six places; Saved / Next card with 13 states and a broken Chinese action | web | M | 是 | P2 |
| LG-5 | Internal vocabulary, raw error codes and naming drift in user copy | web | M | 是 | P2 |
| LG-7 | One global disabled flag; recovery read-only on every load | web | M | 是 | P2 |
| LG-10 | CSS layered generations and the theme system | web | M | 是 | P2 |
| LG-11 | i18n keyed by English sentences | web | M | 是 | P2 |
| SB-5 | Voice lines must be made with the keyframes, by the server, so their lengths are known at review | server | XL | 否 | P3 |
| GR-3 | Scene video confirm as ONE durable server command that settles narration first | server | XL | 否 | P3 |
| GR-4 | Narration length is only known after paid speech; overflow policy at confirm | server | M | 否 | P3 |
| SB-2 | 'Make shot N s' must be one command: lengthen the shot and accept the voice line | server | M | 否 | P3 |
| SB-3 | 'Keep 6 s' (cut the voice line at 6 s) works today but needs a session, has no fade and cannot be undone | server | S | 是 | P3 |
| SB-9 | Undo must restore media and cover narration decisions and compound choices | server | L | 否 | P3 |
| LG-15 | Undo is single-step, only for the latest hand edit, and detaches media even when the edit had kept it | server | M | 否 | P3 |
| LG-16 | Takes: re-roll detaches the current picture first, no take adoption, multiple alternatives block the scene, clips cannot be re-rolled, video whole-scene only | server | L | 否 | P3 |
| LG-12 | Scene confirmation is a browser-run saga; request identity for paid presses | server | L | 否 | P3 |
| GR-19 | Retire the legacy review read and dead take-history paths | cross-cutting | S | 是 | P3 |
| LG-23 | Narration fit and voice: overlong lines, undecided narration blocks video, model duration limits, personal voice and transcription unreachable | web | M | 是 | P3 |
| WA-8 | Video confirmation behind an interface; keep the browser saga only until the server owns the chain | web | M | 是 | P3 |
| DC-1 | Typed, shot-anchored Director notes (record_notes tool + director_note record) | core | L | 否 | P4 |
| DC-2 | Held proposals (propose_change) distinct from today's prepare+apply | server | XL | 否 | P4 |
| DC-3 | App-computed Now/After preview and rebase-or-expire rule for proposals | core | L | 否 | P4 |
| DC-4 | Undo for an accepted recommendation | server | M | 否 | P4 |
| DC-5 | Hand edits, accepts, rejects and note resolutions must not revoke the running Director turn | server | XL | 否 | P4 |
| DC-7 | Let the Director see generated keyframes (app-selected keyframe projection) | server | L | 否 | P4 |
| DC-8 | App-started discuss-only review turn when a scene's keyframes land | server | M | 否 | P4 |
| DC-9 | Blocking recommendations gate the scene video confirm on the server | server | M | 否 | P4 |
| DC-10 | Note resolution routes, staleness, and feeding decisions back to the Director | server | M | 否 | P4 |
| DC-11 | Tool contract 5.0.0 plumbing and V6 skill guidance | skills | L | 否 | P4 |
| DC-13 | Scripted (fake) Director emits real notes and a proposal so demos show the design | server | M | 否 | P4 |
| DC-16 | Honest turn progress and endings in the bottom-anchored thread | server | S | 否 | P4 |
| DC-17 | Structured answers to Director questions, rendered like note choices | server | S | 否 | P4 |
| DC-18 | Web API surface and pure models for notes, recommendations and activity | web | L | 否 | P4 |
| WA-10 | Director notes and the recommendation banner need structured data | cross-cutting | M | 否 | P4 |
| LG-20 | DIRECTOR RECOMMENDS: no recommendation record, the Director cannot see pictures, question options are plain text, prose questions, impact counts empty for creative changes | cross-cutting | XL | 否 | P4 |
| SB-13 | Scenes have no title, cannot be deleted and cannot be reordered | server | M | 否 | P5 |
| SB-14 | Projects cannot be renamed, deleted or duplicated | server | M | 否 | P5 |
| SB-15 | Film-tab edits clear the export, hold the film, and hide the previous export | server | M | 否 | P5 |
| SB-16 | Export needs a Director-written timeline/render plan and uses the plan's shot order | server | XL | 否 | P5 |
| SB-17 | One export surface: the Export view's contents, history and 'changed since' | web | M | 否 | P5 |
| SB-18 | The demo film cannot be exported | server | M | 否 | P5 |
| SB-19 | Film tab view: required contents and timeline/playback gaps | web | L | 是 | P5 |
| SB-20 | Plan tab view: required contents, including brief import | web | L | 是 | P5 |
| SB-21 | Assets tab: the library lacks audio, shot links and meaningful labels | server | M | 否 | P5 |
| SB-22 | Start / new-film flow: required contents and backend constraints | web | M | 是 | P5 |
| SB-23 | Settings view: required contents | web | M | 是 | P5 |
| SB-24 | Music and voice choice: separate music from voice takes, add a project narrator voice and a personal-voice control | server | M | 否 | P5 |
| LG-24 | Film, export and playback: Director-authored render plan, two export mechanisms, demo media refused, music duplicated, no Range or caching on media | server | L | 是 | P5 |
| LG-25 | Start, setup, sessions, demo and project management are undesigned and partly backend-limited | cross-cutting | L | 是 | P5 |
| WA-20 | Retire the local draft cache beyond the composer | web | M | 是 | P6 |
| WA-25 | Rollout sequence and deletion gates | cross-cutting | L | 是 | P6 |
| LG-9 | App.tsx god component, oversized settings and audio UI, over-built local draft cache | web | L | 是 | P6 |
