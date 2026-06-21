/**
 * 框架无关的 AI 代理核心：`POST /api/ai/respond` 的业务逻辑（瘦身后）。
 *
 * 流程：`aiTaskRequestSchema` 校验 → `config.configured` 检查 → `buildPrompt`（prompt/*，
 * 绝不含超出可见信息的真相）→ `sendToLLM`（llm.ts，OpenAI 兼容）。任何失败都映射成
 * `Result` 的 err 分支（永不抛），由上层 httpAi → withFallback 决定是否降级脚本AI。
 *
 * ISO 纪律：局中任务的 prompt 只由 `req.visibleInformation` 派生；复盘任务只由
 * `req.reviewContext` + `questionText` 派生。请求本身就不携带完整真相，结构上保证不泄漏。
 *
 * 提示词文本在 `prompt/*`（分层纯函数），传输在 `llm.ts`，模型/温度路由在 `config.ts`，
 * 本文件只做「校验 → 装配 → 调用」的薄编排，不内联任何提示词文本。
 */
import type { z } from "zod";

import type { Result } from "../shared";
import { aiTaskPayloadSchema, aiTaskRequestSchema, err } from "../shared";

import { type ProxyConfig, modelForTask, temperatureForTask } from "./config";
import { proxyError } from "./errors";
import { sendToLLM } from "./llm";
import { buildPrompt } from "./prompt";

type AiTaskPayload = z.infer<typeof aiTaskPayloadSchema>;

type FetchImpl = typeof fetch;

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
  const model = modelForTask(parsed.data.taskType, config);
  const temperature = temperatureForTask(parsed.data.taskType);
  return sendToLLM(prompt, config, model, temperature, fetchImpl);
}
