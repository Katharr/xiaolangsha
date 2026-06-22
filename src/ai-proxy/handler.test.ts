import { describe, expect, it, vi } from "vitest";

import type { VisibleInformationSnapshot } from "../shared";

import type { ProxyConfig } from "./config";
import { handleAiRespond } from "./handler";
import { buildPrompt } from "./prompt";

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
    ownName: "阿杰",
    ownRole: "villager",
    ownFaction: "good_team",
    teammates: [],
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
  models: { speech: "gpt-5.4", reasoning: "gpt-5.5", review: "gpt-5.5" },
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

  it("按任务三档选模型：发言→speech、投票→reasoning、复盘→review", async () => {
    const fetchImpl = vi.fn(async () =>
      chatResponse(JSON.stringify({ text: "ok" })),
    );

    await handleAiRespond(
      { gameId: "g-1", taskType: "speech", playerId: "ai-1", visibleInformation: fakeVi() },
      configured,
      fetchImpl as unknown as typeof fetch,
    );
    await handleAiRespond(voteRequest(), configured, fetchImpl as unknown as typeof fetch);
    await handleAiRespond(
      {
        gameId: "g-1",
        taskType: "review_question",
        questionText: "你晚上为什么刀我？",
        reviewContext: { foo: "bar" },
      },
      configured,
      fetchImpl as unknown as typeof fetch,
    );

    const bodyOf = (call: number) =>
      JSON.parse((fetchImpl.mock.calls[call] as unknown as [string, RequestInit])[1].body as string);
    // 发言走快档 gpt-5.4；投票走推理强档 gpt-5.5；复盘走 gpt-5.5。url/key 共用同一端点。
    expect(bodyOf(0).model).toBe("gpt-5.4");
    expect(bodyOf(1).model).toBe("gpt-5.5");
    expect(bodyOf(2).model).toBe("gpt-5.5");
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

  it("injects a name-bound persona, and different names get different system prompts", () => {
    const jie = buildPrompt(voteRequest(fakeVi({ ownName: "阿杰" })));
    const zhang = buildPrompt(voteRequest(fakeVi({ ownName: "老张" })));

    // 注入了「你的性格：…」一行。
    expect(jie.system).toContain("你的性格：");
    // 名字不同 → 性格不同 → system 段不同（锁定「名字绑性格」）。
    expect(jie.system).not.toBe(zhang.system);
  });

  it("injects a name-bound judgment disposition (反趋同：判断层面就分歧)", () => {
    const jie = buildPrompt(voteRequest(fakeVi({ ownName: "阿杰" })));
    const zhang = buildPrompt(voteRequest(fakeVi({ ownName: "老张" })));

    // 注入了「你判断局面的倾向：…」一行。
    expect(jie.system).toContain("你判断局面的倾向：");
    // 名字不同 → 倾向不同 → 倾向那一行的内容不同。
    const dispLine = (system: string) =>
      system.split("\n").find((line) => line.startsWith("你判断局面的倾向："));
    expect(dispLine(jie.system)).not.toBe(dispLine(zhang.system));
  });

  it("speech 指令：松散群聊 + 反复读 + 给情绪口头禅许可", () => {
    const prompt = buildPrompt({
      gameId: "g-1",
      taskType: "speech",
      playerId: "ai-1",
      visibleInformation: fakeVi(),
    });
    // 松散：像群里聊天，挑最在意的点，不用面面俱到（拆掉旧的三段论模板）。
    expect(prompt.system).toContain("不用面面俱到");
    // 反复读：别人讲过的别换个说法复读。
    expect(prompt.system).toContain("别换个说法复读");
    // 给口头禅/情绪许可（治死板刻意）。
    expect(prompt.system).toContain("口头禅");
    // 仍守座位去偏见。
    expect(prompt.system).toContain("别按座位顺序");
  });

  it("gives the same persona for the same name across calls (stable)", () => {
    const a = buildPrompt(voteRequest(fakeVi({ ownName: "囡囡" })));
    const b = buildPrompt(voteRequest(fakeVi({ ownName: "囡囡" })));
    expect(a.system).toBe(b.system);
  });

  it("uses a casual, non-report speech instruction", () => {
    const prompt = buildPrompt({
      gameId: "g-1",
      taskType: "speech",
      playerId: "ai-1",
      visibleInformation: fakeVi(),
    });
    // 去掉了旧的「有逻辑、贴合阵营利益」分析腔。
    expect(prompt.system).not.toContain("有逻辑、贴合");
    expect(prompt.system).toContain("像真人那样自然");
  });

  it("injects the private-reasoning baseline (analysisSummary/decisionSummary) for in-game tasks", () => {
    const prompt = buildPrompt(voteRequest());
    expect(prompt.system).toContain("analysisSummary");
    expect(prompt.system).toContain("decisionSummary");
    // 反跟风纪律：票数不是证据。
    expect(prompt.system).toContain("票数本身不是证据");
  });

  it("gives the vote task anti-bandwagon / counter-claim / consistency guidance", () => {
    const prompt = buildPrompt(voteRequest());
    expect(prompt.system).toContain("对跳");
    expect(prompt.system).toContain("话少");
    expect(prompt.system).toContain("保持一致");
    // 发言-投票一致绑定（治「嘴上盯 A、票投 B」言行不一）。
    expect(prompt.system).toContain("言行不一");
    // 候选顺序去偏见提示。
    expect(prompt.system).toContain("不代表任何倾向");
    // 仍不得泄漏其他玩家真实身份的断言式措辞。
    expect(prompt.system).not.toMatch(/狼人是|预言家是/);
  });

  it("shuffles candidate order deterministically (same vi → identical system)", () => {
    const vi = fakeVi({
      legalActions: [
        {
          actionType: "vote",
          actorId: "ai-1",
          legalTargets: ["ai-3", "ai-4", "ai-5", "human-1"],
          allowAbstain: true,
          required: true,
        },
      ],
    });
    const a = buildPrompt(voteRequest(vi));
    const b = buildPrompt(voteRequest(vi));
    expect(a.system).toBe(b.system);
  });

  it("de-biases position by varying candidate order across seats", () => {
    const legalActions = [
      {
        actionType: "vote" as const,
        actorId: "ai-1",
        legalTargets: ["ai-3", "ai-4", "ai-5", "ai-6", "human-1"],
        allowAbstain: true,
        required: true,
      },
    ];
    const systems = [1, 2, 3, 4, 5, 6].map(
      (ownSeat) => buildPrompt(voteRequest(fakeVi({ ownSeat, legalActions }))).system,
    );
    // 不同座位（不同洗牌种子）至少产生两种不同的候选排列。
    expect(new Set(systems).size).toBeGreaterThan(1);
  });

  it("keeps analysisSummary optional so scripted fallback (no summaries) stays valid", async () => {
    // 不含 analysisSummary/decisionSummary 的返回仍是合法 payload（证明没误改成 required）。
    const fetchImpl = vi.fn(async () =>
      chatResponse(JSON.stringify({ choiceType: "target", targetId: "ai-3" })),
    );
    const result = await handleAiRespond(
      voteRequest(),
      configured,
      fetchImpl as unknown as typeof fetch,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.analysisSummary).toBeUndefined();
      expect(result.data.decisionSummary).toBeUndefined();
    }
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
