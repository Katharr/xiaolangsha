# 01 领域模型和规则集

## 目标

定义“小狼杀”的核心领域模型、玩家视角模型和 MVP 6 人板子。

## 范围

本阶段只定义类型、规则集配置和视角构造的基础约束。不要实现完整夜晚/白天流程，也不要实现 AI 决策和 UI 对局。

## 必要概念

定义以下核心类型：

- `PlayerId`
- `Seat`
- `Role`
- `Camp`
- `Phase`
- `PlayerState`
- `GameState`
- `Ruleset`
- `WinConditionMode`
- `TimelineEvent`
- `PlayerView`
- `AiPlayerView`
- `CoachPlayerView`

## MVP 规则集

创建规则集 id `quick-6-v1`。

角色配置：

- 2 werewolf
- 1 seer
- 1 witch
- 2 villager

默认胜利条件：

- `side_elimination`: 屠边。狼人淘汰全部平民或全部神职即胜利；好人淘汰全部狼人即胜利。

预留胜利条件：

- `total_elimination`: 屠城。狼人淘汰所有好人即胜利；好人淘汰全部狼人即胜利。

## 信息隔离模型

`GameState` 是上帝视角，可以包含所有角色、私密夜晚行动、隐藏结果和赛后信息。

只有 `src/domain` 可以直接构造或检查完整 `GameState`。

创建视角构造器契约：

```ts
buildPlayerView(gameState: GameState, playerId: PlayerId): PlayerView
buildAiPlayerView(gameState: GameState, playerId: PlayerId): AiPlayerView
buildCoachPlayerView(gameState: GameState, humanPlayerId: PlayerId): CoachPlayerView
```

AI 模块只能接收 `AiPlayerView`。教练模块只能接收 `CoachPlayerView`。

## 可见性规则

时间轴事件必须支持：

- `public`: 所有玩家可见。
- `private`: 仅指定玩家可见。
- `wolf_team`: 狼人阵营视角可见。
- `post_game`: 仅赛后复盘可见。

## 测试要求

添加测试证明：

- `quick-6-v1` contains exactly 6 roles.
- 提供随机种子时，角色分配可以确定复现。
- 平民视角不会泄露隐藏角色。
- 狼人视角会显示狼队友，但不会显示神职身份。
- 预言家视角只显示自己的身份和未来查验结果占位。
- 女巫视角只显示自己的身份和药水状态占位。
- 教练视角能显示人类玩家自己的身份，但不显示其他隐藏身份。

## 验收标准

- 核心类型存在。
- `quick-6-v1` 存在，并默认使用 `side_elimination`。
- `total_elimination` 已表示，但不需要 UI 支持。
- 视角构造器以领域接口或最小实现形式存在。
- 信息隔离测试通过。

## 不在本阶段范围

- 完整游戏循环。
- 夜晚行动结算。
- 投票。
- 发言生成。
- AI 策略。
- 评分。
- UI 对局。
