# ProjectStatus

## 当前阶段

阶段6已完成，当前进入阶段7：项目规则生成。

## 已锁定的关键决策

1. 项目名称：小狼杀
2. 项目类型：单人 Web 版 AI 狼人杀游戏
3. 当前工作方式：先产出工程化 Markdown 文档，不进入业务编码
4. MVP 规则：5人最简局；首夜禁止刀真人；死亡默认不亮身份；夜死无遗言，放逐有遗言；投票可弃票不可自投
5. MVP 前端方向：无美术素材、接近 CLI 的 Web 聊天室；用消息流展示主持人播报、AI 发言、玩家发言、投票和复盘，用结构化按钮完成夜晚行动、投票、确认、快进等规则动作
6. 数据原则：`TruthEvent` 为权威事实源，`GameSnapshot` 为派生缓存，`VisibleInformationSnapshot` 由规则引擎生成
7. 验收原则：技术正确性由 AI 自动化测试与 Reviewer Agent 审查负责；项目负责人只亲自跑通一次 MVP 并判断基础体验是否达标

## 阶段产出的文档摘要与链接

- [阶段1需求定义](docs/phase-1-requirements-definition.md)：精简后的阶段1交付文档，包含锁定决策、MVP 范围、核心用户故事、项目边界、核心反用例、MVP 规则基线 v0.3、AI 参与边界和 DoD 检查。
- [阶段2业务逻辑与 UX/User Flow](docs/phase-2-business-ux-flow.md)：精简后的阶段2交付文档，包含 MVP 主流程、双层状态模型、状态机基线、AI 输入输出边界和 DoD 结论。
- [阶段3数据结构与核心模型](docs/phase-3-data-structure-core-model.md)：阶段3交付文档，定义事件日志、状态快照、可见信息、字段级模型、枚举、事件 payload、恢复与重放规则。
- [阶段4技术选型](docs/phase-4-technology-selection.md)：阶段4交付文档，确定前端、状态管理、规则引擎、持久化、AI 代理、测试校验、部署边界和风险-缓解-备选表。
- [阶段5系统与接口设计](docs/phase-5-system-interface-design.md)：阶段5交付文档，确定模块边界、规则引擎接口、AI Client/Proxy 边界、存储与恢复接口、错误与降级格式、启动恢复流程和无循环依赖约束。
- [阶段5.5极简聊天室式 MVP 前端设计](docs/phase-5-5-chatroom-mvp-frontend-design.md)：阶段5.5交付文档，将前端收束为无美术素材、接近 CLI 的 Web 聊天室，定义聊天流、结构化操作区、可见信息到消息的映射、按钮到 `GameAction` 的映射、死亡旁观/快进 UI、输入限制、错误提示和首轮可运行骨架；门禁审查结论为阶段5与5.5均可进入阶段6。
- [阶段6测试与验收设计](docs/phase-6-testing-acceptance-design.md)：阶段6交付文档，采用“一局完整流程验收 + 模块验收矩阵”的组合方式，定义 E2E、RULE、STATE、UI、AI、STORE、ISO、REVIEW、HITL 编号化验收用例，并明确技术测试交给 AI，项目负责人只做 MVP 跑通与基础体验确认。
- 历史归档：`docs/archive/phase-1-requirements-definition-full-history.md` 与 `docs/archive/phase-2-business-ux-flow-full-history.md` 仅用于人工追溯。后续 AI Agent 默认不得读取 `docs/archive/`，除非用户明确要求追溯历史。

## 当前待解决问题

1. 阶段7需输出 `Agent.md`，写明阶段推进规则、双 Agent 开发审查规则、Reviewer 驳回单格式和 HITL 确认门禁。
2. 阶段7需输出 `Skill.md`，写明后续 AI Agent 如何读取 `ProjectStatus.md`、阶段文档和当前阶段任务。
3. 阶段7需将阶段6编号化验收用例纳入 Developer Agent 与 Reviewer Agent 的强制依据。
4. 阶段7需明确后续 AI Agent 默认不得读取 `docs/archive/`，除非项目负责人要求追溯历史。
5. 阶段7不得进入业务编码；若发现阶段6验收口径不足，先生成回溯清单修正阶段6。
