# ProjectStatus — 小狼杀（xiaolangsha / langrensha）

> 这份文档替代了 Codex 早期那套「阶段 / 驳回单 / 双 Agent 审查 / HITL 门禁」的过度工程流程，只记录**当前真实状态**。详细交接见 `CLAUDE.md`，构建计划见 `docs/BUILD-PLAN.md`。

## 它是什么

单人网页版 **AI 狼人杀**：1 个真人 + 4 个 AI，开局到复盘全程可玩。AI 由真 LLM（OpenAI 兼容端点，`gpt-5.5`）驱动，调用失败自动降级到本地脚本AI。

技术栈：Vite + React 19 + TypeScript + Zod + Zustand + Dexie(IndexedDB)。单板 `mvp_5p_wolf_seer_3villagers`（1 狼 / 1 预言家 / 3 村民）。

## 状态：可玩 MVP 已就绪 ✅

- **M1–M7 全部完成**。`npm test` → **15 文件 104 用例全绿**；`npm run build`（tsc + vite）通过。
- 开局（标准 / 自由）→ 首夜 → 天亮播报 → 发言 → 投票 / 平票 / 放逐 / 遗言 → 胜负 → 复盘追问，端到端打通。
- e2e 冒烟（`src/store/smoke.test.ts`）确定性地把标准局与自由局都打到 review。

## 架构分层（模块边界即纪律）

```
shared ← rules        rules 只依赖 shared，不碰 UI/storage/AI/React
storage               只持久化（Dexie 三表原子写）
ai-client             不持 key，只见 VisibleInformationSnapshot；scriptedAi / httpAi / withFallback
ai-proxy              持 key、调 LLM（Vite dev 中间件 /api/ai/respond）
store                 只编排（applyAction→持久化→派生→驱动 AI），永不手写 TruthEvent
ui                    只读 visibleInformation / messages / reviewContext
```

两条红线：
- **ISO-001**：UI 物理上拿不到 snapshot/events，只能读真人视角的 `VisibleInformationSnapshot`（局中不泄露 AI 身份）。
- **ISO-002**：完整真相只在 `gamePhase==="review"` 时经 `buildReviewContext` 组装。

数据模型三层：`TruthEvent`（append-only 权威事实）→ `GameSnapshot`（派生缓存）→ `VisibleInformationSnapshot`（每 viewer 信息隔离视图）。规则引擎唯一入口 `src/rules/index.ts` 的 `applyAction`。

## 模块清单

| 目录 | 职责 |
| --- | --- |
| `src/shared` | 数据模型 / 枚举 / GameAction / Result / Zod schema |
| `src/rules` | 事件溯源规则引擎 + 信息隔离 + 复盘上下文 |
| `src/storage` | Dexie 持久化 + 启动恢复 |
| `src/ai-client` | AiClient 接缝：脚本兜底 / httpAi / 失败降级 |
| `src/ai-proxy` | 服务端 LLM 代理（持 key，OpenAI 兼容 chat completions） |
| `src/store` | Zustand store + AI 自动轮转 driver + 消息派生 + 中文错误映射 |
| `src/ui` | 聊天室 UI：StatusBar / MessageStream / ActionArea / TextInput / ReviewPanel |

## 如何运行

1. 复制 `.env.example` 为 `.env`，填入 `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL=gpt-5.5` / `AI_WIRE_API=chat`。**`.env` 已在 `.gitignore`，key 绝不入库。**
2. `npm run dev` → 浏览器开局，和 gpt-5.5 的 AI 玩家对局到复盘。
3. 降级验证：把 key 改错 → 游戏仍用脚本兜底跑完，UI 显示中文降级提示。

## 已知限制（MVP 取舍）

- 兜底事件统一标 `generatedBy:"ai"`，引擎无法回流 `fallback`/`analysisSummary` 元数据（动 rules 边界才能改，暂不做）。
- 启动恢复依赖快照 parse + lastEventSeq 对齐（三表原子写保证不分叉），未做完整 `foldEvents` 重放；快照损坏即清档重来。
- 规则引擎错误 message 为英文技术串（作日志），中文展示文案集中在 `src/store/errorMessages.ts`。
