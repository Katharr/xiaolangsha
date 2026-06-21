import { describe, expect, it, vi } from "vitest";

import { ScriptedAiClient, withFallback, type AiClient } from "../ai-client";
import { applyAction, type RuleEngineSuccess } from "../rules";
import type {
  ActiveVoteRound,
  GameAction,
  GameSession,
  GameSnapshot,
  Result,
  Role,
  VoteChoiceType,
} from "../shared";
import { err, ok } from "../shared";

import {
  isAbnormalHalt,
  nextDriverStep,
  runAiDriver,
  type DriverHalt,
  type DriverState,
} from "./driver";

const boardId = "mvp_5p_wolf_seer_3villagers";
const humanPlayerId = "human-1";
const now = "2026-06-19T12:00:00.000Z";

function expectOk(result: Result<RuleEngineSuccess>): RuleEngineSuccess {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.data;
}

function apply(state: DriverState, action: GameAction): Result<RuleEngineSuccess> {
  return applyAction(action, {
    session: state.session,
    snapshot: state.snapshot,
    events: state.events,
    now,
  });
}

function step(state: DriverState, action: GameAction): DriverState {
  const result = expectOk(apply(state, action));
  return {
    session: result.session,
    snapshot: result.snapshot,
    events: [...state.events, ...result.events],
  };
}

function playerIdByRole(snapshot: GameSnapshot, role: Role): string {
  const aiPlayer = snapshot.players.find(
    (player) => player.role === role && !player.isHuman,
  );
  return aiPlayer?.playerId ?? "";
}

/** create → 真人选民身份 → 揭示，停在 night_action（狼+预言家均为 AI）。 */
function reachNight(): DriverState {
  const created = expectOk(
    applyAction(
      {
        type: "create_game",
        idempotencyKey: "drv-create",
        mode: "free",
        boardId,
        humanPlayerId,
      },
      { now },
    ),
  );
  let state: DriverState = {
    session: created.session,
    snapshot: created.snapshot,
    events: created.events,
  };

  state = step(state, {
    type: "confirm_role_setup",
    idempotencyKey: "drv-setup",
    playerId: humanPlayerId,
    selectedRole: "villager",
  });
  state = step(state, {
    type: "confirm_role_reveal",
    idempotencyKey: "drv-reveal",
    playerId: humanPlayerId,
  });

  expect(state.snapshot.gamePhase).toBe("night_action");
  return state;
}

function castVote(
  state: DriverState,
  voterId: string,
  voteRound: ActiveVoteRound,
  choiceType: VoteChoiceType,
  targetId?: string,
): DriverState {
  return step(state, {
    type: "submit_vote",
    idempotencyKey: `drv-vote-${voteRound}-${voterId}`,
    voterId,
    voteRound,
    choiceType,
    ...(targetId ? { targetId } : {}),
  });
}

/** 手动把真人放逐掉，到达夜 2 的 dead_spectating。 */
function reachHumanDeadSpectating(): DriverState {
  let state = reachNight();
  const wolfId = playerIdByRole(state.snapshot, "werewolf");
  const seerId = playerIdByRole(state.snapshot, "seer");
  const killedVillagerId =
    state.snapshot.players.find(
      (player) => player.role === "villager" && !player.isHuman,
    )?.playerId ?? "";

  state = step(state, {
    type: "submit_night_action",
    idempotencyKey: "drv-wolf-kill",
    actorId: wolfId,
    actionType: "werewolf_kill",
    targetId: killedVillagerId,
  });
  state = step(state, {
    type: "submit_night_action",
    idempotencyKey: "drv-seer-check",
    actorId: seerId,
    actionType: "seer_check",
    targetId: wolfId,
  });

  expect(state.snapshot.gamePhase).toBe("day_announcement");
  state = step(state, {
    type: "confirm_day_announcement",
    idempotencyKey: "drv-confirm-day",
    playerId: humanPlayerId,
  });

  const speakerOrder = state.snapshot.speechState?.speakerOrder ?? [];
  for (const speakerId of speakerOrder) {
    state = step(state, {
      type: "submit_speech",
      idempotencyKey: `drv-speech-${speakerId}`,
      speakerId,
      text: `${speakerId} 的发言。`,
    });
  }

  // 让所有存活 AI 投真人，真人投狼 → 真人被放逐。
  const voters = state.snapshot.voteState?.eligibleVoterIds ?? [];
  for (const voterId of voters) {
    if (voterId === humanPlayerId) {
      state = castVote(state, voterId, "first", "target", wolfId);
    } else {
      state = castVote(state, voterId, "first", "target", humanPlayerId);
    }
  }

  expect(state.snapshot.gamePhase).toBe("exile_last_words");
  state = step(state, {
    type: "submit_last_words",
    idempotencyKey: "drv-human-last-words",
    speakerId: humanPlayerId,
    text: "替我报仇。",
  });

  expect(state.snapshot.humanParticipationState).toBe("dead_spectating");
  expect(state.snapshot.players.find((p) => p.isHuman)?.alive).toBe(false);
  return state;
}

describe("runAiDriver", () => {
  it("drives the AI night actions then stops for the alive human", async () => {
    const ai = new ScriptedAiClient();
    const spy = vi.spyOn(ai, "respond");

    const driven = await runAiDriver(reachNight(), {
      ai,
      humanPlayerId,
      now,
    });

    // 两个 AI 夜晚行动跑完，停在需要真人确认的天亮播报。
    expect(driven.snapshot.gamePhase).toBe("day_announcement");
    expect(spy).toHaveBeenCalledTimes(2);

    // ISO-001：AI 只拿到 visibleInformation，且视角就是它自己；不含真相字段。
    for (const call of spy.mock.calls) {
      const request = call[0];
      expect(Object.keys(request).sort()).toEqual(
        ["gameId", "playerId", "taskType", "visibleInformation"].sort(),
      );
      expect(request).not.toHaveProperty("snapshot");
      expect(request).not.toHaveProperty("events");
      if (request.taskType !== "review_question") {
        expect(request.visibleInformation.viewerId).toBe(request.playerId);
      }
    }
  });

  it("auto-advances a dead spectating human all the way to review", async () => {
    const ai = new ScriptedAiClient();
    const state = reachHumanDeadSpectating();
    // 出局即旁观：无需任何「快进」动作，driver 自动接管推进。
    expect(state.snapshot.humanParticipationState).toBe("dead_spectating");

    const driven = await runAiDriver(state, { ai, humanPlayerId, now });

    expect(driven.snapshot.gamePhase).toBe("review");
    expect(driven.session.status).toBe("ended");
    expect(driven.snapshot.winner).toBeDefined();
    // 真人始终未被分配 pendingAction。
    expect(driven.snapshot.pendingAction ?? null).toBeNull();
  });

  it("stops driving immediately when cancelled (e.g. human restarts mid-spectate)", async () => {
    const ai = new ScriptedAiClient();
    const spy = vi.spyOn(ai, "respond");
    const state = reachHumanDeadSpectating();

    const driven = await runAiDriver(state, {
      ai,
      humanPlayerId,
      now,
      isCancelled: () => true,
    });

    // 一上来就被作废：不调用 AI、不推进，原样返回。
    expect(spy).not.toHaveBeenCalled();
    expect(driven.snapshot.gamePhase).toBe(state.snapshot.gamePhase);
    expect(driven.events).toBe(state.events);
  });

  it("keeps the game running when the primary AI fails (scripted fallback)", async () => {
    const failing: AiClient = {
      async respond() {
        return err({
          code: "AI_UNAVAILABLE",
          message: "primary down",
          retryable: true,
          source: "ai_client",
        });
      },
    };
    const ai = withFallback(failing, new ScriptedAiClient());

    const driven = await runAiDriver(reachNight(), { ai, humanPlayerId, now });

    // 主 AI 全挂，仍靠脚本兜底跑完夜晚到达天亮播报。
    expect(driven.snapshot.gamePhase).toBe("day_announcement");
    expect(driven.snapshot.nightState?.resolved).toBe(true);
  });

  it("degrades to a safe scripted action when the AI returns an illegal action (不卡死)", async () => {
    const scripted = new ScriptedAiClient();
    // 第一个夜晚行动（狼刀）返回一个不存在的目标——语法合法、规则非法；其余照常走脚本。
    let firstNightActionSeen = false;
    const rogue: AiClient = {
      async respond(req) {
        if (req.taskType === "night_action" && !firstNightActionSeen) {
          firstNightActionSeen = true;
          return ok({ actionType: "werewolf_kill", targetId: "ghost-nonexistent" });
        }
        return scripted.respond(req);
      },
    };
    const degrades: Array<{ actorId: string; taskType: string }> = [];
    const halts: DriverHalt[] = [];

    const driven = await runAiDriver(reachNight(), {
      ai: rogue,
      humanPlayerId,
      now,
      onDegrade: ({ actorId, taskType }) => degrades.push({ actorId, taskType }),
      onHalt: (h) => halts.push(h),
    });

    // 非法狼刀被规则拒绝 → 脚本安全动作顶上 → 夜晚照常结算到天亮播报，不卡死。
    expect(driven.snapshot.gamePhase).toBe("day_announcement");
    expect(driven.snapshot.nightState?.resolved).toBe(true);
    expect(degrades).toHaveLength(1);
    expect(degrades[0]?.taskType).toBe("night_action");
    // 不是异常停止。
    expect(halts.at(-1)?.reason).toBe("idle");
    expect(isAbnormalHalt(halts.at(-1) ?? null)).toBe(false);
  });

  it("onHalt reports idle when stopping for the alive human (正常等真人，非异常)", async () => {
    const ai = new ScriptedAiClient();
    const halts: DriverHalt[] = [];

    await runAiDriver(reachNight(), {
      ai,
      humanPlayerId,
      now,
      onHalt: (h) => halts.push(h),
    });

    expect(halts.at(-1)).toEqual({ reason: "idle", phase: "day_announcement" });
    expect(isAbnormalHalt(halts.at(-1) ?? null)).toBe(false);
  });

  it("onHalt reports ai_error when the AI fails with no fallback (异常卡住)", async () => {
    const failing: AiClient = {
      async respond() {
        return err({
          code: "AI_UNAVAILABLE",
          message: "primary down",
          retryable: true,
          source: "ai_client",
        });
      },
    };
    const halts: DriverHalt[] = [];

    const driven = await runAiDriver(reachNight(), {
      ai: failing,
      humanPlayerId,
      now,
      onHalt: (h) => halts.push(h),
    });

    // 无兜底 → 停在首夜未结算，halt 标为 ai_error（异常）。
    expect(driven.snapshot.gamePhase).toBe("night_action");
    expect(halts.at(-1)?.reason).toBe("ai_error");
    expect(isAbnormalHalt(halts.at(-1) ?? null)).toBe(true);
  });

  it("nextDriverStep stops at terminal/setup phases", () => {
    const base = reachNight();
    // night：第一个 AND AI 夜晚行动。
    const stepAtNight = nextDriverStep(base, humanPlayerId);
    expect(stepAtNight?.kind).toBe("ai");

    // review/ended：不再驱动。
    const ended: DriverState = {
      ...base,
      session: { ...base.session, status: "ended" } as GameSession,
      snapshot: { ...base.snapshot, gamePhase: "review" } as GameSnapshot,
    };
    expect(nextDriverStep(ended, humanPlayerId)).toBeNull();
  });
});
