# ProjectStatus

## 当前阶段

阶段8已完成，当前处于阶段9：开发与双 Agent 审查。

阶段9状态校准结论：`S8-SLICE-01 / P9-S01` 工程可运行壳已合并到 `main`，当前可复验证据通过。

`S8-SLICE-02 / P9-S02` 共享模型与错误协议已完成 Developer 实现和 Reviewer 审查。

`S8-SLICE-03 / P9-S03` 开局、补位、身份揭示已完成 Developer 实现和 Reviewer 复审。

`S8-SLICE-04 / P9-S04` 首夜与夜晚结算已完成 Developer 实现和 Reviewer 复审；下一步进入 `S8-SLICE-05 / P9-S05`：天亮播报与顺次发言。

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

1. `S8-SLICE-02 / P9-S02` 已完成：新增 `shared` 枚举、核心模型、`GameAction`、`Result`、`AppError`、基础 Zod schema 和 schema 单元测试；引入 `zod` 作为运行时校验依赖。
2. `S8-SLICE-02 / P9-S02` 仅覆盖 `RULE-008`、`STATE-001`、`AI-002`、`STORE-002`、`STORE-003` 的共享协议/schema 前置部分；重复提交幂等、状态机动作合法性、AI 重试降级、事件重放和恢复失败清空入口仍属于后续切片。
3. `S8-SLICE-03 / P9-S03` 已完成：新增 `rules` 规则层开局入口，支持标准局/自由局创建、5 人身份补位、真人身份揭示、初始 `TruthEvent`、`GameSnapshot` 和真人 `VisibleInformationSnapshot`；覆盖 `RULE-001`、`RULE-008`、`STATE-001`、`ISO-001`。
4. `S8-SLICE-03 / P9-S03` 已知限制：仅推进到 `night_action` 前状态，不实现夜晚行动与结算；自由局需先 `create_game` 进入 `role_setup`，再由 `confirm_role_setup` 固定真人身份并补齐 AI；已有对局中重复 `create_game` 已按 `STATE-001` 拒绝。
5. `S8-SLICE-04 / P9-S04` 已完成：新增 `submit_night_action` 规则入口，支持狼人击杀、预言家查验、夜晚结算、夜死不亮身份、夜后胜负检查，并覆盖首夜禁止刀真人、自刀/非法目标拒绝、同 `idempotencyKey` 重放不产生重复事实、夜转昼轮次推进；覆盖 `RULE-002`、`RULE-005`、`RULE-006`、`RULE-007`、`RULE-008`、`ISO-003`、`ISO-004`。
6. 下一步任务为 `S8-SLICE-05 / P9-S05`：实现天亮播报与顺次发言；关联验收编号以 `docs/phase-8-development-breakdown.md` 对应切片和阶段6验收矩阵为准，必须继续保持死亡身份局中不公开、消息流不成为事实源。
7. 阶段9后续切片必须继续提交切片编号、验收编号、验证证据、已知限制和 Reviewer 结论；缺少证据、破坏 `ISO-001`/`ISO-002` 或违反模块边界时必须驳回。
8. `S8-SLICE-12` 通过 Reviewer Agent 后，进入阶段10并触发项目负责人执行 `HITL-001`；阶段9普通切片通过后暂不触发 HITL。
