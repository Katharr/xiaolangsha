/**
 * Vite dev-server 中间件：注册 `POST /api/ai/respond`，把请求转交给框架无关的
 * `handleAiRespond`。API key 只在 dev-server 进程内（通过 `loadEnv` 读取 `.env`），
 * 绝不下发到浏览器。该 contract 未来可平移到 Vercel/Express 函数。
 */
import { appendFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";

import { loadEnv, type Plugin } from "vite";

import type { Result } from "../shared";

import { type ProxyConfig, loadProxyConfig, modelForTask, temperatureForTask } from "./config";
import { handleAiRespond } from "./handler";
import { buildPrompt } from "./prompt";

const ROUTE = "/api/ai/respond";
const TRACE_FILE = "ai-trace.jsonl";

/**
 * 完整 LLM trace：把每次调用的「发出去的 system+user 全文」和「模型返回的完整结构」
 * （text + 私有 analysisSummary/decisionSummary 等）逐条追加成 JSONL，供事后核对模型
 * 是否按提示词方向作答。**含完整真相、仅本地 dev 用、已在 .gitignore 忽略**。
 */
function appendTrace(
  tracePath: string,
  body: unknown,
  config: ProxyConfig,
  result: Result<unknown>,
): void {
  try {
    const b = body as {
      taskType?: string;
      visibleInformation?: { ownName?: string; ownSeat?: number; ownRole?: string; gamePhase?: string };
    };
    const taskType = b?.taskType ?? "?";
    const vi = b?.visibleInformation;
    let system = "";
    let user = "";
    try {
      const prompt = buildPrompt(body as Parameters<typeof buildPrompt>[0]);
      system = prompt.system;
      user = prompt.user;
    } catch {
      /* body 非法时留空 */
    }
    const record = {
      ts: new Date().toISOString(),
      taskType,
      viewer: vi ? { name: vi.ownName, seat: vi.ownSeat, role: vi.ownRole } : null,
      phase: vi?.gamePhase ?? null,
      model: modelForTask(taskType, config),
      temperature: temperatureForTask(taskType),
      input: { system, user },
      output: result.ok ? result.data : { error: result.error },
    };
    appendFileSync(tracePath, JSON.stringify(record) + "\n", "utf8");
  } catch {
    /* trace 绝不影响主流程 */
  }
}

/**
 * 诊断日志：每次 AI 调用在 dev-server 控制台打印一行，回答三个排错问题——
 * 走的是真 LLM 还是降级？用的什么模型/温度？发出去的 system 是不是**新版**提示词
 * （检查我们刚加的标记串「点名回应」/「言行不一」是否在内）。system 只由可见信息派生、
 * 不含他人真相，打印长度 + 标记命中即可，不打印正文。
 */
function logAiStep(body: unknown, configured: boolean, result: { ok: boolean; error?: { code?: string } }): void {
  try {
    const b = body as {
      taskType?: string;
      visibleInformation?: { ownName?: string; ownSeat?: number; ownRole?: string };
    };
    const taskType = b?.taskType ?? "?";
    const vi = b?.visibleInformation;
    const who = vi ? `${vi.ownName ?? "?"}(${vi.ownSeat ?? "?"}号/${vi.ownRole ?? "?"})` : "-";
    const model = (() => {
      try {
        return modelForTask(taskType, loadProxyConfig(process.env));
      } catch {
        return "?";
      }
    })();
    const temp = temperatureForTask(taskType);

    let sysLen = 0;
    let markerHit = "-";
    try {
      const sys = buildPrompt(body as Parameters<typeof buildPrompt>[0]).system;
      sysLen = sys.length;
      if (taskType === "speech") markerHit = `[点名回应]=${sys.includes("点名回应") ? "有(新版)" : "无(旧版!)"}`;
      else if (taskType === "vote") markerHit = `[言行不一]=${sys.includes("言行不一") ? "有(新版)" : "无(旧版!)"}`;
    } catch {
      /* body 非法时跳过指纹 */
    }

    const verdict = result.ok ? "ok(真LLM)" : `降级(${result.error?.code ?? "err"})`;
    console.log(
      `[ai-proxy] ${taskType} ${who} model=${model} temp=${temp} configured=${configured} sysLen=${sysLen} ${markerHit} → ${verdict}`,
    );
  } catch {
    /* 诊断日志绝不影响主流程 */
  }
}

export function aiProxyPlugin(): Plugin {
  return {
    name: "langrensha-ai-proxy",
    configureServer(server) {
      // 空 prefix 让 Vite 把所有（含未加 VITE_ 前缀的）变量从 .env 读进来，
      // 这正是我们要的：服务端密钥不暴露给客户端。
      const env = loadEnv(server.config.mode, server.config.root, "");
      const config = loadProxyConfig(env);

      // 每次启动清空 trace，让文件里只剩本次 server 这几局，便于事后定位最新一局。
      const tracePath = join(server.config.root, TRACE_FILE);
      try {
        writeFileSync(
          tracePath,
          `# ai-trace 启动 ${new Date().toISOString()} speech=${config.models.speech} reasoning=${config.models.reasoning} review=${config.models.review}\n`,
          "utf8",
        );
      } catch {
        /* 忽略 trace 初始化失败 */
      }

      if (!config.configured) {
        server.config.logger.warn(
          "[ai-proxy] 未检测到 AI_BASE_URL / AI_API_KEY，/api/ai/respond 将返回降级响应（脚本AI 兜底）。",
        );
      }

      server.middlewares.use(ROUTE, async (req, res) => {
        if (req.method !== "POST") {
          sendJson(res, 405, {
            ok: false,
            error: {
              code: "INVALID_ACTION",
              message: "仅支持 POST",
              retryable: false,
              source: "ai_proxy",
            },
          });
          return;
        }

        let body: unknown;
        try {
          body = await readJsonBody(req);
        } catch (error) {
          sendJson(res, 200, {
            ok: false,
            error: {
              code: "INVALID_ACTION",
              message: `请求体解析失败：${error instanceof Error ? error.message : String(error)}`,
              retryable: false,
              source: "ai_proxy",
            },
          });
          return;
        }

        // handleAiRespond 永不抛；结果本身就是 Result<AiTaskPayload>，HTTP 恒 200，
        // 由 httpAi 用 aiTaskResponseSchema 解析 ok/err。
        const result = await handleAiRespond(body, config);
        logAiStep(body, config.configured, result);
        appendTrace(tracePath, body, config, result);
        sendJson(res, 200, result);
      });
    },
  };
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const LIMIT = 1_000_000; // 1MB 上限，防止异常大请求

    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > LIMIT) {
        reject(new Error("请求体过大"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (raw.length === 0) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}
