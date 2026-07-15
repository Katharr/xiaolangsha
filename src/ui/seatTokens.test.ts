import { describe, expect, it } from "vitest";

import type {
  Role,
  VisibleEventRef,
  VisibleInformationSnapshot,
} from "../shared";

import {
  deathChips,
  ownRoleBadge,
  privateSeatTokens,
  type SeatTokenKind,
} from "./seatTokens";

/**
 * 座位 token 派生的四视角互斥测试（ISO-001 的机械化验收）：
 * 断言每个 viewer 只会得到属于自己角色的 token 种类，绝不混入他人私密信息。
 */

const NAMES = ["乔木", "小满", "阿泽", "林夜", "沈舟", "阿岚", "白露"];
const pid = (seat: number) => `p-${seat}`;

function baseVi(
  role: Role,
  overrides: Partial<VisibleInformationSnapshot> = {},
): VisibleInformationSnapshot {
  return {
    gameId: "g-test",
    viewerId: pid(3),
    generatedAtSeq: 10,
    gamePhase: "day_speech",
    round: { night: 2, day: 2, voteRound: "none" },
    ownSeat: 3,
    ownName: NAMES[2],
    ownRole: role,
    ownFaction: role === "werewolf" ? "werewolf_team" : "good_team",
    teammates: [],
    alivePlayers: NAMES.map((name, i) => ({
      playerId: pid(i + 1),
      name,
      seat: i + 1,
      alive: true,
    })),
    deadPlayers: [],
    publicEvents: [],
    privateEvents: [],
    speeches: [],
    votes: [],
    legalActions: [],
    canAct: false,
    ...overrides,
  };
}

function ev(
  type: VisibleEventRef["type"],
  night: number,
  payload: Record<string, unknown>,
): VisibleEventRef {
  return {
    eventId: `e-${type}-${night}-${JSON.stringify(payload).length}`,
    seq: night * 10,
    type,
    phase: "night_action",
    round: { night, day: night, voteRound: "none" },
    payload,
  };
}

function allKinds(
  m: ReturnType<typeof privateSeatTokens>,
): Set<SeatTokenKind> {
  const s = new Set<SeatTokenKind>();
  for (const list of m.values()) {
    for (const t of list) {
      s.add(t.kind);
    }
  }
  return s;
}

describe("privateSeatTokens 四视角互斥", () => {
  it("预言家：查验结果贴在被查座位，只有 wolf/good 两种", () => {
    const vi = baseVi("seer", {
      privateEvents: [
        ev("night_action_resolved", 1, {
          result: {
            kind: "seer_check_result",
            targetId: pid(5),
            factionResult: "werewolf_team",
          },
        }),
        ev("night_action_resolved", 2, {
          result: {
            kind: "seer_check_result",
            targetId: pid(2),
            factionResult: "good_team",
          },
        }),
      ],
    });
    const m = privateSeatTokens(vi);
    expect(m.get(pid(5))).toEqual([
      { kind: "wolf", ch: "狼", tip: "第1夜查验 · 狼人 · 仅你可见" },
    ]);
    expect(m.get(pid(2))?.[0].kind).toBe("good");
    // 互斥：不含任何女巫/狼/守卫的 token 种类。
    const kinds = allKinds(m);
    expect(kinds.has("save")).toBe(false);
    expect(kinds.has("poison")).toBe(false);
    expect(kinds.has("knife")).toBe(false);
    expect(kinds.has("guard")).toBe(false);
  });

  it("狼人：队友标 + 未得手的刀；得手的刀不挂（公开死因牌已覆盖）", () => {
    const vi = baseVi("werewolf", {
      teammates: [
        { playerId: pid(5), name: NAMES[4], seat: 5, role: "werewolf", alive: true },
      ],
      privateEvents: [
        ev("night_action_resolved", 1, {
          result: { kind: "kill_result", targetId: pid(1), killed: false },
        }),
        ev("night_action_resolved", 2, {
          result: { kind: "kill_result", targetId: pid(4), killed: true },
        }),
      ],
    });
    const m = privateSeatTokens(vi);
    expect(m.get(pid(5))?.[0]).toMatchObject({ kind: "wolf" });
    expect(m.get(pid(1))?.[0]).toMatchObject({ kind: "knife" });
    // 得手的刀（4号）不挂 token。
    expect(m.has(pid(4))).toBe(false);
    const kinds = allKinds(m);
    expect(kinds.has("good")).toBe(false);
    expect(kinds.has("save")).toBe(false);
  });

  it("女巫：救回挂 save；毒 token 只在目标已死于 poison 时出现（同帧纪律）", () => {
    const poisonSubmitted = ev("night_action_submitted", 2, {
      actionType: "witch_poison",
      targetId: pid(4),
    });
    const saveSubmitted = ev("night_action_submitted", 1, {
      actionType: "witch_save",
      targetId: pid(1),
    });
    // 毒了但目标还没进 deadPlayers（death 事件未落）：不得提前挂毒 token。
    const before = privateSeatTokens(
      baseVi("witch", { privateEvents: [saveSubmitted, poisonSubmitted] }),
    );
    expect(before.get(pid(1))?.[0]).toMatchObject({ kind: "save" });
    expect(before.has(pid(4))).toBe(false);

    // 目标已死于 poison：与公开死因牌同帧挂出。
    const after = privateSeatTokens(
      baseVi("witch", {
        privateEvents: [saveSubmitted, poisonSubmitted],
        deadPlayers: [
          {
            playerId: pid(4),
            name: NAMES[3],
            seat: 4,
            deathCause: "poison",
            round: { night: 2, day: 2, voteRound: "none" },
          },
        ],
      }),
    );
    expect(after.get(pid(4))?.[0]).toMatchObject({ kind: "poison" });
    const kinds = allKinds(after);
    expect(kinds.has("wolf")).toBe(false);
    expect(kinds.has("knife")).toBe(false);
  });

  it("村民/猎人：零私密 token", () => {
    for (const role of ["villager", "hunter"] as const) {
      const m = privateSeatTokens(
        baseVi(role, {
          privateEvents: [
            // 即便混入了不属于该角色的事件形状，也不产出 token。
            ev("night_action_resolved", 1, {
              result: {
                kind: "seer_check_result",
                targetId: pid(5),
                factionResult: "werewolf_team",
              },
            }),
          ],
        }),
      );
      expect(m.size).toBe(0);
    }
  });

  it("私密 tooltip 一律以「仅你可见」结尾", () => {
    const vi = baseVi("seer", {
      privateEvents: [
        ev("night_action_resolved", 1, {
          result: {
            kind: "seer_check_result",
            targetId: pid(5),
            factionResult: "werewolf_team",
          },
        }),
      ],
    });
    for (const list of privateSeatTokens(vi).values()) {
      for (const t of list) {
        expect(t.tip.endsWith("仅你可见")).toBe(true);
      }
    }
  });
});

describe("ownRoleBadge", () => {
  it("女巫：两颗药剂 pip 的可用/已用状态", () => {
    const badge = ownRoleBadge(
      baseVi("witch", {
        privateEvents: [
          ev("night_action_submitted", 1, {
            actionType: "witch_save",
            targetId: pid(1),
          }),
        ],
      }),
    );
    expect(badge.role).toBe("witch");
    expect(badge.pips).toHaveLength(2);
    expect(badge.pips[0]).toMatchObject({ kind: "save", used: true });
    expect(badge.pips[0].tip).toContain("乔木");
    expect(badge.pips[1]).toMatchObject({ kind: "poison", used: false });
  });

  it("狼人：wolfy 变体；非女巫无 pip", () => {
    const badge = ownRoleBadge(baseVi("werewolf"));
    expect(badge.wolfy).toBe(true);
    expect(badge.pips).toHaveLength(0);
  });
});

describe("deathChips", () => {
  it("放逐死因带 ×N 票数缀（只取 vote_resolved payload.tally）", () => {
    const vi = baseVi("villager", {
      deadPlayers: [
        {
          playerId: pid(5),
          name: NAMES[4],
          seat: 5,
          deathCause: "exile",
          round: { night: 1, day: 1, voteRound: "none" },
        },
        {
          playerId: pid(4),
          name: NAMES[3],
          seat: 4,
          deathCause: "night_kill",
          round: { night: 2, day: 2, voteRound: "none" },
        },
      ],
      publicEvents: [
        {
          eventId: "e-vr-1",
          seq: 20,
          type: "vote_resolved",
          phase: "vote",
          round: { night: 1, day: 1, voteRound: "first" },
          payload: {
            outcome: "exile",
            exiledPlayerId: pid(5),
            tally: { [pid(5)]: 3, [pid(2)]: 2 },
            votes: [],
          },
        },
      ],
    });
    const m = deathChips(vi);
    expect(m.get(pid(5))).toMatchObject({ text: "逐·天1", xn: 3 });
    expect(m.get(pid(4))).toMatchObject({ text: "刀·夜2", xn: null });
  });
});
