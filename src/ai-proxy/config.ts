/**
 * 代理配置：从环境变量装配 LLM 调用参数。
 *
 * 纪律：API key 只在这里（dev-server / 服务端进程）被读取，永不进浏览器、永不进 git。
 * `loadProxyConfig` 接收一个普通的 env 字典（由 vitePlugin 用 Vite 的 `loadEnv`
 * 注入），保持纯函数、便于测试。
 */

export type WireApi = "chat" | "responses";

export interface ProxyConfig {
  baseUrl: string;
  apiKey: string;
  /** 局内任务（发言/夜晚行动/投票…）使用的模型。 */
  model: string;
  /** 复盘问答（taskType=review_question）使用的模型，通常更强。 */
  reviewModel: string;
  wireApi: WireApi;
  timeoutMs: number;
  /** baseUrl 与 apiKey 都齐备时才算配置完成；否则代理直接返回 AI_UNAVAILABLE 触发脚本兜底。 */
  configured: boolean;
}

// 局内发言/行动走更快更省的 mini；复盘问答走更强的 gpt-5.5。url/key 两者共用。
const DEFAULT_MODEL = "gpt-5.4-mini";
const DEFAULT_REVIEW_MODEL = "gpt-5.5";
const DEFAULT_TIMEOUT_MS = 30_000;

function clean(value: string | undefined): string {
  return (value ?? "").trim();
}

/** 去掉 baseUrl 末尾的斜杠，便于后续拼接 `/chat/completions`。 */
function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

export function loadProxyConfig(env: Record<string, string | undefined>): ProxyConfig {
  const baseUrl = normalizeBaseUrl(clean(env.AI_BASE_URL));
  const apiKey = clean(env.AI_API_KEY);
  const model = clean(env.AI_MODEL) || DEFAULT_MODEL;
  const reviewModel = clean(env.AI_REVIEW_MODEL) || DEFAULT_REVIEW_MODEL;
  const wireApi: WireApi = clean(env.AI_WIRE_API) === "responses" ? "responses" : "chat";

  const parsedTimeout = Number.parseInt(clean(env.AI_TIMEOUT_MS), 10);
  const timeoutMs =
    Number.isFinite(parsedTimeout) && parsedTimeout > 0
      ? parsedTimeout
      : DEFAULT_TIMEOUT_MS;

  return {
    baseUrl,
    apiKey,
    model,
    reviewModel,
    wireApi,
    timeoutMs,
    configured: baseUrl.length > 0 && apiKey.length > 0,
  };
}
