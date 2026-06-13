# 00 R0 项目治理与文档重置

## 目标

完成“小狼杀”方向重启后的文档治理，让所有顶层规则、阶段 SPEC 和状态入口统一到新版 MVP：LLM 驱动真实 AI 对抗感，本地规则引擎负责权威裁判和兜底。

本阶段只改项目文档和阶段规则，不写业务代码。

## 背景

旧路线以无 API key 可运行的脚本 AI、模板发言、固定评分和本地复盘为 MVP 核心。用户确认新版方向后，旧文档中的多处约束已经不再成立：

- 旧 MVP 要求无 API key 完整可用。
- 旧规则禁止 LLM 成为决策层。
- 旧阶段把 LLM 能力放在 MVP 后增强。
- 旧脚本 AI 被设计为核心对手。

新版方向要求：

- 真实玩家感优先。
- MVP 可以依赖 LLM API key。
- LLM 作为 AI 玩家认知核心。
- 本地规则引擎仍是权威裁判。
- 人类玩家先以平民视角验证白天发言、站边和投票可玩性。

## 范围

本阶段必须更新：

- `AGENTS.md`
- `README.md`
- `ProjectStatus.md`
- `.codex/skills/xiaolangsha-stage-execution/SKILL.md`
- `specs/` 新版阶段文档

本阶段必须删除或替换：

- 旧 `specs/00` 到 `specs/12`。
- 临时重启讨论稿 `docs/2026-06-13-restart-requirements-and-roadmap.md`。

## 新版阶段体系

- `00-r0-governance-reset.md`: 项目治理与文档重置。
- `01-r1-llm-player-protocol.md`: LLM 玩家协议与信息隔离。
- `02-r2-civilian-playable-skeleton.md`: 人类平民视角可玩骨架。
- `03-r3-llm-speech-and-stance-consistency.md`: LLM 发言与站边一致性。
- `04-r4-structured-player-speech.md`: 玩家结构化发言体验。
- `05-r5-lightweight-replay-and-playability.md`: 轻量复盘与可玩性评估。
- `06-r6-free-text-speech.md`: 自由文本发言。
- `07-r7-expanded-roles-and-rulesets.md`: 扩展角色与板子。

## 验收标准

- 顶层文档一致说明：MVP 核心体验可以依赖 LLM API key。
- 顶层文档一致说明：LLM 可以生成 AI 玩家决策候选，但不能成为规则裁判。
- 顶层文档一致说明：脚本 AI 是兜底、测试替身和失败恢复机制，不再承担真实玩家感目标。
- `ProjectStatus.md` 指向新版当前阶段。
- `specs/` 不再保留与新版方向冲突的旧阶段文件。
- 临时重启讨论稿已删除。
- 本阶段不修改业务代码。

## 验证命令

本阶段为文档重置，不强制运行 `npm test` 或 `npm run build`。完成前必须人工检查：

- 没有 `TODO`、`TBD`、`xxx` 等占位。
- `AGENTS.md`、`README.md`、`ProjectStatus.md` 和 `specs/` 对 MVP、LLM 边界、阶段顺序的描述一致。
- `git status --short` 中本阶段只包含文档变更和临时文档删除。

