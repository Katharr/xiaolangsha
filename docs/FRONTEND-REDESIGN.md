# 前端重设计交接文档 — 借鉴 wolfcha，落地环形牌桌（方案 C → 三列）

> **新会话推进前端重设计前先读完本文件。** 视觉方向已与用户拍板定稿：
> 在方案 C 基础上扩成**三列**（新增左侧「信息列」=私密面板+公开面板）。
> **当前预览基准 = `preview/wolfcha-mockup-3col.html`（静态稿，已批准）**；
> 早期两列稿 `wolfcha-mockup-balanced.html` 仅作历史参考。逻辑层（store/rules/shared）
> 一行不动，只改/扩 UI 层。
>
> **进度**：阶段 0（token+深色）✅、阶段 1（环形牌桌）✅、阶段 1.5（三列骨架）✅、阶段 2（DiceBear 头像）✅、阶段 3（天黑/天亮过场）✅、主页 HomeScreen ✅、选身份页 RoleSelectScreen ✅、阶段 4（圆桌剧场 v3：投票可视化 + 布局重排 + 信息上桌）✅、**阶段 5（复盘时间线）✅** 已全部落地。
> **⚠️ 布局已升级为「圆桌剧场」单行三列**（预览基准改为 `preview/vote-mockup-v3.html`，经 v1→v2a/v2b→v3 三轮用户评审拍板）：
> 左「过程档案」窄列｜中「大牌桌」视觉主体（座位铭牌+桌心铭牌）｜右「发言流+操作」。
> 顶部状态条 StatusBar 与场上速览 Roster 已删除（信息拆迁进牌桌，见下「阶段 4」）。
> **下一步 = 阶段 6：打磨 + 回归**，见下「阶段 6」。

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
| 布局 | **三列**（左 信息列＝私密+公开面板 ｜ 中 发言流+操作 ｜ 右 紧凑牌桌+速览），见下「目标形态」。起因：两列时发言流过宽、左右留白没利用 |
| 填满窗口 | 外壳**铺满整个浏览器窗口**（`width:100%`，不再 `max-width` 居中）。已去掉 1280px 限制与左右 border |
| 名字着色 | **凡显示玩家名字处一律带座位专属色 + 加粗高亮**（「你」=金色 `--gold`，其余按 `(seat-1)%6` 取 `--seat-1..6`；座位号小字 `（N号）` 保持 `--ink-faint`）。落地收成统一 `PlayerName` 组件，全组件复用 |
| 私密面板 | 左列上半，按角色显示**常驻**私有信息（预言家查验史 / 女巫药剂+夜间情报 / 守卫守护史 / 狼队+击杀史 / 村民提示）。仅读 `vi.privateEvents`＋`vi.teammates`，ISO 安全 |
| 公开面板 | 左列下半，人人相同：**死亡公告**（死因+轮次）＋**投票记录**（按「天」折叠卡片、每票一行、默认展开最近一天）。仅读 `vi.deadPlayers`／`vi.votes`＋`vote_resolved` |
| 硬约束 | **不同板子 UI 不能崩**（默认 7 人 `STANDARD_7P_BOARD`，5 人 `mvp_5p_*` 回归；座位数可变、死人减少）。环形座位角度只由 `total` 算。牌桌用正方形 `aspect-ratio:1` 保证任意列宽都是正圆 |
| 样式方案 | **纯 CSS 变量（design token）+ Framer Motion**（效果优先；画质天花板与 Tailwind 相同，过场动画用 FM 最顺滑；**不引 Tailwind/组件库**，不重写已有 CSS，只在其上 token 化） |
| 借鉴亮点 | 深色复古主题、DiceBear 真实头像、天黑天亮过场动画、投票可视化 + 复盘时间线 |
| 头像 | DiceBear，风格 `adventurer`。**已定（用户拍板）= 本地包**：`@dicebear/core` + `@dicebear/adventurer`（直接导入 adventurer，不引整包 collection），浏览器本地生成 SVG data URI，离线可用。**seed 用座位号**（思考态无 playerId，座位号各处都拿得到 → 同一玩家全界面同一张脸）。背景透明、座位色透出作底。落地见 `src/ui/Avatar.tsx` |
| 推进 | 分阶段，每阶段「测试绿 或 浏览器能点」交付；**视觉细节每阶段由用户敲定** |

## 不可触碰的红线

- 只改 **UI 层**：`src/App.tsx`、`src/ui/*`、`src/App.css`（+ 新增样式/组件文件）。
- **禁止**改 `src/store`、`src/rules`、`src/shared`、`visibility.ts`、`review.ts` 的契约与逻辑。
- **ISO-001**：新组件只能读 `visibleInformation` / `messages` / `thinking` / `reviewContext`，
  物理上拿不到 `snapshot`/`events`/AI 身份。
- **ISO-002**：完整真相只在 `phase === "review"` 经 `reviewContext` 出现。

## 目标形态（方案 C → 三列）

```
┌──────────────────────────────────────────────────────────────┐
│ topbar：阶段·第N天/夜 │ 第N天 │           你是：角色  │ 旁观     │  ← StatusBar 细条，跨三列
├───────────────────┬──────────────────────────┬───────────────┤
│ 🔒 私密信息（上）   │  发言流（主内容，唯一长滚动）  │ 紧凑环形牌桌    │
│  身份卡            │  💬 头像气泡 / 居中通知       │ 中央舞台=当前  │
│  角色专属私有信息    │  💬 ...                     │ 发言者+这句话  │
│ ┄┄ 公开信息（下）┄┄ ├──────────────────────────┤───────────────┤
│  💀 死亡公告        │  ── 发言输入区（并入中列）──   │ 场上速览（名单）│
│  🗳️ 投票记录(折叠)  │  提示 / textarea / 跳过·发送 │ 小头像+状态+角标│
└───────────────────┴──────────────────────────┴───────────────┘
   左 = 信息列(贯通全高)    中 = 聊天+输入(一体)        右 = 牌桌+名单(贯通全高)
```

列宽：`grid-template-columns: clamp(260px,21vw,330px) 1fr clamp(360px,30vw,500px)`，可微调。
区域：`"top top top" / "info chat side" / "info ctrl side"`。

要点（已在 `wolfcha-mockup-3col.html` 验证）：
- **发言流仍是主角**居中列；左加信息列、右压牌桌，三列把窗口填满、信息密度均衡。
- **左信息列**上下两块、整列可滚动：
  - 🔒 **私密面板**（按角色变）：见下「信息面板规范」。
  - 📢 **公开面板**（人人同）：死亡公告 + 折叠投票记录。
- **中央舞台不空毡**：当前发言者头像 + 名字 + 实时这句话（夜晚切月幕 + 「天黑请闭眼」）。
- **右列下半「场上速览」**：紧凑名单（小头像 + 名字(N号) + 你/狼角标 + 存活/出局）。
- **发言输入区**：输入框整宽 + 底部工具条（字数左、跳过/发送靠右）。
- 窄屏塌叠：`≤820px` 折成单列（顶条→牌桌→发言流→操作），信息列处理待阶段 6 细化。

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

## 文案排版原则：杜绝「孤字 / 寡行」（全局适用）

换行有**两类**都要杜绝，根因不同，别只防一种：

1. **孤字 / 寡行**（orphan / widow）：一两个字单独掉到下一行（如 tagline 尾巴几个字落到第二行）。
2. **词组被逐字拆断**：中文**没有词边界、默认逐字断行**，所以一个有含义的词组会被从中间拆开（如「反复打磨」断成「反复 / 打磨」、「预言家」断成 2+1）。`text-wrap:balance` **只均衡行长、不防这种拆词**，必须另行处理。

规则：

- **按意群断句，断点只落在语义停顿**：换行只允许出现在**真正的句意停顿**（句末「。」、破折号「——」、分句之间）。一个**意群**（表达一件事的一句话，如「挑一个想练的身份反复打磨」）必须整体在一行、不准从中间换行——把它包成一个 `<span class="nb">`（`white-space:nowrap`）。**严禁为了制造换行点而硬塞逗号/拆句**：那等于把一句话切碎、改变了语义节奏（反例：写成「挑一个想练的身份，反复打磨」是错的，这本就是一句话）。tagline 这类短句应按**意群**切成几个 `nb` 块拼接，而不是按字数或随便找个位置切。
- **专有短词同理整体不拆**：角色名、玩家名、阵营/状态徽标等也用 `nb` 包住（这是意群的最小情形）。整块 CJK 文案也可用 `word-break:keep-all`（只在标点/空格断），但 `nb` 包裹最可控、最保险。
- **相邻次要元素整块让行**：词组放不下时，让相邻的徽标/次要元素整块换到下一行（容器 `flex-wrap:wrap`），绝不从词中间断开。
- **多行短句加 `text-wrap:balance`**：标题、tagline、卡片描述等 1–3 行短文本，均衡各行长度、消除末行孤字（正文长段落可用 `text-wrap:pretty`）。注意它**不能**替代上一条的拆词防护，两者叠加用。
- **必要时手动控断点**：用 `&nbsp;` 连住不该拆的字，或在语义停顿处用 `<br>` 主动断行。
- **窄断点必查**：响应式每个断点都要扫一眼有没有新冒出来的孤字或拆词（容器越窄越容易触发）。

## 名字着色统一规则（PlayerName 组件）

凡渲染玩家名字的地方**一律一致**，落地为一个共用组件 `src/ui/PlayerName.tsx`：

- 入参 `{ name, seat, isSelf }`；输出 `名字`（加粗 `font-weight:600` + 着色）`（N号）`（`--ink-faint`、不加粗）。
- 颜色：`isSelf ? var(--gold) : var(--seat-${(seat-1)%6 + 1})`。座位 6 色循环，7 号与 1 号同色（沿用既有 `SEAT_COLORS`）。
- 复用点（全部改用它，不再各写各的）：SeatRing 座位名、Roster 名单、MessageStream 气泡名、私密/公开面板内每一处名字（查验/救毒/夜间情报/狼队/击杀/死亡公告/**投票记录每个 who→whom**）、主持人/投票通知里的名字。
- `isSelf` 判定：`playerId === vi.viewerId`。

## 信息面板规范（左信息列，ISO-001 安全）

数据**只来自** `vi`，组件物理上拿不到 `snapshot`/`events`/AI 身份。

### 🔒 私密面板（按 `vi.ownRole` 切换内容）

顶部恒显**身份卡**（头像 + `PlayerName(自己)` + 角色 · 阵营）。下方按角色：

| 角色 | 内容 | 数据来源（`vi.privateEvents` 的事件） |
|------|------|----------------------------------------|
| 预言家 | 逐夜查验记录表：第N夜→`PlayerName`→🟩好人/🟥狼人 | `night_action_resolved`，`payload.result.kind==="seer_check_result"`，取 `result.targetId`/`result.factionResult`（`werewolf_team`=狼）、`round.night` |
| 女巫 | 药剂状态卡（解药/毒药：可用 or「第N夜 用在谁」）＋ 夜间情报「每夜倒牌的是谁」 | 状态卡：`night_action_submitted` actionType `witch_save`/`witch_poison`（含 `targetId`）；当前可用性看最新 `witch_wake` 的 `saveAvailable`/`poisonAvailable`。夜间情报：`witch_wake` 的 `result.killedTargetId`（`night_action_resolved`，`result.kind==="witch_wake"`） |
| 守卫 | 逐夜守护记录：第N夜→`PlayerName` | `night_action_submitted` actionType `guard_protect`（含 `targetId`） |
| 狼人 | 狼队名单（`PlayerName`+存活/出局）＋ 逐夜击杀记录（目标+得手/被救/被守） | 队友：`vi.teammates`；击杀：`night_action_resolved` `result.kind==="kill_result"`（`targetId`/`killed`/`wolfVotes`） |
| 村民 | 身份卡 + 「无夜间能力」提示（面板较稀疏，接受现状） | — |

### 📢 公开面板（人人相同）

- **💀 死亡公告**：每行 头像（灰显）+ `PlayerName` + 死因徽章 + 轮次。
  - 来源：`vi.deadPlayers`（`PublicDeathRef`）。死因 `deathCause`→文案：`night_kill`=夜里出局、`exile`=被放逐、`poison`=被毒杀、`hunter_shot`=被猎人带走；轮次取 `round`。
- **🗳️ 投票记录**：**按「天」折叠的卡片**。
  - 分组：`vi.votes`（`VisibleVote`，结算前只见自己的票，结算后全显——沿用既有逻辑）按 `day` 分卡，卡内再按 `voteRound`（首轮/加赛）分段。
  - 每票**一行**：`PlayerName(投票者)` → `PlayerName(被投)`，弃票显示「弃票」（灰）。
  - 每段尾部结算结果（平票进加赛 / 谁被放逐几票）：取 `vote_resolved` 公共事件的 `tally`/`exiledPlayerId`。
  - **折叠交互**：点卡片顶部标题栏展开/收起（箭头旋转）；标题右侧带该天结果摘要；**默认只展开 `max(day)`（最近一天）**，历史天收起。

## 现有 UI 层盘点（改造起点）

| 文件 | 现状 | 阶段动作 |
|------|------|----------|
| `src/App.tsx` | ✅ 两列 grid 外壳（showBoard 切单/双列），绑定 store 的 `ready/busy/thinking/phase/participation/vi/messages/reviewContext` | 阶段1.5 升级三列（info/chat/side） |
| `src/App.css` | ✅ 已 token 化+两列 grid+响应式安全网 | 阶段1.5 改三列 + 信息列样式 |
| `src/ui/StatusBar.tsx` | ✅ 已瘦身成细条（名单移到 Roster） | 基本完成 |
| `src/ui/SeatRing.tsx` | ✅ 新增：`SeatRing` 牌桌+舞台 / `Roster` 速览 | 阶段1.5 名字改用 `PlayerName`；阶段2 头像换 DiceBear |
| `src/ui/MessageStream.tsx` (156) | 气泡流 + `SEAT_COLORS` 首字色块头像 + 思考气泡（夜晚匿名），**留在中列** | 阶段1.5 名字改用 `PlayerName`；阶段2 换 DiceBear |
| `src/ui/ActionArea.tsx` (541) | 按相位渲染合法按钮（女巫三步/投票/夜晚行动） | 逻辑保留，阶段0/6 套新样式；阶段4 投票可视化 |
| `src/ui/TextInput.tsx` (80) | 自由发言/拉票/遗言输入 | 阶段0/6 套方案 C 输入区样式 |
| `src/ui/ReviewPanel.tsx` (217) | 6 个平铺列表 + AI 追问 | ✅ 阶段5 已重构成时间线（见下「阶段 5」） |
| `src/store/messages.ts` | `ChatMessage` 已带 `speakerSeat/speakerLabel/self` | 只读，不改 |

**座位/头像数据来源**：`vi.alivePlayers` + `vi.deadPlayers`（各 `{playerId, seat, name}`）、
`vi.viewerId`、`vi.teammates`（狼队友）、`vi.ownRole`、`thinking.seat`（当前行动者）。
当前发言者高亮：优先 `thinking.seat`（AI 思考中），否则取最近一条 speech 的 `speakerSeat`。

## 分阶段计划

- **阶段 P** ✅ 已完成：静态预览定方案。**当前基准 `preview/wolfcha-mockup-3col.html`（三列，已批准）**；
  两列稿 `wolfcha-mockup-balanced.html` 仅历史参考，A/B 稿（`wolfcha-mockup.html`/`-wide.html`）已弃可删。
- **阶段 0** ✅ 已落地：设计 token + 深色底座（`src/ui/theme.css`，`App.css`/`MessageStream` 硬编码色全改引用变量并切深色）。`tsc -b`/`npm test`/`build` 绿。
- **阶段 1** ✅ 已落地（**两列版，待升级三列**）：`src/ui/SeatRing.tsx`（`SeatRing` 环形牌桌+中央舞台 / `Roster` 速览，按 `total` 动态摆位、兼容 5/7 人与死亡缩减、牌桌正方形保正圆）+ `StatusBar` 瘦身成细条 + `App.tsx`/`App.css` 两列 grid + 响应式安全网（1100/820/480 三档）+ 外壳铺满窗口（去 max-width）。
- **阶段 1.5** ✅ 已落地（三列骨架 + 信息面板 + 名字着色）：
  1. `src/ui/PlayerName.tsx`：统一名字着色组件（`seatColorVar`/`firstChar`/`bareName` 辅助导出）；SeatRing/Roster/MessageStream/InfoPanel 全改用它。
  2. `src/ui/InfoPanel.tsx`（合并版）：上半私密面板（预言家查验史 / 女巫药剂+夜间情报 / 守卫守护史 / 狼队+击杀史 / 猎人·村民提示，按 `vi.ownRole` 切换）+ 下半公开面板（死亡公告 + 按「天」折叠投票卡，默认展开 `max(day)`）。结算结果从 `vi.publicEvents` 的 `vote_resolved`（含 `outcome`/`tally`/`exiledPlayerId`）取，票型从 `vi.votes` 取。只读 `vi`，ISO 安全。
  3. `App.tsx`/`App.css` 两列 → 三列（`grid-template-areas: "top top top"/"info chat side"/"info ctrl side"`，列宽 `clamp(260px,21vw,330px) 1fr clamp(360px,30vw,500px)`），响应式 1180/920 两档塌叠（含 info 列）。
  - 基线：`tsc -b` ✅ / `npm test` 132 绿 ✅ / `npm run build` ✅。ISO 文案踩坑：村民/猎人提示原含「狼人」二字触发 App.test 的身份泄露正则，已改为「隐藏的狼」。
  - **下一步 = 阶段 2（DiceBear 头像）**，见下。
- **阶段 2** ✅ 已落地 — DiceBear 头像：新增 `src/ui/Avatar.tsx`（**本地包** `@dicebear/core`+`@dicebear/adventurer`，
  `createAvatar(adventurer,{seed:'seat-N',backgroundColor:[]}).toDataUri()`，按座位号缓存）。
  五处首字色块（SeatRing 座位 / 中央舞台 / Roster 速览 / MessageStream 气泡+思考 / InfoPanel 身份卡·查验·狼队·死亡公告）全改用它。
  CSS 加 `.av-img`（填满圆形容器、座位色透出作底）。`tsc -b`/132 用例/`build` 全绿。
  踩坑：装包后 `tsc -b` 报 TS5083 找不到 `@dicebear/core/lib/tsconfig.json`，实为 **stale tsbuildinfo**——
  删 `node_modules/.tmp/*.tsbuildinfo` 后 `tsc -b --force` 即过（`tsc -p tsconfig.app.json` 一直是绿的）。
  bundle 涨到 761KB（gzip 255KB，adventurer SVG 精灵数据所致，单机可接受）；vite 已把 collection 树摇到只剩 adventurer。
- **主页 / 开场屏**（阶段 3 后追加，用户要求重设计入口）✅ 已落地：
  - 新增 `src/ui/HomeScreen.tsx` + `src/ui/home.css`（作用域全部以 `.home-screen` 前缀隔离，复用 theme token，仅本屏加 `--silver`）。
  - 视觉：深色夜晚氛围——漂移极光光晕（3 团，Stripe/Linear 式活渐变）+ 64 颗闪烁星空 + 16 点上浮余烬/萤火 + 120s 自转的环形牌桌剪影（7 座位光点）+ 呼吸月亮 + 金色流光标题；两张模式卡片（标准局/自由局）带渐变描边、hover 掠光、圆形徽章图标、推荐缎带、等高 + CTA 钉底对齐。背景装饰用 `useMemo` 一次性生成（Math.random），CSS 变量经 `as CSSProperties` 注入；带 `prefers-reduced-motion` 与 ≤600px 降级。
  - **接线**：`App.tsx` 在 `ready` 后、`phase === null || "mode_select"`（入口态，vi 为空）时整屏返回 `<HomeScreen>`（不渲染状态栏/牌桌/输入区）；`!ready` 时返回 `.app-boot` 加载屏（去掉了旧的 `.app-loading` 叠层）。**注意：初次启动入口相位是 `null` 不是 `mode_select`**（bootstrap 无存档不设相位；`mode_select` 仅在 `confirm_new_game` 后出现）。
  - 派发与旧入口一致：`create_game` mode `standard`/`free`。旧 `ActionArea` 的 `case null/mode_select` 入口按钮已不可达（保留无害）。
  - 文案：自由局 CTA 改「进入自由局」（避免与卡片标题「练习 / 自由局」文本重复触发 `getByText` 多匹配）；模型措辞去掉写死的 gpt-5.5，改「大语言模型驱动」。`App.test.tsx` 中点击目标随之改为 `/进入自由局/`。
  - 预览基准：`preview/home-mockup-v2.html`（已批准；`home-mockup.html` 为 v1 历史稿）。基线：`tsc -b` ✅ / `npm test` 132 绿 ✅ / `build` ✅。
- **选身份页 / RoleSelectScreen**（主页后追加，用户指出旧选身份页破相）✅ 已落地：
  - **根因**：`role_setup`（仅自由局）的 `vi` 是 `buildEmptySetupVisibleInformation` 返回的**空壳**（无 players、`ownRole` 默认 villager），导致 `App.tsx` 的 `showBoard` 判真、渲染出「空牌桌 / 存活 0 / 你是村民占位 / 空面板」的破相三列界面。
  - 新增 `src/ui/RoleSelectScreen.tsx`：整屏接管，复用 `home.css` 的 `.home-screen` 背景层与 `.hs-*` 视觉语言（极光/星空/余烬/自转牌桌剪影），新增 `.rs-*` 角色卡片/确认条样式（追加在 `home.css`，`hs-cta` 金色 CTA 直接复用）。角色卡用 `<button>`（角色名内层 `span.rname`，点击冒泡到卡片→不破坏 `App.test` 的 `getByText("村民")`）。
  - 可选身份来自 `getBoardConfig(boardId)` 去重角色（与旧 `ActionArea` 一致），AI 人数 = `playerCount-1`。派发原有 `confirm_role_setup`。**逻辑层零改动。**
  - **接线**：`App.tsx` 在 `phase === "role_setup"` 时整屏返回 `<RoleSelectScreen>`（在三列外壳之前拦截，紧跟 HomeScreen 那段）。旧 `ActionArea` 的 `case "role_setup"` 已不可达（保留无害）。
  - **排版红线落地**：tagline 按意群切 `.nb`（`white-space:nowrap`，新加到 `theme.css` 作全局工具类）块——「挑一个想练的身份反复打磨」整句不拆、不硬塞逗号；角色名 `.rname` nowrap，徽标放不下整块换行；标题/lede 加 `text-wrap:balance`，卡片描述 `text-wrap:pretty`。详见上「文案排版原则」。
  - 卡片 flex 居中换行（宽屏一排匀分、折行变 3+2 居中而非 4+1 拖尾）。预览基准：`preview/role-select-mockup.html`（已批准）。基线：`tsc -b` ✅ / `npm test` 132 绿 ✅ / `build` ✅。
- **阶段 3** ✅ 已落地 — 天黑/天亮过场（`framer-motion@12`）：
  - 新增 `src/ui/PhaseTransition.tsx`（固定全窗口、`pointer-events:none`）：监听 `phase`+`vi.round`，
    把相位归约成昼/夜段（`segmentOf`），段切换时播「上下眼睑黑幕闭合 + 衬体字幕（第 N 夜/天）」，
    并在遮罩闭合到底（~560ms）的瞬间 `document.body.classList.toggle("is-day")` 切昼夜主题。
    首次观测（含刷新落在局中）与开局前「准备段」只切主题不播过场，避免突兀闪屏。挂在 `App.tsx` 的 `app-root` 顶部。
  - **是 body.is-day 的唯一驱动**：之前 `theme.css` 定义了 `body.is-day` 但无人 toggle（界面恒为夜色），现由本组件按相位切换。
  - `SeatRing` 中央舞台改用 `AnimatePresence mode="wait"`：夜↔昼/换发言者时淡入淡出「高亮进出」
    （只动 opacity 不动 transform，保住 `.stage` 的居中 translate；key 用 `night`/`think-座位`/`speech-消息id`/`idle`）。
  - 座位死亡淡出沿用既有 CSS 过渡（`.seat.dead .avatar` 的 grayscale），未额外引 FM。
  - CSS 加在 `App.css` 末尾（`.phase-transition`/`.lid`/`.phase-caption` + `prefers-reduced-motion` 降级）。
  - 基线：`tsc -b` ✅ / `npm test` 132 绿 ✅ / `npm run build` ✅（bundle 761KB→890KB，gzip 297KB，单机可接受）。
  - **下一步 = 阶段 4（投票可视化）**，见下。
- **阶段 4** ✅ 已落地 — **圆桌剧场 v3：投票可视化 + 大牌桌布局重排 + 信息上桌**（分 4 个提交，
  预览基准 `preview/vote-mockup-v3.html`，其内注释是全部落地纪律的权威来源；v1/v2a/v2b 稿留档）：
  1. **外壳换骨**：grid 改单行三列 `clamp(228px,16vw,264px) minmax(520px,1fr) clamp(400px,30vw,520px)`、
     areas `"info table chat"`；牌桌居中 `width:min(100%, calc(100dvh - var(--chrome-h)), 880px)`
     + `aspect-ratio:1` + container query 分档（≤560px 小档铭牌，920px @media 双保险）。
     操作/输入区折进右列 `.chat` 底部。**StatusBar/Roster/chat-head 删除**，信息拆迁：
     相位/轮次/存活→桌心铭牌 `TablePlaque`（夜晚吃 nightStatus 播报、投票转蓝灰、旁观缀灰 tag）；
     你是:角色→own 座位角色胶囊 `.tk-role`（aria-label 供测试断言）；重开/导出→牌桌左下
     `TableTools` 幽灵钮（复盘态 ReviewPanel 自带新局、halt-banner 内嵌导出兜底）。
  2. **信息上桌**（`src/ui/seatTokens.ts` = viewer 作用域纯 selector，ISO-001 核心）：
     座位铭牌徽标行 = 私密圆 token（查验狼/好、狼队、未得手刀、救/毒、守）+ own 胶囊
     （女巫附药剂 pip）+ 公开死因胶囊（`逐·天N ×票数`）。纪律：**得手的刀不挂**（死因牌已表达）、
     **毒 token 与死因牌同帧**（目标死于 poison 才挂）、私密 tooltip 一律缀「仅你可见」、
     四角制度（右上=你/平、左上=票数、右下永久留空）、max3+N 溢出兜底。
     InfoPanel 收缩为「过程档案」两节：🌙夜报（只收无座位锚点/有私密增量的流水）+ 🗳️投票记录
     （`VoteFlow` 票流图：voter 叠瓦 chips→目标+计数条，三态横幅）。**信息不重复：上桌即从面板删**。
     ❔图例 `TableLegend` 按 viewer 过滤 + 首枚 token 单次呼吸提醒。
  3. **投票揭示状态机**（保密红线 = 投票中零计票结构，见记忆 vote-secrecy-rule）：
     舞台优先级 **veil(vote/tie_vote) → reveal → night → thinking → speech → idle**——投票态必须
     排在 isNight 之前（修「AI 并发暗投匿名思考把白天顶成月幕」的 bug，`thinking.anonymous &&
     taskType!=="vote"` 才算夜）。`useVoteReveal`：已见 eventId 集合放 ref、**首帧全部记已见不播动画**
     （Dexie 刷新恢复直出终态）、连发只播 seq 最大一条、calming 2.6s 退让（既有 token 降透明 +
     felt 金脉冲）。票数/票向唯一公开点 = `vote_resolved` payload（`VisibleVote.tally` 恒 undefined、
     弃票数 payload.votes 的 abstain）。票数角标入夜自动清、加赛自动清首轮；平票候选双环+「平」角标。
     ActionArea 已投确认条从 `vi.votes` 找自己那票（结算前本就只见自己的票，刷新可恢复零本地 state）。
  4. **hover 联动 + 回归**：document 级事件委托（`data-seat-link`→`.seat.hl` 外晕、
     `data-aim`→`.aim` 瞄准环、`.tt` tap 切换 tooltip），不提升 state。
  - 新文件：`table.css`（牌桌全部样式）/ `TablePlaque` / `TableTools` / `TableLegend` /
    `seatTokens(.test)` / `VoteFlow` / `VoteStage` / `useVoteReveal`；删除 `StatusBar.tsx`、Roster 导出。
  - 测试：App.test 断言迁移（`getByLabelText("你的身份：村民")` + 铭牌存活计数）；
    `seatTokens.test.ts` 四视角 token 互斥 + tooltip 纪律 + ×N 口径。反泄露正则 `/狼人|预言家/` 保留有效。
  - **死因口径（用户拍板的规则铁律）：夜死不公布死法**——visibility 层统一掩蔽
    （`maskNightDeathCause`：poison 对外归并 night_kill，`vi.deadPlayers` 与公共
    `player_died` payload 双口子都蔽），死因牌用通用「倒·夜N」文案；女巫私密用毒记录
    与狼的击杀记录不受影响；复盘 reviewContext / debug 导出读 TruthEvent 真相（ISO-002）。
    白天死法（放逐/猎人枪）仍公开。顺手修复 `PublicDeathRef.round` 恒为 0 的占位 bug
    （现从死亡事件回填，死因牌轮次因此才正确）。
- **阶段 5** ✅ 已落地 — 复盘时间线（预览基准 `preview/review-timeline-mockup.html`，已批准）：
  - **数据层**：新增 `src/shared/reviewRounds.ts` 的 `deriveRoundArchives` 纯函数（reviewContext → 序章/逐轮夜卡·天卡/终局归档，只依赖 shared 内部）；死因真相 label 归位 `labels.ts`。`src/rules/reviewRounds.test.ts` 复用真引擎跑全局，覆盖四陷阱（毒杀揭示 / 平票加赛 / 放逐终局拂晓枪 / 铁律③跳遗言）+ 枪杀终局回归（endNote 按实际终局路径分文案）。
  - **UI 层**：`ReviewPanel.tsx` 容器重写（props 签名不变，App.tsx 零改动）+ 新增 `src/ui/review/` 子目录（ReviewNav 进度轨 / ReviewHero 终局横幅+身份墙+死亡带 / NightCard / DayCard / FinaleCard / ReviewQa 幕后问答 / useScrollSpy / usePulseJump）；`review.css` 全选择器加 `.rv` 作用域、直接引用 theme token。
  - **导航**：宽屏固定竖轨、≤1280px 退化为吸顶横条药丸（`--nav-h` 分档）；40% 线 scroll-spy + 键盘 ←/→/Home/End + 死亡带点跳金脉冲，AI 追问保留（ReviewQa）。
  - 基线：`tsc -b` ✅ / `npm test` 188 绿（27 文件）✅ / `npm run build` ✅。
- **阶段 6** — 打磨 + 回归：toast/loading 反馈、错误更显眼；响应式 + 5/7 人全回归；
  `App.test.tsx`/`MessageStream` 测试随结构修绿；e2e 冒烟 + 降级测试。

## 验证方式（每阶段）

1. `npx tsc -b` + `npm test` 绿（结构变更同步更新 UI 测试）。
2. `npm run dev` 手测：7 人标准局走完夜→投票→放逐→屠边→复盘；切 5 人板确认环形布局不崩。
3. 夜晚信息隔离回归：夜晚只见「天黑请闭眼」，无姓名/身份泄漏（ISO-001 不被新 UI 破坏）。
4. 降级回归：故意填错 `.env` key → 脚本兜底全程跑到复盘不卡死。
5. `npm run build`（tsc + vite）通过。
