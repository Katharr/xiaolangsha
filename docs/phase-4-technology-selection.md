# 小狼杀：阶段4 技术选型

## 文档状态

- 阶段：阶段4 技术选型
- 状态：已收束，可作为阶段5“系统与接口设计”的输入
- 收束日期：2026-06-15
- 默认上下文入口：仅使用 `ProjectStatus.md`、阶段1至阶段4主文档
- 上下文规则：默认不得读取 `docs/archive/`；除非用户明确要求追溯历史、调研来源或讨论过程

## 锁定技术决策

1. 架构采用“前端本地应用 + 轻量 AI API 代理”。
2. MVP 以本地开发为主，但技术栈兼容后续私有部署。
3. 前端采用 React + Vite + TypeScript。
4. 状态管理采用 Zustand；核心规则引擎采用纯 TypeScript 模块。
5. 本地持久化采用 IndexedDB，并使用 Dexie 作为访问封装。
6. AI 调用通过服务端代理完成，前端不得直接持有 API key。
7. MVP 保留 `AI_MODEL_GAME`、`AI_MODEL_REVIEW`、`AI_MODEL_FALLBACK` 三个模型配置位，当前均填写官方模型 ID `gpt-5.5`。

## 总体架构

MVP 采用本地优先架构：

`浏览器前端 -> 本地状态与规则引擎 -> IndexedDB 持久化 -> 轻量 AI API 代理 -> AI 服务`

职责边界：

| 模块 | 职责 | 禁止项 |
| --- | --- | --- |
| 前端 UI | 展示页面、收集玩家输入、展示可见信息 | 不直接读取完整真相日志；不保存 API key |
| Zustand Store | 保存当前 UI 状态、加载状态、错误状态、当前对局派生视图 | 不直接修改规则事实 |
| 规则引擎 | 校验动作、写入 `TruthEvent`、生成 `GameSnapshot` 与 `VisibleInformationSnapshot` | 不调用 AI；不依赖 UI 框架 |
| Dexie/IndexedDB | 保存当前局数据，支持刷新恢复 | 不作为规则权威来源替代事件日志 |
| AI API 代理 | 持有 API key，调用 AI，返回结构化结果 | 不写入对局状态；不决定玩家可见信息 |
| AI 服务 | 生成发言、投票理由、夜晚行动建议、复盘回答 | 不直接改变身份、死亡、投票、胜负等规则事实 |

## 前端选型

| 选型 | 结论 | 理由 |
| --- | --- | --- |
| 构建框架 | Vite | 启动快，适合本地 MVP；后续可静态部署 |
| UI 框架 | React | 状态驱动清晰，适合复杂流程 UI |
| 类型系统 | TypeScript | 阶段3模型字段较多，需要类型约束 |
| 状态管理 | Zustand | 轻量，适合游戏当前状态与 UI 状态管理 |
| 样式方案 | CSS Modules | MVP 可控、低约定，便于后续 AI Agent 阅读 |
| 图标 | lucide-react | 用于按钮、状态和操作图标 |

不在 MVP 引入重型组件库。完整体验阶段若需要更快构建复杂 UI，可再评估 Tailwind CSS 或 shadcn/ui。

## 规则引擎选型

规则引擎采用纯 TypeScript 模块，不绑定 React、Zustand 或 Dexie。

核心输入：

- 当前 `GameSession`
- 当前 `TruthEvent[]`
- 当前 `GameSnapshot`
- 玩家动作或 AI 结构化输出

核心输出：

- 新的合法 `TruthEvent`
- 更新后的 `GameSnapshot`
- 面向指定玩家的 `VisibleInformationSnapshot`

该设计保证规则事实只由规则引擎改变，AI 与 UI 都不能绕过规则层直接改写游戏真相。

## 持久化选型

MVP 使用 IndexedDB 保存当前局，并通过 Dexie 封装读写。

MVP 保存内容：

- `currentGameSession`
- 当前局 `TruthEvent[]`
- 当前局 `GameSnapshot`
- 必要的本地设置，如最近一次恢复信息

MVP 不保存内容：

- 多局历史列表
- 复盘问答持久记录
- API key
- 局中玩家发言摘要

扩展边界：

- 当前局模型保留 `gameId`，未来可扩展为多局历史。
- 新开局在 MVP 中覆盖 `currentGame`。
- 若快照损坏或版本过旧，应优先通过 `TruthEvent[]` 重放恢复。

## AI 接入选型

AI 接入采用服务端代理，浏览器前端只调用本项目自己的 API。

环境变量：

```env
OPENAI_BASE_URL=服务商 baseUrl
OPENAI_API_KEY=服务端 API key
AI_MODEL_GAME=gpt-5.5
AI_MODEL_REVIEW=gpt-5.5
AI_MODEL_FALLBACK=gpt-5.5
```

模型配置含义：

| 配置位 | 用途 | MVP 值 |
| --- | --- | --- |
| `AI_MODEL_GAME` | 局中发言、投票、夜晚行动、遗言/拉票 | `gpt-5.5` |
| `AI_MODEL_REVIEW` | 终局复盘与追问回答 | `gpt-5.5` |
| `AI_MODEL_FALLBACK` | AI 调用失败后的备用模型配置位 | `gpt-5.5` |

MVP 使用单模型，但保留三个用途位，便于未来替换为更快或更便宜的模型。当前 `AI_MODEL_FALLBACK` 不是实际低成本模型；真实降级策略是 AI 调用重试一次后，使用固定模板或随机合法动作，并在事件 metadata 中记录 `fallbackReason`。

AI 输出必须采用结构化 JSON。局中发言字段必须保留原文 `text`，不得用摘要替代原文。`analysisSummary` 与 `decisionSummary` 只表示 AI 的主观分析和决策理由，可写入事件 metadata，局中不可见，终局可见。

## AI 代理运行方式

MVP 默认：

- 本地 Vite 前端
- 本地轻量 AI API 代理，采用 Node.js + Express + OpenAI JS SDK

后续私有部署兼容：

- 前端可部署为静态站点
- AI 代理可迁移为 Vercel Serverless Function
- 环境变量迁移到部署平台服务端配置
- 本地 Express 代理与 Vercel Function 必须保持同一 AI Proxy 接口契约

阶段4不设计公开用户体系、防刷、计费、多用户隔离和用户自带 key。

## 校验与测试选型

| 选型 | 用途 |
| --- | --- |
| Zod | 校验事件 payload、AI JSON 输出、可见信息快照 |
| Vitest | 测试规则引擎、状态机、事件回放 |
| Playwright | 后续验证完整一局流程 |
| ESLint + Prettier | 统一代码质量和格式，方便长期 AI 维护 |

优先测试对象：

1. 规则引擎的状态流转。
2. `TruthEvent[]` 重放生成 `GameSnapshot`。
3. `VisibleInformationSnapshot` 不泄露不可见真相。
4. AI JSON 输出通过 Zod 校验后仍需经过规则引擎合法性校验。
5. 刷新恢复、防重复提交和快进失败恢复。

## 风险-缓解-备选表

| 风险 | 影响 | 缓解 | 备选 |
| --- | --- | --- | --- |
| IndexedDB 数据损坏或版本变更 | 当前局无法恢复 | 使用 `schemaVersion`；快照可由事件日志重放；升级时做迁移检查 | 清空当前局并提示重新开始 |
| Dexie 封装理解成本 | 后续 AI Agent 误用存储层 | 将存储层限制为少量 repository 函数 | 直接使用 IndexedDB API，但代码更繁琐 |
| Zustand 与规则引擎边界混乱 | UI 直接改写规则事实 | 明确 Store 只调规则引擎，不手写事件 | 引入更严格的 action facade |
| AI 调用失败 | 游戏流程卡住 | 重试一次；失败后使用固定模板或随机合法动作；在 metadata 记录 `fallbackReason` | 未来将 `AI_MODEL_FALLBACK` 替换为可用的更快或更便宜模型 |
| 单模型成本或速度偏高 | 局中等待时间变长 | 限制无意义调用；结构化输出；失败重试上限 | 未来将 `AI_MODEL_GAME` 或 `AI_MODEL_FALLBACK` 替换为更快或更便宜模型 |
| 结构化 JSON 不合法 | 规则引擎无法消费 | Zod 校验；失败重试；仍失败则降级 | 使用固定模板或随机合法动作 |
| API key 暴露 | 账号与费用风险 | key 只放服务端代理环境变量；前端不得读取 | 若只本地试玩，可临时本地代理，但仍不放前端 |
| 私有部署与本地代理差异 | 后续迁移成本 | 阶段5定义统一 AI Proxy 接口 | 先只支持本地代理，私有部署另开阶段 |
| 发言摘要误替代原文 | 影响推理与复盘真实性 | 局中只保存和传递发言原文 | 复盘阶段按需生成摘要，不持久化为事实 |

## 阶段5输入项

阶段5“系统与接口设计”需要基于本阶段选型继续细化：

1. 前端模块划分：页面、Store、规则引擎、持久化、AI client 的目录边界。
2. 规则引擎接口：动作输入、事件输出、快照生成、可见信息生成。
3. IndexedDB 表结构与 repository API。
4. AI Proxy API：发言、夜晚行动、投票、遗言/拉票、复盘追问的请求与响应 schema。
5. 错误与降级接口：AI 失败、JSON 校验失败、重复提交、恢复失败。
6. 刷新恢复流程：启动时如何从 IndexedDB 恢复当前局。
7. 私有部署兼容边界：本地 Express 代理与 Vercel Function 代理共享同一接口契约。

## 阶段4 DoD 检查

| DoD 项 | 结论 |
| --- | --- |
| 前端框架已确定 | 通过：React + Vite + TypeScript |
| 状态管理已确定 | 通过：Zustand + 纯 TypeScript 规则引擎 |
| 本地持久化方案已确定 | 通过：IndexedDB + Dexie |
| AI 服务调用方式已确定 | 通过：服务端轻量代理，前端不持有 API key |
| 部署边界已确定 | 通过：MVP 本地开发为主，兼容后续私有部署 |
| 风险-缓解-备选表已输出 | 通过 |
| 是否可进入阶段5系统与接口设计 | 通过 |

阶段4收束结论：技术选型已完成，可以进入阶段5。
