# 前端重设计交接文档 — 借鉴 wolfcha，落地环形牌桌（方案 C）

> **新会话推进前端重设计前先读完本文件。** 视觉方向已与用户拍板定稿（方案 C），
> 预览基准 = `preview/wolfcha-mockup-balanced.html`（静态稿，已批准）。逻辑层（store/rules/shared）
> 一行不动，只改/扩 UI 层。下一步从 **阶段 0** 开始正式落地到 `src/`。

## Context（为什么做）

游戏逻辑完成度 ~95%（全流程可玩、ISO 信息隔离严格、112 用例全绿），但前端美观度/沉浸感偏弱：
纯文本存活列表、首字色块头像、浅绿主题、几乎无动画。用户欣赏 GitHub `oil-oil/wolfcha` 的前端，
要把它的**视觉/交互**提炼过来。

**核心结论**：wolfcha 的后端栈（Next.js/Supabase/Stripe/实时同步/Minimax 语音）是为「多人云端联机」
设计的，对本项目「单人本地 + 严格信息隔离」**不适用**。只借鉴它的前端视觉与交互；本项目的
`store`/`rules`/`shared` 三层与 ISO 红线**原样保留**。

## 已锁定的决策（用户敲定）

| 维度 | 决策 |
|------|------|
| 布局 | **方案 C（发言流主导 + 紧凑牌桌）**，见下「目标形态」 |
| 硬约束 | **不同板子 UI 不能崩**（默认 7 人 `STANDARD_7P_BOARD`，5 人 `mvp_5p_*` 回归；座位数可变、死人减少）。环形座位角度只由 `total` 算 |
| 样式方案 | **纯 CSS 变量（design token）+ Framer Motion**（效果优先；画质天花板与 Tailwind 相同，过场动画用 FM 最顺滑；**不引 Tailwind/组件库**，不重写已有 CSS，只在其上 token 化） |
| 借鉴亮点 | 深色复古主题、DiceBear 真实头像、天黑天亮过场动画、投票可视化 + 复盘时间线 |
| 头像 | DiceBear，风格 `adventurer`，预览用在线 API `https://api.dicebear.com/9.x/adventurer/svg?seed=<playerId>`；落地时**在线 API vs 本地包 `@dicebear/core` 由用户再定**（在线零依赖需联网，本地离线但加依赖） |
| 推进 | 分阶段，每阶段「测试绿 或 浏览器能点」交付；**视觉细节每阶段由用户敲定** |

## 不可触碰的红线

- 只改 **UI 层**：`src/App.tsx`、`src/ui/*`、`src/App.css`（+ 新增样式/组件文件）。
- **禁止**改 `src/store`、`src/rules`、`src/shared`、`visibility.ts`、`review.ts` 的契约与逻辑。
- **ISO-001**：新组件只能读 `visibleInformation` / `messages` / `thinking` / `reviewContext`，
  物理上拿不到 `snapshot`/`events`/AI 身份。
- **ISO-002**：完整真相只在 `phase === "review"` 经 `reviewContext` 出现。

## 目标形态（方案 C）

```
┌────────────────────────────────────────────────┐
│ topbar：阶段·第N天/夜  │  你是：角色  │  旁观      │  ← StatusBar 瘦身成细条
├──────────────────────────────┬─────────────────┤
│  发言流（主内容，唯一长滚动）    │  紧凑环形牌桌      │
│  💬 头像气泡 / 居中通知         │  中央舞台 = 当前   │
│  💬 ...                       │  发言者大头像+这句话│
│                              ├─────────────────┤
│  ── 发言输入区（并入聊天列）──   │  场上速览（名单）   │
│  提示 / textarea / 字数·跳过·发送│  小头像+状态+角标  │
└──────────────────────────────┴─────────────────┘
      左列 = 聊天 + 输入（一体）        右列 = 牌桌 + 名单（贯通全高）
```

要点（已在预览中验证）：
- **发言流是主角**，占左列最大空间；牌桌压缩成右列紧凑块，避免「大空间低信息」。
- **中央舞台不空毡**：显示当前发言者头像 + 名字 + 实时这句话（夜晚切月幕 + 「天黑请闭眼」）。
- **右列下半「场上速览」**：紧凑名单（小头像 + 名字(N号) + 你/狼角标 + 存活/出局），填满竖向空间。
- **发言输入区**：输入框整宽独占一行 + 底部工具条（字数左、跳过/发送靠右），三者高度对齐。
- 列宽：`grid-template-columns: 1fr clamp(400px, 40vw, 560px)`，可按需微调。

## 设计 token（预览里已成型，落地搬进 `src/ui/theme.css`）

深色复古暖褐黑底 + 金色强调；`body.is-day` 切白天（更暖更亮一档）。座位 6 色在深色下提亮。
```
--bg-0..3 #14110c→#2e2820   --line #3a3328
--ink #ece3d0  --ink-dim #b3a78d  --ink-faint #7d745f
--gold #d8b25a  --gold-soft #b8954a  --danger #c0563f  --good #6fae8f
--seat-1..6 #6fae8f #d59a4e #5b91c9 #b07cc4 #d4685a #44b2a6
--radius/-sm  --shadow  --t-fast .18s  --t-mid .35s
serif 标题（衬体字，用于阶段/字幕） + sans 正文
```

## 现有 UI 层盘点（改造起点）

| 文件 | 现状 | 阶段动作 |
|------|------|----------|
| `src/App.tsx` (165) | 三段式 grid 外壳，绑定 store 的 `ready/busy/thinking/phase/participation/vi/messages/reviewContext` | 阶段1 改成方案 C 两列 grid 编排 |
| `src/App.css` (385) | 纯 CSS 全部样式，硬编码色 | 阶段0 token 化；阶段1 改 grid |
| `src/ui/StatusBar.tsx` (84) | 顶部相位/轮次/自身角色 + **文本存活名单** | 阶段1 瘦身成细条；名单移到 SeatRing/速览 |
| `src/ui/MessageStream.tsx` (156) | 气泡流 + `SEAT_COLORS` 首字色块头像 + 思考气泡（夜晚匿名） | 阶段2 换 DiceBear；移入左列面板 |
| `src/ui/ActionArea.tsx` (541) | 按相位渲染合法按钮（女巫三步/投票/夜晚行动） | 逻辑保留，阶段0/6 套新样式；阶段4 投票可视化 |
| `src/ui/TextInput.tsx` (80) | 自由发言/拉票/遗言输入 | 阶段0/6 套方案 C 输入区样式 |
| `src/ui/ReviewPanel.tsx` (217) | 6 个平铺列表 + AI 追问 | 阶段5 重构成时间线 |
| `src/store/messages.ts` | `ChatMessage` 已带 `speakerSeat/speakerLabel/self` | 只读，不改 |

**座位/头像数据来源**：`vi.alivePlayers` + `vi.deadPlayers`（各 `{playerId, seat, name}`）、
`vi.viewerId`、`vi.teammates`（狼队友）、`vi.ownRole`、`thinking.seat`（当前行动者）。
当前发言者高亮：优先 `thinking.seat`（AI 思考中），否则取最近一条 speech 的 `speakerSeat`。

## 分阶段计划

- **阶段 P** ✅ 已完成：静态预览定方案。产物 `preview/wolfcha-mockup-balanced.html`（方案 C，已批准基准）。
  备选 `wolfcha-mockup.html`（A 窄居中）、`wolfcha-mockup-wide.html`（B 宽双栏）已弃，可删。
- **阶段 0** — 设计 token + 深色主题底座：新增 `src/ui/theme.css`，把 `App.css` 与 `MessageStream`
  的硬编码色全部改引用变量并切深色。交付：现有布局换深色不崩，`tsc -b`/`npm test` 绿。
- **阶段 1** — 环形牌桌（核心）：新增 `src/ui/SeatRing.tsx`（入参 `vi`+`thinking`，按 `total` 动态摆位，
  兼容 5/7 人及死亡缩减）+ 中央舞台（当前发言者）+ 右列「场上速览」；`StatusBar` 瘦身；
  `App.tsx`/`App.css` 改方案 C 两列 grid。交付：7 人局可点全流程、5 人板不崩。
- **阶段 2** — DiceBear 头像：新增 `src/ui/Avatar.tsx`（seed=playerId，整局稳定），替换首字色块，
  复用到 SeatRing/气泡/速览/复盘。**在线 vs 本地包**待用户定。
- **阶段 3** — 天黑/天亮过场（装 `framer-motion`）：相位切换触发眨眼遮罩 + 黑底字幕（第 N 夜/天）；
  叠加发言者高亮进出、座位死亡淡出。
- **阶段 4** — 投票可视化：投票/平票相位在 SeatRing 或面板上渲染票数（柱/箭头/环上连线），
  数据取现有 `vote_submitted`/`vote_resolved`（不改规则层）。
- **阶段 5** — 复盘时间线：`ReviewPanel` 从 6 平铺列表重构成按「夜/天 轮次」分组的可点/可拖时间轴，
  复用 `reviewContext`，AI 追问保留。
- **阶段 6** — 打磨 + 回归：toast/loading 反馈、错误更显眼；响应式 + 5/7 人全回归；
  `App.test.tsx`/`MessageStream` 测试随结构修绿；e2e 冒烟 + 降级测试。

## 验证方式（每阶段）

1. `npx tsc -b` + `npm test` 绿（结构变更同步更新 UI 测试）。
2. `npm run dev` 手测：7 人标准局走完夜→投票→放逐→屠边→复盘；切 5 人板确认环形布局不崩。
3. 夜晚信息隔离回归：夜晚只见「天黑请闭眼」，无姓名/身份泄漏（ISO-001 不被新 UI 破坏）。
4. 降级回归：故意填错 `.env` key → 脚本兜底全程跑到复盘不卡死。
5. `npm run build`（tsc + vite）通过。
