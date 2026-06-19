# 小狼杀 MVP 实现计划：从「跑测试的规则引擎」到「浏览器里和 gpt-5.5 打一局」

## Context（为什么做这件事）

项目 `C:/vibecoding/langrensha`（package 名 `xiaolangsha`）是一个单人网页版 AI 狼人杀，原先由 Codex 用一套极重的「10 阶段 + 双 Agent 审查 + 驳回单 + HITL 门禁」流程推进。结果是：**文档/流程极度过度工程，但实际能玩的东西为零**。

体检结论：
- ✅ **好的部分**：一套事件溯源的规则引擎（`src/shared` + `src/rules`），32 个测试全过，`npm run build` 通过。数据模型干净（`TruthEvent` 权威事实 → `GameSnapshot` 派生 → `VisibleInformationSnapshot` 信息隔离），`GameAction` 协议带幂等键，`Result/AppError` 错误协议。已实现：开局→补位→揭示→首夜→夜晚结算→天亮播报→顺次发言→胜负判定。
- ❌ **烂/缺的部分**：UI 是 13 行的假壳子（只显示"工程壳已就绪"）；投票/平票/放逐/遗言只是半成品 WIP；持久化、状态编排、AI 接入、聊天室全部为零。

**目标**：保留规则引擎这块好料，丢掉 Codex 那套官僚流程，按务实的「构建→测试→迭代」节奏，做出一个**第一版就能在浏览器里和真 LLM（gpt-5.5）对话、从开局玩到复盘**的可玩 MVP。

## 已锁定的决策

1. **第一版即接真 LLM**。LLM 对话是这游戏的核心，不做"纯脚本版先交付"的中途停顿。脚本AI 照样实现，但**仅作为 LLM 调用失败时的降级兜底**（设计文档本就要求 AI 失败→重试一次→降级到安全模板/随机合法动作）。
2. **Provider 无关，OpenAI 兼容**。endpoint = 用户的第三方 OpenAI 兼容地址，模型 `gpt-5.5`。
3. **凭证由用户自己填 `.env`**。我搭好 `.env.example` 模板 + 代理代码；用户把 `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` 粘进 `.env`。`.env` 进 `.gitignore`，key 只在服务端代理进程读取，**绝不进浏览器、绝不进 git**。不碰 Codex 的 `auth.json`。
4. **丢掉 Codex 的双 Agent 流程**。那套阶段/驳回单/HITL 流程文档已删除，仅保留 `docs/phase-5-5-chatroom-mvp-frontend-design.md` 作 M6 UI 布局参考。M7 收尾时新建一份精简 `ProjectStatus.md`。
5. **模块边界仍遵守**（这是设计里唯一值得留的纪律）：`shared`←`rules`；`storage` 只持久化；`ai-client` 不持 key、只见 `VisibleInformationSnapshot`；`ai-proxy` 持 key、调 LLM；`store` 只编排不手写事实；`ui` 只读 `VisibleInformationSnapshot`（ISO-001 红线）。

## 技术细节（落地前定好）

- **状态管理**：加 `zustand`（设计指定、轻量）。
- **持久化**：加 `dexie`（IndexedDB）；测试用 `fake-indexeddb`。
- **AI 代理形态**：本地用 **Vite dev-server 中间件插件**（`/api/ai/respond`），key 留在 dev-server 进程里。保持该 contract，未来可平移到 Vercel/Express 函数。
- **LLM 线格式**：现有 Codex 配置是 `wire_api = "responses"`，但 Chat Completions（`/v1/chat/completions` + `response_format: json_object`）最通用。代理默认走 Chat Completions，并加一个 `AI_WIRE_API=chat|responses` 开关；M5 验证时若端点只支持 responses 就切过去。
- **AI 输出契约**：复用已存在的 `aiTaskRequestSchema` / `aiTaskPayloadSchema` / `aiTaskResponseSchema`（schemas.ts 里已写好并有测试）。AI 返回 `{text?, targetId?, choiceType?, actionType?, analysisSummary?, decisionSummary?}`，Zod 校验，`analysisSummary/decisionSummary` 只进 metadata 不在局中显示。

---

## 构建顺序（7 个里程碑，每个以「测试绿」或「能点」收尾）

### M0 — 记忆 + 工程准备
- **记忆**：把可复用的关键事实写入长期记忆（`~/.claude/.../memory/`）：项目定位、规则引擎数据模型与 `applyAction` 入口、模块边界红线、AI 契约、"脚本AI=LLM 兜底"路线、踩坑点（见下方 Risks）。更新 `MEMORY.md` 索引。
- **git**：从当前 `restore-c4fb78d-progress` 开一个干净工作分支（如 `build/mvp-playable`），逐里程碑提交。
- **依赖**：`npm install zustand dexie` + `npm install -D fake-indexeddb`。
- 验证：`npm test` 仍 32 绿、`npm run build` 通过。

### M1 — 投票/平票/放逐/遗言规则（切片6）
改 `src/rules/index.ts`、`src/rules/visibility.ts`；新增 `src/rules/voting.test.ts`。shared 不动（类型/schema 已齐）。
- 在 `applyAction` switch 加 `submit_vote` / `submit_tie_speech` / `submit_last_words` 三个 case。
- `submitVote`：**首票时惰性初始化 `voteState`**（关键——`submitSpeech` 进入 `vote` 时只设了 `pendingAction:null`，没建 `voteState`；不能改 `submitSpeech`，否则破坏现有 day-speech 测试对 `pendingAction toBeNull` 的断言）。校验：存活、在 `eligibleVoterIds`、未重复投、`target` 需 `targetId` 且合法非自投、`abstain` 合法。每票发 `vote_submitted`（`public:false, visibleTo:[voterId]`，结算前不公开票型）。全员投完→`resolveVote`。
- `resolveVote`：唱票（弃票不计）→ 发 `vote_resolved`（`public:true`，payload 含 tally，**只含 seat/id 不含身份**）。分支：唯一最高→`exile_resolved`+`player_died`（`deathCause:"exile"`, `isRoleVisiblePublicly:false`）→`exile_last_words`→`checkWin`→review/下一夜；首轮平票→`tie_speech`→`tie_vote`（`voteRound:"tie_break"`, 候选=并列集）；二次平票（`maxTieRounds=1` 用尽）→无人放逐→`checkWin`→下一夜。
- `submitTieSpeech` ≈ `submitSpeech` 的克隆（phase `tie_speech`，发 `tie_speech_submitted`）。`submitLastWords`：发言者须为被放逐者，发 `last_words_submitted`，然后跑被延后的 `checkWin`→相位推进。
- **回到夜晚（夜 N>1）**：按当前存活的狼+预言家重建 `nightState.requiredActorIds`（预言家若死则只需狼）；`isLegalNightTarget` 的"首夜护真人"只在 night===1 生效，后续夜可刀真人（正确）。
- `visibility.ts` `getLegalActions` 加 `vote/tie_vote/tie_speech/exile_last_words` 分支（`canViewerAct` 已按 `pendingAction.actorId` 判断，自动覆盖）。
- 验证：`voting.test.ts` 覆盖 唯一放逐→遗言→下一夜、平票循环、二次平票无放逐、放逐后胜负、自投/投死人/重复投/出相位 拒绝、弃票接受、幂等重放 no-op、`expectNoRoleLeakInPayloads`（从 day-speech.test.ts 复制 ISO 守卫）、seq 单调。

### M2 — 快进 + 复盘上下文（切片11 的规则侧）
改 `src/rules/index.ts`；新增 `src/rules/review.ts`、`src/rules/fast-forward.test.ts`。
- `request_fast_forward`：仅真人已死时合法，置 `humanParticipationState:"fast_forwarded"`→`fast_forwarding`。引擎不自动模拟，由 store 驱动循环跑 AI 直到 review。规则侧只需保证**死亡真人永不被分配 `pendingAction`**（resolveNight 已有此守卫 index.ts:669-680，在 resolveVote/submitLastWords 复刻）。
- `confirm_new_game`：仅 `review` 合法，回到 `mode_select` 空快照（store 据此清存储）。
- `src/rules/review.ts` 的 `buildReviewContext(session, players, events)`：**唯一**组装完整真相的地方，**只在 `gamePhase==="review"` 时被 store 调用**（ISO-002 红线在调用点强制）。
- 验证：死真人→快进→状态翻转且不被卡；`buildReviewContext` 含全部发言/夜晚行动/胜负。

### M3 — 持久化（Dexie）+ 恢复
新增 `src/storage/`（只依赖 shared + dexie）：`db.ts` `repository.ts` `recovery.ts` `index.ts` + `repository.test.ts`（fake-indexeddb）。
- Dexie 表：`currentGame`(gameId)、`events`(eventId, 索引 `[gameId+seq]`)、`snapshots`(gameId)、`settings`(key)。
- repository 函数返回 `Result<T>`：`saveGameState`（一个事务里 append events + put snapshot + put currentGame，**原子写**保证不分叉）、`loadCurrentGame`、`appendEvents`（按 eventId 去重幂等）、`clearCurrentGame`、settings。错误映射 `STORAGE_SAVE_FAILED/LOAD_FAILED`。
- `recovery.ts`：load → 用 `gameSnapshotSchema.safeParse` 校验快照；有效且 `lastEventSeq` 对齐则用；损坏/缺失→MVP 策略是因原子写不会分叉，快照 parse 失败即 `clearCurrentGame` 重来（完整 `foldEvents` 重放列为已知限制，先做 `players_assigned`+`player_died`+`phase_changed` 的最小折叠够过验收）。
- 验证：save→load 往返一致；appendEvents 重复 eventId 幂等；损坏快照走恢复路径。

### M4 — ai-client 接缝 + 脚本兜底AI + Store(Zustand) + 驱动循环
新增 `src/ai-client/`（`types.ts` `scriptedAi.ts` `withFallback.ts` `index.ts`）和 `src/store/`（`gameStore.ts` `driver.ts` `messages.ts`）+ `driver.test.ts` `scriptedAi.test.ts`。
- **`AiClient` 接口**（唯一接缝）：`respond(req: AiTaskRequest): Promise<Result<AiTaskPayload>>`，永不抛、失败→`Result` err。`scriptedAi` 和后面的 `httpAi` 都实现它，换 LLM 只改 app 装配一行。
- **脚本AI**（确定性、仅见 `VisibleInformationSnapshot`，按 gameId+seq 播种）：夜晚从 `legalActions[].legalTargets` 随机合法目标；投票随机合法目标（AI 预言家可用自己的 `privateEvents` 查验结果）；发言/拉票/遗言用模板文本。所有输出都是合法 `AiTaskPayload`，恒 `ok(...)`——保证 LLM 全挂时游戏照样跑完。
- **`withFallback(primary, scripted)`**：primary 返回 err 时调脚本兜底（M4 里 primary 就是脚本，恒等；M5 起 primary 换 httpAi，失败才兜底）。
- **Store（Zustand）**：`{session, snapshot, events, visibleInformation(真人视角), messages, busy}` + actions。核心是单一漏斗 `dispatch(action)`：`applyAction` → 失败则推系统错误消息、不改状态 → 成功则更新 state、`storage.saveGameState`、派生 messages、`runDriver()`。Store **永不手写 TruthEvent**，每个 action 自带唯一 `idempotencyKey`。
- **`driver.ts` AI 自动轮转**：循环取 `pickNextAiActor`（夜晚遍历 `nightState.requiredActorIds` 里未提交的 AI；否则 `pendingAction.actorId` 若为 AI）→ 为该 AI 算 `buildVisibleInformation`（只给它该看的）→ `ai.respond` → `payloadToAction` 转成 GameAction → 走同一 dispatch。轮到真人或真人已死未快进→停，等 UI。真人死亡快进时无人工 pending，循环跑到 review。
- 验证：注入脚本AI，从 create 驱动到 review 拿到 winner；spy 确认 AI 只收到 `VisibleInformationSnapshot`（ISO-001）；ai-client 返回 err→兜底仍出合法动作、游戏继续。

### M5 — ai-proxy（Vite 中间件，gpt-5.5）+ httpAi 客户端 → 真 LLM 驱动
新增 `src/ai-proxy/handler.ts` `vitePlugin.ts`、`src/ai-client/httpAi.ts`、`.env.example`；改 `vite.config.ts`。
- `.env.example`：`AI_BASE_URL=`、`AI_API_KEY=`、`AI_MODEL=gpt-5.5`、`AI_WIRE_API=chat`。`.env` 入 `.gitignore`。
- `handler.ts`（`POST /api/ai/respond` 核心，框架无关）：`aiTaskRequestSchema` 校验 → `buildPrompt`（system=狼人杀规则+该 AI 角色+任务指令要求返回 JSON；user=序列化的 `visibleInformation`，局中绝不含超出可见信息的真相；review 才用 `reviewContext`）→ `callLLM`（OpenAI 兼容 `/chat/completions`，`response_format: json_object`，`Authorization: Bearer`，AbortController 超时→`AI_TIMEOUT`，网络失败→`AI_UNAVAILABLE`）→ 解析+`aiTaskPayloadSchema` 校验，失败→`AI_JSON_INVALID`。`AI_WIRE_API=responses` 时切 `/v1/responses` 线格式。
- `vitePlugin.ts`：`configureServer` 注册 `/api/ai/respond` 中间件，读 body→`handleAiRespond`→回 `Result<AiTaskPayload>` JSON。key 留进程内。加入 `vite.config.ts` plugins。
- `httpAi.ts`（实现 `AiClient`）：`fetch('/api/ai/respond')` → `aiTaskResponseSchema` 校验 → **内部重试一次** → 仍失败返回 err。app 装配成 `withFallback(new HttpAiClient(), scriptedAi)`。**至此 driver 由 gpt-5.5 驱动，失败自动降级脚本、UI 提示"AI 降级"。**
- 验证：mock fetch（合法 JSON→采用 / 坏 JSON→兜底 / 超时→兜底）；ISO 检查代理请求体只含 `visibleInformation`/`reviewContext`；**手动**：填真 `.env`、`npm run dev`、驱动一局观察 LLM 真发言。

### M6 — 聊天室 UI → 浏览器里能和 gpt-5.5 打一局
新增 `src/ui/`（`StatusBar` `MessageStream` `ActionArea` `TextInput` `ReviewPanel`），重写 `src/App.tsx`；`src/store/messages.ts` 映射器；扩展 `src/App.test.tsx`。
- 布局（按 phase-5.5 文档）：固定视口，顶部状态栏 / 消息流（仅此滚动）/ 结构化操作区 / 文本输入。
- `messages.ts`：**只从 `store.visibleInformation` + pendingAction + AppError 派生**（ISO-001：组件物理上拿不到 snapshot/events）。`publicEvents`→`host`/`vote_result`；`privateEvents`→`private_info` 加 `[仅你可见]` 前缀；`speeches`→`human_speech`/`ai_speech`（原文逐字）；`votes`→结算后才显示票型；`legalActions`→`action_prompt`+按钮；AppError→`system`。
- `StatusBar`：相位/轮次/你的身份(仅自己)/存活玩家(座位·你或AI·生死)。**不显示 AI 身份、不显示真相日志。**
- `ActionArea`：按 `gamePhase × humanParticipationState` 切换按钮→`GameAction`（开局两模式/选身份/确认进夜/夜晚选目标/进入发言/发送发言/投票(自投按钮禁用)+弃票/拉票发言/二次投票/遗言/复盘问答）。`dead_spectating` 全程只读+「快进到结局」「继续旁观」。按钮带 `idempotencyKey`，`busy` 时禁用。
- `TextInput`：仅在 发言(轮到你)/拉票/遗言/复盘问 时启用；上限 发言 500、复盘问 300；纯文本渲染；失败留草稿、成功清空。
- `ReviewPanel`：`review` 时显示 store 构造的 `ReviewContext` 完整真相 + 问答输入（→ ai-client `review_question`）。
- 验证：扩展 `App.test.tsx`（注入脚本AI）点「开始标准局」→断言状态栏显示身份→走到投票→投票→到 review；断言复盘前不出现 AI 身份文本、自投禁用。

### M7 — 打磨 + 交付验收
- AppError→中文消息映射；死亡旁观/快进边界（快进失败回 `dead_spectating` 只读）；新开局清存储不串档；刷新恢复（`bootstrap()`→`recoverGame()`）。
- 一条 start→review 的 e2e 冒烟（标准局 + 自由局）。
- 新建一份精简 `ProjectStatus.md`（一次，记录新架构与"能玩"状态，不重启 Codex 仪式）。
- **HITL 交付**：填好 `.env`、`npm run dev`、你亲自从开局玩到复盘，和 gpt-5.5 的 AI 玩家对话验收手感。

---

## 投票规则决策表（M1 实现参照）

| 情形 | 结果 |
| --- | --- |
| 首轮唯一最高票 | 放逐该玩家→遗言→checkWin→review/下一夜 |
| 首轮平票(≥2 并列) | →tie_speech(并列集,按座位)→tie_vote |
| 二次唯一最高票 | 放逐，同上 |
| 二次又平票 | maxTieRounds(1)用尽→**无人放逐**→checkWin→下一夜 |
| 全员弃票/无有效票 | 视为无放逐→下一夜 |
| 自投 | 拒绝(allowSelfVote=false)，不写事实 |
| 投死人/非法目标 | 拒绝 |
| 弃票 | 接受(allowAbstainVote=true) |
| 同人重复投 | 拒绝；同 idempotencyKey 重放→no-op |
| 放逐身份 | 死亡记录 `isRoleVisiblePublicly:false`，**局中不公开身份** |
| 遗言 | 仅放逐者有(nightDeathLastWords=false，夜死无遗言) |

## Risks / 踩坑点（来自实读现有代码）

1. **`vote` 进入时 `voteState` 未初始化** —— 头号坑。必须在 `submitVote` 惰性建 `voteState` 并设首个 pending voter，**不能改 `submitSpeech`**（会破坏 day-speech 测试的 `pendingAction toBeNull` 断言）。
2. **前向引用的 event seq** —— `buildEventId` 是 `${gameId}-${seq}-${type}`，放逐结算要发一串事件且 `deathEventId` 前向引用未来 seq；先按序算好 seq 再回填交叉引用，或对 exile 简化不做链接（MVP UI 不遍历）。加 seq 单调测试。
3. **夜 N>1 重建** —— 按当前存活重建 `requiredActorIds`，否则要求死亡 actor 会死锁。
4. **死亡真人永不分配 pendingAction** —— resolveVote/submitLastWords 必须复刻 resolveNight 的守卫，否则快进卡死。
5. **fallback/summary 元数据无法经 `applyAction` 流回** —— 现引擎从 `actor.controller` 推 `generatedBy`，无法表达 `generatedBy:"fallback"` 与 `analysisSummary`。MVP 接受兜底事件标为 `ai`，列为已知限制（如需真标记，给 `RuleEngineContext` 加可选 `metadataOverride`，但那动了 rules 边界，权衡后再说）。
6. **`buildVisibleInformation` 对不在 players 的 viewer 抛错** —— `role_setup`/`mode_select` 阶段 store 不要调它。
7. **幂等键跨 viewer 复用被严格拒绝** —— store 每个 action 生成唯一 key。
8. **UI 的 ISO-001 靠构造保证** —— selector 只暴露 `visibleInformation`+`messages`+`legalActions`，组件物理上读不到 snapshot/events。

## 端到端验证方式

- 单元/集成：`npm test`（M1 投票、M2 快进/复盘、M3 存储、M4 驱动、M5 代理 mock、M6 UI 各一组），全绿。
- 构建：`npm run build`（tsc + vite）通过。
- 真 LLM 手测：用户填 `.env`(`AI_BASE_URL`/`AI_API_KEY`/`AI_MODEL=gpt-5.5`) → `npm run dev` → 浏览器开局 → 观察 AI 玩家由 gpt-5.5 真发言、夜晚行动、投票 → 玩到复盘并对 AI 追问。
- 降级验证：临时把 `.env` key 改错 → 游戏仍能用脚本兜底跑完，UI 显示降级提示。

## 流程说明（去官僚化）

不再执行 Codex 的「阶段推进/驳回单/通过单/双 Agent」仪式。`docs/` 留作设计参考。工作在新分支上按里程碑提交，每个里程碑以"测试绿或浏览器能点"为完成标准。

---

# M1 详细实现设计（已定稿，可直接照此编码）

> 已通读 `src/rules/index.ts`(1473行)、`visibility.ts`、`models.ts`、`enums.ts`、`actions.ts`、`schemas.ts`、`boards.ts`、`day-speech.test.ts`。以下是逐函数定稿设计。

## 关键决策：voteState 在 submitSpeech 进入 vote 时初始化（而非 submitVote 惰性初始化）
原因：投票是**并行**的（所有存活玩家各自投票、结算前不公开），`pendingAction` 全程为 `null`。若 voteState 不在进入 vote 时建好，`visibility.ts` 的 `canViewerAct`（非夜晚阶段只看 `pendingAction?.actorId===viewer`）会让所有人都不能投票。
**已逐条核对**：在 `submitSpeech` 最后一段（全部发言完成、转 vote）只**新增** `voteState` 字段并把 `round.voteRound` 设为 `"first"`，**不改 `pendingAction`（仍为 null）**。day-speech 的 5 个测试只断言 `gamePhase/pendingAction/speechState/events`，不碰 `voteState`/`round`，所以不会破坏。`getBoardConfig(session.boardId)` 可在 submitSpeech 内取 `allowAbstainVote`。

## 投票为并行模型，靠 voteState 而非 pendingAction
- `vote`/`tie_vote` 阶段 `pendingAction` 恒为 `null`；合法性完全由 `voteState`（eligibleVoterIds/submittedVoterIds/candidateIds/allowAbstain/resolved）判断。
- `tie_speech`/`exile_last_words` 是**顺序**的，有 `pendingAction.actorId`（当前拉票者/被放逐者），`canViewerAct` 默认分支已覆盖。

## round.voteRound 的设置
- submitSpeech→vote：`round.voteRound="first"`
- submitTieSpeech→tie_vote：`round.voteRound="tie_break"`
- finishDayResolution→night：`round.voteRound="none"`
vote 事件 payload 里也冗余存 `voteRound`，`getCurrentVoteSubmissions` 按 `payload.voteRound===voteState.voteRound && actorId∈submittedVoterIds` 过滤本轮票。

## applyAction switch 新增（M1 三个；fast_forward/new_game 留给 M2）
```
case "submit_vote":        return submitVote(validAction, context, previousEvents);
case "submit_tie_speech":  return submitTieSpeech(validAction, context, previousEvents);
case "submit_last_words":  return submitLastWords(validAction, context, previousEvents);
```

## submitVote(action, context, previousEvents)
- 前置：`context.session/snapshot/snapshot.voteState` 必须存在，否则 `INVALID_ACTION`。
- `expectedPhase = action.voteRound==="first" ? "vote" : "tie_vote"`。
- 拒绝(`ACTION_NOT_ALLOWED`)若：`gamePhase!==expectedPhase` | `voteState.voteRound!==action.voteRound` | `voteState.resolved` | voter 不存在/!alive | voter∉eligibleVoterIds | voter∈submittedVoterIds。
- 选择校验：`abstain` → 需 `voteState.allowAbstain` 否则拒绝；`target` → 无 targetId 报 `INVALID_ACTION`；`targetId===voterId` 拒绝(自投)；target 不存在/!alive/∉candidateIds 拒绝。
- 发 `vote_submitted`：`source: voter.controller`, `actorId: voterId`, payload `{voterId, voteRound, choiceType, targetId?}`, `visibility {public:false, visibleTo:[voterId], revealInReview:true}`, `round: snapshot.round`。
- `submittedVoterIds += voterId`；若 `< eligibleVoterIds.length` → 返回(pendingAction 仍 null)；否则 → `resolveVote(...)`。

## resolveVote（唱票 + 分支）
- 收本轮票 `getCurrentVoteSubmissions`，tally：仅 `choiceType==="target"` 计数到 `targetId`。
- `maxVotes=max(0,...counts)`；`top=keys where count===maxVotes`；`hasValid=maxVotes>0`；`exiledId = hasValid && top.length===1 ? top[0] : null`。
- 先发 `vote_resolved`(public)：payload `{voteRound, day, tally, exiledPlayerId, outcome}`，`outcome = exiledId?"exile":(voteRound==="first"&&top.length>1?"tie":"no_exile")`。tally 只含 playerId→count，**无身份**。
- 分支：
  - **EXILE**(exiledId!==null)：发 `exile_resolved`(public, payload `{playerId, day, revealRolePublicly:false}`) → `player_died`(public, `{playerId, deathCause:"exile", sourceEventId:exileEventId, revealRolePublicly:false}`)，players 标记该人 `alive:false, deathCause:"exile", deathEventId, isRoleVisiblePublicly:false`。因 `board.exileLastWords=true` → 发 `phase_changed`→`exile_last_words`，`pendingAction={type:"last_words", actorId:exiledId, legalTargets:[], allowAbstain:false}`，`voteState.resolved=true`。**checkWin 延后到 submitLastWords**。
  - **TIE_BREAK**(hasValid && top.length>1 && voteRound==="first")：发 `phase_changed`→`tie_speech`；`speechState={day, speechKind:"tie_speech", speakerOrder: top 按座位且 alive, currentSpeakerId: 第一个, completedSpeakerIds:[]}`；`pendingAction={type:"tie_speech", actorId: 第一个}`；`voteState.resolved=true`。
  - **NO_EXILE**(其余：无有效票任意轮，或 tie_break 又平票)：无死亡 → 直接 `finishDayResolution(players 不变)`。
- forward-seq 注意：`exileEventId/deathEventId` 用 `buildEventId(gameId, seq, type)` 按预定 seq 先算后填（仿 resolveNight）。加 seq 单调断言。

## submitTieSpeech ≈ submitSpeech 克隆
- 校验 `gamePhase==="tie_speech"`、`speechState.speechKind==="tie_speech"`、`currentSpeakerId===speakerId`、alive、in order、未完成、text 1..500。
- 发 `tie_speech_submitted`(public, `{speakerId, day, text}`)。
- 还有下一个并列者 → 推进 currentSpeakerId + pendingAction tie_speech。
- 全部说完 → `phase_changed`→`tie_vote`；建 `voteState={day, voteRound:"tie_break", eligibleVoterIds: 全部 alive 按座位, submittedVoterIds:[], candidateIds: speakerOrder 中仍 alive 者, allowAbstain: board.allowAbstainVote, resolved:false}`；`round.voteRound="tie_break"`；`pendingAction=null`。

## submitLastWords
- 校验 `gamePhase==="exile_last_words"`、`pendingAction.actorId===speakerId`、text 1..500。**注意被放逐者 alive 已是 false，不要校验 alive**，用 pendingAction 绑定。
- 发 `last_words_submitted`(public, `{speakerId, day: snapshot.round.day, text}`)。
- 然后 `finishDayResolution(players=snapshot.players /*放逐死亡已落*/, fromPhase:"exile_last_words", viewerId:speakerId)`。

## finishDayResolution（放逐后/无放逐的统一收尾，复用于 NO_EXILE 与 submitLastWords）
仿 resolveNight 尾部：
- `checkWin(players)`（复用现有，index.ts:1392）。
- 发 `win_checked`（payload 含 winner/winReason 仅当有结果 + `checkedAfterEventId`；`public: Boolean(winResult)`）。
- 发 `phase_changed` → `winResult?"review":"night_action"`（reason `win_condition_met`/`day_resolved`）。
- winResult → 追发 `game_ended`（public, `{winner, winReason, endedAt:now}`），`session.status="ended", endedAt=now`。
- 续局(无 win)：`nextNight=round.night+1`；`round={night:nextNight, day:round.day, voteRound:"none"}`；重建 `nightState={night:nextNight, requiredActorIds: 当前 alive 的 werewolf+seer, submittedActorIds:[], resolved:false, deathPlayerIds:[]}`（**预言家若死则只剩狼，避免死锁**）；`humanParticipationState = human.alive===false?"dead_spectating":原值`；`pendingAction = (human alive && 是 wolf/seer && participation alive) ? {type:"night_action", actorId:human, legalTargets: alive 除自己, allowAbstain:false} : null`（夜>1 无首夜护真人，真实合法性由 submitNightAction/isLegalNightTarget 把关）。
- 返回 `buildVisibleInformation(viewerId, snapshot, [...previousEvents, ...events])`。

## getCurrentVoteSubmissions(events, voteState)
仿 `getCurrentNightSubmissions`：对每个 `voteState.submittedVoterIds` 反向找最近的 `vote_submitted` 且 `payload.voteRound===voteState.voteRound && actorId===voterId`。

## visibility.ts 改动
- `getLegalActions` 在 `day_speech` 分支后追加：
  - `vote`/`tie_vote`：`vs=snapshot.voteState`; 无则 `[]`；否则 `[{actionType:"vote", actorId:viewer, legalTargets: vs.candidateIds.filter(!==viewer), allowAbstain: vs.allowAbstain, required:true}]`。
  - `tie_speech`：`[{actionType:"tie_speech", actorId:viewer, legalTargets:[], allowAbstain:false, required:true}]`。
  - `exile_last_words`：`[{actionType:"last_words", actorId:viewer, ...}]`。
- `canViewerAct` 在 night 分支后、return 前追加：
  - `vote`/`tie_vote`：`const vs=snapshot.voteState; if(!vs||vs.resolved) return false; return vs.eligibleVoterIds.includes(viewer)&&!vs.submittedVoterIds.includes(viewer);`
  - tie_speech/exile_last_words 走默认 `pendingAction?.actorId===viewer`（无需改）。
- `toVisibleVote` 已就绪；可在结算后让 UI 读 `vote_resolved` 的 tally（M6 关心）。

## voting.test.ts 覆盖清单
正路：首轮唯一放逐→遗言→下一夜/胜利；首轮平票→tie_speech→tie_vote→唯一放逐；二次平票→无放逐→下一夜；放逐狼人→好人胜。
负路：自投拒绝、投死人/非候选拒绝、重复投拒绝、出相位投票拒绝、未轮到/非 eligible 拒绝、abstain 接受、空/超长 tie_speech 与 last_words 拒绝。
不变量：`expectNoRoleLeakInPayloads`(从 day-speech.test.ts:251 复制) 覆盖 vote_submitted/vote_resolved/exile_resolved/player_died/last_words_submitted；幂等重放 no-op；事件 seq 单调。
复用 day-speech.test.ts 的 `EngineState`/`expectOk`/`appendState`/`createNightState`/`playerIdByRole` 骨架（建议抽到 test helper 或直接复制）。

---

# 会话交接方案（用户已选：落交接文档→项目目录开新会话）

分类器恢复后，在 **本会话先 ExitPlanMode**，然后：
1. 在 `C:/vibecoding/langrensha/` 写一份 **`CLAUDE.md`**（会被项目根会话自动加载），内容 = 本计划全文要点：项目定位与"去 Codex 官僚化"、可复用架构与红线、已锁定决策（第一版即接 gpt-5.5、OpenAI 兼容、用户填 `.env`）、M0–M7 计划、上面这份 M1 详细设计、踩坑点。开头注明"这是交接文档，新会话请先读本文件再从 M1 继续"。
2. 复制本计划文件到项目：`C:/vibecoding/langrensha/docs/BUILD-PLAN.md`（供细节追溯）。
3. 备注：我此前写的 4 篇记忆在 `C:\Users\DKM99\.claude\projects\C--Users-DKM99\memory\`（绑定 `C:\Users\user\` cwd，项目会话不会自动加载，仅作备份）。
4. M0 未完成项：开分支 `build/mvp-playable`、`npm install zustand dexie -D fake-indexeddb`、确认 `npm test`(32) 与 `npm run build` 绿 —— 这些在新会话里做。

新会话启动指引（告诉用户在项目目录里说）：
> "读 CLAUDE.md 和 docs/BUILD-PLAN.md，从 M0 收尾 + M1 开始按计划实现。"
