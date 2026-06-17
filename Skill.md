---
name: xiaolangsha-project-onboarding
description: Use when an AI Agent continues, plans, implements, reviews, or audits the 小狼杀 project. This project skill defines how to load ProjectStatus.md, select phase documents, avoid archive overloading, obey Agent.md, and preserve the locked AI狼人杀 architecture before doing any project work.
---

# 小狼杀项目协作 Skill

## 启动顺序

每次接手项目时，先执行以下步骤：

1. 读取 `ProjectStatus.md`，确认当前阶段、锁定决策、阶段文档链接和待解决问题。
2. 读取本轮用户任务，判断任务类型：阶段推进、回溯修正、开发拆分、Developer 实现、Reviewer 审查、HITL 协助或资料追溯。
3. 读取 `Agent.md`，确认阶段门禁、双 Agent 规则、验收编号和禁止事项。
4. 按任务类型读取必要阶段文档。
5. 若发现当前任务与锁定决策冲突，先输出回溯清单或请求用户决策，不得直接改写规则。

## 文档读取矩阵

| 任务类型 | 必读文档 |
| --- | --- |
| 阶段推进 | `ProjectStatus.md`、`Agent.md`、上一阶段文档、当前阶段相关输入文档 |
| 阶段8开发拆分 | `ProjectStatus.md`、`Agent.md`、阶段1至阶段7主文档 |
| Developer 实现 | `ProjectStatus.md`、`Agent.md`、阶段8拆分文档、阶段5、阶段5.5、阶段6、当前切片相关阶段文档 |
| Reviewer 审查 | `ProjectStatus.md`、`Agent.md`、阶段6、阶段8拆分文档、Developer 交付说明、被审查改动相关阶段文档 |
| HITL 协助 | `ProjectStatus.md`、`Agent.md`、阶段6的 `HITL-001`、当前可运行骨架说明 |
| 回溯修正 | `ProjectStatus.md`、`Agent.md`、触发阶段文档、目标修正阶段文档、直接相邻阶段文档 |
| 历史追溯 | 仅在用户明确要求时读取 `docs/archive/` |

不要默认全量读取历史归档。归档只用于追溯讨论过程，不是当前规范来源。

## 归档读取规则

默认不得读取 `docs/archive/`。

允许读取归档的条件：

- 用户明确说要追溯历史。
- 用户明确要求查看归档。
- 用户明确要求查看调研来源。
- 用户明确要求查看过去讨论过程。

若归档与主文档冲突，以 `ProjectStatus.md` 和阶段主文档为准。除非用户要求重新讨论，否则不得用归档推翻已锁定结论。

## 当前项目核心约束

小狼杀是单人 Web 版 AI 狼人杀游戏。MVP 是 5 人最简局：1 狼人、1 预言家、3 村民。

当前锁定规则：

- 首夜禁止狼人刀真人。
- 死亡默认不亮身份。
- 夜死无遗言，放逐有遗言。
- 投票可弃票，不可自投。
- 平票最多追加一次拉票和二次投票。
- 真人死亡后只能旁观或快进，不能继续影响局势。
- 终局复盘公开完整真相，并允许基于真实记录追问。

## 架构边界提醒

模块分层为 `ui / store / rules / storage / ai-client / ai-proxy / shared`。

强制边界：

- `rules` 是规则事实的唯一写入口。
- `applyAction(action, context) -> RuleEngineResult` 是规则引擎核心入口。
- `TruthEvent` 是唯一权威事实源。
- `GameSnapshot` 是派生缓存，冲突时以事件重放为准。
- `VisibleInformationSnapshot` 是局中 UI 与 AI 的可见信息来源。
- 所有改变状态的 `GameAction` 必须带 `idempotencyKey`。
- 非法动作不得写入 `TruthEvent`。

## AI 边界提醒

AI 可以发言、推理、欺骗、投票、夜晚行动和复盘，但不能直接改变规则事实。

局中 AI 只能接收 `VisibleInformationSnapshot`、公开发言、公开投票和合法目标。

只有 `review` 阶段允许构造并发送 `ReviewContext`。非 `review` 阶段禁止构造、发送或展示完整真相上下文。

前端不得读取 API key。AI 调用只能通过服务端 AI Proxy，统一接口为 `POST /api/ai/respond`。

AI 失败时先重试一次；仍失败则使用安全降级策略，并在有效业务事件 metadata 中标记降级来源。

## 前端边界提醒

MVP 前端是接近 CLI 的 Web 聊天室，不是卡牌战斗界面。

第一版不做：

- 美术素材。
- 头像、背景图、动画。
- 移动端专项适配。
- 复杂主题系统。
- 自然语言驱动规则动作。

主界面由“状态栏 + 消息流 + 结构化操作区 + 输入区”组成。

所有规则动作必须通过结构化按钮、选择器或确认控件提交。自由文本只用于白天发言、平票拉票、放逐遗言和复盘追问。

聊天室消息是 UI 派生视图，不是事实源。局中消息只能来自过滤后的可见信息、`PendingAction`、Store 状态和 `AppError`。

## 验收编号使用规则

后续开发与审查必须引用阶段6编号化验收用例。

最低要求：

- 规则结算切片覆盖 `RULE-*`。
- 状态推进切片覆盖 `STATE-*`。
- UI 切片覆盖 `UI-*` 或 `E2E-*`。
- AI 调用切片覆盖 `AI-*` 与相关 `ISO-*`。
- 存储恢复切片覆盖 `STORE-*`。
- 复盘切片覆盖 `REVIEW-*`。
- 第一轮可运行骨架必须最终执行 `HITL-001`。

`ISO-001` 与 `ISO-002` 是红线验收，任何破坏都必须驳回。

## 输出习惯

阶段1至阶段8期间，输出文档、清单、方案和验收设计，不输出业务代码。

阶段9之后，Developer Agent 才能按阶段8切片实现代码。Reviewer Agent 只能审查，不得直接修改 Developer 的代码。

任何阶段结束后，必须更新 `ProjectStatus.md`，并保持它极简：

- 当前阶段。
- 已锁定关键决策，不超过7条。
- 阶段产出文档摘要与链接。
- 当前待解决问题。

## 冲突处理

发现矛盾时，先判断是否只影响上一阶段：

- 只影响上一阶段：生成回溯清单，先修正上一阶段。
- 需要推翻更早核心决策：触发重启讨论。
- 涉及安全、隐私、技术不可行：提出专业否决，并给出可验证依据和替代方向。

不得在无用户反馈的情况下坚持假设。
