import { describe, expect, it, vi } from "vitest";

import type { Result, VisibleInformationSnapshot } from "../shared";

import { HttpAiClient } from "./httpAi";
import type { AiTaskPayload, AiTaskRequest } from "./types";

function fakeVi(): VisibleInformationSnapshot {
  return {
    gameId: "g-1",
    viewerId: "ai-1",
    generatedAtSeq: 4,
    gamePhase: "vote",
    round: { night: 1, day: 1, voteRound: "first" },
    ownSeat: 2,
    ownName: "莉莉",
    ownRole: "villager",
    ownFaction: "good_team",
    alivePlayers: [],
    deadPlayers: [],
    publicEvents: [],
    privateEvents: [],
    speeches: [],
    votes: [],
    legalActions: [],
    canAct: true,
  };
}

const req: AiTaskRequest = {
  gameId: "g-1",
  taskType: "vote",
  playerId: "ai-1",
  visibleInformation: fakeVi(),
};

function jsonResponse(body: Result<AiTaskPayload> | unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  } as unknown as Response;
}

describe("HttpAiClient", () => {
  it("adopts an ok Result from the proxy", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ ok: true, data: { choiceType: "abstain" } }),
    );
    const client = new HttpAiClient({ fetchImpl: fetchImpl as unknown as typeof fetch });

    const result = await client.respond(req);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.choiceType).toBe("abstain");
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, fetchInit] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/ai/respond");
    expect(fetchInit.method).toBe("POST");
  });

  it("passes through a non-retryable err without retrying", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        ok: false,
        error: {
          code: "AI_UNAVAILABLE",
          message: "未配置",
          retryable: false,
          source: "ai_proxy",
        },
      }),
    );
    const client = new HttpAiClient({ fetchImpl: fetchImpl as unknown as typeof fetch });

    const result = await client.respond(req);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("AI_UNAVAILABLE");
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries once on a retryable err then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          ok: false,
          error: {
            code: "AI_TIMEOUT",
            message: "超时",
            retryable: true,
            source: "ai_service",
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: { text: "好的" } }));
    const client = new HttpAiClient({ fetchImpl: fetchImpl as unknown as typeof fetch });

    const result = await client.respond(req);

    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("returns the last err after exhausting retries", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        ok: false,
        error: {
          code: "AI_TIMEOUT",
          message: "超时",
          retryable: true,
          source: "ai_service",
        },
      }),
    );
    const client = new HttpAiClient({ fetchImpl: fetchImpl as unknown as typeof fetch });

    const result = await client.respond(req);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("AI_TIMEOUT");
    }
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("maps an HTTP 500 to a retryable AI_UNAVAILABLE", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, { ok: false, status: 500 }));
    const client = new HttpAiClient({ fetchImpl: fetchImpl as unknown as typeof fetch });

    const result = await client.respond(req);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("AI_UNAVAILABLE");
    }
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("maps a malformed proxy response to AI_JSON_INVALID", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ totally: "wrong shape" }));
    const client = new HttpAiClient({ fetchImpl: fetchImpl as unknown as typeof fetch });

    const result = await client.respond(req);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("AI_JSON_INVALID");
    }
  });

  it("maps a fetch throw to AI_UNAVAILABLE", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });
    const client = new HttpAiClient({ fetchImpl: fetchImpl as unknown as typeof fetch });

    const result = await client.respond(req);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("AI_UNAVAILABLE");
    }
  });
});
