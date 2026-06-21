# AI 玩家提示词体系顶层重构 —— 交接计划

> 本文是**会话交接文档**,可独立执行,无需上一轮对话上下文。配套调研沉淀见 `docs/AI-PROMPT-RESEARCH.md`。
> 目标:把局内 AI 玩家的 LLM 提示词从「逐次累积的补丁拼接」重做成「**人物卡优先(先做人再玩游戏)+ 模块化分层**」的体系,并修复「好人 AI 集体冤杀跳身份预言家」的系统性 bug。
> **状态:✅ 已实施(2026-06-21)。** 代码层全部落地:`shared/personas.ts` 加 `NAME_CHARACTERS`+`characterForName`;`ai-proxy/prompt/*` 分层(character/table/worldModel/playbook/reasoning/task/output/index);传输拆 `llm.ts`、错误拆 `errors.ts`、温度/模型路由进 `config.ts`;`handler.ts` 瘦身。基线 `tsc -b`/`npm test`(160 绿)/`npm run build` 均绿。剩余=手测验证(见 §5)。下文保留作设计依据。

---

## 1. Context（为什么做)

真人玩预言家,首夜查杀 1 号狼,白天硬跳「我是预言家,查验1号狼人,今晚全票打飞他」,结果三个村民 AI 把「自信硬跳」当成「狼人骗票」破绽、全票放逐预言家(女巫 AI 反而信了、票了狼)。

**根因**:AI 没有完整自洽的游戏心智模型。现状 `src/ai-proxy/handler.ts` 的 `buildPrompt()` 由约 9 个文本块线性拼接、逐次累积;关于「怎么读跳身份/查杀」只零散写在 `vote` 任务指令里,且只覆盖「对跳」场景,对「单预言家硬跳查杀、无对跳」这个最常见场景零指导。靠往任务层续段落补场景,永远补不完。

**用户要求**(两条硬方向):
1. **从顶层重设计,不要再打补丁**——「游戏脚本可以打补丁,而 llm 打补丁是永远打不完的」。
2. **AI 玩家先要有「人味」**——自己的性格、喜好、甚至职业/背景,然后才是坐上牌桌玩这一局(灵感来自 `oil-oil/wolfcha`)。
3. **代码要模块化**——别把内容都堆回一个文件,保证可读性/可维护性。

### 已确认决策
- **人设架构 = 固定老朋友·静态丰富**:保留现有固定名字(囡囡/老张/胖虎…)与存档复现,把每个名字从「一句性格+一句倾向」升级成**完整人物卡**(职业/背景/说话习惯/打法心智/缺点),**手写、静态**。不采用 wolfcha 式「每局 LLM 现生成」(破坏确定性、加成本、偏离固定老朋友设计)——该路线记入 `AI-PROMPT-RESEARCH.md`,留作未来扩展。
- 局内模型**不升级**(仍 `gpt-5.4-mini`);靠结构化、原则化、私有推理帮弱模型把推理做对。
- 调研结论印证 persona-first 改善推理,但动作执行仍要 task-first 硬约束(详见 `AI-PROMPT-RESEARCH.md`)。

---

## 2. 设计:人物卡优先的分层架构

system prompt 按以下顺序装配(**先人 → 再入桌 → 再玩 → 严格输出**):

| 层 | 名称 | 职责 | 装配条件 |
|---|---|---|---|
| **L0** | **人物卡 CHARACTER** | **先立人**:你叫什么、做什么的(职业/背景)、什么性格、说话习惯、打狼人杀的习性(胆量/怀疑阈值/逻辑深度/自保方式/惯犯错误/狼时悍跳风格) | 始终(按名字) |
| L1 | 入桌框架 TABLE | 你和一桌人(含 1 真人,余皆 AI,不可辨别、一视同仁)坐下玩这局;你坐几号、这局身份、阵营 | 始终(身份按 vi 注入) |
| L2 | 世界模型 WORLD_MODEL | 板子+胜负+角色职责+**信息流+跳身份/查杀/对跳判读机制**(通用知识,全员同一份) | 始终 |
| L3 | 阵营打法 PLAYBOOK | 好人 / 狼人打法原则(狼人叠加队友段) | 按 `vi.ownFaction` |
| L4 | 推理与表达 REASONING | 私有/公开分离:先在 `analysisSummary` 以「你这个人」视角真实想清楚(狼可含真实意图),`text` 说出来的话合性格、像真人;别只因票数跟票;与历史一致 | 始终 |
| L5 | 任务 TASK | 当前 taskType 的动作纪律 + 合法目标(洗牌)——**严格硬约束** | 按 taskType |
| L6 | 输出契约 OUTPUT | JSON 字段约定——**严格** | 始终 |

**核心原则**:L0 人物卡领头(persona-first 改推理质量),游戏框架 L1–L3 跟随(把狼人杀框成「这个人坐下来做的事」),L5/L6 保持 task-first 严格(动作/JSON 正确性不靠人设松绑)。「判读知识」(L2/L3)与「现在做什么」(L5)彻底分开;今后加规则/调打法 = 改 L2/L3 原则数据,任务层自动继承,而非再拼补丁。

### L2 世界模型核心认知(讲原则,非场景清单)
- **板子+胜负**:7 人局(2狼+2民+预言家+女巫+猎人);**无警长/警徽**(保留现有禁令原文)。屠边 → 推论:好人神职是稀缺战略资源,死一个就逼近败局(让「保护神职」可推导)。
- **信息结构(治本关键)**:神职(尤预言家)是好人唯一能产「验人真伪信息」的来源,村民只有逻辑。好人赢取决于找到并相信真预言家;狼要赢就污染/顶替信息源。推论:预言家给的查杀默认是「强信息」,除非有人对跳挑战其真伪,否则没理由当假。
- **跳身份机制(对跳 vs 单跳的连续判读)**:跳身份 = 把私有信息转公共信息的正常必要行为,本身不是破绽;自信、要求全票打人是真预言家应有姿态,**不能仅凭「说得满/态度强硬」反推他是狼**(直接否定这个民间误判,这是首夜冤神的直接根因)。判真伪的唯一触发条件是「对跳」(两人争同一神职、互指对方假),此时才比对验人逻辑/归票/票型/破绽。无对跳时,孤身跳出的神职信息默认采信并据此行动。
- **公共行为证据权重**:票数本身不是证据;沉默/平安夜没话说/话少不等于可疑;发言顺序、座位不构成嫌疑。

### L3 好人/狼人打法
- **好人(`good_team`)**:首要 = 找出并保护真预言家、用验人信息推狼;无对跳的单跳查杀是当前最强信息,应采信并跟随归票,而非因「跳得急/太自信」推他(把神当狼推 = 替狼杀神);出现对跳才进辨真假模式;神职兼顾自保与产信息;即使 disposition 多疑,也服从 L2 底线——多疑用在普通玩家身上,别把无对跳单跳查杀当破绽。
- **狼人(`werewolf_team`,叠加队友段)**:目标屠边、优先消耗神职;会悍跳(冒充预言家报假查杀顶替真信息源);会扛推/对跳转移火力;**护队友**(绝不查杀/归票/投队友,白天不动声色帮队友洗清、把火引向好人尤其神职,狼刀集中);伪装得像真好人,别因知道真相而「过度准确」露马脚。

---

## 3. 代码改动落点(模块化:一层一文件,薄编排)

**核心原则:不把内容堆回 `handler.ts`。** 每个提示词层独立成小模块(纯函数、各自可单测),由薄装配器组合;handler 只做请求校验→装配→调用;LLM 传输单独拆出。目标目录结构:

```
src/ai-proxy/
  handler.ts          # 瘦身:校验请求 → buildPrompt() → sendToLLM();不再内联任何提示词文本
  prompt/
    index.ts          # 薄装配器 buildPrompt():按 L0–L6 顺序组合各层;review 分支也在此
    character.ts      # L0 人物卡渲染(读 shared/personas 的卡数据,负责"怎么写进提示词")
    table.ts          # L1 入桌框架 + 身份(座位/role/faction/真人AI不可辨);describeRole/describeFaction 可就近放这
    worldModel.ts     # L2 WORLD_MODEL(全员同一份,中立无真相)
    playbook.ts       # L3 goodPlaybook()/werewolfPlaybook(teammates)/factionPlaybook(vi)
    reasoning.ts      # L4 私有/公开分离 + 与历史一致(精简自旧 reasoningInstruction + STYLE_GUIDE)
    task.ts           # L5 各 taskType 动作纪律 + shuffledTargets 去偏见
    output.ts         # L6 OUTPUT_CONTRACT
  llm.ts              # 传输层:sendToLLM + buildChat/ResponsesRequest + extract/parse;持 key、调 fetch
  ai-config.ts        # 已存在:在此加"温度按 taskType 查表";模型路由(mini vs review)也归这
```

### 3.1 `src/shared/personas.ts`(人物卡数据,固定老朋友做厚)
- **保留** `NAME_PERSONAS`、`NAME_DISPOSITIONS` 及 `personaForName`/`dispositionForName`(测试断言 `你的性格：`/`你判断局面的倾向：` 两行存在且异名不同——必须保留;`NAME_POOL` 由 `NAME_PERSONAS` 键派生、键序影响存档复现,**键序绝不动**)。
- **新增** 每名扩展卡字段(新 map `NAME_CHARACTERS`,与现有 map 同键、并行):`profession`(职业背景一句)、`playMind`(胆量/怀疑阈值/逻辑深度/自保方式/惯犯错误,各一短句)、`wolfDeception`(狼时伪装风格一句)。**阵营中立、不含身份真相**(红线:对任何身份都成立,真人不能借此被认出)。
- 导出结构化取值(如 `characterForName(name)` 返回卡对象);**渲染成提示词文本的职责放在 `prompt/character.ts`**(数据与措辞分离)。未知名字回退中性卡、绝不抛错(仿现有 `personaForName`)。

### 3.2 `src/ai-proxy/prompt/*`(各层纯函数)
- 每文件导出一/少数纯函数,只依赖 `shared`(类型/personas/labels),**不持 key、不碰 fetch**(天然守 ISO/模块边界,各层可独立单测)。
- `index.ts` 的 `buildPrompt(req)`:in-game 分支按 `[character, table, worldModel, factionPlaybook, reasoning, task, output].filter(Boolean).join("\n")` 组合;**user 段一行不动**(仍 `safeStringify(vi)`,守 ISO 测试);review 分支单独保留(从现 handler.ts:89-104 迁来)。
- 旧块迁移映射(现 handler.ts 行号供定位):
  - `BOARD_RULES`(143-147)→ `worldModel.ts`(无警长禁令**逐字保留**)。
  - teammates 拼接(116-120)→ `playbook.ts` 狼人分支,扩写「护队友」。
  - `STYLE_GUIDE`(153-158)→ 并入 `character.ts`/`reasoning.ts`(管「怎么说话」)。
  - `reasoningInstruction()`(166-173)→ 拆:「别只因票数跟票/沉默不等于可疑」上移 `worldModel.ts`;`reasoning.ts` 留私有/公开分离 + 与历史一致。
  - `taskInstruction()`(218-284)各 case → `task.ts`,**瘦身**:删已上移到 L2/L3 的判读(vote case 里对跳/别投软柿子/别盯沉默等),只留动作纪律 + `targetsHint`。
  - `shuffledTargets()`(180-204)→ `task.ts`,机制不动。

### 3.3 `src/ai-proxy/llm.ts` + `ai-config.ts`(传输与配置分离)
- 把 `callLLM`(322-389)/`buildChatRequest`(391-403)/`buildResponsesRequest`(405-417)/`extractChatContent`/`extractResponsesContent`/`parsePayload`/`stripCodeFence` 等从 handler 迁到 `llm.ts`。
- **温度分层**(`ai-config.ts` 按 taskType 查表):发言类(speech/tie_speech/last_words)较高(更自然,如 ~1.0),行动/投票类(vote/night_action/witch_action/hunter_shoot)较低(逻辑优先,如 ~0.4);`llm.ts` 据此在请求体带 `temperature`。证据:wolfcha + 调研。模型路由(mini vs review,现 handler.ts:80-81)也归 `ai-config.ts`。
- handler.ts 最终瘦身为:`safeParse` 校验 → `config.configured` 检查 → `buildPrompt()` → `sendToLLM()`,无内联文本。

### 3.4 不动
- `src/shared/models.ts` / `schemas.ts`(vi/payload 字段够用,无需扩)。

---

## 4. 测试约束(红线)与新增

**必须守住**(`src/ai-proxy/handler.test.ts` 现有断言;重构后这些子串须仍出现在对应任务的 system 中——它们恰好都是该保留的健全认知):

| 断言(行号) | 约束 |
|---|---|
| `not.toMatch(/狼人是\|预言家是/)`(246/321) | 新文案**绝不能含** `狼人是`/`预言家是` 子串。用「你的狼队友」「真预言家」「预言家这一神职」可以;**避免**「狼人是…」「预言家是…」断句(如写「狼方屠边」而非「狼人是屠边方」) |
| vote system 含 `对跳`/`话少`/`保持一致`(315-317) | 归 L2(对跳/话少)+ L4(保持一致),始终装配 → 投票时自然在场 |
| vote system 含 `票数本身不是证据`(310) | 上移 L2,始终在场 |
| speech system 含 `别附和或复述`/`别按发言顺序或座位顺序`(283-284)、`像真人那样自然`(302),且**不含** `有逻辑、贴合`(301) | 保留在 `task.ts` speech case / L4 |
| `你的性格：` + 异名不同(259-261)、`你判断局面的倾向：` + 异名不同(269-273)、同名稳定(290) | L0 渲染时**保留这两行原前缀** |
| 候选洗牌确定性(338)、跨座位去偏见(355)、`不代表任何倾向`(319) | `task.ts` 内 `shuffledTargets` 机制不动 |
| review prompt(375-385)、model 分流 `gpt-5.4-mini`/`gpt-5.5`(232-233) | 行为不变(模型路由迁到 ai-config 但结果一致) |
| `analysisSummary`/`decisionSummary` 在 system(307-308)、payload optional(358-373) | schema 不动,L4/L6 保留这两字段说明 |

**测试随模块拆分迁移**:`buildPrompt` 迁到 `prompt/index.ts` → `handler.test.ts` 里 `import { buildPrompt }` 改指向新路径(`handleAiRespond` 仍从 `handler.ts` 导入);按新模块各补 `*.test.ts`(`prompt/worldModel.test.ts`、`prompt/playbook.test.ts`、`prompt/character.test.ts` 等),每层独立验证。

**新增测试**(分布到对应模块):
1. 好人 system 含「采信无对跳单预言家查杀」类指导子串(锁首夜冤神 bug 修复)。
2. 狼人(`werewolf_team`+teammates)system 含「护队友/帮队友洗清」+「悍跳」或「对跳」。
3. 好人 system **不含** 狼人专属子串(如「悍跳」);狼人 **不含** 好人专属子串(锁 L3 条件装配)。
4. `WORLD_MODEL` 对所有 role/faction 都出现(全员同一份)。
5. ISO 回归:对 werewolf/seer/witch 各 role 跑 `buildPrompt`,断言 `not.toMatch(/狼人是|预言家是/)`。
6. 人物卡:L0 含职业/打法心智字段;异名人物卡不同;同名稳定;`characterForName`/`character.ts` 渲染无真相泄漏。
7. (温度)发言类与行动类 taskType 走不同 `temperature`。

---

## 5. 验证
1. `npx tsc -b` 通过;`npm test` 全绿(现有 145 + 新增),重点 `handler.test.ts` 全部 ISO/子串断言;`npm run build` 通过。
2. 手测(`npm run dev`,7 人标准局):真人当预言家、首夜查杀一狼、白天硬跳报查杀。**预期**:好人 AI(村民/女巫/猎人)不再集体踩预言家,而倾向相信、把票投向被查杀的狼;且 AI 发言更有「人味」(职业/性格/口吻各异、偶有缺点)。重复几局看是否稳定(弱模型仍可能偶发,但不应再出现「全好人票预言家」的系统性崩盘)。
3. 对照:能构造对跳时,确认 AI 才进辨真假、不无脑信第一个跳的人。

---

## 6. 实施顺序建议(给新会话)
1. 先扩 `shared/personas.ts` 人物卡数据 + `characterForName`(纯数据,先绿)。
2. 建 `ai-config.ts` 温度表 + 把传输层抽到 `llm.ts`(纯搬运,跑现有测试确认不回归)。
3. 建 `prompt/*` 各层,逐个把旧文本迁入并按本计划改写;`prompt/index.ts` 装配。
4. handler.ts 瘦身,改测试 import,补各模块新测试。
5. 全量 `tsc -b` / `npm test` / `npm run build` 绿,再手测。

> 注:实施时同步在 `CLAUDE.md` 的「现状基线」追加一条本次重构记录(项目惯例)。
