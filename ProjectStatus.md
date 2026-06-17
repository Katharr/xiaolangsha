# ProjectStatus

## 当前阶段

阶段8已完成，当前进入阶段9：开发与双 Agent 审查。

## 已锁定的关键决策

1. 项目名称：小狼杀
2. 项目类型：单人 Web 版 AI 狼人杀游戏
3. 当前工作方式：阶段9开始允许按阶段8切片进入业务编码，但必须采用 Developer Agent 实现、Reviewer Agent 独立审查、项目负责人最终确认的流程
4. MVP 规则：5人最简局；首夜禁止刀真人；死亡默认不亮身份；夜死无遗言，放逐有遗言；投票可弃票不可自投
5. MVP 前端方向：无美术素材、接近 CLI 的 Web 聊天室；用消息流展示主持人播报、AI 发言、玩家发言、投票和复盘，用结构化按钮完成夜晚行动、投票、确认、快进等规则动作
6. 数据原则：`TruthEvent` 为权威事实源，`GameSnapshot` 为派生缓存，`VisibleInformationSnapshot` 由规则引擎生成
7. 开发拆分原则：阶段9必须按 `docs/phase-8-development-breakdown.md` 的 12 个 `S8-SLICE-*` 顺序推进；每个切片必须绑定阶段6验收编号、覆盖相关负路径，并经过 Reviewer Agent 审查

## 阶段产出的文档摘要与链接

- [阶段1需求定义](docs/phase-1-requirements-definition.md)：精简后的阶段1交付文档，包含锁定决策、MVP 范围、核心用户故事、项目边界、核心反用例、MVP 规则基线 v0.3、AI 参与边界和 DoD 检查。
- [阶段2业务逻辑与 UX/User Flow](docs/phase-2-business-ux-flow.md)：精简后的阶段2交付文档，包含 MVP 主流程、双层状态模型、状态机基线、AI 输入输出边界和 DoD 结论。
- [阶段3数据结构与核心模型](docs/phase-3-data-structure-core-model.md)：阶段3交付文档，定义事件日志、状态快照、可见信息、字段级模型、枚举、事件 payload、恢复与重放规则。
- [阶段4技术选型](docs/phase-4-technology-selection.md)：阶段4交付文档，确定前端、状态管理、规则引擎、持久化、AI 代理、测试校验、部署边界和风险-缓解-备选表。
- [阶段5系统与接口设计](docs/phase-5-system-interface-design.md)：阶段5交付文档，确定模块边界、规则引擎接口、AI Client/Proxy 边界、存储与恢复接口、错误与降级格式、启动恢复流程和无循环依赖约束。
- [阶段5.5极简聊天室式 MVP 前端设计](docs/phase-5-5-chatroom-mvp-frontend-design.md)：阶段5.5交付文档，将前端收束为无美术素材、接近 CLI 的 Web 聊天室，定义聊天流、结构化操作区、可见信息到消息的映射、按钮到 `GameAction` 的映射、死亡旁观/快进 UI、输入限制、错误提示和首轮可运行骨架。
- [阶段6测试与验收设计](docs/phase-6-testing-acceptance-design.md)：阶段6交付文档，采用“一局完整流程验收 + 模块验收矩阵”的组合方式，定义 E2E、RULE、STATE、UI、AI、STORE、ISO、REVIEW、HITL 编号化验收用例，并明确技术测试交给 AI，项目负责人只做 MVP 跑通与基础体验确认。
- [阶段7项目规则生成](docs/phase-7-project-rules-generation.md)：阶段7交付文档，记录门禁审查、`Agent.md`、`Skill.md`、双 Agent 审查规则、Reviewer 驳回单和 HITL 门禁。
- [阶段8开发阶段拆分](docs/phase-8-development-breakdown.md)：阶段8交付文档，将第一轮 MVP 骨架拆为 12 个 `S8-SLICE-*`，并定义每个切片的目标、输入、产出、禁止范围、验收编号、负路径、Developer 任务单和 Reviewer 审查单模板。
- [Agent 工作规则](Agent.md)：后续所有 Agent 的阶段推进、回溯、Developer/Reviewer 分工、驳回单、通过单、HITL 和红线规则。
- [项目协作 Skill](Skill.md)：后续 AI Agent 的启动读取顺序、文档读取矩阵、归档读取规则、架构边界、AI 边界、前端边界和验收编号使用规则。
- 历史归档：`docs/archive/phase-1-requirements-definition-full-history.md` 与 `docs/archive/phase-2-business-ux-flow-full-history.md` 仅用于人工追溯。后续 AI Agent 默认不得读取 `docs/archive/`，除非项目负责人明确要求追溯历史、查看归档、查看调研来源或查看讨论过程。

## 当前待解决问题

1. 阶段9需从 `S8-SLICE-01` 开始，由 Developer Agent 创建工程可运行壳，并提交切片编号、验收编号、验证证据和已知限制。
2. 每个阶段9切片完成后，必须由 Reviewer Agent 独立审查；缺少验收编号、缺少证据、破坏 `ISO-001`/`ISO-002` 或违反模块边界时必须驳回。
3. 阶段9执行期间若发现阶段8拆分不足，只允许先生成回溯清单修正阶段8，不得跳过切片直接编码。
4. `S8-SLICE-12` 通过 Reviewer Agent 后，进入阶段10并触发项目负责人执行 `HITL-001`。
5. 阶段9普通切片通过后暂不触发 HITL；项目负责人最终确认仍是每个开发阶段正式推进的门禁。
