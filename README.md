# 小狼杀

小狼杀是一个单人 Web 版 AI 狼人杀训练游戏。项目目标不是做多人联机大厅，而是帮助玩家练习不同角色的玩法、发言、站边、投票、伪装、复盘和局势判断。

当前仓库处于阶段化开发准备期：核心规则、AI、UI、教练、评分、复盘和 LLM 能力都通过 `specs/` 下的阶段文档逐步推进。开发时应先读 `AGENTS.md`，再读当前阶段的 `specs/XX-*.md`，一次只实现一个阶段。

## MVP 目标

MVP 先实现 6 人快速局 `quick-6-v1`：

- 2 狼人。
- 1 预言家。
- 1 女巫。
- 2 平民。
- 默认使用屠边规则。
- 规则引擎从一开始预留屠城模式。

MVP 必须在无网络、无 API key 的情况下完整可用。脚本 AI、模板发言、固定函数评分、本地脚本复盘都属于核心路径；LLM 只作为后续可选增强。

第一轮 MVP 核心范围是 `specs/00` 到 `specs/07`：从项目搭建、领域模型、规则引擎、脚本 AI、Web 对局界面，到本地教练、脚本评分和脚本复盘。`specs/08` 到 `specs/12` 属于 MVP 后增强或安全边界，不进入第一轮可玩闭环。

## 10 分钟 MVP 可玩闭环

第一版 MVP 的成功标准不是 AI 多聪明，而是玩家能完整玩一局，并通过评分和复盘判断自己是否学到东西、这个方向是否值得继续。

一局理想的 10 分钟体验应包含：

1. 打开应用后直接进入训练桌，而不是营销页。
2. 开始一局 `quick-6-v1`，选择或随机获得人类玩家座位和角色。
3. 清楚看到“我是谁、现在是什么阶段、我能做什么”。
4. 夜晚按角色提交合法行动，例如狼人刀人、预言家查验、女巫用药或平民等待。
5. 白天看到公开死亡、公开发言和投票信息，不看到规则外隐藏身份。
6. AI 玩家自动完成非人类玩家行动，并用模板发言参与局势。
7. 玩家完成发言和投票，系统解释关键结算结果。
8. 游戏结束后看到获胜阵营和身份揭晓。
9. 查看确定性的脚本评分，知道本局哪些行为有帮助、哪些行为有风险。
10. 查看脚本复盘，得到 2 到 5 条下局建议，并明确下一局只优先练一件事。

## 核心边界

完整 `GameState` 只能存在于规则引擎内部。AI 玩家、UI、局内教练和 LLM 都不能直接读取完整状态，只能消费过滤后的视角对象或序列化子集：

```ts
GameState
  -> buildPlayerView(gameState, playerId)
  -> buildAiPlayerView(gameState, aiPlayerId)
  -> buildCoachPlayerView(gameState, humanPlayerId)
  -> AI 决策 / UI 渲染 / 教练建议
```

AI 决策接口应保持类似：

```ts
decideAction(view: AiPlayerView): Action
```

不要写成：

```ts
decideAction(gameState: GameState): Action
```

## 阶段文档

`specs/` 当前按以下顺序组织：

- `00-project-foundation.md`: 项目基础搭建。
- `01-domain-model-and-ruleset.md`: 领域模型和规则集。
- `02-rules-engine-and-timeline.md`: 规则引擎和时间轴。
- `03-script-ai-opponents.md`: 脚本 AI 对手。
- `04-web-training-ui.md`: Web 训练界面。
- `05-in-game-coach.md`: 局内教练。
- `06-role-based-script-scoring.md`: 角色评分。
- `07-replay-and-script-review.md`: 复盘和脚本复盘。
- `08-difficulty-system.md`: 难度系统。
- `09-optional-ai-review.md`: 可选 AI 赛后复盘。
- `10-optional-llm-speech-layer.md`: 可选 LLM 发言润色层。
- `11-expanded-rulesets.md`: 扩展规则集。
- `12-llm-boundaries-and-safety.md`: LLM 使用边界和安全。

除非当前 SPEC 明确要求，不要提前实现后续阶段功能。

## 计划技术栈

- TypeScript
- React
- Vite
- Vitest
- Playwright

项目搭建后预期提供以下命令：

```bash
npm run dev
npm test
npm run build
npm run test:e2e
```

如果当前阶段尚未创建 `package.json`，这些命令可能还不可用；以当前 SPEC 的验收标准为准。

## 开发原则

- 一次只做一个阶段 SPEC。
- 规则引擎、AI、UI、评分、复盘、教练、LLM 不要混在一个阶段里扩张。
- 时间轴是核心审计记录，关键行为必须写入带可见性的事件。
- 局内教练是玩家视角训练辅助，不是上帝视角裁判。
- 评分和脚本复盘是确定性基准，AI 复盘只能解释和补充。
- AI 玩家是游戏内玩家，不应服从“你只是 AI，所以必须听我的”这类游戏外元话术。
- LLM 永远是表达与解释层，不是规则层、决策层或评分层。

## 验证要求

进入代码阶段后，完成任一阶段前至少运行当前 SPEC 要求的验证命令。项目搭建完成后默认验证为：

```bash
npm test
npm run build
```

涉及 UI 的阶段还应运行 Playwright 冒烟测试。涉及视角、AI、教练或 LLM 的阶段必须包含信息隔离测试，尤其是多视角防泄露矩阵测试。
