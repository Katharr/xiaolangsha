/**
 * 代理配置：从环境变量装配 LLM 调用参数。
 *
 * 纪律：API key 只在这里（dev-server / 服务端进程）被读取，永不进浏览器、永不进 git。
 * `loadProxyConfig` 接收一个普通的 env 字典（由 vitePlugin 用 Vite 的 `loadEnv`
 * 注入），保持纯函数、便于测试。
 */

export type WireApi = "chat" | "responses";

/** 按任务对「质量 vs 速度」需求分的三档（模型与温度共用同一分组）。 */
export type TaskGroup = "speech" | "reasoning" | "review";

export interface TaskModels {
  /** 发言类（speech/tie_speech/last_words）：最频繁、要快+自然。 */
  speech: string;
  /** 推理类（vote/night_action/witch_action/hunter_shoot）：决策逻辑质量优先。 */
  reasoning: string;
  /** 复盘问答（review_question）：频率低、可慢、要质量。 */
  review: string;
}

export interface ProxyConfig {
  baseUrl: string;
  apiKey: string;
  /** 三档任务模型；url/key 全部共用同一端点。 */
  models: TaskModels;
  wireApi: WireApi;
  timeoutMs: number;
  /** baseUrl 与 apiKey 都齐备时才算配置完成；否则代理直接返回 AI_UNAVAILABLE 触发脚本兜底。 */
  configured: boolean;
}

// 此 endpoint 实测可用：gpt-5.4-mini / gpt-5.4 / gpt-5.5（gpt-5.2 系列在 Codex 通道 400 不可用）。
// 发言与推理（决策）都走又快又稳的 gpt-5.4；复盘走最强的 gpt-5.5（频率低、可慢，配合 90s 超时）。
const DEFAULT_SPEECH_MODEL = "gpt-5.4";
const DEFAULT_REASONING_MODEL = "gpt-5.4";
const DEFAULT_REVIEW_MODEL = "gpt-5.5";
// 推理用 5.5 偏慢，默认放宽到 90s，避免投票/夜晚频繁超时降级到脚本。
const DEFAULT_TIMEOUT_MS = 90_000;

/** 把 taskType 归入三档之一（模型路由与温度分层共用，避免两套 switch）。 */
function taskGroup(taskType: string): TaskGroup {
  switch (taskType) {
    case "speech":
    case "tie_speech":
    case "last_words":
      return "speech";
    case "review_question":
      return "review";
    default:
      // vote / night_action / witch_action / hunter_shoot 及任何未知动作都按推理处理。
      return "reasoning";
  }
}

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
  // 老 AI_MODEL 作为发言/推理的兜底，兼容只配了单一模型的旧 .env。
  const fallback = clean(env.AI_MODEL);
  const models: TaskModels = {
    speech: clean(env.AI_SPEECH_MODEL) || fallback || DEFAULT_SPEECH_MODEL,
    reasoning: clean(env.AI_REASONING_MODEL) || fallback || DEFAULT_REASONING_MODEL,
    review: clean(env.AI_REVIEW_MODEL) || DEFAULT_REVIEW_MODEL,
  };
  const wireApi: WireApi = clean(env.AI_WIRE_API) === "responses" ? "responses" : "chat";

  const parsedTimeout = Number.parseInt(clean(env.AI_TIMEOUT_MS), 10);
  const timeoutMs =
    Number.isFinite(parsedTimeout) && parsedTimeout > 0
      ? parsedTimeout
      : DEFAULT_TIMEOUT_MS;

  return {
    baseUrl,
    apiKey,
    models,
    wireApi,
    timeoutMs,
    configured: baseUrl.length > 0 && apiKey.length > 0,
  };
}

/**
 * 模型路由：按任务三档取模型（发言快档 / 推理强档 / 复盘强档）；url/key 共用同一端点。
 */
export function modelForTask(taskType: string, config: ProxyConfig): string {
  return config.models[taskGroup(taskType)];
}

/**
 * 温度分层（证据：wolfcha CREATIVE=1.1 + 调研，见 docs/AI-PROMPT-RESEARCH.md），与模型共用 taskGroup：
 * 发言类走高温 1.0（自然多样、少雷同；发言任务已改成松散群聊式、不再靠低温压模板）；
 * 推理类（投票/夜晚行动）走低温 0.4，逻辑优先、少抽风；复盘走最低温 0.3 求稳。
 */
export function temperatureForTask(taskType: string): number {
  switch (taskGroup(taskType)) {
    case "speech":
      return 1.0;
    case "review":
      return 0.3;
    case "reasoning":
    default:
      return 0.4;
  }
}
