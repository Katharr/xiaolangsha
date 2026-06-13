# 小狼杀

小狼杀是一个单人 Web 版 AI 狼人杀训练游戏。项目长期目标是训练玩家的完整狼人杀能力：发言、站边、投票、伪装、身份判断、局势推进、复盘和不同角色玩法。

项目已完成一次方向重启：新版 MVP 不再追求“纯本地脚本 AI + 完整训练闭环”，而是优先验证“LLM 驱动的真实 AI 对抗感”。核心体验可以依赖 LLM API key；无 API key 时只保留弱降级、测试替身或开发模式。

## 新版 MVP

第一版重启 MVP 是 6 人快速局 `quick-6-v1`：

- 2 狼人。
- 1 预言家。
- 1 女巫。
- 2 平民。
- 人类玩家默认先玩平民。
- AI 扮演其他 5 名玩家。
- 重点验证白天发言对抗、站边、投票和胜负刺激。
- 复盘和训练反馈先做轻量辅助。

MVP 成功标准不是“所有角色都完整可玩”，而是玩家能在 10 分钟内判断：和这些 AI 玩家对抗是否有真实局的感觉，自己发言和投票是否能影响局势，这个方向是否值得继续打磨。

## 核心架构

小狼杀采用“LLM 做玩家大脑，本地引擎做裁判”的架构。

```ts
GameState
  -> buildPlayerView(gameState, humanPlayerId)
  -> buildLlmPlayerView(gameState, aiPlayerId)
  -> buildLegalActionOptions(gameState, aiPlayerId)
  -> LLM AI 玩家生成决策候选
  -> validateLlmPlayerDecision(candidate, view, legalActions)
  -> 规则引擎提交合法 Action
```

本地规则引擎负责：

- 完整 `GameState`。
- 角色、阵营、座位和存活状态。
- 阶段推进和合法行动。
- 胜负结算。
- 时间轴和可见性。
- 玩家视角和 AI 视角过滤。
- LLM 输出校验、重试和兜底。

LLM AI 玩家负责：

- 基于自身视角理解局势。
- 形成怀疑、信任和站边。
- 决定是否跳身份、质疑、辩解或带票。
- 生成公开发言。
- 在合法行动列表内提出投票或夜间行动候选。

LLM 不能直接读取完整 `GameState`，不能直接修改规则状态，不能决定胜负，不能提交合法行动列表之外的动作。

## 玩家发言路线

MVP 使用“结构化意图 + 补充文本”：

1. 玩家选择发言意图，例如质疑、支持、反驳、跳身份、要求解释票型、建议投票、保留意见。
2. 玩家可以补充一句自然语言。
3. 系统把意图和文本写入时间轴。
4. AI 基于公开信息和玩家发言回应。

完全自由文本发言放到后续阶段，必须先完成文本解析、提示注入识别、失败降级和证据引用。

## 项目文档入口

每次新对话或新阶段开始时，优先读取：

1. [`ProjectStatus.md`](ProjectStatus.md)
2. [`AGENTS.md`](AGENTS.md)
3. 当前阶段的 `specs/XX-*.md`

`ProjectStatus.md` 是长期协作入口，只保留当前阶段、锁定决策、文档链接和待解决问题。

## 阶段文档

新版 `specs/` 按重启后的可玩性路线组织：

- `00-r0-governance-reset.md`: 项目治理与文档重置。
- `01-r1-llm-player-protocol.md`: LLM 玩家协议与信息隔离。
- `02-r2-civilian-playable-skeleton.md`: 人类平民视角可玩骨架。
- `03-r3-llm-speech-and-stance-consistency.md`: LLM 发言与站边一致性。
- `04-r4-structured-player-speech.md`: 玩家结构化发言体验。
- `05-r5-lightweight-replay-and-playability.md`: 轻量复盘与可玩性评估。
- `06-r6-free-text-speech.md`: 自由文本发言。
- `07-r7-expanded-roles-and-rulesets.md`: 扩展角色与板子。

除非当前 SPEC 明确要求，不要提前实现后续阶段功能。

## 技术栈

- TypeScript
- React
- Vite
- Vitest
- Playwright
- LLM provider 待后续技术选型确定

项目预期命令：

```bash
npm run dev
npm test
npm run build
npm run test:e2e
```

## 开发原则

- 一次只做一个阶段 SPEC。
- 完整 `GameState` 只能存在于规则引擎内部。
- UI 只读取人类玩家视角和公开显示数据。
- LLM 只接收过滤后的 `LlmPlayerView` 和合法行动列表。
- LLM 输出是“决策候选”，不是权威规则事实。
- 所有关键行为必须写入带可见性的时间轴。
- 多视角信息隔离测试是核心验收要求。
- 复盘必须基于时间轴，不能凭空评价。
- Git 提交信息使用中文。

