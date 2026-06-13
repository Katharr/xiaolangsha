# ProjectStatus

## 当前阶段

阶段 R0：项目治理与文档重置。

当前已完成新版方向的确定文档落地：顶层规则、README、阶段 SPEC 和本地阶段执行规则已统一到“LLM 驱动真实 AI 对抗感”的路线。下一步应进入阶段 R1：LLM 玩家协议与信息隔离。

## 已锁定的关键决策

1. 长期目标是训练“狼人杀完整游戏能力”，未来所有板子、所有角色都应可玩。
2. MVP 优先验证可玩性、胜负刺激和 AI 对抗感，复盘和训练反馈为辅助。
3. MVP 可以先做人类平民视角，核心验证白天发言对抗、站边和投票。
4. 真实玩家感优先，MVP 可以依赖 LLM API key。
5. LLM 作为 AI 玩家认知核心，负责局势理解、怀疑、站边、跳身份、发言和投票候选。
6. 本地规则引擎作为权威裁判，负责信息过滤、合法行动、状态推进、胜负结算和越权兜底。
7. 玩家发言路线为“先结构化意图 + 补充文本，后续开放自由文本”。

## 阶段产出摘要

- [AGENTS.md](AGENTS.md)：新版项目规则、LLM 权限边界、信息隔离、阶段执行和验证要求。
- [README.md](README.md)：新版项目说明、MVP 目标、架构原则和阶段目录。
- [00 R0 项目治理与文档重置](specs/00-r0-governance-reset.md)：本阶段文档重置范围和验收。
- [01 R1 LLM 玩家协议与信息隔离](specs/01-r1-llm-player-protocol.md)：下一阶段目标，定义 LLM 玩家视角、合法行动、决策候选和校验器。
- [02 R2 人类平民视角可玩骨架](specs/02-r2-civilian-playable-skeleton.md)：后续可玩骨架。
- [03 R3 LLM 发言与站边一致性](specs/03-r3-llm-speech-and-stance-consistency.md)：后续 AI 真实感增强。
- [04 R4 玩家结构化发言体验](specs/04-r4-structured-player-speech.md)：后续玩家发言交互。
- [05 R5 轻量复盘与可玩性评估](specs/05-r5-lightweight-replay-and-playability.md)：后续轻量反馈闭环。
- [06 R6 自由文本发言](specs/06-r6-free-text-speech.md)：后续自由表达。
- [07 R7 扩展角色与板子](specs/07-r7-expanded-roles-and-rulesets.md)：后续角色和板子扩展。

## 当前待解决问题

- 进入 R1 前，需要确认旧代码是直接迁移、部分保留，还是以新协议为准重写相关 AI 层。
- LLM provider 和模型选择尚未确定，应在 R1 或后续技术选型中基于成本、延迟、结构化输出能力决定。
- `LlmPlayerView`、`LegalActionOption`、`LlmPlayerDecisionCandidate` 的具体 TypeScript 契约尚未定义。
- LLM 请求与响应的校验失败、重试和弱脚本兜底策略尚未实现。
- 人类平民 MVP 的具体发言轮数、投票节奏和 UI 行动流将在 R2/R4 细化。
