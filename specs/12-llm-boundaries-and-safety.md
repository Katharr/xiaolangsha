# 12 LLM 使用边界和安全

## 目标

在接入任何 LLM 功能前，明确 LLM 在“小狼杀”中的权限边界、输入输出、失败回退和幻觉风险处理。LLM 永远是表达与解释层，不是规则、决策或评分层。

## 范围

本 SPEC 汇总所有可选 LLM 使用场景：

- 局内教练增强。
- 赛后 AI 复盘。
- AI 玩家发言润色。

所有 LLM 功能默认关闭，需要用户显式配置 API key 并开启对应功能。无 API key 时，游戏、脚本 AI、模板发言、固定函数评分和本地脚本复盘必须完整可用。

## MVP 阶段阅读和实现限制

本 SPEC 在 MVP 阶段主要作为 LLM 边界提醒，不作为前置阶段的实现任务。开发 `00` 到 `08` 阶段时，不需要提前实现本 SPEC 中完整的 payload、校验、回退、成本控制和 LLM 测试体系；只有当前 SPEC 明确进入 `09`、`10`、`12` 或其他 LLM 接入阶段时，才展开本文件后续详细要求。

MVP 前置阶段只需继承以下硬约束：

- 无 API key 路径必须完整可用。
- LLM 默认关闭，不能成为核心玩法依赖。
- LLM 不得读取完整 `GameState`。
- LLM 不得修改 `Action`、`TimelineEvent`、`RoleScore`、胜负结果或规则状态。
- AI、教练、UI、LLM 仍然只能使用过滤后的视角数据。

MVP 前置阶段暂不要求过度关注：

- 多套 LLM payload DTO 的完整细节。
- LLM 幻觉检测的完整工程化实现。
- LLM 成本控制、调用次数限制和 token 风险 UI。
- LLM 输出证据追踪的完整引用系统。
- 赛后 AI 复盘和 LLM 发言润色的失败回退实现，除非当前 SPEC 已进入 `09`、`10`、`12` 或其他 LLM 接入阶段。

本 SPEC 的后续详细内容仍保留为 LLM 接入前的总安全规范，供 `09`、`10` 或未来真正接入 LLM 时作为验收依据。

## 总权限边界

LLM 可以生成：

- 建议。
- 解释。
- 复盘讲解。
- 发言润色文本。

LLM 不得：

- 修改 `GameState`。
- 执行、提交或覆盖 `Action`。
- 修改胜负结果、规则结算或规则集配置。
- 修改、新增或删除权威 `TimelineEvent`。
- 修改 `RoleScore`、评分维度、评分证据或 `scorePlayerGame` 的结果。
- 替代任何固定规则函数、脚本 AI 决策函数或脚本评分函数。
- 读取完整 `GameState`、`internal` 事件、随机种子、调试快照或当前调用视角外的隐藏信息。

所有 LLM 输出只能写入“建议/文本/解释/非权威元数据”字段，不能写入规则状态字段。

## 使用场景

| 场景 | 输入 | 输出 | 禁止能力 | 失败回退 |
| --- | --- | --- | --- | --- |
| 局内教练增强 | 序列化后的 `CoachPlayerView`、玩家问题、公开术语表、当前阶段摘要 | `CoachAdvice` 文本、下一步建议、术语解释 | 读取玩家视角外信息；替玩家执行行动；修改时间轴、规则结果或评分 | 回退本地规则教练 |
| 赛后 AI 复盘 | 赛后复盘载荷：可公开的赛后时间轴、身份揭晓、脚本评分、脚本复盘、胜负结果 | 非权威复盘讲解、训练建议、证据引用 | 创造不存在的回合事实；覆盖脚本评分；修改时间轴或胜负结果 | 保留脚本复盘和固定评分，显示非阻塞错误 |
| 发言润色 | 行动者允许视角、`SpeechIntent`、近期公开时间轴、角色语气设定 | 渲染后的发言文本和非权威来源元数据 | 改变原始意图、行动、投票、目标或身份声明；添加视角外隐藏事实 | 回退模板发言 |

## 输入要求

LLM 请求 payload 必须是专用 DTO，禁止直接序列化领域对象。payload 中不得出现：

- 完整 `GameState`。
- `internal` 时间轴事件。
- 随机种子或调试快照。
- 调用者视角外的隐藏身份、夜晚行动、查验结果、药水状态。
- AI 内部怀疑分、隐藏策略权重或未公开决策理由。

不同场景必须使用不同 payload 类型，例如：

```ts
type CoachLlmPayload = SerializedCoachPlayerView & {
  sourceScope: "基于你的当前视角";
};

type PostGameReviewLlmPayload = {
  sourceScope: "基于赛后复盘数据";
  timelineEvents: PostGameTimelineEvent[];
  scriptScore: RoleScore;
  scriptReview: ScriptReview;
};

type SpeechRenderLlmPayload = {
  source: "llm_speech_render";
  authoritative: false;
  actorView: AiPlayerView;
  speechIntent: SpeechIntent;
  recentPublicEvents: PublicTimelineEvent[];
};
```

## 输出要求

LLM 输出必须满足：

- 带有来源范围或非权威标记，例如“基于你的当前视角”“基于赛后复盘数据”或 `authoritative: false`。
- 只能进入建议、文本、解释类字段。
- 不能直接作为规则事实、胜负结论或评分结果。
- 不能覆盖结构化决策来源，例如 `Action`、`SpeechIntent`、`RoleScore`、`TimelineEvent`。
- 如果输出声称某个事实，必须能追溯到输入 payload 中的时间轴事件、评分维度或视角字段。

## 幻觉风险处理

LLM 可能产生幻觉，因此所有调用方必须做边界校验：

- 规则事实以规则引擎和时间轴为准。
- 评分事实以 `scorePlayerGame` 和 `RoleScore` 为准。
- 发言意图以脚本 AI 生成的 `SpeechIntent` 为准。
- LLM 提到没有证据支撑的事件、身份、投票、夜晚行动或评分理由时，必须丢弃、降级、标记为“证据不足”，或回退到本地结果。
- 赛后复盘中的关键判断应引用 `evidenceEventIds` 或评分维度；没有证据时不能编造事实。

## 测试要求

添加或更新测试覆盖：

- LLM 请求 payload 不包含完整 `GameState`。
- LLM 请求 payload 不包含 `internal` 事件、随机种子或调试快照。
- LLM 请求 payload 不包含调用者视角外的隐藏身份或私密行动。
- LLM 赛后复盘失败时不影响脚本复盘和评分。
- LLM 发言润色失败时回退模板发言。
- LLM 输出不能改变 `Action`、`RoleScore`、`TimelineEvent`、胜负结果或规则状态字段。
- 所有 LLM 输出都保留“非权威建议”标记或来源范围标记。
- 赛后 AI 复盘引用的事件 id 必须存在于赛后时间轴中。
- 对同一份 replay，脚本评分结果不受 LLM 开关、失败或输出内容影响。

## 验收标准

- 所有 LLM 功能都可以关闭。
- 无 API key 路径完整可用。
- LLM 不参与裁判、行动决策、规则结算或评分。
- LLM payload 经过视角过滤，不包含完整 `GameState` 或 `internal` 信息。
- LLM 输出可追溯、可回退、非权威。

## 不在本阶段范围

- 让 LLM 决定 AI 玩家行动。
- 让 LLM 替代规则引擎。
- 让 LLM 替代脚本评分。
- 让 LLM 修改时间轴或胜负结果。
