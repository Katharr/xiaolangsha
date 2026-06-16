# 小狼杀：阶段3数据结构与核心模型

## 文档状态

- 阶段：阶段3 数据结构与核心模型
- 状态：已收束，可作为阶段4“技术选型”的输入
- 收束日期：2026-06-14
- 上下文入口：仅使用 `ProjectStatus.md`、`docs/phase-1-requirements-definition.md`、`docs/phase-2-business-ux-flow.md` 与本文档。
- 上下文规则：默认不得读取 `docs/archive/`；除非用户明确要求追溯历史。
- 技术边界：本文定义字段级数据模型，不绑定数据库、ORM、前端框架或后端框架。

## 已锁定模型原则

1. MVP 仅保留当前局；未来预留多局历史扩展。
2. 事件日志是权威来源，状态快照是派生缓存。
3. 规则引擎拥有完整真相日志；真人玩家与 AI 只能读取规则引擎生成的 `VisibleInformationSnapshot`。
4. `GameSnapshot` 可保存完整身份和隐藏信息，但只能由规则引擎读取。
5. MVP 不保存独立 `AIPrivateMemory`；后续 AI 体验优化阶段再扩展。
6. 非法尝试不进入核心事件日志；由规则引擎即时拒绝或前端拦截。
7. AI 降级不设独立事件，只在最终有效业务事件中标记。
8. 局中发言只保存原文，不生成局中摘要；复盘阶段按需根据时间轴事实和原文生成总览与追问回答，不持久化复盘问答。

## 数据分层

| 层级 | 模型 | 读取者 | 用途 |
| --- | --- | --- | --- |
| 真相层 | `TruthEvent`、完整 `GameSnapshot` | 规则引擎 | 规则结算、胜负判断、恢复、生成可见信息 |
| 可见层 | `VisibleInformationSnapshot` | 真人 UI、AI 玩家 | 展示当前可见信息、驱动 AI 发言/行动 |
| 复盘层 | `TruthEvent`、发言原文 | 终局复盘模块 | 按需生成复盘总览和追问回答，区分局中可见与终局真相 |

## 核心模型

### `GameSession`

当前对局容器。MVP 只有一个 `currentGame`，但字段保留多局历史扩展能力。

| 字段 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `gameId` | string | 是 | 对局唯一 ID。 |
| `schemaVersion` | string | 是 | 数据结构版本，例如 `phase3-mvp-v1`。 |
| `mode` | `GameMode` | 是 | `standard` 随机身份；`free` 手动身份。 |
| `boardId` | string | 是 | MVP 固定为 `mvp_5p_wolf_seer_3villagers`。 |
| `status` | `GameStatus` | 是 | `created`、`active`、`ended`。 |
| `createdAt` | ISO datetime | 是 | 对局创建时间。 |
| `startedAt` | ISO datetime? | 否 | 进入首夜时间。 |
| `endedAt` | ISO datetime? | 否 | 终局时间。 |
| `currentEventSeq` | number | 是 | 当前已接受事件的最大序号。 |
| `currentSnapshotSeq` | number | 是 | 当前快照对应的事件序号。 |
| `humanPlayerId` | string | 是 | 真人玩家 ID。 |
| `randomSeed` | string? | 否 | 随机分配与 AI 补位可选种子；MVP 可不展示。 |

### `BoardConfig`

板子与规则配置。MVP 固定一套，但必须预留后续多板子。

| 字段 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `boardId` | string | 是 | 板子 ID。 |
| `playerCount` | number | 是 | MVP 为 `5`。 |
| `roles` | `Role[]` | 是 | MVP 为 `werewolf`、`seer`、`villager` x3。 |
| `winConditionMode` | `WinConditionMode` | 是 | MVP 为 `simple_count`。 |
| `firstNightProtectHuman` | boolean | 是 | 所有板子为 `true`。 |
| `allowWerewolfSelfKill` | boolean | 是 | MVP 5 人局为 `false`。 |
| `revealRoleOnDeathDefault` | boolean | 是 | MVP 为 `false`。 |
| `nightDeathLastWords` | boolean | 是 | MVP 为 `false`。 |
| `exileLastWords` | boolean | 是 | MVP 为 `true`。 |
| `allowAbstainVote` | boolean | 是 | MVP 为 `true`。 |
| `allowSelfVote` | boolean | 是 | MVP 为 `false`。 |
| `maxTieRounds` | number | 是 | MVP 为 `1`，即最多一次拉票和二次投票。 |

### `Player`

规则引擎内部玩家真相数据。完整身份不可直接暴露给 UI 或 AI。

| 字段 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `playerId` | string | 是 | 玩家唯一 ID。 |
| `gameId` | string | 是 | 所属对局。 |
| `seat` | number | 是 | 座位号，MVP 为 1 至 5。 |
| `controller` | `PlayerController` | 是 | `human` 或 `ai`。 |
| `role` | `Role` | 是 | 真实身份。 |
| `faction` | `Faction` | 是 | 真实阵营。 |
| `alive` | boolean | 是 | 是否存活。 |
| `deathCause` | `DeathCause?` | 否 | `night_kill`、`exile`。 |
| `deathEventId` | string? | 否 | 对应死亡事件。 |
| `isHuman` | boolean | 是 | 是否真人玩家。 |
| `isRoleVisiblePublicly` | boolean | 是 | 局中是否公开身份；MVP 死亡默认为 `false`。 |

### `TruthEvent`

核心事件日志条目。只记录被规则引擎接受并进入对局事实或终局复盘记录的事件。

| 字段 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `eventId` | string | 是 | 事件唯一 ID。 |
| `gameId` | string | 是 | 所属对局。 |
| `seq` | number | 是 | 对局内递增序号，用于重放和恢复。 |
| `type` | `EventType` | 是 | 事件类型。 |
| `phase` | `GamePhase` | 是 | 事件发生时的流程状态。 |
| `round` | `RoundRef` | 是 | 事件发生的夜晚/白天轮次。 |
| `actorId` | string? | 否 | 行动者；系统事件可为空。 |
| `source` | `EventSource` | 是 | `human`、`ai`、`rule_engine`、`system`。 |
| `payload` | object | 是 | 由事件类型决定的结构化内容。 |
| `visibility` | `EventVisibility` | 是 | 局中可见性和终局复盘可见性。 |
| `metadata` | `EventMetadata` | 是 | 幂等、AI 降级、AI 摘要等非规则事实信息。 |
| `createdAt` | ISO datetime | 是 | 事件写入时间。 |

### `GameSnapshot`

规则引擎内部当前状态缓存，可由 `TruthEvent` 重放生成。它是恢复和渲染的缓存，不是唯一真相。

| 字段 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `gameId` | string | 是 | 所属对局。 |
| `lastEventSeq` | number | 是 | 快照已应用到的事件序号。 |
| `gamePhase` | `GamePhase` | 是 | 当前流程状态。 |
| `humanParticipationState` | `HumanParticipationState` | 是 | 真人参与权限。 |
| `round` | `RoundState` | 是 | 当前夜晚、白天、投票轮次。 |
| `players` | `Player[]` | 是 | 完整玩家真相数据。 |
| `pendingAction` | `PendingAction?` | 否 | 当前等待谁做什么。 |
| `nightState` | `NightState?` | 否 | 当前夜晚行动状态。 |
| `speechState` | `SpeechState?` | 否 | 当前发言顺序与进度。 |
| `voteState` | `VoteState?` | 否 | 当前投票或二次投票状态。 |
| `lastResolvedEventId` | string? | 否 | 最近一次规则结算事件。 |
| `winner` | `Faction?` | 否 | 终局后胜方。 |
| `winReason` | `WinReason?` | 否 | 胜负触发原因。 |

### `VisibleInformationSnapshot`

规则引擎为单个玩家生成的结构化可见信息。AI 和真人 UI 只能读取自己的该快照。

| 字段 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `gameId` | string | 是 | 所属对局。 |
| `viewerId` | string | 是 | 接收该可见信息的玩家。 |
| `generatedAtSeq` | number | 是 | 基于哪个事件序号生成。 |
| `gamePhase` | `GamePhase` | 是 | 当前流程状态。 |
| `humanParticipationState` | `HumanParticipationState?` | 否 | 仅真人视角需要。 |
| `round` | `RoundState` | 是 | 当前轮次。 |
| `ownSeat` | number | 是 | 自己座位。 |
| `ownRole` | `Role` | 是 | 自己身份。 |
| `ownFaction` | `Faction` | 是 | 自己阵营。 |
| `alivePlayers` | `PublicPlayerRef[]` | 是 | 局中可见的存活玩家。 |
| `deadPlayers` | `PublicDeathRef[]` | 是 | 局中公开死亡信息，不默认包含身份。 |
| `publicEvents` | `VisibleEventRef[]` | 是 | 已公开事件。 |
| `privateEvents` | `VisibleEventRef[]` | 是 | 该玩家私有可见事件，如预言家查验结果。 |
| `speeches` | `VisibleSpeech[]` | 是 | 可见发言原文。局中不提供摘要。 |
| `votes` | `VisibleVote[]` | 是 | 已公开票型或投票记录。 |
| `legalActions` | `LegalAction[]` | 是 | 当前可执行动作与合法目标。 |
| `canAct` | boolean | 是 | 当前是否轮到该玩家行动。 |

## 子模型

### `RoundRef` / `RoundState`

| 字段 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `night` | number | 是 | 当前第几夜；首夜为 1。 |
| `day` | number | 是 | 当前第几天；首日为 1，夜晚前可为 0。 |
| `voteRound` | `none` / `first` / `tie_break` | 是 | 当前投票轮次。 |

### `PendingAction`

| 字段 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `type` | `PendingActionType` | 是 | `night_action`、`speech`、`vote`、`tie_speech`、`last_words`、`confirm`。 |
| `actorId` | string? | 否 | 需要行动的玩家；系统确认可为空。 |
| `legalTargets` | string[] | 是 | 当前合法目标列表，无目标则为空数组。 |
| `allowAbstain` | boolean | 是 | 投票阶段是否允许弃票。 |
| `expiresAt` | ISO datetime? | 否 | MVP 可不使用，留给未来计时。 |

### `NightState`

| 字段 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `night` | number | 是 | 第几夜。 |
| `requiredActorIds` | string[] | 是 | 需要夜晚行动的玩家。 |
| `submittedActorIds` | string[] | 是 | 已提交夜晚行动的玩家。 |
| `resolved` | boolean | 是 | 夜晚是否已结算。 |
| `deathPlayerIds` | string[] | 是 | 夜晚死亡玩家。 |

### `SpeechState`

| 字段 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `day` | number | 是 | 第几天。 |
| `speechKind` | `day_speech` / `tie_speech` | 是 | 普通发言或平票拉票。 |
| `speakerOrder` | string[] | 是 | 发言顺序。 |
| `currentSpeakerId` | string? | 否 | 当前发言者。 |
| `completedSpeakerIds` | string[] | 是 | 已发言玩家。 |

### `VoteState`

| 字段 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `day` | number | 是 | 第几天。 |
| `voteRound` | `first` / `tie_break` | 是 | 首轮或二次投票。 |
| `eligibleVoterIds` | string[] | 是 | 可投票玩家。 |
| `submittedVoterIds` | string[] | 是 | 已提交投票玩家。 |
| `candidateIds` | string[] | 是 | 可投目标；二次投票仍从合法存活玩家中选择。 |
| `allowAbstain` | boolean | 是 | MVP 为 `true`。 |
| `resolved` | boolean | 是 | 投票是否已结算。 |

### `PublicPlayerRef`

`VisibleInformationSnapshot` 中的公开玩家引用，不包含隐藏身份。

| 字段 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `playerId` | string | 是 | 玩家 ID。 |
| `seat` | number | 是 | 座位号。 |
| `controller` | `PlayerController` | 是 | 真人或 AI。 |
| `alive` | boolean | 是 | 是否存活。 |
| `publicRole` | `Role?` | 否 | 仅身份已公开时存在；MVP 死亡默认不公开。 |

### `PublicDeathRef`

局中公开死亡信息。

| 字段 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `playerId` | string | 是 | 死亡玩家 ID。 |
| `seat` | number | 是 | 死亡玩家座位。 |
| `deathCause` | `DeathCause` | 是 | 夜死或放逐。 |
| `round` | `RoundRef` | 是 | 死亡发生轮次。 |
| `publicRole` | `Role?` | 否 | 仅身份公开规则开启时存在。 |

### `VisibleEventRef`

可见事件引用，用于给 UI 和 AI 提供已公开或私有可见的结构化事实。

| 字段 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `eventId` | string | 是 | 对应 `TruthEvent`。 |
| `seq` | number | 是 | 事件序号。 |
| `type` | `EventType` | 是 | 事件类型。 |
| `phase` | `GamePhase` | 是 | 事件发生阶段。 |
| `round` | `RoundRef` | 是 | 事件发生轮次。 |
| `payload` | object | 是 | 已按可见性过滤后的 payload。 |

### `VisibleSpeech`

局中可见的发言原文。MVP 不提供局中发言摘要。

| 字段 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `eventId` | string | 是 | 对应 `speech_submitted`、`tie_speech_submitted` 或 `last_words_submitted`。 |
| `speakerId` | string | 是 | 发言者。 |
| `day` | number | 是 | 第几天。 |
| `speechKind` | `day_speech` / `tie_speech` / `last_words` | 是 | 发言类型。 |
| `text` | string | 是 | 发言原文。 |
| `createdAt` | ISO datetime | 是 | 发言时间。 |

### `VisibleVote`

局中已公开的投票信息。

| 字段 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `eventId` | string | 是 | 对应投票提交或结算事件。 |
| `day` | number | 是 | 第几天。 |
| `voteRound` | `first` / `tie_break` | 是 | 首轮或二次投票。 |
| `voterId` | string? | 否 | 单票记录中的投票者；票型汇总可为空。 |
| `choiceType` | `VoteChoiceType?` | 否 | `target` 或 `abstain`。 |
| `targetId` | string? | 否 | 被投玩家；弃票为空。 |
| `tally` | object? | 否 | 票型汇总。 |

### `LegalAction`

当前玩家可执行动作。

| 字段 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `actionType` | `PendingActionType` / `NightActionType` | 是 | 可执行动作类型。 |
| `actorId` | string | 是 | 可执行该动作的玩家。 |
| `legalTargets` | string[] | 是 | 合法目标列表。 |
| `allowAbstain` | boolean | 是 | 是否可弃票；非投票动作为 `false`。 |
| `required` | boolean | 是 | 是否必须提交后才能推进。 |

### `EventVisibility`

| 字段 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `public` | boolean | 是 | 局中是否公开。 |
| `visibleTo` | string[] | 是 | 局中可见玩家 ID。公开事件可为空数组并由 `public` 表示。 |
| `revealInReview` | boolean | 是 | 终局复盘是否公开。 |

### `EventMetadata`

| 字段 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `idempotencyKey` | string | 是 | 防重复提交键。 |
| `generatedBy` | `human` / `ai` / `rule_engine` / `fallback` | 是 | 内容或动作来源。 |
| `fallbackReason` | string? | 否 | AI 降级原因；不单独创建 `ai_degraded` 事件。 |
| `analysisSummary` | string? | 否 | AI 对其他玩家发言、投票、行为的简短主观分析；局中不可见，终局复盘可见。 |
| `decisionSummary` | string? | 否 | AI 对本次行为的简短理由；局中不可见，终局复盘可见。 |

## 枚举

### 核心枚举

| 枚举 | 值 |
| --- | --- |
| `GameMode` | `standard`、`free` |
| `GameStatus` | `created`、`active`、`ended` |
| `PlayerController` | `human`、`ai` |
| `Role` | `werewolf`、`seer`、`villager` |
| `Faction` | `werewolf_team`、`good_team` |
| `GamePhase` | `mode_select`、`role_setup`、`role_reveal`、`night_action`、`day_announcement`、`day_speech`、`vote`、`tie_speech`、`tie_vote`、`exile_last_words`、`fast_forwarding`、`review` |
| `HumanParticipationState` | `alive`、`dead_spectating`、`fast_forwarded` |
| `DeathCause` | `night_kill`、`exile` |
| `VoteChoiceType` | `target`、`abstain` |
| `NightActionType` | `werewolf_kill`、`seer_check`、`none` |
| `WinConditionMode` | `simple_count`、`slay_side`、`slay_all` |
| `WinReason` | `all_werewolves_dead`、`werewolves_reach_parity` |
| `EventSource` | `human`、`ai`、`rule_engine`、`system` |
| `PendingActionType` | `night_action`、`speech`、`vote`、`tie_speech`、`last_words`、`confirm` |

### `EventType`

| 分组 | 事件类型 |
| --- | --- |
| 对局生命周期 | `game_created`、`game_started`、`game_ended` |
| 身份与座位 | `players_assigned`、`human_role_revealed` |
| 阶段流转 | `phase_changed` |
| 夜晚行动 | `night_action_submitted`、`night_action_resolved` |
| 天亮播报 | `day_announced` |
| 白天发言 | `speech_submitted` |
| 投票与平票 | `vote_submitted`、`vote_resolved`、`tie_speech_submitted` |
| 放逐、死亡、遗言 | `exile_resolved`、`player_died`、`last_words_submitted` |
| 胜负结算 | `win_checked` |
| 快进 | `fast_forward_requested`、`fast_forward_completed`、`fast_forward_failed` |

## 事件 Payload 规范

| 事件类型 | payload 必需字段 |
| --- | --- |
| `game_created` | `mode`、`boardId`、`humanPlayerId` |
| `game_started` | `firstPhase`、`startedAt` |
| `players_assigned` | `players: { playerId, seat, controller, role, faction }[]` |
| `human_role_revealed` | `playerId`、`seat`、`role` |
| `phase_changed` | `fromPhase`、`toPhase`、`reason` |
| `night_action_submitted` | `actorId`、`actionType`、`targetId?` |
| `night_action_resolved` | `actorId`、`actionType`、`targetId?`、`result`；`werewolf_kill` 与 `seer_check` 的结果结构见下方专项约束 |
| `day_announced` | `night`、`deadPlayerIds`、`announcementText` |
| `speech_submitted` | `speakerId`、`day`、`text` |
| `vote_submitted` | `voterId`、`voteRound`、`choiceType`、`targetId?` |
| `vote_resolved` | `day`、`voteRound`、`tally`、`outcome`、`topVotedPlayerIds` |
| `tie_speech_submitted` | `speakerId`、`day`、`text` |
| `exile_resolved` | `exiledPlayerId`、`day` |
| `player_died` | `playerId`、`deathCause`、`sourceEventId`、`revealRolePublicly` |
| `last_words_submitted` | `speakerId`、`day`、`text` |
| `win_checked` | `winner?`、`winReason?`、`checkedAfterEventId` |
| `game_ended` | `winner`、`winReason`、`endedAt` |
| `fast_forward_requested` | `requestedByPlayerId`、`fromPhase` |
| `fast_forward_completed` | `requestedByPlayerId`、`endedAtEventId` |
| `fast_forward_failed` | `requestedByPlayerId`、`reason`、`restoredPhase`、`restoredHumanParticipationState` |
约束：

1. `speech_submitted`、`tie_speech_submitted`、`last_words_submitted` 只保存发言原文 `text`，不保存局中摘要。
2. `vote_submitted.choiceType = abstain` 时，`targetId` 必须为空。
3. 自投、非法目标、空发言、重复提交等非法尝试不写入 `TruthEvent`。
4. AI 降级后的有效动作写入对应业务事件，并在 `metadata.generatedBy = fallback` 与 `metadata.fallbackReason` 中记录。
5. `vote_submitted` 与 `vote_resolved` 同时覆盖首轮和二次投票；`voteRound = first` 表示首轮，`voteRound = tie_break` 表示二次投票。
6. 复盘总览和复盘追问回答不是核心事实；按需由时间轴事实和发言原文生成。若缓存与 `TruthEvent` 冲突，以 `TruthEvent` 为准。

夜晚行动结果结构：

| actionType | `night_action_resolved.payload.result` |
| --- | --- |
| `werewolf_kill` | `{ "kind": "kill_result", "targetId": string, "killed": boolean, "deathEventId": string? }` |
| `seer_check` | `{ "kind": "seer_check_result", "targetId": string, "factionResult": "werewolf_team" | "good_team" }` |

夜晚行动可见性：

1. 狼人击杀提交与结算属于真相事件；局中不公开目标，只在天亮播报公开死亡结果。
2. 预言家查验结果只对预言家本人可见，`visibility.public = false`，`visibleTo = [seerPlayerId]`，`revealInReview = true`。
3. 狼人自己的夜晚行动目标属于该狼人自己的私有可见信息，可影响其后续发言策略，但不得被当成公开事实直接宣称。
4. AI 夜晚行动的降级来源仍写在 `metadata.generatedBy` 与 `metadata.fallbackReason`，不改变 payload 结构。

## 可见信息生成规则

1. 真人和 AI 永远不直接读取 `TruthEvent` 或完整 `GameSnapshot`。
2. 规则引擎根据 `viewerId`、`GameSnapshot`、`TruthEvent.visibility` 和当前阶段生成 `VisibleInformationSnapshot`。
3. 预言家可见自己的查验结果；狼人可见自己的夜晚行动目标；村民只可见公开事件。
4. 死亡旁观者只可见公开流程和公开发言，不获得隐藏身份或隐藏夜晚行动。
5. 终局复盘可读取完整真相，但必须标记“局中当时可见信息”和“终局揭示真相”。

## 恢复与重放规则

1. 事件按 `seq` 严格递增，重放顺序只认 `seq`。
2. 页面刷新优先读取 `GameSnapshot`；若快照损坏或过期，可从 `TruthEvent` 重放生成。
3. 每个会改变状态的有效动作必须带 `idempotencyKey`，防止刷新或重复点击造成重复事件。
4. 新开局会覆盖 MVP 的 `currentGame`；未来多局历史可将 `GameSession` 列表化，不推翻当前模型。
5. 快进失败返回旁观时，`humanParticipationState` 必须恢复为 `dead_spectating`。

## 阶段3 DoD 自检

| DoD 项 | 当前结论 |
| --- | --- |
| 数据模型覆盖阶段1与阶段2业务需求 | 通过 |
| 模型支持事件日志、状态快照和可见信息分层 | 通过 |
| 模型支持投票弃票、不可自投、死亡不亮身份 | 通过 |
| 模型支持真人死亡旁观和快进失败恢复 | 通过 |
| 模型支持 AI 可见信息边界和终局复盘追问 | 通过 |
| 是否可进入阶段4技术选型 | 通过 |

阶段3收束结论：可以进入阶段4。
