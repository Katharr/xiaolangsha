# CLAUDE.md — 小狼杀（langrensha / xiaolangsha）

> **会话交接文档。** 新会话先读本文件，再按需读 `docs/`。本文件只保留**长期有效的信息与约束**；
> 逐次改动的流水账看 `git log`，详细设计看对应的 `docs/*.md`。

## 这个项目是什么

单人网页版 **AI 狼人杀**。Vite + React 19 + TypeScript + Zod。`package.json` 里 name 是
`xiaolangsha`，文件夹叫 `langrensha`。目标：打开浏览器就能和真 LLM（gpt-5.5）对话，从开局玩到复盘。

> 历史背景：本项目原由 Codex 用一套极重的「10 阶段 + 双 Agent 审查 + 驳回单 + HITL 门禁」流程推进，
> 文档严重过度工程而实际能玩的为零。已丢弃那套流程，只保留唯一做对的东西——**带测试的事件溯源规则引擎**。

## 工作方式

- **去官僚化**：不要执行旧的「阶段推进 / 驳回单 / 通过单 / 双 Agent 审查 / HITL」仪式（那批过度工程的流程文档已删）。
  按务实的「构建 → 测试 → 迭代」节奏推进，每步以「测试绿 **或** 浏览器能点」为完成标准。
- 当前在 **`main`** 分支上工作。
- 改 UI/视觉前**先出独立静态 HTML 预览**（`preview/*.html`，硬编码假数据、不碰 `src/`），用户看过满意再落地源码（「眼见为实」）。

## 已锁定的决策

1. **第一版即接真 LLM 对话**（游戏核心）。脚本 AI 只作 LLM 调用失败时的**降级兜底**（失败 → 重试一次 → 降级到安全模板 / 随机合法动作）。
2. AI 用 **OpenAI 兼容**第三方 endpoint，模型 **`gpt-5.5`**。代理默认走 chat completions，`AI_WIRE_API=chat|responses` 开关备用。
3. **凭证由用户自己填项目 `.env`**（进 `.gitignore`，只在服务端代理进程读，绝不进浏览器 / git）。只提供 `.env.example` 模板；
   **绝不要碰 `C:/vibecoding/auth.json`（那是 Codex 的 key）**。

## 可复用核心架构（保留，勿重写）

**数据模型三层**（`src/shared/models.ts`）：`TruthEvent`（权威事实源，append-only）→ `GameSnapshot`（派生缓存）
→ `VisibleInformationSnapshot`（每 viewer 的信息隔离视图）。枚举 `enums.ts`，`GameAction` `actions.ts`，
`Result/AppError` `result.ts`，Zod schema `schemas.ts`（AI 契约 `aiTask*Schema` 已写好）。中文 label 单一来源在 `src/shared/labels.ts`。

**规则引擎唯一入口**：`src/rules/index.ts` 的
`applyAction(action, {session?, snapshot?, events?, now}): Result<{session, events, snapshot, visibleInformation, nextPendingAction?}>`。
每次状态变更走 `buildEvent` + `buildEventId`，幂等靠 `metadata.idempotencyKey`（重复键 → no-op）。`checkWin` 可复用。
信息隔离在 `visibility.ts` 的 `buildVisibleInformation`。投票是**并行模型**（pendingAction 全程 null，靠 voteState 判合法）。

### 模块边界红线（必须遵守）

`shared` ← `rules`（rules 只依赖 shared，不碰 UI/storage/AI/React）；`storage` 只持久化；
`ai-client` 不持 key、只见 `VisibleInformationSnapshot`；`ai-proxy` 持 key 调 LLM；`store` 只编排不手写 `TruthEvent`；
**`ui` 只读 `VisibleInformationSnapshot`（ISO-001 红线）**。完整真相只能在 `review` 阶段经 `buildReviewContext` 组装（**ISO-002 红线**）。

### AI 契约与提示词

- AI 输入只给 `VisibleInformationSnapshot` + taskType；输出 JSON
  `{text?, targetId?, choiceType?, actionType?, analysisSummary?, decisionSummary?}`（后两者只进 metadata、不在局中显示）。
  `AiClient.respond` 是脚本AI ↔ LLM 的唯一切换接缝；`withFallback(httpAi, scriptedAi)` 实现失败降级。
- **提示词分层**（`src/ai-proxy/prompt/*`，一层一文件、薄装配 `prompt/index.ts` 的 `buildPrompt`）：
  L0 人物卡 → L1 入桌 → L2 世界模型 → L3 阵营打法/角色战术卡 → L4 推理 → L5 任务 → L6 输出。
- **提示词必须小而精**（弱模型对长 prompt 敏感：越胖越像念报告、越趋同）；原则少而精、每层一两行，关键约束放任务层最后一行。
  权威设计/调研：`docs/AI-PROMPT-REDESIGN.md` + `docs/AI-PROMPT-RESEARCH.md`。
- ai-proxy 是 **Vite 中间件、不走前端 HMR**——改提示词后必须**重启 `npm run dev`** 才生效。

### 当前默认板

`STANDARD_7P_BOARD` = 7 人标准局（2 狼 + 2 民 + 预言家 + 女巫 + 猎人，屠边胜负，**无守卫**，顺序夜晚）。
旧 5 人板 `mvp_5p_wolf_seer_3villagers` 仅留作回归测试。

## 现状基线

- **基线绿**：`npx tsc -b` 通过；`npm test`（vitest）全绿；`npm run build`（tsc + vite）通过。提交规范见全局 CLAUDE.md（**不加 Claude 署名**；push 走 Clash 代理 7897）。
- M1–M7 的规则引擎 / store / driver / ai-proxy / 聊天室 UI 主体均已完成。近期里程碑（细节见 `git log` 与 `docs/`）：
  顺序夜晚 + 预女猎 + 屠边重构、Dexie 持久化、driver 降级安全网、真人出局即自动旁观、并发投票、
  前端深色环形牌桌重设计、AI 提示词人物卡优先重构 + 精简 + 角色战术卡。

### 进行中 / 下一步

- **前端重设计**（逻辑层不动，只改 UI 层）：阶段 0–4 + 主页 / 选身份页已完成。**当前布局 = 「圆桌剧场」单行三列**
  （左过程档案｜中大牌桌·座位铭牌+桌心铭牌｜右发言流+操作），StatusBar/Roster 已删除（信息上桌）；
  **投票全程保密**（投票中零计票 UI，一切票向/票数只在 vote_resolved 揭示——用户拍板的红线）。
  **下一步 = 阶段 5 复盘时间线**。权威计划 `docs/FRONTEND-REDESIGN.md`，预览基准 `preview/vote-mockup-v3.html`。
- **阶段 4 落地后待手测**：投票→开票揭示动画→平票加赛→放逐全链、刷新恢复直出终态不重播、5 人板牌桌不崩。
- **AI 提示词**：代码已落地，剩**手测验证**（真人当预言家硬跳查杀，好人 AI 不再集体冤神；发言像人、不雷同）。

## 构建计划与手测交付

7 里程碑详见 `docs/BUILD-PLAN.md`（M0 工程准备 → M1 投票/平票/放逐/遗言 → M2 复盘上下文 → M3 Dexie 持久化
→ M4 ai-client+store+driver → M5 ai-proxy+httpAi → M6 聊天室 UI → M7 打磨手测）；M1–M6 + 阶段二重构已完成，当前在 M7。

**M7 手测步骤**：① 填项目 `.env`（参照 `.env.example`，别碰 `C:/vibecoding/auth.json`）；
② `npm run dev` → 开 7 人标准局，验证夜晚只见「天黑请闭眼」无姓名泄漏、各神职控件可用、玩到屠边看复盘真相；
③ 降级测试：故意填错 key → 脚本兜底应全程跑完到复盘不卡死；④ 刷新恢复（Dexie）、e2e 冒烟、UI 打磨。
