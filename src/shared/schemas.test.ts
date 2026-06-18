import { describe, expect, it } from "vitest";

import {
  aiTaskResponseSchema,
  appErrorSchema,
  ruleEngineResultSchema,
  gameActionSchema,
  resultSchema,
} from "./schemas";

describe("P9-S02 shared schemas", () => {
  it("accepts standard Result success and failure envelopes", () => {
    const success = resultSchema(appErrorSchema).safeParse({
      ok: true,
      data: {
        code: "INVALID_ACTION",
        message: "not used by callers, but valid as generic data",
        retryable: false,
        source: "app",
      },
    });
    const failure = resultSchema(appErrorSchema).safeParse({
      ok: false,
      error: {
        code: "INVALID_ACTION",
        message: "Action is invalid.",
        retryable: false,
        source: "rules",
      },
    });

    expect(success.success).toBe(true);
    expect(failure.success).toBe(true);
  });

  it("rejects malformed Result and AppError envelopes", () => {
    expect(resultSchema(appErrorSchema).safeParse({ ok: true }).success).toBe(
      false,
    );
    expect(resultSchema(appErrorSchema).safeParse({ ok: false }).success).toBe(
      false,
    );
    expect(
      resultSchema(appErrorSchema).safeParse({
        ok: true,
        data: {
          code: "INVALID_ACTION",
          message: "Action is invalid.",
          retryable: false,
          source: "rules",
        },
        error: {
          code: "INVALID_ACTION",
          message: "Mixed envelope.",
          retryable: false,
          source: "rules",
        },
      }).success,
    ).toBe(false);
    expect(
      appErrorSchema.safeParse({
        code: "NOT_A_PROJECT_ERROR",
        message: "Bad error code.",
        retryable: false,
        source: "rules",
      }).success,
    ).toBe(false);
    expect(
      appErrorSchema.safeParse({
        code: "INVALID_ACTION",
        message: "Bad source.",
        retryable: false,
        source: "ui",
      }).success,
    ).toBe(false);
  });

  it("accepts valid GameAction variants with idempotency keys", () => {
    const createGame = gameActionSchema.safeParse({
      type: "create_game",
      idempotencyKey: "create-1",
      mode: "standard",
      boardId: "mvp_5p_wolf_seer_3villagers",
      humanPlayerId: "p1",
    });
    const submitVote = gameActionSchema.safeParse({
      type: "submit_vote",
      idempotencyKey: "vote-1",
      voterId: "p1",
      voteRound: "first",
      choiceType: "target",
      targetId: "p2",
    });
    const abstainVote = gameActionSchema.safeParse({
      type: "submit_vote",
      idempotencyKey: "vote-2",
      voterId: "p1",
      voteRound: "tie_break",
      choiceType: "abstain",
    });

    expect(createGame.success).toBe(true);
    expect(submitVote.success).toBe(true);
    expect(abstainVote.success).toBe(true);
  });

  it("rejects invalid GameAction variants", () => {
    expect(
      gameActionSchema.safeParse({
        type: "confirm_role_reveal",
        playerId: "p1",
      }).success,
    ).toBe(false);
    expect(
      gameActionSchema.safeParse({
        type: "create_game",
        idempotencyKey: "create-1",
        mode: "chaos",
        boardId: "mvp_5p_wolf_seer_3villagers",
        humanPlayerId: "p1",
      }).success,
    ).toBe(false);
    expect(
      gameActionSchema.safeParse({
        type: "submit_vote",
        idempotencyKey: "vote-3",
        voterId: "p1",
        voteRound: "first",
        choiceType: "target",
      }).success,
    ).toBe(false);
    expect(
      gameActionSchema.safeParse({
        type: "confirm_role_reveal",
        idempotencyKey: "",
        playerId: "p1",
      }).success,
    ).toBe(false);
    expect(
      gameActionSchema.safeParse({
        type: "submit_vote",
        idempotencyKey: "vote-4",
        voterId: "p1",
        voteRound: "first",
        choiceType: "abstain",
        targetId: "p2",
      }).success,
    ).toBe(false);
  });

  it("rejects malformed rule engine result snapshots", () => {
    const malformedSnapshot = ruleEngineResultSchema.safeParse({
      ok: true,
      data: {
        events: [],
        snapshot: {
          gameId: "g1",
          lastEventSeq: 0,
          gamePhase: "impossible_phase",
          humanParticipationState: "alive",
          round: { night: 0, day: 0, voteRound: "none" },
          players: [],
        },
        visibleInformation: {
          gameId: "g1",
          viewerId: "p1",
          generatedAtSeq: 0,
          gamePhase: "mode_select",
          round: { night: 0, day: 0, voteRound: "none" },
          ownSeat: 1,
          ownRole: "villager",
          ownFaction: "good_team",
          alivePlayers: [],
          deadPlayers: [],
          publicEvents: [],
          privateEvents: [],
          speeches: [],
          votes: [],
          legalActions: [],
          canAct: false,
        },
      },
    });

    expect(malformedSnapshot.success).toBe(false);
  });

  it("accepts standard AI response envelopes and rejects invalid choices", () => {
    expect(
      aiTaskResponseSchema.safeParse({
        ok: true,
        data: {
          text: "我先听大家发言。",
          choiceType: "abstain",
          decisionSummary: "No strong target.",
        },
      }).success,
    ).toBe(true);
    expect(
      aiTaskResponseSchema.safeParse({
        ok: true,
        data: {
          choiceType: "skip",
        },
      }).success,
    ).toBe(false);
  });
});
