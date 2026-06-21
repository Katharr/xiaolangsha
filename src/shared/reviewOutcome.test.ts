import { describe, expect, it } from "vitest";

import type {
  DeathCause,
  EventType,
  GamePhase,
  Player,
  Role,
  TruthEvent,
} from "./index";
import { derivePlayerOutcomes } from "./index";

/** 构造一个最小合法 TruthEvent；只填 derivePlayerOutcomes 关心的字段。 */
function ev(
  seq: number,
  type: EventType,
  phase: GamePhase,
  round: { night: number; day: number },
  payload: Record<string, unknown>,
): TruthEvent {
  return {
    eventId: `e-${seq}`,
    gameId: "g",
    seq,
    type,
    phase,
    round: { night: round.night, day: round.day, voteRound: "none" },
    source: "rule_engine",
    payload,
    visibility: { public: true, visibleTo: [], revealInReview: true },
    metadata: { idempotencyKey: `k-${seq}`, generatedBy: "rule_engine" },
    createdAt: "2026-06-21T00:00:00.000Z",
  };
}

/** 构造一个玩家；只填本测关心的字段。 */
function pl(
  playerId: string,
  seat: number,
  role: Role,
  alive: boolean,
  deathCause?: DeathCause,
): Player {
  return {
    playerId,
    gameId: "g",
    seat,
    name: `${seat}号`,
    role,
    faction: role === "werewolf" ? "werewolf_team" : "good_team",
    controller: "ai",
    alive,
    ...(deathCause ? { deathCause } : {}),
    isHuman: false,
    isRoleVisiblePublicly: false,
  } as Player;
}

describe("derivePlayerOutcomes", () => {
  it("存活者：alive=true、无死因、killerIds 为空", () => {
    const players = [pl("villager", 5, "villager", true)];
    const outcomes = derivePlayerOutcomes(players, []);
    expect(outcomes[0]).toEqual({
      playerId: "villager",
      alive: true,
      killerIds: [],
    });
  });

  it("被狼刀：第N夜 + killerIds=全部行动狼", () => {
    const players = [pl("seer", 2, "seer", false, "night_kill")];
    const events = [
      ev(10, "night_action_resolved", "night_action", { night: 2, day: 1 }, {
        actionType: "werewolf_kill",
        actorIds: ["w1", "w2"],
        targetId: "seer",
        result: { killed: true },
      }),
      ev(11, "player_died", "night_action", { night: 2, day: 1 }, {
        playerId: "seer",
        deathCause: "night_kill",
      }),
    ];
    const out = derivePlayerOutcomes(players, events)[0];
    expect(out.alive).toBe(false);
    expect(out.deathCause).toBe("night_kill");
    expect(out.deathPhaseKind).toBe("night");
    expect(out.deathRound).toBe(2);
    expect(out.killerIds).toEqual(["w1", "w2"]);
  });

  it("被毒杀：killerIds=女巫（取自 night_action_submitted）", () => {
    const players = [pl("wolf", 1, "werewolf", false, "poison")];
    const events = [
      ev(20, "night_action_submitted", "night_action", { night: 2, day: 1 }, {
        actorId: "witch",
        actionType: "witch_poison",
        targetId: "wolf",
      }),
      ev(21, "player_died", "night_action", { night: 2, day: 1 }, {
        playerId: "wolf",
        deathCause: "poison",
      }),
    ];
    const out = derivePlayerOutcomes(players, events)[0];
    expect(out.deathCause).toBe("poison");
    expect(out.deathPhaseKind).toBe("night");
    expect(out.deathRound).toBe(2);
    expect(out.killerIds).toEqual(["witch"]);
  });

  it("被放逐：第N天 + exileVotes 取自 tally，killerIds 为空", () => {
    const players = [pl("wolf", 4, "werewolf", false, "exile")];
    const events = [
      ev(30, "vote_resolved", "vote", { night: 1, day: 1 }, {
        exiledPlayerId: "wolf",
        tally: { wolf: 5, other: 2 },
      }),
      ev(31, "player_died", "vote", { night: 1, day: 1 }, {
        playerId: "wolf",
        deathCause: "exile",
      }),
    ];
    const out = derivePlayerOutcomes(players, events)[0];
    expect(out.deathCause).toBe("exile");
    expect(out.deathPhaseKind).toBe("day");
    expect(out.deathRound).toBe(1);
    expect(out.killerIds).toEqual([]);
    expect(out.exileVotes).toBe(5);
  });

  it("被猎人带走：killerIds=猎人", () => {
    const players = [pl("villager", 6, "villager", false, "hunter_shot")];
    const events = [
      ev(40, "hunter_shot", "hunter_shoot", { night: 2, day: 2 }, {
        hunterId: "hunter",
        targetId: "villager",
      }),
      ev(41, "player_died", "hunter_shoot", { night: 2, day: 2 }, {
        playerId: "villager",
        deathCause: "hunter_shot",
      }),
    ];
    const out = derivePlayerOutcomes(players, events)[0];
    expect(out.deathCause).toBe("hunter_shot");
    expect(out.deathPhaseKind).toBe("day");
    expect(out.deathRound).toBe(2);
    expect(out.killerIds).toEqual(["hunter"]);
  });
});
