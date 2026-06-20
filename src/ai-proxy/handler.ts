/**
 * 框架无关的 AI 代理核心：`POST /api/ai/respond` 的业务逻辑。
 *
 * 流程：`aiTaskRequestSchema` 校验 → `buildPrompt`（绝不含超出可见信息的真相）→
 * `callLLM`（OpenAI 兼容）→ 解析 + `aiTaskPayloadSchema` 校验。任何失败都映射成
 * `Result` 的 err 分支（永不抛），由上层 httpAi → withFallback 决定是否降级脚本AI。
 *
 * ISO 纪律：局中任务的 prompt 只由 `req.visibleInformation` 派生；复盘任务只由
 * `req.reviewContext` + `questionText` 派生。请求本身就不携带完整真相，结构上保证不泄漏。
 */
import type { z } from "zod";

import type { AppError, Result, VisibleInformationSnapshot } from "../shared";
import { aiTaskPayloadSchema, aiTaskRequestSchema, err, ok, personaForName } from "../shared";

import type { ProxyConfig } from "./config";

// 直接从已审定的 Zod 契约推导类型，避免 ai-proxy 依赖 ai-client（守住模块边界）。
type AiTaskRequest = z.infer<typeof aiTaskRequestSchema>;
type AiTaskPayload = z.infer<typeof aiTaskPayloadSchema>;

export interface PromptMessages {
  system: string;
  user: string;
}

type FetchImpl = typeof fetch;

function proxyError(
  code: AppError["code"],
  message: string,
  options: { userMessage?: string; retryable?: boolean; source?: AppError["source"] } = {},
): AppError {
  return {
    code,
    message,
    retryable: options.retryable ?? false,
    source: options.source ?? "ai_service",
    ...(options.userMessage ? { userMessage: options.userMessage } : {}),
  };
}

/**
 * 代理入口。`fetchImpl` 可注入以便测试。
 */
export async function handleAiRespond(
  rawBody: unknown,
  config: ProxyConfig,
  fetchImpl: FetchImpl = fetch,
): Promise<Result<AiTaskPayload>> {
  const parsed = aiTaskRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return err(
      proxyError("INVALID_ACTION", `非法的 AI 请求体：${parsed.error.message}`, {
        source: "ai_proxy",
        retryable: false,
      }),
    );
  }

  if (!config.configured) {
    return err(
      proxyError("AI_UNAVAILABLE", "AI 代理未配置 AI_BASE_URL / AI_API_KEY", {
        source: "ai_proxy",
        retryable: false,
        userMessage: "AI 未配置，已降级到脚本AI。",
      }),
    );
  }

  const prompt = buildPrompt(parsed.data);
  return callLLM(prompt, config, fetchImpl);
}

/**
 * 由请求装配 system / user 两段提示词。导出以便单测直接断言「只含可见信息」。
 */
export function buildPrompt(req: AiTaskRequest): PromptMessages {
  if (req.taskType === "review_question") {
    return {
      system: [
        "你是一名 AI 狼人杀玩家，本局已经结束，正在复盘环节回答真人玩家的提问。",
        "下面提供本局的完整复盘上下文（reviewContext，含所有身份、夜晚行动、发言与投票）。",
        "请基于该上下文如实、简洁地用中文回答问题。",
        OUTPUT_CONTRACT,
        "复盘回答只需填写 text 字段。",
      ].join("\n"),
      user: [
        `问题：${req.questionText}`,
        "复盘上下文（JSON）：",
        safeStringify(req.reviewContext),
      ].join("\n"),
    };
  }

  const vi = req.visibleInformation;
  const draft = req.promptContext?.currentText;

  const totalPlayers = vi.alivePlayers.length + vi.deadPlayers.length;
  return {
    system: [
      `你正在玩一局 ${totalPlayers} 人狼人杀（主流「预女猎」屠边规则：杀光所有平民或所有神职任一边，狼人即获胜）。`,
      `你叫「${vi.ownName}」，坐 ${vi.ownSeat} 号位；你的身份：${describeRole(vi.ownRole)}；你的阵营：${describeFaction(vi.ownFaction)}。`,
      `你的性格：${personaForName(vi.ownName)}。说话时自然地流露这种性格，但别刻意表演。`,
      "所有玩家（包括你）都以「名字 + 座位号」标识；这局有一名真人玩家和若干同你一样的 AI 玩家，但你无法从任何可见信息中分辨谁是真人、谁是 AI，请一视同仁地对待每一位玩家。",
      BOARD_RULES,
      STYLE_GUIDE,
      "重要：你只能依据下面提供的「可见信息」做判断，绝不能假设你知道其他玩家的真实身份，也不要凭空怀疑或针对某位玩家——只根据其发言与行为的逻辑来推理。",
      reasoningInstruction(),
      taskInstruction(req.taskType, vi),
      OUTPUT_CONTRACT,
    ].filter((line) => line.length > 0).join("\n"),
    user: [
      "当前可见信息（visibleInformation，JSON）：",
      safeStringify(vi),
      ...(draft ? ["", `你此前的草稿（可参考或改写）：${draft}`] : []),
    ].join("\n"),
  };
}

/**
 * 本局板子规则约束。最重要的一条：这是**没有警长（警徽）**的简化板——LLM 自带的狼人杀
 * 常识里默认有警长竞选，必须显式禁掉，否则 AI 会满嘴「上警/退水/留警徽流」让真人无所适从。
 */
const BOARD_RULES = [
  "本局采用简化规则，没有「警长 / 警徽」这一设定：不存在上警、竞选警长、警上发言、退水、警徽流、移交或撕毁警徽等任何环节。",
  "因此你绝对不要提到「警长」「警徽」「上警」「警徽流」「带队」之类与警长有关的概念，也不要安排或建议谁去「留警徽」——这局根本没有警徽可留。",
  "白天的流程很简单：天亮播报死讯 → 全场轮流发言一轮 → 所有人同时投票放逐。你的发言和投票只围绕「谁是狼」展开即可。",
].join("\n");

/**
 * 说话风格：轻松开黑但有边界。让 AI 像和朋友面对面玩那样自然开口，而不是念分析报告，
 * 但话始终服务于这局游戏，不为玩梗跑题成纯聊天。
 */
const STYLE_GUIDE = [
  "把这局当成周末和一群朋友面对面玩狼人杀，气氛轻松随意。",
  "开口像平时聊天那样自然：可以短句、带点情绪和口头禅，偶尔吐槽或调侃一句也行。",
  "但别为了搞笑而跑题——你的话始终是在推进这局游戏（找狼/自保/带节奏），不是来纯聊天的；点到为止，别刷梗、别长篇大论。",
  "别写成条理分明的分析报告或念稿，不用「第一第二第三」那套；一两句到位的大白话往往比长篇分析更像真人。",
].join("\n");

/**
 * 决策前「私有推理」基线块（始终生效，装配在 taskInstruction 之前）。
 *
 * 难度接缝：签名保留 `difficulty` 形参位置。未来「简单档=想得浅、可失误」「困难档=完整
 * 思维链 + 记忆反思」从这里按档返回不同深度即可，其余装配无需改动。当前对所有难度返回同一段。
 */
function reasoningInstruction(/* 未来: difficulty */): string {
  return [
    "做决定前，先在 analysisSummary 里用一两句把局面想清楚（这段只有你自己看得到，不会给别人看）：现在谁可信、谁可疑，依据是什么。",
    "如果你之前发过言，你的票和行动要跟当时表达的判断保持一致，别自相矛盾。",
    "别只因为某人话少、或者别人已经投了他，就跟着投——票数本身不是证据，平安夜没什么可说也不等于可疑。",
    "想好之后，在 decisionSummary 里一句话说清你为什么这么选。",
  ].join("\n");
}

/**
 * 候选目标去偏见洗牌：对一份副本做确定性 Fisher-Yates（种子=gameId+generatedAtSeq+ownSeat），
 * 避免模型按列表首尾位置锚定选人。**绝不改动 vi 本身**（user 段仍精确等于 vi 序列化，守 ISO 测试）。
 * 同一 vi 必得同一顺序（可复现）；不同座位通常得到不同顺序（去位置偏见）。
 */
function shuffledTargets(targets: string[], vi: VisibleInformationSnapshot): string[] {
  const seed = `${vi.gameId}#${vi.generatedAtSeq}#${vi.ownSeat}`;
  // FNV-1a 把种子串压成 32 位整数。
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // xorshift32 作为确定性 PRNG。
  let state = hash >>> 0 || 1;
  const nextInt = (): number => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state >>> 0;
  };
  const copy = targets.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = nextInt() % (i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const OUTPUT_CONTRACT = [
  "你必须只输出一个 JSON 对象，不要包含任何额外文字或 Markdown 代码块。",
  "JSON 字段（按需填写）：",
  '- text: string —— 你的发言/遗言/拉票文本（发言类任务必填）。',
  '- choiceType: "target" | "abstain" —— 投票任务用，target 表示投某人，abstain 表示弃票。',
  '- targetId: string —— 行动/投票的目标玩家 id，必须取自可见信息给出的合法目标。',
  '- actionType: "werewolf_kill" | "seer_check" | "guard_protect" —— 狼刀/预言家查验/守卫守护任务用。',
  '- witchChoice: "save" | "poison" | "skip" —— 女巫任务用：救被刀者 / 用毒药（配 targetId）/ 放弃。',
  "- analysisSummary: string —— （可选）你的私下分析，不会展示给其他玩家。",
  "- decisionSummary: string —— （可选）你做出该决策的简要理由，不会展示给其他玩家。",
].join("\n");

function taskInstruction(
  taskType:
    | "speech"
    | "night_action"
    | "witch_action"
    | "hunter_shoot"
    | "vote"
    | "tie_speech"
    | "last_words",
  vi: VisibleInformationSnapshot,
): string {
  const legalTargets = vi.legalActions.flatMap((action) => action.legalTargets);
  const orderedTargets = legalTargets.length > 0 ? shuffledTargets(legalTargets, vi) : [];
  const targetsHint =
    orderedTargets.length > 0
      ? `合法目标 id：${orderedTargets.join("、")}。（候选顺序是随机排的，不代表任何倾向，别按排序先后选人。）`
      : "当前没有可选目标。";

  switch (taskType) {
    case "night_action":
      return `任务：夜晚行动。先按上面的方法在心里想清楚再选。请根据你的身份选择 actionType（狼人=werewolf_kill，预言家=seer_check，守卫=guard_protect）并指定 targetId。${targetsHint}`;
    case "witch_action":
      return [
        "任务：女巫行动。你已得知今晚被刀的人（见可见信息里仅你可见的私有事件）。先按上面的方法想清楚再决定 witchChoice：save 救他、poison 并给出 targetId 毒一人、或 skip 放弃。解药和毒药各只有一次。",
        "用毒的纪律：毒药是你最稀缺、最容易帮倒忙的资源。决定用毒前，先确认你能在 decisionSummary 里点名「我要毒谁、依据是这局里的哪条具体证据」——某人的发言破绽、票型、预言家对跳、或公开的查杀。",
        "只要有指向某个具体人的依据就可以毒，哪怕这个判断是别人带起来的节奏、哪怕你可能被骗了、哪怕最后毒错——那都算正常发挥，不用怕。",
        "但如果你说不出针对某个具体人的理由，只是「想找狼试试」「施压」「随便毒一个赌一把」，那就 skip，把毒药留到有据的那一晚。空过一晚不用毒完全没问题，别因为「预言家死了我得做点什么」就盲毒。",
        "反过来，如果场上已经有人被对跳或公开查杀坐实成狼，那他就是你优先该毒的对象，该出手就果断出手——纪律不是叫你永远不用毒。",
        targetsHint,
      ].join("\n");
    case "hunter_shoot":
      return `任务：你是猎人且已出局，可开枪带走一名存活玩家。先按上面的方法想清楚该带走谁最有利再开枪。给出 targetId 开枪，或留空放弃开枪。${targetsHint}`;
    case "vote":
      return [
        "任务：投票放逐。先按上面的方法在 analysisSummary 里想清楚再投。",
        "本局投票是所有人同时暗投、结算时一起翻牌——你现在看不到别人投了谁，所以根本无从跟票，只管按你自己的判断投出最该走的那个人。",
        "把票投在对你阵营最有利的人身上：好人要找狼、狼要带节奏，但都得基于这局讨论里的逻辑，而不是挑场上最软的柿子。",
        "如果场上出现预言家对跳（两个人互相争着认领同一个神职、说对方假），那其中必定藏着一匹狼——你的票通常应落在你判断为假的那个对跳者身上、或他报出的查杀身上，而不是去投一个一直安静的普通玩家。",
        "别因为谁话少、平安夜没东西可说就把他当突破口；也要跟你自己刚才发言里表达的怀疑保持一致。",
        `然后 choiceType="target" 配 targetId 投出一票，或在允许时 choiceType="abstain" 弃票。不能投自己。${targetsHint}`,
      ].join("\n");
    case "speech":
      return "任务：白天发言。用你自己的性格、像真人那样自然地说几句（仅填 text，别太长，大白话即可）。先在心里把判断想好，说出来的话要和你心里的判断一致；该带的节奏、该表的态照样表，只是用平时聊天的口气说出来。";
    case "tie_speech":
      return "任务：平票了，再争取一下选票。用聊天的口气简短重申你的立场（要和你之前的判断一致），别念稿（仅填 text，越短越自然）。";
    case "last_words":
      return "任务：你被放逐了，留几句遗言。像真人那样自然交代你的判断或心里话即可，不用长篇大论（仅填 text）。";
    default:
      return "任务：请根据可见信息给出合理输出。";
  }
}

function describeRole(role: string): string {
  switch (role) {
    case "werewolf":
      return "狼人";
    case "seer":
      return "预言家";
    case "witch":
      return "女巫";
    case "hunter":
      return "猎人";
    case "guard":
      return "守卫";
    case "idiot":
      return "白痴";
    case "villager":
      return "村民";
    default:
      return role;
  }
}

function describeFaction(faction: string): string {
  return faction === "werewolf_team" ? "狼人阵营" : "好人阵营";
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "{}";
  }
}

/**
 * 调用 OpenAI 兼容端点。默认 Chat Completions；`AI_WIRE_API=responses` 切到 Responses API。
 */
async function callLLM(
  prompt: PromptMessages,
  config: ProxyConfig,
  fetchImpl: FetchImpl,
): Promise<Result<AiTaskPayload>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const request =
      config.wireApi === "responses"
        ? buildResponsesRequest(prompt, config)
        : buildChatRequest(prompt, config);

    const response = await fetchImpl(request.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(request.body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await safeReadText(response);
      return err(
        proxyError("AI_UNAVAILABLE", `LLM 返回 HTTP ${response.status}：${detail}`, {
          retryable: response.status >= 500 || response.status === 429,
        }),
      );
    }

    const json = (await response.json()) as unknown;
    const content =
      config.wireApi === "responses"
        ? extractResponsesContent(json)
        : extractChatContent(json);

    if (!content) {
      return err(
        proxyError("AI_JSON_INVALID", "LLM 响应缺少可解析的文本内容", {
          retryable: true,
        }),
      );
    }

    return parsePayload(content);
  } catch (error) {
    if (isAbortError(error)) {
      return err(
        proxyError("AI_TIMEOUT", `LLM 调用超时（${config.timeoutMs}ms）`, {
          retryable: true,
          userMessage: "AI 响应超时，已降级到脚本AI。",
        }),
      );
    }
    return err(
      proxyError("AI_UNAVAILABLE", `LLM 调用失败：${describeError(error)}`, {
        retryable: true,
        userMessage: "AI 暂不可用，已降级到脚本AI。",
      }),
    );
  } finally {
    clearTimeout(timer);
  }
}

function buildChatRequest(prompt: PromptMessages, config: ProxyConfig) {
  return {
    url: `${config.baseUrl}/chat/completions`,
    body: {
      model: config.model,
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
      response_format: { type: "json_object" },
    },
  };
}

function buildResponsesRequest(prompt: PromptMessages, config: ProxyConfig) {
  return {
    url: `${config.baseUrl}/responses`,
    body: {
      model: config.model,
      input: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
      text: { format: { type: "json_object" } },
    },
  };
}

function extractChatContent(json: unknown): string | undefined {
  const choice = (json as { choices?: Array<{ message?: { content?: unknown } }> })
    ?.choices?.[0];
  const content = choice?.message?.content;
  return typeof content === "string" && content.trim().length > 0 ? content : undefined;
}

function extractResponsesContent(json: unknown): string | undefined {
  const root = json as {
    output_text?: unknown;
    output?: Array<{ content?: Array<{ text?: unknown }> }>;
  };

  if (typeof root?.output_text === "string" && root.output_text.trim().length > 0) {
    return root.output_text;
  }

  for (const item of root?.output ?? []) {
    for (const part of item?.content ?? []) {
      if (typeof part?.text === "string" && part.text.trim().length > 0) {
        return part.text;
      }
    }
  }
  return undefined;
}

/** 解析 LLM 文本为 JSON，再用契约 schema 校验。兼容偶发的 ```json 包裹。 */
function parsePayload(content: string): Result<AiTaskPayload> {
  const stripped = stripCodeFence(content);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return err(
      proxyError("AI_JSON_INVALID", "LLM 输出不是合法 JSON", { retryable: true }),
    );
  }

  const validated = aiTaskPayloadSchema.safeParse(parsed);
  if (!validated.success) {
    return err(
      proxyError("AI_JSON_INVALID", `LLM 输出不符合契约：${validated.error.message}`, {
        retryable: true,
      }),
    );
  }
  return ok(validated.data);
}

function stripCodeFence(content: string): string {
  const trimmed = content.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenceMatch ? fenceMatch[1].trim() : trimmed;
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return "<无法读取响应体>";
  }
}
