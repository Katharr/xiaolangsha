import { describe, expect, it } from "vitest";

import { STANDARD_7P_BOARD_ID } from "../rules/boards";
import { applyAction, type RuleEngineSuccess } from "../rules";
import type {
  GameAction,
  GameSession,
  GameSnapshot,
  Player,
  Result,
  TruthEvent,
} from "../shared";

import { buildDebugSummary } from "./debugSummary";
import type { DriverHalt } from "./driver";

const boardId = STANDARD_7P_BOARD_ID;
const humanPlayerId = "human-1";
const now = "2026-06-19T00:00:00.000Z";

type State = { session: GameSession; snapshot: GameSnapshot; events: TruthEvent[] };

function expectOk(result: Result<RuleEngineSuccess>): RuleEngineSuccess {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.data;
}

let keyCounter = 0;
const key = (prefix: string) => `${prefix}-${(keyCounter += 1)}`;

function step(state: State, action: GameAction): State {
  const data = expectOk(
    applyAction(action, {
      session: state.session,
      snapshot: state.snapshot,
      events: state.events,
      now,
    }),
  );
  return {
    session: data.session,
    snapshot: data.snapshot,
    events: [...state.events, ...data.events],
  };
}

/** 开 7 人标准局，真人选村民，推进到首夜 night_action（当前步=狼步，狼均为 AI、未提交）。 */
function reachFirstNight(): State {
  const created = expectOk(
    applyAction(
      {
        type: "create_game",
        idempotencyKey: key("create"),
        mode: "free",
        boardId,
        humanPlayerId,
      },
      { now },
    ),
  );
  let state: State = {
    session: created.session,
    snapshot: created.snapshot,
    events: created.events,
  };
  state = step(state, {
    type: "confirm_role_setup",
    idempotencyKey: key("setup"),
    playerId: humanPlayerId,
    selectedRole: "villager",
  });
  state = step(state, {
    type: "confirm_role_reveal",
    idempotencyKey: key("reveal"),
    playerId: humanPlayerId,
  });
  expect(state.snapshot.gamePhase).toBe("night_action");
  return state;
}

function idsByRole(snapshot: GameSnapshot, role: Player["role"]): string[] {
  return snapshot.players
    .filter((p) => p.role === role)
    .map((p) => p.playerId);
}

describe("buildDebugSummary", () => {
  it("夜晚卡住：标出当前步、未提交的 AI 狼、身份真相、异常诊断", () => {
    const state = reachFirstNight();
    const [wolf1] = idsByRole(state.snapshot, "werewolf");
    const diagnostics: DriverHalt = {
      reason: "ai_error",
      actorId: wolf1,
      taskType: "night_action",
      error: {
        code: "AI_UNAVAILABLE",
        message: "primary down",
        userMessage: "AI 调用超时",
        retryable: true,
        source: "ai_client",
      },
    };

    const summary = buildDebugSummary({
      exportedAt: now,
      session: state.session,
      snapshot: state.snapshot,
      events: state.events,
      diagnostics,
      lastError: null,
    });

    // 四块齐全。
    expect(summary).toContain("【当前状态】");
    expect(summary).toContain("【卡点分析】");
    expect(summary).toContain("【身份真相】");
    expect(summary).toContain("【时间线】");

    // 卡点分析：首夜狼步、有未出手的 AI 狼、标了「卡在这」。
    expect(summary).toContain("狼人行动");
    expect(summary).toContain("卡在这");
    expect(summary).toContain("（AI·狼人）");

    // 身份真相含 7 人标准局全部角色。
    for (const role of ["狼人", "村民", "预言家", "女巫", "猎人"]) {
      expect(summary).toContain(role);
    }

    // 异常诊断带 ⚠️ + 透传 userMessage。
    expect(summary).toContain("⚠️ AI 行动失败");
    expect(summary).toContain("AI 调用超时");

    // 时间线至少有「对局创建」。
    expect(summary).toContain("对局创建");
  });

  it("时间线还原狼刀归属与查验结果", () => {
    let state = reachFirstNight();
    const [wolf1, wolf2] = idsByRole(state.snapshot, "werewolf");
    const seer = idsByRole(state.snapshot, "seer")[0];
    const victim = state.snapshot.players.find(
      (p) => p.role === "villager" && !p.isHuman,
    )!.playerId;

    // 两狼刀同一村民 → 推进到预言家步。
    state = step(state, {
      type: "submit_night_action",
      idempotencyKey: key("w1"),
      actorId: wolf1,
      actionType: "werewolf_kill",
      targetId: victim,
    });
    state = step(state, {
      type: "submit_night_action",
      idempotencyKey: key("w2"),
      actorId: wolf2,
      actionType: "werewolf_kill",
      targetId: victim,
    });
    // 预言家查验狼1。
    state = step(state, {
      type: "submit_night_action",
      idempotencyKey: key("seer"),
      actorId: seer,
      actionType: "seer_check",
      targetId: wolf1,
    });
    // 女巫放弃用药 → 夜晚结算（此时才会产出狼刀 night_action_resolved 含 wolfVotes）。
    const witch = idsByRole(state.snapshot, "witch")[0];
    state = step(state, {
      type: "submit_witch_action",
      idempotencyKey: key("witch"),
      actorId: witch,
      witchChoice: "skip",
    });
    expect(state.snapshot.gamePhase).toBe("day_announcement");

    const summary = buildDebugSummary({
      exportedAt: now,
      session: state.session,
      snapshot: state.snapshot,
      events: state.events,
      diagnostics: { reason: "idle", phase: state.snapshot.gamePhase },
      lastError: null,
    });

    // 狼刀归属（狼队 + 击杀目标）与刀票。
    expect(summary).toContain("狼队（");
    expect(summary).toContain("击杀");
    expect(summary).toContain("刀票：");
    // 预言家查验结果（狼1 → 狼人）。
    expect(summary).toContain("查验");
    expect(summary).toContain("→ 狼人");
    // 非终局的 win_checked（夜晚结算后必发）不入时间线，不再出现「胜负判定：未知获胜」。
    expect(summary).not.toContain("未知获胜");
    expect(summary).not.toContain("胜负判定");
    // 正常诊断不带 ⚠️。
    expect(summary).not.toContain("⚠️");
  });
});
