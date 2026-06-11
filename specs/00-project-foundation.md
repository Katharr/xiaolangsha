# 00 项目基础搭建

## 目标

搭建“小狼杀”的前端项目基础，不实现具体玩法。

## 范围

本阶段只创建工程、测试、目录结构和基础页面。不要实现狼人杀规则、AI 玩家、评分、复盘、局内教练或 LLM 调用。

## 技术要求

- 使用 TypeScript。
- 使用 React 构建 UI。
- 使用 Vite 进行开发和构建。
- 使用 Vitest 进行单元测试。
- 使用 Playwright 进行后续浏览器冒烟测试。
- 应用必须在无 API key 的情况下可运行。

## 目录结构

创建以下源码目录：

- `src/domain`: 规则引擎、完整 `GameState`、视角构造器、胜负判断。
- `src/ai`: 脚本 AI 玩家和结构化发言意图。
- `src/ui`: React 组件和页面。
- `src/replay`: 时间轴和复盘数据转换。
- `src/scoring`: 角色评分函数。
- `src/coach`: 局内教练上下文和本地教练逻辑。
- `src/storage`: 本地设置和历史对局持久化。

## 初始界面

首屏应是“小狼杀”的简单训练外壳，可以展示项目名、MVP 目标，以及游戏桌、行动面板、时间轴、教练、复盘的占位区域。不要做成营销落地页。

## Commands

定义以下 package scripts：

- `npm run dev`
- `npm test`
- `npm run build`
- `npm run test:e2e`

## 验收标准

- 开发者可以用 `npm run dev` 本地启动应用。
- `npm test` 至少运行一个占位测试。
- `npm run build` 成功。
- 目录边界存在。
- 本阶段不实现玩法逻辑。

## 不在本阶段范围

- 角色分配。
- 回合顺序。
- AI 决策。
- 时间轴事件。
- 评分。
- 复盘。
- 教练。
- API key 或 LLM 接入。
