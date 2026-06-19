import type { z } from "zod";

import type { Result } from "../shared";
import { aiTaskPayloadSchema, aiTaskRequestSchema } from "../shared";

/**
 * AI 请求/响应载荷的 TS 类型直接从已审定的 Zod 契约推导，保证类型与运行时校验同源。
 */
export type AiTaskRequest = z.infer<typeof aiTaskRequestSchema>;
export type AiTaskPayload = z.infer<typeof aiTaskPayloadSchema>;

/**
 * 脚本AI 与 LLM 客户端的唯一切换接缝。
 *
 * 约定：`respond` **永不抛异常**——任何失败都映射成 `Result` 的 err 分支，
 * 由 `withFallback` 决定是否降级到脚本兜底。换 LLM 只需改 app 装配一行。
 */
export interface AiClient {
  respond(req: AiTaskRequest): Promise<Result<AiTaskPayload>>;
}
