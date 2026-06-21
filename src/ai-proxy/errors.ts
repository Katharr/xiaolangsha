/**
 * 代理层统一的错误构造器。handler（请求校验/未配置）与 llm（传输/解析失败）共用，
 * 都把失败映射成 `Result` 的 err 分支——永不抛，由上层 httpAi → withFallback 决定降级。
 */
import type { AppError } from "../shared";

export function proxyError(
  code: AppError["code"],
  message: string,
  options: {
    userMessage?: string;
    retryable?: boolean;
    source?: AppError["source"];
  } = {},
): AppError {
  return {
    code,
    message,
    retryable: options.retryable ?? false,
    source: options.source ?? "ai_service",
    ...(options.userMessage ? { userMessage: options.userMessage } : {}),
  };
}
