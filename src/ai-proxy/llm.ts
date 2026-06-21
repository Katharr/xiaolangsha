/**
 * 传输层：调用 OpenAI 兼容端点并把响应解析成契约 payload。持 key、调 fetch。
 *
 * 与提示词层（prompt/*）彻底分开：本模块不关心提示词内容，只负责「把两段文本 + 温度 + 模型
 * 发出去、把回来的文本解析成 AiTaskPayload」。任何失败都映射成 Result 的 err（永不抛）。
 */
import type { z } from "zod";

import type { Result } from "../shared";
import { aiTaskPayloadSchema, err, ok } from "../shared";

import type { ProxyConfig } from "./config";
import { proxyError } from "./errors";
import type { PromptMessages } from "./prompt";

type AiTaskPayload = z.infer<typeof aiTaskPayloadSchema>;
type FetchImpl = typeof fetch;

/**
 * 调用 LLM。默认 Chat Completions；`AI_WIRE_API=responses` 切到 Responses API。
 * `temperature` 由调用方（handler）按 taskType 查表决定。
 */
export async function sendToLLM(
  prompt: PromptMessages,
  config: ProxyConfig,
  model: string,
  temperature: number,
  fetchImpl: FetchImpl = fetch,
): Promise<Result<AiTaskPayload>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const request =
      config.wireApi === "responses"
        ? buildResponsesRequest(prompt, config, model, temperature)
        : buildChatRequest(prompt, config, model, temperature);

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

function buildChatRequest(
  prompt: PromptMessages,
  config: ProxyConfig,
  model: string,
  temperature: number,
) {
  return {
    url: `${config.baseUrl}/chat/completions`,
    body: {
      model,
      temperature,
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
      response_format: { type: "json_object" },
    },
  };
}

function buildResponsesRequest(
  prompt: PromptMessages,
  config: ProxyConfig,
  model: string,
  temperature: number,
) {
  return {
    url: `${config.baseUrl}/responses`,
    body: {
      model,
      temperature,
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
