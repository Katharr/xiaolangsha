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
import { aiTaskPayloadSchema, aiTaskRequestSchema, err, ok } from "../shared";

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

  return {
    system: [
      "你正在玩一局 5 人狼人杀（1 狼人、1 预言家、3 村民）。",
      `你叫「${vi.ownName}」，坐 ${vi.ownSeat} 号位；你的身份：${describeRole(vi.ownRole)}；你的阵营：${describeFaction(vi.ownFaction)}。`,
      "所有玩家（包括你）都以「名字 + 座位号」标识；这局有一名真人玩家和若干同你一样的 AI 玩家，但你无法从任何可见信息中分辨谁是真人、谁是 AI，请一视同仁地对待每一位玩家。",
      "重要：你只能依据下面提供的「可见信息」做判断，绝不能假设你知道其他玩家的真实身份，也不要凭空怀疑或针对某位玩家——只根据其发言与行为的逻辑来推理。",
      taskInstruction(req.taskType, vi),
      OUTPUT_CONTRACT,
    ].join("\n"),
    user: [
      "当前可见信息（visibleInformation，JSON）：",
      safeStringify(vi),
      ...(draft ? ["", `你此前的草稿（可参考或改写）：${draft}`] : []),
    ].join("\n"),
  };
}

const OUTPUT_CONTRACT = [
  "你必须只输出一个 JSON 对象，不要包含任何额外文字或 Markdown 代码块。",
  "JSON 字段（按需填写）：",
  '- text: string —— 你的发言/遗言/拉票文本（发言类任务必填）。',
  '- choiceType: "target" | "abstain" —— 投票任务用，target 表示投某人，abstain 表示弃票。',
  '- targetId: string —— 行动/投票的目标玩家 id，必须取自可见信息给出的合法目标。',
  '- actionType: "werewolf_kill" | "seer_check" —— 夜晚行动任务用。',
  "- analysisSummary: string —— （可选）你的私下分析，不会展示给其他玩家。",
  "- decisionSummary: string —— （可选）你做出该决策的简要理由，不会展示给其他玩家。",
].join("\n");

function taskInstruction(
  taskType: "speech" | "night_action" | "vote" | "tie_speech" | "last_words",
  vi: VisibleInformationSnapshot,
): string {
  const legalTargets = vi.legalActions.flatMap((action) => action.legalTargets);
  const targetsHint =
    legalTargets.length > 0 ? `合法目标 id：${legalTargets.join("、")}。` : "当前没有可选目标。";

  switch (taskType) {
    case "night_action":
      return `任务：夜晚行动。请根据你的身份选择 actionType 并指定 targetId。${targetsHint}`;
    case "vote":
      return `任务：投票放逐。选择 choiceType="target" 并给出 targetId 投出你的一票，或在允许时 choiceType="abstain" 弃票。不能投自己。${targetsHint}`;
    case "speech":
      return "任务：白天发言。请输出一段有逻辑、贴合你身份与阵营利益的中文发言（仅填 text，控制在 200 字内）。";
    case "tie_speech":
      return "任务：平票后的二次拉票发言。请简短重申你的立场以争取选票（仅填 text，控制在 200 字内）。";
    case "last_words":
      return "任务：你被放逐了，请留下遗言（仅填 text，控制在 200 字内）。";
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
