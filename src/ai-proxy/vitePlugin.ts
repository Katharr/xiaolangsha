/**
 * Vite dev-server 中间件：注册 `POST /api/ai/respond`，把请求转交给框架无关的
 * `handleAiRespond`。API key 只在 dev-server 进程内（通过 `loadEnv` 读取 `.env`），
 * 绝不下发到浏览器。该 contract 未来可平移到 Vercel/Express 函数。
 */
import type { IncomingMessage, ServerResponse } from "node:http";

import { loadEnv, type Plugin } from "vite";

import { loadProxyConfig } from "./config";
import { handleAiRespond } from "./handler";

const ROUTE = "/api/ai/respond";

export function aiProxyPlugin(): Plugin {
  return {
    name: "langrensha-ai-proxy",
    configureServer(server) {
      // 空 prefix 让 Vite 把所有（含未加 VITE_ 前缀的）变量从 .env 读进来，
      // 这正是我们要的：服务端密钥不暴露给客户端。
      const env = loadEnv(server.config.mode, server.config.root, "");
      const config = loadProxyConfig(env);

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
