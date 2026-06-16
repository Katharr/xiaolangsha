# ProjectStatus

## 当前阶段

阶段5已完成，准备进入阶段6：测试与验收设计

## 已锁定的关键决策

1. 项目名称：小狼杀
2. 项目类型：单人 Web 版 AI 狼人杀游戏
3. 当前工作方式：先产出工程化 Markdown 文档，不进入业务编码
4. MVP 规则：5人最简局；首夜禁止刀真人；死亡默认不亮身份；夜死无遗言，放逐有遗言；投票可弃票不可自投
5. 核心体验：沉浸式、休闲向，AI 完整参与推理、欺骗、投票和复盘
6. 数据原则：`TruthEvent` 为权威事实源，`GameSnapshot` 为派生缓存，`VisibleInformationSnapshot` 由规则引擎生成
7. 技术路线：React + Vite + TypeScript；Zustand；纯 TypeScript 规则引擎；IndexedDB + Dexie；Node.js + Express + OpenAI JS SDK 轻量 AI API 代理

## 阶段产出的文档摘要与链接

- [阶段1需求定义](docs/phase-1-requirements-definition.md)：精简后的阶段1交付文档，包含锁定决策、MVP 范围、核心用户故事、项目边界、核心反用例、MVP 规则基线 v0.3、AI 参与边界和 DoD 检查。
- [阶段2业务逻辑与 UX/User Flow](docs/phase-2-business-ux-flow.md)：精简后的阶段2交付文档，包含 MVP 主流程、双层状态模型、状态机基线、AI 输入输出边界和 DoD 结论。
- [阶段3数据结构与核心模型](docs/phase-3-data-structure-core-model.md)：阶段3交付文档，定义事件日志、状态快照、可见信息、字段级模型、枚举、事件 payload、恢复与重放规则。
- [阶段4技术选型](docs/phase-4-technology-selection.md)：阶段4交付文档，确定前端、状态管理、规则引擎、持久化、AI 代理、测试校验、部署边界和风险-缓解-备选表。
- [阶段5系统与接口设计](docs/phase-5-system-interface-design.md)：阶段5交付文档，确定模块边界、规则引擎接口、AI Client/Proxy 边界、存储与恢复接口、错误与降级格式、启动恢复流程和无循环依赖约束。
- 历史归档：`docs/archive/phase-1-requirements-definition-full-history.md` 与 `docs/archive/phase-2-business-ux-flow-full-history.md` 仅用于人工追溯。后续 AI Agent 默认不得读取 `docs/archive/`，除非用户明确要求追溯历史。

## 当前待解决问题

1. 阶段6需定义可量化测试用例：规则引擎、状态机、AI Proxy、存储恢复、刷新恢复、快进失败、复盘追问。
2. 阶段6需定义验收标准：单局跑通、异常路径、可恢复性、可重放性、AI 降级行为。
3. 阶段6需覆盖自由局手动选身份、`idempotencyKey` 防重复、AI Client/Proxy 边界、复盘完整真相输入、非 review 阶段禁止构造/发送 `ReviewContext`、事件唯一事实源。
4. 阶段6不得推翻阶段1至阶段5的锁定规则；若发现冲突，先生成回溯清单。
