# CLAUDE.md — 小狼杀（langrensha / xiaolangsha）

> **这是会话交接文档。新会话请先读完本文件（重点看下方「## 现状基线」的最新进度），再按需读 `docs/BUILD-PLAN.md`。M1–M6 与「阶段二重构（顺序夜晚+预女猎+屠边）」均已完成，当前在 M7：手测交付 + 打磨。**
>
> **🎨 进行中：前端重设计（借鉴 wolfcha，落地环形牌桌）。视觉方向已定稿（方案 C），权威计划见 `docs/FRONTEND-REDESIGN.md`，预览基准 `preview/wolfcha-mockup-balanced.html`。下一步从该文档的「阶段 0」开始。逻辑层不动，只改 UI 层。**
>
> **🤖 已完成（代码层）：AI 玩家提示词顶层重构（人物卡优先「先做人再玩游戏」+ 模块化分层）。见下方「现状基线 › AI 提示词体系重构」。计划/调研留底 `docs/AI-PROMPT-REDESIGN.md` + `docs/AI-PROMPT-RESEARCH.md`。剩余=手测验证（真人当预言家硬跳查杀，好人 AI 不再集体冤神）。**

## 这个项目是什么

单人网页版 **AI 狼人杀**。Vite + React 19 + TypeScript + Zod。`package.json` 里 name 是 `xiaolangsha`，文件夹叫 `langrensha`。

原本由 Codex 用一套极重的「10 阶段 + 双 Agent 审查 + 驳回单 + HITL 门禁」流程推进，结果**文档严重过度工程，但实际能玩的东西为零**（UI 只是 13 行的占位壳子，显示"工程壳已就绪"）。

**当前目标**：保留 Codex 唯一做对的东西（带测试的事件溯源规则引擎），**丢掉那套官僚流程**，按务实的「构建→测试→迭代」节奏，做出**第一版打开浏览器就能和真 LLM（gpt-5.5）对话、从开局玩到复盘**的可玩 MVP。

## 工作方式（重要）

- **去官僚化**：不要执行 Codex 的「阶段推进/驳回单/通过单/双 Agent 审查/HITL」仪式。那套过度工程的流程文档（`Agent.md`/`Skill.md`/`docs/phase-1..8`/`ProjectStatus.md`/`docs/archive`）已删除。唯一保留的旧设计参考是 `docs/phase-5-5-chatroom-mvp-frontend-design.md`（M6 聊天室 UI 布局参照）。「模块边界红线」见下方「可复用核心架构」，已是权威。
- 在分支 `build/mvp-playable` 上工作，按里程碑提交，每个里程碑以「测试绿 或 浏览器能点」为完成标准。

## 已锁定的决策

1. **第一版即接真 LLM 对话**（游戏核心）。脚本AI 照做，但只作为 LLM 调用失败时的**降级兜底**（设计本就要求：AI 失败→重试一次→降级到安全模板/随机合法动作）。
2. AI 用 **OpenAI 兼容**第三方 endpoint，模型 **`gpt-5.5`**。
3. **凭证由用户自己填项目 `.env`**（进 `.gitignore`，只在服务端代理进程读取，绝不进浏览器/git）。只提供 `.env.example` 模板；不替用户填、**不要碰 `C:/vibecoding/auth.json`（那是 Codex 的 key）**。
   - 现有参考（用户可能复用）：`C:/vibecoding/config.toml` 里 `base_url=https://fuck-clau.de/v1`、`wire_api="responses"`、`model=gpt-5.5`。代理默认走 chat completions，加 `AI_WIRE_API=chat|responses` 开关备用。

## 可复用核心架构（保留，勿重写）

**数据模型三层**（`src/shared/models.ts`）：`TruthEvent`（权威事实源，append-only）→ `GameSnapshot`（派生缓存）→ `VisibleInformationSnapshot`（每 viewer 的信息隔离视图）。枚举 `enums.ts`，`GameAction` `actions.ts`，`Result/AppError` `result.ts`，Zod schema `schemas.ts`（**AI 契约 `aiTaskRequestSchema/aiTaskPayloadSchema/aiTaskResponseSchema` 已写好可直接用**）。

**规则引擎唯一入口**：`src/rules/index.ts` 的 `applyAction(action, {session?, snapshot?, events?, now}): Result<{session, events, snapshot, visibleInformation, nextPendingAction?}>`。已实现 create_game→confirm_role_setup→confirm_role_reveal→submit_night_action(+resolveNight)→confirm_day_announcement→submit_speech。每次状态变更走 `buildEvent`+`buildEventId(=${gameId}-${seq}-${type})`，幂等靠 `metadata.idempotencyKey`（重复键→no-op）。`checkWin(players)`(index.ts:1392) 可复用。信息隔离在 `visibility.ts` 的 `buildVisibleInformation`。单板 `mvp_5p_wolf_seer_3villagers`（1狼1预言家3民，1真人+4AI；`allowSelfVote:false, allowAbstainVote:true, maxTieRounds:1, exileLastWords:true, nightDeathLastWords:false`）。

**模块边界红线**（必须遵守）：`shared`←`rules`（rules 只依赖 shared，不碰 UI/storage/AI/React）；`storage` 只持久化；`ai-client` 不持 key、只见 `VisibleInformationSnapshot`；`ai-proxy` 持 key 调 LLM；`store` 只编排不手写 `TruthEvent`；`ui` 只读 `VisibleInformationSnapshot`（**ISO-001 红线**）。完整真相只能在 `review` 阶段经 `buildReviewContext` 组装（**ISO-002 红线**）。

**AI 契约**：AI 输入只给 `VisibleInformationSnapshot`+taskType；输出 JSON `{text?, targetId?, choiceType?, actionType?, analysisSummary?, decisionSummary?}`（后两者只进 metadata 不在局中显示）。`AiClient.respond(req): Promise<Result<AiTaskPayload>>` 是脚本AI↔LLM 的唯一切换接缝；`withFallback(httpAi, scriptedAi)` 实现失败降级。

## 现状基线（2026-06-20 更新）

- **基线绿**：`npx tsc -b` 通过；`npm test` → **16 文件 112 用例全绿**；`npm run build`（tsc+vite）通过。
- **已完成（全部提交在 `main`，最新 commit `e5956e9`）**：
  - M1–M6 全部完成（投票/平票/放逐/遗言、快进+复盘、Dexie 持久化、ai-client 接缝+脚本兜底+Zustand store+driver、ai-proxy Vite 中间件+httpAi+`.env.example`、聊天室 UI）。
  - **阶段二大重构完成**（顺序夜晚 + 主流神职预女猎 + 屠边胜负 + 夜晚信息隔离）：见 commit `07fdba2`（夜晚匿名化止血）、`b6ad726`（规则层）、`e5956e9`（2.8 UI）。
- **当前默认板 = 7 人标准局 `STANDARD_7P_BOARD`**（2狼+2民+预言家+女巫+猎人，屠边）。旧 5 人板 `mvp_5p_*` 仅留作回归测试。
- **下一步 = M7 手测交付**：
  1. 填好项目 `.env`（参照 `.env.example`，不要碰 `C:/vibecoding/auth.json`）。
  2. `npm run dev` → 开 7 人标准局，验证：夜晚只见「天黑请闭眼」无姓名泄漏；真人当女巫（救X/毒谁/放弃）、猎人（开枪/不开枪）、守卫、狼时控件可用；玩到屠边结束看复盘真相。
  3. 降级测试：故意填错 key → 脚本兜底应能全程跑完到复盘不卡死。
  4. 刷新恢复（Dexie）、e2e 冒烟、UI 打磨。

### 前端重设计（2026-06-21 起，进行中）

- **目标**：借鉴 GitHub `oil-oil/wolfcha` 的前端视觉/交互，把朴素聊天室 UI 升级成「深色复古 + 环形牌桌」。逻辑层（store/rules/shared）一行不动，**只改 UI 层**。
- **视觉方向已定稿 = 方案 C → 三列**（左 信息列＝私密+公开面板 ｜ 中 发言流+操作 ｜ 右 紧凑牌桌+速览；当前发言者中央舞台；名字一律座位色+加粗高亮）。
- **权威计划见 `docs/FRONTEND-REDESIGN.md`**（决策、红线、设计 token、信息面板规范、名字着色规范、现有 UI 盘点、阶段计划、验证方式都在里面）。
- **预览基准（已批准）= `preview/wolfcha-mockup-3col.html`**（三列，纯静态稿，双击可看；两列稿 `-balanced` 及 A/B 稿已弃可删）。
- **进度**：阶段 0（token+深色）✅、阶段 1（环形牌桌 SeatRing/Roster + StatusBar 瘦身 + 响应式 + 铺满窗口）✅、阶段 1.5（三列 grid + `InfoPanel` 私密/公开信息面板 + 统一 `PlayerName` 着色组件）✅、阶段 2（DiceBear 头像）✅、阶段 3（天黑/天亮过场 `src/ui/PhaseTransition.tsx` + 舞台高亮进出，framer-motion@12；`body.is-day` 由它按相位驱动）✅、**主页重设计**（`src/ui/HomeScreen.tsx`+`home.css`，深色夜晚氛围：极光/星空/余烬/自转牌桌/呼吸月亮/流光标题 + 两张模式卡片；`App.tsx` 在 `phase===null||"mode_select"` 时整屏渲染，`!ready` 走 `.app-boot`；预览 `preview/home-mockup-v2.html`；132 绿/build 绿）✅、**选身份页重设计**（`src/ui/RoleSelectScreen.tsx`+`home.css` 的 `.rs-*`，复用主页背景；修复旧 `role_setup` 因空壳 vi 渲染出空牌桌的破相；`App.tsx` 在 `phase==="role_setup"` 整屏渲染；落地全局排版红线「按意群断句 `.nb`」见 FRONTEND-REDESIGN.md；预览 `preview/role-select-mockup.html`；132 绿/build 绿）✅。**下一步 = 阶段 4：投票可视化**（详见 FRONTEND-REDESIGN.md）。
- 样式方案：**纯 CSS 变量 + Framer Motion**（不引 Tailwind/组件库）。头像用 DiceBear `adventurer` **本地包**（`@dicebear/core`+`@dicebear/adventurer`，seed=座位号，`src/ui/Avatar.tsx`）。过场动画用 `framer-motion@12`。

### 调试 / 主持人播报（2026-06-21）

- **夜晚主持人播报**：`VisibleInformationSnapshot.nightStatus`（`{currentStepKind, waitingForViewer}`，由 `visibility.ts` 的 `buildNightStatus` 产出，只暴露「当前在等哪类角色」不含具体行动者身份 → 守 ISO-001）。UI 落地：`ActionArea` 夜晚等待文案 +「主持人正在等待预言家查验…」、`MessageStream` 匿名夜晚气泡同播报；标签 `NIGHT_STEP_LABEL`（labels.ts）。
- **驱动停止诊断**：`runAiDriver` 新增 `onHalt(DriverHalt)`，区分 `idle`/`completed`（正常）与 `ai_error`/`invalid_payload`/`rule_rejected`/`max_steps`（异常卡住）；`isAbnormalHalt()` 判定。store 存 `diagnostics`，`App.tsx` 在非 busy 且异常时浮层提示「⚠️ … 请导出日志」（`.halt-banner`）。这是「天黑卡住没动静」的根因可视化。
- **导出日志按钮**：顶部 `StatusBar` 右侧「⛏ 导出日志」→ `store.exportDebugLog()` 返回**复盘式中文摘要（纯文本）**，由纯函数 `src/store/debugSummary.ts` 的 `buildDebugSummary` 生成：四块＝【当前状态】（相位/真人身份/停止原因/最近错误）+【卡点分析】（按相位列「在等谁出手」并标 AI/真人·角色）+【身份真相】（全员角色阵营生死）+【时间线】（关键事件中文一行，含狼刀归属/刀票/查验结果/投票票型，截断+最近 80 条）。下载成 `wolf-debug-<gameId>-seq<NNN>.txt`。比旧 JSON 小一个量级。**仍含完整真相（AI 身份/夜晚密谋），仅 debug 用，不在局内 UI 展示。**
- **中文 label 单一来源**：领域枚举→中文映射（ROLE/PHASE/FACTION/WIN_REASON/NIGHT_STEP/DEATH_CAUSE/NIGHT_ACTION_VERB）已从 `src/ui/labels.ts` 迁到 `src/shared/labels.ts`（ui 与 store 共用，避免 store→ui 依赖环）；`ui/labels.ts` 改为再导出 + 保留 ui 专属 `TASK_THINKING_LABEL`。
- 基线：`tsc -b` 绿、`npm test` **138 绿**、`npm run build` 绿。

### 驱动降级安全网（2026-06-21）

- **修复「AI 出非法动作→整局卡死」**：真 LLM 可能返回「语法合法但规则非法」的动作（实测：女巫在平安夜无刀口时仍选 `witchChoice:"save"` → 规则引擎拒 `Witch cannot use the antidote now.`，第 2 夜女巫步卡死）。旧 `runAiDriver` 一遇 `applyAction` 拒绝就 `rule_rejected` 停死；`withFallback` 只兜底「AI 调用报错」，管不到「返回了非法动作」。
- **落地**：`src/store/driver.ts` 新增降级安全网——AI 步被规则拒绝时，用模块级 `SAFE_FALLBACK_AI = new ScriptedAiClient()`（输出恒为合法动作、ISO-001 安全）对同一步重新决策再 `applyAction` 一次；只有**连脚本安全动作都被拒**才算真异常、才 `rule_rejected` 停。脚本女巫无刀口时返回 `skip`（永远合法），正好化解这一类。新增可选回调 `onDegrade`，`gameStore` 接到后 `console.warn` 留痕（不卡死、仅记录 LLM 出非法动作）。回归测试 `driver.test.ts`「degrades to a safe scripted action…」。
- 基线：`tsc -b` 绿、`npm test` **145 绿**、`npm run build` 绿。

### 删除「快进」、改为出局即自动旁观（2026-06-21）

- **需求**：删掉真人出局后的「快进到结局」功能（没啥用）。真人一死自动进入旁观：对局由 AI 自动打到结束，玩家可静候到结局看复盘，也可**随时直接重开一局**。
- **删除面**：去掉 `request_fast_forward` 动作（`shared/actions.ts`、`schemas.ts`、`rules/index.ts` 的 case + `requestFastForward` 函数）、`fast_forwarding` 相位与 `fast_forwarded` 参与态枚举（`shared/enums.ts` + `labels.ts`/`debugSummary.ts` 对应映射）、UI 的快进/继续旁观按钮。**保留** `fast_forward_*` 事件类型枚举与叙事（惰性历史词汇，避免动持久化事件 schema；已无生产者）。
- **自动旁观**：`driver.ts` 的 `nextDriverStep` 把判据从 `fast_forwarded` 改成 `humanDeadSpectating = participation==="dead_spectating"`——真人一出局，driver 即自动接管（代确认天亮 `auto_confirm_day` + AI 全程）一路推到 review。`rules/index.ts` 的 `confirmDayAnnouncement` 放行 `dead_spectating` 的代确认（原先只放行 `fast_forwarded`）。
- **随时重开**：`confirmNewGame` 放宽——`review` **或** `dead_spectating` 均可开新局（事件 `fromPhase` 用实际相位）。UI `ActionArea` 旁观面板给「直接重开一局」按钮（**不受 `busy` 禁用**，方便观战途中立即重开）。
- **并发安全网（关键）**：旁观自动推进期间 `busy` 全程为 true、旧 driver 仍在 `await` LLM；此时点「重开」会发起新 `dispatch`。`gameStore` 引入闭包 `generation` 代数：每次 `dispatch` 先 `++generation` 认领当前代；`drive(state, gen)` 据此判 `isCancelled`/守 `onStep`/`onHalt`，旧驱动一旦过期立刻停手且**绝不回写**已重置的开局态。`runAiDriver` 新增 `isCancelled?()`（循环顶 + AI await 后各查一次）。回归：`driver.test.ts`「auto-advances…」「stops driving when cancelled」、`fast-forward.test.ts` 重写为旁观自动确认/随时重开。
- 基线：`tsc -b` 绿、`npm test` **145 绿**、`npm run build` 绿。

### AI 提示词体系重构：人物卡优先 + 模块化分层（2026-06-21）

- **目标**：把局内 AI 玩家的 system prompt 从「`handler.ts` 里约 9 块文本线性拼接、逐次累积」重做成「**人物卡优先（先做人再玩游戏）+ L0–L6 分层模块**」，并修「好人 AI 把自信硬跳查杀的真预言家当狼、集体冤神」的系统性 bug。权威计划 `docs/AI-PROMPT-REDESIGN.md`、调研 `docs/AI-PROMPT-RESEARCH.md`。**只动 ai-proxy 提示词层 + shared/personas 数据，逻辑层（rules/store）一行没碰。**
- **治本点**：把「怎么读跳身份/查杀/对跳」的判读知识从零散补在 `vote` 任务里，**上移成一份所有任务都继承的世界模型（L2）**——核心原则：①神职（尤预言家）是好人唯一硬信息源；②跳身份/自信硬跳本身不是破绽，**判真假的唯一触发条件是「对跳」**；③无对跳的孤身单跳查杀默认采信并归票，把真神当狼推＝替狼杀神。好人打法（L3）再把这条落成「采信无对跳单跳查杀 + 保护真预言家」。今后调打法＝改 L2/L3 原则数据，任务层自动继承，不再往任务层拼补丁。
- **分层装配**（`src/ai-proxy/prompt/*`，一层一文件、纯函数、各自可单测；`prompt/index.ts` 薄装配 `buildPrompt`）：L0 `character`（人物卡：职业/性格/判断倾向/打法心智，狼额外加伪装风格——`wolfDeception` **只在自己真是狼时渲染**，绝不漏给好人）→ L1 `table`（入桌+座位/身份/阵营+真人AI不可辨，`describeRole/Faction` 就近）→ L2 `worldModel`（全员同一份，含无警长禁令逐字保留）→ L3 `playbook`（好人/狼人**条件装配**，狼叠加队友名单+悍跳+护队友）→ L4 `reasoning`（私有 analysisSummary / 公开 text 分离 + 与历史一致）→ L5 `task`（各 taskType 动作纪律 + `shuffledTargets` 去偏见，已瘦身：判读移走只留动作）→ L6 `output`（OUTPUT_CONTRACT）。
- **人物卡数据**（`src/shared/personas.ts`）：新增 `NAME_CHARACTERS`（与 `NAME_PERSONAS`/`NAME_DISPOSITIONS` 同键并行）+ `characterForName`，每名加 `profession`/`playMind`/`wolfDeception` 三字段，**手写静态、阵营中立、不含真相**（不采 wolfcha 式每局现生成，留作未来）。`NAME_PERSONAS` 键序绝不动（影响存档复现）。
- **传输/配置拆分**：传输层抽到 `src/ai-proxy/llm.ts`（`sendToLLM`+请求构造+解析，持 key、调 fetch）；`errors.ts`（`proxyError` 共用）；`config.ts` 加 `temperatureForTask`（**发言类 1.0 高温更自然 / 行动投票类 0.4 低温逻辑优先 / 复盘 0.3**）+ `modelForTask`（mini vs review 路由收拢到配置层）。`handler.ts` 瘦身为「校验→装配→调用」，不再内联任何提示词文本。`buildPrompt`/`PromptMessages` 从 `prompt/index.ts` 导出（测试 import 已改指向；`handleAiRespond` 仍出自 `handler.ts`）。
- **ISO 红线守住**：user 段仍精确 `safeStringify(vi)`；新文案对所有 role 跑 `buildPrompt` 均 `not.toMatch(/狼人是|预言家是/)`；好人 system 不含「悍跳」、狼 system 不含「保护真预言家」（条件装配可测）。
- 基线：`tsc -b` 绿、`npm test` **160 绿**（145+15 新：character/worldModel/playbook/config 各模块测试）、`npm run build` 绿。**剩余 = 手测**：真人当预言家首夜查杀一狼、白天硬跳报查杀，预期好人 AI 倾向相信并把票投向被查杀的狼、不再集体踩预言家；发言更有「人味」。

### 提示词精简（压体积）+ 修手测暴露的三毛病（2026-06-21）

- **背景**：上面那版（commit `0517bc5`）真机手测一局发现：①发言又长又雷同、端着分析报告腔；②自我指涉崩坏（6号 AI 在分析、怀疑「6号」＝它自己）；③真预言家潜水、查到金水/查杀全程不报，好人没弹药直接输。**根因＝我为治判读往每条 system prompt 堆了 L2/L3/L4 大段原则，把体积撑胖（实测旧版 system 约 2530–2620 字符/条），弱模型照着写报告、还趋同。**
- **用户硬要求**：提示词设计过重，**重新设计、体积不能太大**。
- **改法（结构不变、各层重写成「短、指令式」，不再堆原则）**：
  - **体积砍约 55%**：实测新版 system **约 1080–1280 字符/条**（好人发言 1079 / 预言家发言 1141 / 投票 1195 / 狼夜晚 1276）。L2 世界模型从 6 大段压成 4 行、L3 打法从 5 条压成 1–2 行、L0 人物卡去掉 `playMind` 渲染（数据仍留 personas）。
  - **L6 输出契约改为 taskType 感知**（`output(taskType)`）：每步只列用得到的字段（发言只列 text，投票只列 choiceType/targetId…），不再每条铺全字段；`analysisSummary/decisionSummary` 仍始终保留；复盘用 `reviewOutputContract` 极简串。
  - **修自我指涉**：L0 每条钉「场上的『N号』就是你本人，别把自己当成需要怀疑的对象」。
  - **修神职潜水**：L3 好人段按 `vi.ownRole` 补一句产信息纪律——预言家「验到金水/查杀别藏，白天大方跳报，别只顾自保潜水」（女巫/猎人各一句）。
  - **修啰嗦**：把「短、大白话、给一个具体判断、别复述、别念报告」放在任务层**最后一行**（离输出最近、权重最高）。
- **红线仍守**：`你的性格：`/`你判断局面的倾向：` 两前缀在；各 role 跑 `buildPrompt` 均 `not.toMatch(/狼人是|预言家是/)`；好人 system 不含「悍跳」、狼不含「保护真预言家」；vote system 仍含 `对跳/话少/保持一致/票数本身不是证据/不代表任何倾向`。
- 基线：`tsc -b` 绿、`npm test` **161 绿**、`npm run build` 绿。**仍待手测验证发言质量是否真的变短变像人、预言家是否肯报信息**（dev server 改提示词后需重启 `npm run dev` 才生效——ai-proxy 是 Vite 中间件、不走前端 HMR）。

## 构建计划（7 里程碑，详见 `docs/BUILD-PLAN.md`）

- **M0** 工程准备：✅ **已完成**——分支 `build/mvp-playable` 已建；`zustand@5`/`dexie@4`/`fake-indexeddb@6` 已装；基线 `npm test` 32 绿。下一步直接进 M1。
- **M1** 投票/平票/放逐/遗言规则（`rules/index.ts` + `visibility.ts` + `voting.test.ts`）。**逐函数详细设计见 `docs/BUILD-PLAN.md` 的「M1 详细实现设计」一节，可直接照做。**
- **M2** 快进 + 复盘上下文（`request_fast_forward`/`confirm_new_game` + `rules/review.ts` `buildReviewContext`）。
- **M3** 持久化 Dexie + 恢复（`src/storage/`）。
- **M4** ai-client 接缝 + 脚本兜底 + Store(Zustand) + AI 自动轮转 driver → 测试可玩。
- **M5** ai-proxy（Vite 中间件 `/api/ai/respond`，OpenAI 兼容 chat completions）+ httpAi 客户端 + `.env.example` → LLM 驱动。
- **M6** 聊天室 UI（StatusBar/MessageStream/ActionArea/TextInput/ReviewPanel，只读 visibleInformation）→ 浏览器里和 gpt-5.5 打一局。
- **M7** 打磨 + 刷新恢复 + e2e 冒烟 + HITL 手测交付。

## M1 头号踩坑点（详见 BUILD-PLAN）

1. 进入 `vote` 时 `voteState` 未初始化 → 在 `submitSpeech` 转 vote 处**新增 voteState 字段**（不动 pendingAction，已核对不破坏 day-speech 测试）。投票是**并行模型**，pendingAction 全程 null，靠 voteState 判合法（需改 `visibility.ts` 的 `getLegalActions`/`canViewerAct`）。
2. event seq 前向引用：放逐结算的 `exileEventId/deathEventId` 按预定 seq 先算后填（仿 resolveNight）。
3. 夜 N>1 重建 nightState 按当前 alive 的狼+预言家（预言家死则只剩狼，防死锁）；夜>1 无首夜护真人。
4. 死亡真人永不分配 pendingAction（仿 resolveNight 守卫），否则快进卡死。
5. fallback/summary 元数据无法经 applyAction 流回（引擎从 controller 推 generatedBy）→ MVP 接受兜底事件标 `ai`。
6. `buildVisibleInformation` 对不在 players 的 viewer 抛错 → role_setup/mode_select 别调它。
7. 幂等键跨 viewer 复用被严格拒绝 → store 每个 action 生成唯一 key。

## 备注

我（上个会话）写的 4 篇记忆在 `C:\Users\DKM99\.claude\projects\C--Users-DKM99\memory\`，但那绑定的是 `C:\Users\user\` cwd，**项目会话不会自动加载**，仅作备份。本 `CLAUDE.md` + `docs/BUILD-PLAN.md` 才是项目内的权威交接。
