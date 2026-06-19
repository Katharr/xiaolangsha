import { describe, expect, it } from "vitest";

import type { VisibleInformationSnapshot } from "../shared";
import { aiTaskPayloadSchema } from "../shared";

import { ScriptedAiClient } from "./scriptedAi";
import type { AiTaskRequest } from "./types";

const ai = new ScriptedAiClient();

function baseVi(
  overrides: Partial<VisibleInformationSnapshot>,
): VisibleInformationSnapshot {
  return {
    gameId: "free-test",
    viewerId: "ai-1",
    generatedAtSeq: 10,
    gamePhase: "night_action",
    round: { night: 1, day: 0, voteRound: "none" },
    ownSeat: 1,
    ownRole: "werewolf",
    ownFaction: "werewolf_team",
    alivePlayers: [],
    deadPlayers: [],
    publicEvents: [],
    privateEvents: [],
    speeches: [],
    votes: [],
    legalActions: [],
    canAct: true,
    ...overrides,
  };
}

async function expectOkPayload(req: AiTaskRequest) {
  const result = await ai.respond(req);
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  // 输出永远是合法的 AiTaskPayload。
  expect(aiTaskPayloadSchema.safeParse(result.data).success).toBe(true);
  return result.data;
}

describe("ScriptedAiClient", () => {
  it("picks a legal werewolf target deterministically", async () => {
    const vi = baseVi({
      ownRole: "werewolf",
      ownFaction: "werewolf_team",
      legalActions: [
        {
          actionType: "werewolf_kill",
          actorId: "ai-1",
          legalTargets: ["ai-3", "ai-4", "ai-2"],
          allowAbstain: false,
          required: true,
        },
      ],
    });
    const req: AiTaskRequest = {
      gameId: "free-test",
      taskType: "night_action",
      playerId: "ai-1",
      visibleInformation: vi,
    };

    const first = await expectOkPayload(req);
    const second = await expectOkPayload(req);

    expect(first.actionType).toBe("werewolf_kill");
    expect(["ai-3", "ai-4", "ai-2"]).toContain(first.targetId);
    // 同一请求确定性可复现。
    expect(second).toEqual(first);
  });

  it("votes a legal candidate (never itself)", async () => {
    const vi = baseVi({
      gamePhase: "vote",
      ownRole: "villager",
      ownFaction: "good_team",
      legalActions: [
        {
          actionType: "vote",
          actorId: "ai-1",
          legalTargets: ["ai-2", "human-1"],
          allowAbstain: true,
          required: true,
        },
      ],
    });

    const payload = await expectOkPayload({
      gameId: "free-test",
      taskType: "vote",
      playerId: "ai-1",
      visibleInformation: vi,
    });

    expect(payload.choiceType).toBe("target");
    expect(["ai-2", "human-1"]).toContain(payload.targetId);
    expect(payload.targetId).not.toBe("ai-1");
  });

  it("lets a seer vote a player it privately confirmed as a werewolf", async () => {
    const vi = baseVi({
      viewerId: "seer-1",
      gamePhase: "vote",
      ownRole: "seer",
      ownFaction: "good_team",
      privateEvents: [
        {
          eventId: "e-seer",
          seq: 5,
          type: "night_action_resolved",
          phase: "night_action",
          round: { night: 1, day: 0, voteRound: "none" },
          payload: {
            actionType: "seer_check",
            targetId: "wolf-1",
            result: {
              kind: "seer_check_result",
              targetId: "wolf-1",
              factionResult: "werewolf_team",
            },
          },
        },
      ],
      legalActions: [
        {
          actionType: "vote",
          actorId: "seer-1",
          legalTargets: ["wolf-1", "villager-2"],
          allowAbstain: true,
          required: true,
        },
      ],
    });

    const payload = await expectOkPayload({
      gameId: "free-test",
      taskType: "vote",
      playerId: "seer-1",
      visibleInformation: vi,
    });

    expect(payload.choiceType).toBe("target");
    expect(payload.targetId).toBe("wolf-1");
  });

  it("produces non-empty text for speech / tie_speech / last_words", async () => {
    for (const taskType of ["speech", "tie_speech", "last_words"] as const) {
      const payload = await expectOkPayload({
        gameId: "free-test",
        taskType,
        playerId: "ai-1",
        visibleInformation: baseVi({ gamePhase: "day_speech" }),
      });
      expect((payload.text ?? "").length).toBeGreaterThan(0);
    }
  });

  it("answers review questions from the question text alone", async () => {
    const result = await ai.respond({
      gameId: "free-test",
      taskType: "review_question",
      questionText: "为什么放逐我？",
      reviewContext: { anything: true },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.data.text ?? "").length).toBeGreaterThan(0);
    }
  });
});
