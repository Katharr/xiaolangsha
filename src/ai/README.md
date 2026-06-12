# ai

脚本 AI 玩家、AI 记忆和结构化发言意图的目录边界。

阶段 03 已实现无 API key 的 MVP 脚本 AI。AI 决策入口必须保持为
`decideAction(view: AiPlayerView)`，不得接收完整对局状态。

## 当前信息流

AI 只能从 `AiPlayerView` 构建本局记忆：

```text
AiPlayerView
  -> AiMemory
  -> 当前回合决策上下文 / AiAction
  -> SpeechIntent
  -> 模板发言
```

`AiMemory` 采用轻结构化设计：

- `knownFacts`: 只保存当前 AI 视角可见且确定的结构化事实，例如阶段、公开死亡、公开投票、放逐、自己的查验结果、自己的女巫药水状态、狼人自己的队友信息。
- `speechRounds`: 按白天轮次保存自然语言发言记忆，包括发言玩家、来源事件、原文、本地理解、置信度和元话术标记。
- `DecisionReason`: AI 最终行动的结构化理由，用于赛后解释和测试，不进入局中公开视角。

怀疑、信任、站边属于 AI 的局内理解和临时策略判断，不是规则事实。当前 `suspicionByPlayer` 和 `trustByPlayer` 只是脚本 AI 的派生辅助，不能写入规则状态、公开时间轴或视角外上下文。

## LLM 预留边界

当前阶段不接入 LLM，不需要 API key。无 API key 时，脚本 AI、本地发言理解和模板发言必须完整可用。

未来如果接入 LLM，只允许替换两个局部能力：

- 理解可见自然语言发言，生成或更新 `speechRounds` 中的自然语言理解。
- 基于 `SpeechIntent` 润色公开发言文本。

LLM 不得替代规则引擎、行动决策、投票、评分或时间轴事实，也不得读取完整 `GameState`、`internal` 事件、随机种子、调试快照或行动者视角外的隐藏信息。
