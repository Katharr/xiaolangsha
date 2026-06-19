import { describe, expect, it, vi } from "vitest";

import type { VisibleInformationSnapshot } from "../shared";

import type { ProxyConfig } from "./config";
import { buildPrompt, handleAiRespond } from "./handler";

function fakeVi(
  overrides: Partial<VisibleInformationSnapshot> = {},
): VisibleInformationSnapshot {
  return {
    gameId: "g-1",
    viewerId: "ai-1",
    generatedAtSeq: 12,
    gamePhase: "vote",
    round: { night: 1, day: 1, voteRound: "first" },
    ownSeat: 2,
    ownRole: "villager",
    ownFaction: "good_team",
    alivePlayers: [],
    deadPlayers: [],
    publicEvents: [],
    privateEvents: [],
    speeches: [],
    votes: [],
    legalActions: [
      {
        actionType: "vote",
        actorId: "ai-1",
        legalTargets: ["ai-3", "human-1"],
        allowAbstain: true,
        required: true,
      },
    ],
    canAct: true,
    ...overrides,
  };
}

const configured: ProxyConfig = {
  baseUrl: "https://llm.example/v1",
  apiKey: "secret-key-123",
  model: "gpt-5.5",
  wireApi: "chat",
  timeoutMs: 30_000,
  configured: true,
};

function chatResponse(content: string): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
    text: async () => content,
  } as unknown as Response;
}

function voteRequest(vi = fakeVi()) {
  return {
    gameId: "g-1",
    taskType: "vote" as const,
    playerId: "ai-1",
    visibleInformation: vi,
  };
}

describe("handleAiRespond", () => {
  it("adopts a valid LLM JSON payload via chat wire format", async () => {
    const fetchImpl = vi.fn(async () =>
      chatResponse(JSON.stringify({ choiceType: "target", targetId: "ai-3" })),
    );

    const result = await handleAiRespond(voteRequest(), configured, fetchImpl as unknown as typeof fetch);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.choiceType).toBe("target");
      expect(result.data.targetId).toBe("ai-3");
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://llm.example/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer secret-key-123",
    );
  });

  it("tolerates ```json code-fenced output", async () => {
    const fetchImpl = vi.fn(async () =>
      chatResponse("```json\n{ \"choiceType\": \"abstain\" }\n```"),
    );

    const result = await handleAiRespond(voteRequest(), configured, fetchImpl as unknown as typeof fetch);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.choiceType).toBe("abstain");
    }
  });

  it("returns AI_JSON_INVALID when LLM output is not valid JSON", async () => {
    const fetchImpl = vi.fn(async () => chatResponse("抱歉我不会"));

    const result = await handleAiRespond(voteRequest(), configured, fetchImpl as unknown as typeof fetch);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("AI_JSON_INVALID");
    }
  });

  it("returns AI_JSON_INVALID when payload violates the contract", async () => {
    const fetchImpl = vi.fn(async () =>
      chatResponse(JSON.stringify({ choiceType: "bogus" })),
    );

    const result = await handleAiRespond(voteRequest(), configured, fetchImpl as unknown as typeof fetch);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("AI_JSON_INVALID");
    }
  });

  it("maps an aborted (slow) request to AI_TIMEOUT", async () => {
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        }),
    );

    const result = await handleAiRespond(
      voteRequest(),
      { ...configured, timeoutMs: 5 },
      fetchImpl as unknown as typeof fetch,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("AI_TIMEOUT");
      expect(result.error.retryable).toBe(true);
    }
  });

  it("maps a network failure to AI_UNAVAILABLE", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });

    const result = await handleAiRespond(voteRequest(), configured, fetchImpl as unknown as typeof fetch);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("AI_UNAVAILABLE");
    }
  });

  it("returns AI_UNAVAILABLE without calling the LLM when unconfigured", async () => {
    const fetchImpl = vi.fn();
    const result = await handleAiRespond(
      voteRequest(),
      { ...configured, configured: false, apiKey: "", baseUrl: "" },
      fetchImpl as unknown as typeof fetch,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("AI_UNAVAILABLE");
      expect(result.error.source).toBe("ai_proxy");
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a malformed request body with INVALID_ACTION", async () => {
    const fetchImpl = vi.fn();
    const result = await handleAiRespond({ taskType: "vote" }, configured, fetchImpl as unknown as typeof fetch);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_ACTION");
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses the responses wire format and endpoint when configured", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ output_text: JSON.stringify({ text: "我赞同" }) }),
      text: async () => "",
    }) as unknown as Response);

    const result = await handleAiRespond(
      { gameId: "g-1", taskType: "speech", playerId: "ai-1", visibleInformation: fakeVi() },
      { ...configured, wireApi: "responses" },
      fetchImpl as unknown as typeof fetch,
    );

    expect(result.ok).toBe(true);
    const [url] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://llm.example/v1/responses");
  });
});

describe("buildPrompt (ISO-001: 只含可见信息)", () => {
  it("embeds the viewer's visibleInformation and nothing more for in-game tasks", () => {
    const vi = fakeVi();
    const prompt = buildPrompt(voteRequest(vi));

    // user 段精确等于该 viewer 的可见信息序列化，证明没有注入其它真相。
    expect(prompt.user).toContain(JSON.stringify(vi, null, 2));
    // system 段只描述自己的身份，不出现任何其他玩家的真实身份字段。
    expect(prompt.system).toContain("村民");
    expect(prompt.system).not.toMatch(/狼人是|预言家是/);
  });

  it("does not leak the api key into the prompt", () => {
    const prompt = buildPrompt(voteRequest());
    expect(prompt.system + prompt.user).not.toContain("secret-key-123");
  });

  it("builds a review prompt from questionText + reviewContext only", () => {
    const prompt = buildPrompt({
      gameId: "g-1",
      taskType: "review_question",
      questionText: "你为什么投我？",
      reviewContext: { winner: "good_team" },
    });

    expect(prompt.user).toContain("你为什么投我？");
    expect(prompt.user).toContain("good_team");
  });
});
