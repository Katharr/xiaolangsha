# 小狼杀：阶段5 系统与接口设计

## 文档状态

- 阶段：阶段5 系统与接口设计
- 状态：已收束，可作为阶段6“测试与验收设计”的输入
- 收束日期：2026-06-15
- 默认上下文入口：仅使用 `ProjectStatus.md`、阶段1至阶段5主文档
- 上下文规则：默认不得读取 `docs/archive/`；除非用户明确要求追溯历史、调研来源或讨论过程

## 锁定决策

1. 模块边界采用 `ui / store / rules / storage / ai-client / ai-proxy / shared` 按领域分层。
2. 规则引擎唯一写入口为 `applyAction(action, context) -> RuleEngineResult`。
3. AI Proxy 统一入口为 `POST /api/ai/respond`，通过 `taskType` 区分场景。
4. 存储层采用 repository 风格接口，MVP 只实现当前局语义，但保留 `gameId` 扩展能力。
5. 启动与刷新恢复采用“快照优先，事件重放兜底，失败后提示清空当前局”。
6. 统一错误返回采用 `Result` 结构，不让原始异常直接穿透到 UI。
7. 局中发言必须保留原文 `text`，不得用摘要替代原文。
8. 每个会改变状态的 `GameAction` 必须携带 `idempotencyKey`。

## 总体架构

```text
UI -> Store -> Rules -> Storage
          \-> AI Client -> AI Proxy -> AI Service
```

数据方向：

- `ui` 负责渲染和收集输入
- `store` 负责编排当前流程、调用规则引擎、触发持久化、触发 AI 请求
- `rules` 负责判断合法性、写入 `TruthEvent`、生成 `GameSnapshot`、生成 `VisibleInformationSnapshot`
- `storage` 负责当前局的本地持久化与恢复
- `ai-client` 是浏览器前端模块，负责发起结构化请求和解析结构化响应
- `ai-proxy` 是 Node.js + Express 服务端模块，负责持有 API key 并调用 OpenAI SDK
- `shared` 负责枚举、类型、schema、Result、错误码和通用工具

## 模块划分

### `shared`

职责：

- 公共枚举、类型、Zod schema
- `GameAction`、`RuleEngineResult`、`Result`
- `EventType`、`GamePhase`、`HumanParticipationState`
- `TruthEvent` / `GameSnapshot` / `VisibleInformationSnapshot` 的共享类型

禁止：

- 不直接依赖 React、Dexie、Express 或 OpenAI SDK

### `rules`

职责：

- 校验动作
- 生成新事件
- 推进阶段与轮次
- 生成快照
- 生成可见信息
- 处理胜负检查与恢复重放

禁止：

- 不直接访问 UI
- 不直接写 Dexie
- 不直接调用 AI

### `storage`

职责：

- 保存当前局
- 追加事件
- 保存快照
- 加载设置
- 清空当前局
- 提供恢复所需原始数据

禁止：

- 不保存 API key
- 不参与规则判断
- 不向 UI 暴露底层 Dexie 细节

### `ai-client`

职责：

- 组装 AI 请求
- 发送到 AI Proxy
- 校验 AI JSON 响应
- 失败重试一次
- 返回结构化结果

禁止：

- 不直接改写对局事实
- 不读取完整真相日志
- 不依赖 OpenAI SDK
- 不保存或读取 API key

说明：`review_question` 所需的 `ReviewContext` 只能由 Store 在 `review` 阶段基于规则层与存储层数据组装；`ai-client` 只负责传输、响应校验和错误包装，不自行读取完整真相日志。

### `ai-proxy`

职责：

- 提供 `POST /api/ai/respond`
- 持有服务端 API key
- 调用 OpenAI JS SDK
- 返回结构化 JSON
- 将 AI 服务错误包装成统一 `Result`

禁止：

- 不写入对局状态
- 不决定玩家可见信息
- 不向浏览器返回 API key 或原始服务端密钥信息

### `store`

职责：

- 协调 UI、rules、storage、ai-client
- 管理加载状态、错误状态、当前局视图
- 把真人输入和 AI 输出转换成 `GameAction`
- 在动作合法后触发持久化

禁止：

- 不直接手写 `TruthEvent`
- 不直接操作 Dexie
- 不绕过 `rules`

### `ui`

职责：

- 根据 `gamePhase` 和 `humanParticipationState` 渲染界面
- 收集真人输入
- 展示可见信息与错误提示

禁止：

- 不直接读 `TruthEvent`
- 不直接改规则事实

## 模块依赖规则

1. `shared` 不依赖其他业务模块。
2. `rules` 只能依赖 `shared`。
3. `storage` 只能依赖 `shared` 与 Dexie。
4. `ai-client` 只能依赖 `shared` 与 HTTP 客户端。
5. `ai-proxy` 只能依赖 `shared`、Express、OpenAI JS SDK 和服务端环境变量。
6. `store` 可以依赖 `shared`、`rules`、`storage`、`ai-client`。
7. `ui` 可以依赖 `shared`、`store`。
8. `rules` 不能反向依赖 `store`、`ui`、`storage`、`ai-client`、`ai-proxy`，避免循环依赖。

## 核心领域模型接口

### `GameAction`

统一输入对象，真人、AI、系统动作都先转成它。

```ts
type BaseGameAction = {
  idempotencyKey: string
}

type GameAction = BaseGameAction & (
  | { type: "create_game"; mode: "standard" | "free"; boardId: string; humanPlayerId: string }
  | { type: "confirm_role_setup"; playerId: string; selectedRole: Role }
  | { type: "confirm_role_reveal"; playerId: string }
  | { type: "submit_night_action"; actorId: string; actionType: "werewolf_kill" | "seer_check"; targetId?: string }
  | { type: "confirm_day_announcement"; playerId: string }
  | { type: "submit_speech"; speakerId: string; text: string }
  | { type: "submit_vote"; voterId: string; voteRound: "first" | "tie_break"; choiceType: "target" | "abstain"; targetId?: string }
  | { type: "submit_tie_speech"; speakerId: string; text: string }
  | { type: "submit_last_words"; speakerId: string; text: string }
  | { type: "request_fast_forward"; playerId: string }
  | { type: "confirm_new_game"; playerId: string }
)
```

说明：

- `confirm_*` 代表真人确认进入下一流程。
- `confirm_role_setup.selectedRole` 仅用于练习/自由局手动身份选择。
- `request_fast_forward` 只由死亡旁观者发起。
- `confirm_new_game` 用于复盘后重新开局。
- `idempotencyKey` 由 Store 在提交动作前生成，规则引擎写入每个有效业务事件的 `EventMetadata.idempotencyKey`。

### `RuleEngineResult`

规则引擎输出：

```ts
type RuleEngineResult = Result<{
  events: TruthEvent[]
  snapshot: GameSnapshot
  visibleInformation: VisibleInformationSnapshot
  nextPendingAction?: PendingAction | null
}>
```

规则引擎只接受合法动作。非法动作返回 `ok: false`，不写事件。

### `Result`

统一错误包装：

```ts
type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: AppError }
```

### `AppError`

```ts
type AppError = {
  code: string
  message: string
  userMessage?: string
  retryable: boolean
  source: "rules" | "storage" | "ai_client" | "ai_proxy" | "ai_service" | "app"
}
```

## 规则引擎接口

### `applyAction`

```ts
applyAction(action: GameAction, context: {
  session: GameSession
  snapshot: GameSnapshot
  events: TruthEvent[]
  now: string
}): RuleEngineResult
```

行为要求：

- 校验动作是否符合当前 `gamePhase` 与 `humanParticipationState`
- 生成新的 `TruthEvent`
- 更新 `GameSnapshot`
- 生成受限的 `VisibleInformationSnapshot`
- 处理胜负检查、平票继续、快进失败恢复等流程
- 非法动作不写入 `TruthEvent`
- 检测重复 `idempotencyKey`，防止重复点击、刷新恢复或 AI 重试造成重复事件

### `buildVisibleInformation`

```ts
buildVisibleInformation(viewerId: string, snapshot: GameSnapshot, events: TruthEvent[]): VisibleInformationSnapshot
```

要求：

- 只返回该玩家可见内容
- 不泄露完整真相日志
- 预言家只见查验结果
- 狼人只见自己的夜晚行动目标
- 村民只见公开信息

### `replayEvents`

```ts
replayEvents(session: GameSession, events: TruthEvent[]): GameSnapshot
```

要求：

- 按 `seq` 严格重放
- 事件与快照冲突时，以事件为准
- 用于刷新恢复和快照重建

## 存储层接口

### `gameRepository`

```ts
loadCurrentGame(): Promise<Result<CurrentGameRecord | null>>
saveCurrentGame(record: CurrentGameRecord): Promise<Result<void>>
clearCurrentGame(): Promise<Result<void>>
```

### `eventRepository`

```ts
appendEvents(gameId: string, events: TruthEvent[]): Promise<Result<void>>
loadEvents(gameId: string): Promise<Result<TruthEvent[]>>
```

### `snapshotRepository`

```ts
loadSnapshot(gameId: string): Promise<Result<GameSnapshot | null>>
saveSnapshot(gameId: string, snapshot: GameSnapshot): Promise<Result<void>>
```

### `settingsRepository`

```ts
loadSettings(): Promise<Result<AppSettings>>
saveSettings(settings: AppSettings): Promise<Result<void>>
```

### `CurrentGameRecord`

```ts
type CurrentGameRecord = {
  gameId: string
  schemaVersion: string
  session: GameSession
  snapshotRef?: {
    gameId: string
    lastEventSeq: number
  }
}
```

说明：

- MVP 仅保留当前局。
- 多局历史只保留 `gameId` 扩展位，不在本阶段实现列表化存储。
- `eventRepository` 是 `TruthEvent[]` 的唯一读取来源。
- `CurrentGameRecord` 不内嵌事件列表，避免与 `eventRepository` 形成双事实源。
- `snapshotRef` 只用于加速恢复；若快照与事件不一致，以事件重放结果为准。
- 一次规则动作成功后，持久化顺序应优先 `appendEvents`，再保存 `GameSnapshot` 与 `snapshotRef`；若使用 Dexie transaction，应将事件、快照和当前局元数据放在同一事务中提交。

## AI 接口

### 前端 AI Client

```ts
requestAiResponse(input: AiTaskRequest): Promise<AiTaskResponse>
```

### AI Proxy HTTP

```http
POST /api/ai/respond
```

请求体：

```ts
type InGameAiTaskRequest = {
  gameId: string
  taskType: "speech" | "night_action" | "vote" | "tie_speech" | "last_words"
  playerId: string
  visibleInformation: VisibleInformationSnapshot
  promptContext?: {
    currentText?: string
  }
}

type ReviewQuestionRequest = {
  gameId: string
  taskType: "review_question"
  questionText: string
  reviewContext: ReviewContext
}

type AiTaskRequest = InGameAiTaskRequest | ReviewQuestionRequest

type ReviewContext = {
  session: GameSession
  players: Player[]
  events: TruthEvent[]
  speeches: ReviewSpeechRef[]
  votes: ReviewVoteRef[]
  nightActions: ReviewNightActionRef[]
  winner: Faction
  winReason: WinReason
}

type ReviewSpeechRef = {
  eventId: string
  speakerId: string
  day: number
  speechKind: "day_speech" | "tie_speech" | "last_words"
  text: string
  createdAt: string
}

type ReviewVoteRef = {
  eventId: string
  day: number
  voteRound: "first" | "tie_break"
  voterId: string
  choiceType: "target" | "abstain"
  targetId?: string
}

type ReviewNightActionRef = {
  eventId: string
  night: number
  actorId: string
  actionType: "werewolf_kill" | "seer_check"
  targetId?: string
  result: object
}
```

响应体：

```ts
type AiTaskResponse = Result<{
  text?: string
  targetId?: string
  choiceType?: "target" | "abstain"
  actionType?: "werewolf_kill" | "seer_check"
  analysisSummary?: string
  decisionSummary?: string
}>
```

规则：

- 局中任务请求输入以 `VisibleInformationSnapshot` 为核心。
- `review_question` 请求必须使用 `ReviewContext`，可读取完整真相、发言原文、夜晚行动、投票和胜负结果。
- 非 `review` 阶段不得构造或发送 `ReviewContext`；局中 AI 任务只能接收规则引擎生成的 `VisibleInformationSnapshot`。
- 响应必须可被 Zod 校验。
- `text` 必须保留原文，不允许摘要替代。
- `analysisSummary` / `decisionSummary` 只进入 metadata，不进入局中可见层。
- AI 失败重试一次；局中任务仍失败时使用固定模板或随机合法动作；`review_question` 失败时只返回固定说明文本，不生成游戏动作。

## UI 与 Store 接口边界

### `store` 主要职责

- `bootstrapGame()`
- `startGame()`
- `submitHumanAction()`
- `requestAiAction()`
- `restoreCurrentGame()`
- `requestFastForward()`
- `startNewGame()`

Store 只做编排，不直接修改规则事实。

### `ui` 页面组织

MVP 采用单应用壳，不引入路由库。

页面由 `gamePhase` 驱动：

- `mode_select`
- `role_setup`
- `role_reveal`
- `night_action`
- `day_announcement`
- `day_speech`
- `vote`
- `tie_speech`
- `tie_vote`
- `exile_last_words`
- `fast_forwarding`
- `review`

## 错误与降级

统一错误码方向：

- `INVALID_ACTION`
- `ACTION_NOT_ALLOWED`
- `DUPLICATE_SUBMIT`
- `STORAGE_LOAD_FAILED`
- `STORAGE_SAVE_FAILED`
- `AI_TIMEOUT`
- `AI_JSON_INVALID`
- `AI_UNAVAILABLE`
- `SNAPSHOT_CORRUPTED`
- `REPLAY_FAILED`

降级规则：

1. 非法动作直接返回错误，不写事件。
2. AI 失败先重试一次。
3. 重试后失败，使用当前状态的安全降级策略。
4. 快照损坏优先事件重放。
5. 恢复失败后提示清空当前局并重新开始。

## 启动与恢复流程

```text
App 启动
-> loadCurrentGame()
-> 若无当前局，进入 mode_select
-> 若有当前局，用 gameId 调用 eventRepository.loadEvents()
-> 同时调用 snapshotRepository.loadSnapshot()
-> 校验 schemaVersion
-> 校验 snapshot.lastEventSeq 与事件最大 seq
-> 一致则直接恢复
-> 不一致或快照损坏则从事件重放
-> 重放失败则提示清空当前局
```

恢复后必须重新生成当前可见信息。

## 阶段5 DoD 检查

| DoD 项 | 结论 |
| --- | --- |
| 模块划分清晰 | 通过 |
| 核心接口完整 | 通过 |
| AI Client/Proxy 接口完整 | 通过 |
| 存储与恢复接口完整 | 通过 |
| 错误与降级接口完整 | 通过 |
| 无循环依赖 | 通过 |
| 是否可进入阶段6测试与验收设计 | 通过 |

阶段5收束结论：系统与接口设计已完成，可以进入阶段6。
