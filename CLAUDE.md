# CLAUDE.md — 小狼杀（langrensha / xiaolangsha）

> **这是会话交接文档。新会话请先读完本文件（重点看下方「## 现状基线」的最新进度），再按需读 `docs/BUILD-PLAN.md`。M1–M6 与「阶段二重构（顺序夜晚+预女猎+屠边）」均已完成，当前在 M7：手测交付 + 打磨。**
>
> **🎨 进行中：前端重设计（借鉴 wolfcha，落地环形牌桌）。视觉方向已定稿（方案 C），权威计划见 `docs/FRONTEND-REDESIGN.md`，预览基准 `preview/wolfcha-mockup-balanced.html`。下一步从该文档的「阶段 0」开始。逻辑层不动，只改 UI 层。**

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
