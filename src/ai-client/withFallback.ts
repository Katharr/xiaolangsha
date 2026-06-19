import type { AiClient } from "./types";

/**
 * 失败降级包装：primary（M5 起为 httpAi/真 LLM）失败时调 fallback（脚本AI）。
 *
 * 由于脚本兜底恒返回 ok，最终结果几乎总能拿到合法动作，保证游戏不会因 LLM
 * 故障而卡死。即便 fallback 自身返回 err（理论上不该发生），也原样透传由上层处理。
 */
export function withFallback(primary: AiClient, fallback: AiClient): AiClient {
  return {
    async respond(req) {
      const primaryResult = await primary.respond(req);
      if (primaryResult.ok) {
        return primaryResult;
      }
      return fallback.respond(req);
    },
  };
}
