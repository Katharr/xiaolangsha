/**
 * 提示词层各模块测试共用的 vi 构造器。仅供测试 import，不参与生产装配。
 */
import type { VisibleInformationSnapshot } from "../../shared";

export function fakeVi(
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
