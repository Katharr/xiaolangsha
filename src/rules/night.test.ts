import { describe, expect, it } from "vitest";

import type { Player } from "../shared";

import { tallyWolfKill } from "./night";

/** 构造一个只填了狼队唱票所需字段的玩家（其余字段对 tallyWolfKill 无关紧要）。 */
function player(overrides: Partial<Player> & Pick<Player, "playerId" | "seat">): Player {
  return {
    playerId: overrides.playerId,
    name: overrides.name ?? overrides.playerId,
    seat: overrides.seat,
    role: overrides.role ?? "werewolf",
    faction: overrides.faction ?? "werewolf_team",
    alive: overrides.alive ?? true,
    isHuman: overrides.isHuman ?? false,
    isRoleVisiblePublicly: overrides.isRoleVisiblePublicly ?? false,
  } as Player;
}

describe("tallyWolfKill 狼队唱票", () => {
  const players = [
    player({ playerId: "wolf-human", seat: 5, isHuman: true }),
    player({ playerId: "wolf-ai", seat: 2 }),
    player({ playerId: "v-a", seat: 1, role: "villager", faction: "good_team" }),
    player({ playerId: "v-b", seat: 3, role: "villager", faction: "good_team" }),
  ];

  it("多数票直接出目标", () => {
    const target = tallyWolfKill(
      { "wolf-human": "v-a", "wolf-ai": "v-a" },
      players,
    );
    expect(target).toBe("v-a");
  });

  it("平票时按真人狼的选择裁定（这是真人的游戏）", () => {
    // 真人狼刀 v-b、AI 狼刀 v-a，各一票平票 → 听真人的 v-b。
    const target = tallyWolfKill(
      { "wolf-human": "v-b", "wolf-ai": "v-a" },
      players,
    );
    expect(target).toBe("v-b");
  });

  it("没有真人狼时，平票退回座位最小者", () => {
    const allAi = [
      player({ playerId: "w1", seat: 4 }),
      player({ playerId: "w2", seat: 6 }),
      player({ playerId: "v-a", seat: 1, role: "villager", faction: "good_team" }),
      player({ playerId: "v-b", seat: 3, role: "villager", faction: "good_team" }),
    ];
    // v-a(座位1) 与 v-b(座位3) 平票 → 座位最小者 v-a。
    const target = tallyWolfKill({ w1: "v-b", w2: "v-a" }, allAi);
    expect(target).toBe("v-a");
  });

  it("空票返回 undefined", () => {
    expect(tallyWolfKill({}, players)).toBeUndefined();
    expect(tallyWolfKill(undefined, players)).toBeUndefined();
  });
});
