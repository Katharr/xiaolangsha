import type { AppError, Result } from "../shared";
import { aiTaskResponseSchema, err } from "../shared";

import type { AiClient, AiTaskPayload, AiTaskRequest } from "./types";

/**
 * 浏览器侧的 LLM 客户端：把请求 POST 给 dev-server 的 `/api/ai/respond` 代理
 * （key 只在代理进程，浏览器永不接触）。响应用 `aiTaskResponseSchema` 校验。
 *
 * 纪律：`respond` 永不抛——网络/HTTP/JSON/校验任何失败都映射成 `Result` 的 err。
 * 内部对「可重试」的失败重试一次；仍失败则返回 err，交给 `withFallback` 降级脚本AI。
 */
export interface HttpAiClientOptions {
  endpoint?: string;
  fetchImpl?: typeof fetch;
  /** 总尝试次数（含首次）。默认 2 = 失败后重试一次。 */
  maxAttempts?: number;
}

const DEFAULT_ENDPOINT = "/api/ai/respond";

export class HttpAiClient implements AiClient {
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxAttempts: number;

  constructor(options: HttpAiClientOptions = {}) {
    this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 2);
  }

  async respond(req: AiTaskRequest): Promise<Result<AiTaskPayload>> {
    let lastError: AppError = {
      code: "AI_UNAVAILABLE",
      message: "AI 代理无响应",
      retryable: true,
      source: "ai_client",
    };

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const outcome = await this.attempt(req);
      if (outcome.ok) {
        return outcome;
      }
      lastError = outcome.error;
      // 代理给出的确定性失败（如未配置 → retryable:false）无需重试。
      if (!outcome.error.retryable) {
        break;
      }
    }

    return err(lastError);
  }

  private async attempt(req: AiTaskRequest): Promise<Result<AiTaskPayload>> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(req),
      });
    } catch (error) {
      return err({
        code: "AI_UNAVAILABLE",
        message: `请求 AI 代理失败：${error instanceof Error ? error.message : String(error)}`,
        retryable: true,
        source: "ai_client",
      });
    }

    if (!response.ok) {
      return err({
        code: "AI_UNAVAILABLE",
        message: `AI 代理返回 HTTP ${response.status}`,
        retryable: response.status >= 500,
        source: "ai_client",
      });
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      return err({
        code: "AI_JSON_INVALID",
        message: "AI 代理响应不是合法 JSON",
        retryable: true,
        source: "ai_client",
      });
    }

    const parsed = aiTaskResponseSchema.safeParse(json);
    if (!parsed.success) {
      return err({
        code: "AI_JSON_INVALID",
        message: `AI 代理响应不符合契约：${parsed.error.message}`,
        retryable: true,
        source: "ai_client",
      });
    }

    // parsed.data 本身就是 Result<AiTaskPayload>：ok 直接采用，err 原样透传
    // （其 retryable 决定上面循环是否重试）。
    return parsed.data;
  }
}
