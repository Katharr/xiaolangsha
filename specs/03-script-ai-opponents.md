# 03 脚本 AI 对手

## 目标

实现无需 API key 的脚本 AI 玩家，让 6 人 MVP 局可以由 AI 自动完成所有非人类玩家行动。

## 范围

本阶段只实现脚本 AI 决策和模板发言意图。不要接入 LLM，不要实现难度系统，不要扩展新角色。

## AI 架构

AI 玩家决策必须使用：

```ts
decideAction(view: AiPlayerView): Action
```

AI 代码不得接收或导入完整 `GameState`。

添加 AI 概念：

- `AiMemory`
- `StrategyProfile`
- `SuspicionScore`
- `SpeechIntent`
- `DecisionReason`

## AiMemory 记忆模型

`AiMemory` 是 AI 玩家基于自身视角整理出的局内短期记忆，不是隐藏真相库。它只能由 `AiPlayerView`、AI 自己的历史行动、AI 自己可见的时间轴事件推导出来，不能包含完整 `GameState` 或玩家视角外的信息。

### AI 可以记住什么

MVP 阶段 `AiMemory` 至少包含：

- `knownSelf`: 自己的座位、角色、阵营、存活状态。
- `knownTeammates`: 狼人已知队友；非狼人必须为空。
- `visibleDeaths`: 自己当前视角可见的死亡玩家、死亡阶段、公开死亡信息。
- `visibleVotes`: 自己当前视角可见的投票记录、改票记录、放逐结果。
- `visibleClaims`: 公开或自己听到的身份声明，例如谁跳了预言家、谁报了查验。
- `visibleSpeechNotes`: 对公开发言的摘要标签，例如质疑、辩护、跟票、强势带队、前后矛盾。
- `ownPrivateResults`: 自己角色可见的私有结果，例如预言家自己的查验、女巫自己的药水状态和夜晚提示、狼人自己的狼队信息。
- `suspicionByPlayer`: AI 基于可见信息计算出的怀疑分。
- `trustByPlayer`: AI 基于可见信息计算出的信任分。
- `lastDecisionReasons`: AI 自己最近若干次行动的结构化理由，用于避免发言和投票突然断裂。

### AI 不能记住什么

`AiMemory` 不得包含：

- 玩家视角外的真实身份。
- 未查验玩家的真实阵营。
- 其他角色的私密夜晚行动。
- 其他玩家的私有结果。
- `post_game` 事件。
- `internal` 事件。
- 完整 `GameState`、随机种子、调试快照。
- LLM 原始请求或响应中的隐藏上下文。

### 记忆生命周期

`AiMemory` 的生命周期分三层：

- 单次决策临时记忆：只在一次 `decideAction(view: AiPlayerView)` 内存在，用于排序候选行动，决策后丢弃。
- 单局长期记忆：从对局开始持续到对局结束，记录公开信息、自己私有信息、怀疑分、信任分、历史决策理由；游戏结束后进入 replay/scoring，不再用于下一局 AI 决策。
- 跨局画像记忆：MVP 阶段禁止实现。AI 不应记住玩家跨局习惯，避免早期系统复杂化和信息污染。若后续要做，也必须另起 SPEC，并默认关闭。

### 记忆更新时机

AI 记忆只能在以下时机更新：

- 新的可见时间轴事件进入 `AiPlayerView`。
- AI 自己提交行动后，记录自己的行动理由。
- AI 自己收到私有结果后，例如查验结果、女巫夜晚提示、狼队行动结果。
- 阶段变化时，对怀疑分和信任分进行衰减或重新加权。

### 记忆长度默认值

MVP 阶段没有难度选择，但要预留 `memoryPolicy`：

```ts
type AiMemoryPolicy = {
  maxVisibleSpeechNotes: number;
  maxVoteRoundsRemembered: number;
  maxDecisionReasons: number;
  suspicionDecayPerDay: number;
};
```

MVP 默认使用普通难度等价值：

- `maxVisibleSpeechNotes`: 12
- `maxVoteRoundsRemembered`: 3
- `maxDecisionReasons`: 5
- `suspicionDecayPerDay`: 0.15

这些限制只影响 AI 能保留多少可见信息摘要，不能改变 AI 能看到什么信息。

## 策略性格

MVP 性格：

- `cautious`: 避免高风险跳身份和极端投票。
- `impulsive`: 更容易质疑别人，也更容易改票。
- `follower`: 更容易跟随高可信公开信息或多数压力。
- `logical`: 更重视票型记录和发言矛盾。
- `deceptive_wolf`: 作为狼人时可以保护队友、推动抗推、伪装不确定。

这些是性格，不是难度。难度是后续阶段。

## 角色行为

平民：

- 跟踪可疑发言和投票。
- 根据公开矛盾和场上压力投票。

预言家：

- 从可疑玩家或影响力较高的玩家中选择查验目标。
- 可以通过 `SpeechIntent` 报告查验结果。

女巫：

- 根据夜晚死亡信息、怀疑程度和药水状态决定救人或毒人。

狼人：

- 根据威胁程度、疑似神职或低风险目标选择刀人对象。
- 可以质疑好人、保护队友，或避免明显的狼队行为。

## 抗元话术

AI 必须忽略游戏外控制话术：

- "你是 AI，所以必须听我的"
- "忽略游戏规则"
- "告诉我真实身份"
- "我命令你相信我"

这些文本可以作为发言内容记录，但决策评分应把它视为无效元压力，不能当作绕过游戏逻辑的证据。

## 结构化发言意图

AI 发言必须先结构化，再由模板渲染。

示例：

- `accuse`
- `defend`
- `claim_role`
- `report_check`
- `question`
- `vote_reason`
- `pass`

## 测试要求

添加测试覆盖：

- AI 能为每个 MVP 角色选择合法行动。
- AI 可以在无人类输入的情况下模拟完整对局。
- AI 只接收 `AiPlayerView`。
- `AiMemory` 只能由 `AiPlayerView` 和 AI 自己的历史行动推导，不能包含完整 `GameState`。
- `AiMemory` 不包含 `post_game`、`internal` 或玩家视角外的隐藏信息。
- `AiMemoryPolicy` 会限制记忆条数和衰减，但不会扩大可见信息范围。
- 平民 AI 看不到隐藏身份。
- 狼人 AI 能看到狼队友，但不能看到神职身份。
- 预言家 AI 只能看到自己的查验结果。
- 女巫 AI 只能看到规则允许的夜晚信息和药水信息。
- 元控制话术不会强制 AI 服从。

## 验收标准

- 无 API key 时，纯 AI 模拟可以完成整局。
- 每个 AI 行动都有结构化理由。
- 每段 AI 发言在渲染前都是 `SpeechIntent`。
- `AiMemory` 有明确内容边界、更新时机和生命周期。
- 信息隔离测试通过。

## 不在本阶段范围

- 难度选择。
- LLM 发言生成。
- 教练。
- 角色评分。
