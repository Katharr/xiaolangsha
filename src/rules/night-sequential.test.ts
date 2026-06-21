import { describe, expect, it } from "vitest";

import type {
  GameAction,
  GameSession,
  GameSnapshot,
  Player,
  TruthEvent,
} from "../shared";
import { STANDARD_7P_BOARD_ID } from "./boards";
import { applyAction, type RuleEngineSuccess } from "./index";
import { buildVisibleInformation } from "./visibility";

const boardId = STANDARD_7P_BOARD_ID;
const humanPlayerId = "human-1";

type EngineState = {
  session: GameSession;
  snapshot: GameSnapshot;
  events: TruthEvent[];
};

function expectOk(result: ReturnType<typeof applyAction>): RuleEngineSuccess {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.data;
}

function expectErr(
  result: ReturnType<typeof applyAction>,
  code: "INVALID_ACTION" | "ACTION_NOT_ALLOWED" | "DUPLICATE_SUBMIT",
) {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error("Expected rejection.");
  }
  expect(result.error.code).toBe(code);
}

let keyCounter = 0;
const key = (prefix: string) => `${prefix}-${(keyCounter += 1)}`;

/** 开一局 7 人自由局，真人选村民，推进到首夜的夜晚行动相位。 */
function reachFirstNight(): EngineState {
  const created = expectOk(
    applyAction(
      {
        type: "create_game",
        idempotencyKey: key("create"),
        mode: "free",
        boardId,
        humanPlayerId,
      },
      { now: "2026-06-19T00:00:00.000Z" },
    ),
  );
  const assigned = expectOk(
    applyAction(
      {
        type: "confirm_role_setup",
        idempotencyKey: key("setup"),
        playerId: humanPlayerId,
        selectedRole: "villager",
      },
      { ...created, now: "2026-06-19T00:00:01.000Z" },
    ),
  );
  const assignedEvents = [...created.events, ...assigned.events];
  const started = expectOk(
    applyAction(
      {
        type: "confirm_role_reveal",
        idempotencyKey: key("reveal"),
        playerId: humanPlayerId,
      },
      {
        events: assignedEvents,
        snapshot: assigned.snapshot,
        session: assigned.session,
        now: "2026-06-19T00:00:02.000Z",
      },
    ),
  );
  return {
    session: started.session,
    snapshot: started.snapshot,
    events: [...assignedEvents, ...started.events],
  };
}

function apply(state: EngineState, action: GameAction) {
  return applyAction(action, {
    events: state.events,
    snapshot: state.snapshot,
    session: state.session,
    now: "2026-06-19T00:01:00.000Z",
  });
}

function step(state: EngineState, action: GameAction): EngineState {
  const data = expectOk(apply(state, action));
  return {
    session: data.session,
    snapshot: data.snapshot,
    events: [...state.events, ...data.events],
  };
}

function idsByRole(snapshot: GameSnapshot, role: Player["role"]): string[] {
  return snapshot.players
    .filter((player) => player.role === role)
    .map((player) => player.playerId);
}

function aliveVillagerNotHuman(snapshot: GameSnapshot): string {
  const villager = snapshot.players.find(
    (player) => player.role === "villager" && !player.isHuman && player.alive,
  );
  if (!villager) {
    throw new Error("No AI villager found.");
  }
  return villager.playerId;
}

describe("顺序夜晚 + 女巫 + 屠边", () => {
  it("夜晚按 狼→预→女 顺序行动；两狼多数票决定刀杀目标", () => {
    let state = reachFirstNight();
    const [wolf1, wolf2] = idsByRole(state.snapshot, "werewolf");
    const seer = idsByRole(state.snapshot, "seer")[0];
    const witch = idsByRole(state.snapshot, "witch")[0];
    const victim = aliveVillagerNotHuman(state.snapshot);

    // 当前步骤是狼步：预言家此刻不能行动（信息隔离 + 顺序约束）。
    expect(buildVisibleInformation(seer, state.snapshot, state.events).canAct).toBe(false);
    // 预言家此刻提交查验应被拒（还没轮到 seer 步）。
    expectErr(
      apply(state, {
        type: "submit_night_action",
        idempotencyKey: key("seer-too-early"),
        actorId: seer,
        actionType: "seer_check",
        targetId: wolf1,
      }),
      "ACTION_NOT_ALLOWED",
    );

    // 两只狼都刀 victim → 多数票 victim。
    state = step(state, {
      type: "submit_night_action",
      idempotencyKey: key("wolf1"),
      actorId: wolf1,
      actionType: "werewolf_kill",
      targetId: victim,
    });
    // 第一只狼提交后仍在狼步，第二只狼是当前行动者。
    expect(state.snapshot.nightState?.steps[0]?.submittedActorIds).toEqual([wolf1]);
    expect(state.snapshot.nightState?.currentStepIndex).toBe(0);

    state = step(state, {
      type: "submit_night_action",
      idempotencyKey: key("wolf2"),
      actorId: wolf2,
      actionType: "werewolf_kill",
      targetId: victim,
    });
    // 狼步完成 → 推进到预言家步。
    expect(state.snapshot.nightState?.currentStepIndex).toBe(1);

    state = step(state, {
      type: "submit_night_action",
      idempotencyKey: key("seer"),
      actorId: seer,
      actionType: "seer_check",
      targetId: wolf1,
    });
    // 预言家步完成 → 进入女巫步，女巫收到「谁倒牌」私有提示。
    const witchView = buildVisibleInformation(witch, state.snapshot, state.events);
    const wake = witchView.privateEvents.find(
      (event) =>
        event.type === "night_action_resolved" &&
        (event.payload.result as { kind?: unknown })?.kind === "witch_wake",
    );
    expect((wake?.payload.result as { killedTargetId?: unknown }).killedTargetId).toBe(
      victim,
    );

    // 女巫用解药救下被刀者 → 平安夜，无人死亡。
    state = step(state, {
      type: "submit_witch_action",
      idempotencyKey: key("witch-save"),
      actorId: witch,
      witchChoice: "save",
    });
    expect(state.snapshot.gamePhase).toBe("day_announcement");
    expect(state.snapshot.nightState?.deathPlayerIds).toEqual([]);
    expect(
      state.snapshot.players.find((p) => p.playerId === victim)?.alive,
    ).toBe(true);
    expect(state.snapshot.witchState?.saveAvailable).toBe(false);
  });

  it("狼人能看到狼队友身份；非狼玩家的 teammates 为空", () => {
    const state = reachFirstNight();
    const [wolf1, wolf2] = idsByRole(state.snapshot, "werewolf");
    const seer = idsByRole(state.snapshot, "seer")[0];

    const wolfView = buildVisibleInformation(wolf1, state.snapshot, state.events);
    expect(wolfView.teammates.map((t) => t.playerId)).toEqual([wolf2]);
    expect(wolfView.teammates[0]?.role).toBe("werewolf");
    // 队友不会把自己列进去。
    expect(wolfView.teammates.some((t) => t.playerId === wolf1)).toBe(false);

    // 预言家（好人）看不到任何队友。
    const seerView = buildVisibleInformation(seer, state.snapshot, state.events);
    expect(seerView.teammates).toEqual([]);
  });

  it("nightStatus 播报当前夜晚步骤：首夜先狼步，随当前步推进而切换", () => {
    let state = reachFirstNight();
    const [wolf1, wolf2] = idsByRole(state.snapshot, "werewolf");
    const seer = idsByRole(state.snapshot, "seer")[0];

    // 首夜当前步是狼步：所有视角都播报「狼人行动」，但只有狼在等自己出手。
    const wolfStatus = buildVisibleInformation(wolf1, state.snapshot, state.events)
      .nightStatus;
    expect(wolfStatus?.currentStepKind).toBe("werewolf_kill");
    expect(wolfStatus?.waitingForViewer).toBe(true);
    const seerStatusAtWolf = buildVisibleInformation(seer, state.snapshot, state.events)
      .nightStatus;
    expect(seerStatusAtWolf?.currentStepKind).toBe("werewolf_kill");
    expect(seerStatusAtWolf?.waitingForViewer).toBe(false);

    // 两狼提交完 → 推进到预言家步，nightStatus 同步切到 seer_check。
    state = step(state, {
      type: "submit_night_action",
      idempotencyKey: key("w1"),
      actorId: wolf1,
      actionType: "werewolf_kill",
      targetId: seer,
    });
    state = step(state, {
      type: "submit_night_action",
      idempotencyKey: key("w2"),
      actorId: wolf2,
      actionType: "werewolf_kill",
      targetId: seer,
    });
    const seerStatus = buildVisibleInformation(seer, state.snapshot, state.events)
      .nightStatus;
    expect(seerStatus?.currentStepKind).toBe("seer_check");
    expect(seerStatus?.waitingForViewer).toBe(true);

    // 白天阶段不再有夜晚播报。
    const dayState = step(state, {
      type: "submit_night_action",
      idempotencyKey: key("seer-check"),
      actorId: seer,
      actionType: "seer_check",
      targetId: wolf1,
    });
    const witch = idsByRole(dayState.snapshot, "witch")[0];
    const witchSaved = step(dayState, {
      type: "submit_witch_action",
      idempotencyKey: key("witch-skip"),
      actorId: witch,
      witchChoice: "skip",
    });
    expect(witchSaved.snapshot.gamePhase).toBe("day_announcement");
    expect(
      buildVisibleInformation(seer, witchSaved.snapshot, witchSaved.events)
        .nightStatus,
    ).toBeNull();
  });

  it("女巫毒药毒杀目标；被刀者无人救则死亡（两死）", () => {
    let state = reachFirstNight();
    const [wolf1, wolf2] = idsByRole(state.snapshot, "werewolf");
    const seer = idsByRole(state.snapshot, "seer")[0];
    const witch = idsByRole(state.snapshot, "witch")[0];
    const victim = aliveVillagerNotHuman(state.snapshot);

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
    state = step(state, {
      type: "submit_night_action",
      idempotencyKey: key("s"),
      actorId: seer,
      actionType: "seer_check",
      targetId: wolf1,
    });
    // 女巫不救、改毒预言家。
    state = step(state, {
      type: "submit_witch_action",
      idempotencyKey: key("poison"),
      actorId: witch,
      witchChoice: "poison",
      targetId: seer,
    });

    const dead = state.snapshot.players.filter((p) => !p.alive).map((p) => p.playerId);
    expect(dead.sort()).toEqual([seer, victim].sort());
    expect(
      state.snapshot.players.find((p) => p.playerId === seer)?.deathCause,
    ).toBe("poison");
    expect(state.snapshot.witchState?.poisonAvailable).toBe(false);
  });

  it("女巫首夜不能自救", () => {
    let state = reachFirstNight();
    const [wolf1, wolf2] = idsByRole(state.snapshot, "werewolf");
    const seer = idsByRole(state.snapshot, "seer")[0];
    const witch = idsByRole(state.snapshot, "witch")[0];

    // 两狼都刀女巫。
    state = step(state, {
      type: "submit_night_action",
      idempotencyKey: key("w1"),
      actorId: wolf1,
      actionType: "werewolf_kill",
      targetId: witch,
    });
    state = step(state, {
      type: "submit_night_action",
      idempotencyKey: key("w2"),
      actorId: wolf2,
      actionType: "werewolf_kill",
      targetId: witch,
    });
    state = step(state, {
      type: "submit_night_action",
      idempotencyKey: key("s"),
      actorId: seer,
      actionType: "seer_check",
      targetId: wolf1,
    });
    // 女巫想自救 → 拒绝（首夜禁止）。
    expectErr(
      apply(state, {
        type: "submit_witch_action",
        idempotencyKey: key("self-save"),
        actorId: witch,
        witchChoice: "save",
      }),
      "ACTION_NOT_ALLOWED",
    );
  });

  it("放逐猎人遗言后开枪，带走一名存活玩家", () => {
    const base = reachFirstNight();
    const hunter = idsByRole(base.snapshot, "hunter")[0];
    const villager = aliveVillagerNotHuman(base.snapshot);
    // 构造「猎人被放逐、正在遗言」的相位。
    const players = base.snapshot.players.map((p) =>
      p.playerId === hunter
        ? {
            ...p,
            alive: false,
            deathCause: "exile" as const,
            deathEventId: "crafted-exile",
            isRoleVisiblePublicly: false,
          }
        : p,
    );
    const crafted: EngineState = {
      ...base,
      snapshot: {
        ...base.snapshot,
        gamePhase: "exile_last_words",
        round: { night: 1, day: 1, voteRound: "first" },
        players,
        pendingAction: {
          type: "last_words",
          actorId: hunter,
          legalTargets: [],
          allowAbstain: false,
        },
      },
    };

    const afterWords = step(crafted, {
      type: "submit_last_words",
      idempotencyKey: key("lw"),
      speakerId: hunter,
      text: "我是猎人，开枪了。",
    });
    expect(afterWords.snapshot.gamePhase).toBe("hunter_shoot");
    expect(afterWords.snapshot.pendingHunterId).toBe(hunter);
    expect(afterWords.snapshot.hunterShootFromExile).toBe(true);

    const afterShot = step(afterWords, {
      type: "submit_hunter_shoot",
      idempotencyKey: key("shot"),
      actorId: hunter,
      targetId: villager,
    });
    expect(
      afterShot.snapshot.players.find((p) => p.playerId === villager)?.alive,
    ).toBe(false);
    expect(
      afterShot.snapshot.players.find((p) => p.playerId === villager)?.deathCause,
    ).toBe("hunter_shot");
    expect(afterShot.events.some((e) => e.type === "hunter_shot")).toBe(true);
    // 放逐结算后回到夜晚（或终局）。
    expect(["night_action", "review"]).toContain(afterShot.snapshot.gamePhase);
  });

  it("屠边：杀光所有神职（屠神边）狼人获胜", () => {
    const base = reachFirstNight();
    const [wolf1] = idsByRole(base.snapshot, "werewolf");
    const seer = idsByRole(base.snapshot, "seer")[0];
    const villager = aliveVillagerNotHuman(base.snapshot);
    const survivors = new Set([wolf1, seer, villager]);
    // 只留 1狼 + 1神(预言家) + 1民 存活，其余出局。
    const players = base.snapshot.players.map((p) =>
      survivors.has(p.playerId)
        ? p
        : {
            ...p,
            alive: false,
            deathCause: "exile" as const,
            deathEventId: `crafted-${p.playerId}`,
            isRoleVisiblePublicly: false,
          },
    );
    const crafted: EngineState = {
      ...base,
      snapshot: {
        ...base.snapshot,
        round: { night: 2, day: 1, voteRound: "none" },
        players,
        nightState: {
          night: 2,
          steps: [
            { kind: "werewolf_kill", actorIds: [wolf1], submittedActorIds: [] },
          ],
          currentStepIndex: 0,
          resolved: false,
          deathPlayerIds: [],
        },
        witchState: undefined,
        pendingAction: null,
      },
    };

    // 狼刀掉最后一个神（预言家）→ 神全灭 → 屠神边狼胜。
    const resolved = step(crafted, {
      type: "submit_night_action",
      idempotencyKey: key("kill-god"),
      actorId: wolf1,
      actionType: "werewolf_kill",
      targetId: seer,
    });
    expect(resolved.snapshot.gamePhase).toBe("review");
    expect(resolved.snapshot.winner).toBe("werewolf_team");
    expect(resolved.snapshot.winReason).toBe("all_gods_dead");
    expect(resolved.session.status).toBe("ended");
  });

  it("信息隔离：村民在夜晚看不到任何行动者，且无合法动作", () => {
    const state = reachFirstNight();
    const villager = aliveVillagerNotHuman(state.snapshot);
    const view = buildVisibleInformation(villager, state.snapshot, state.events);
    expect(view.canAct).toBe(false);
    expect(view.legalActions).toEqual([]);
    // 村民看不到任何 night_action_submitted（夜晚提交只对行动者本人可见）。
    expect(
      view.publicEvents.some((event) => event.type === "night_action_submitted"),
    ).toBe(false);
    expect(
      view.privateEvents.some((event) => event.type === "night_action_submitted"),
    ).toBe(false);
  });
});
