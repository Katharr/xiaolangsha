import type { BoardConfig } from "../shared";

export const MVP_5P_BOARD_ID = "mvp_5p_wolf_seer_3villagers";

export const mvp5pBoard: BoardConfig = {
  boardId: MVP_5P_BOARD_ID,
  playerCount: 5,
  roles: ["werewolf", "seer", "villager", "villager", "villager"],
  winConditionMode: "simple_count",
  firstNightProtectHuman: true,
  allowWerewolfSelfKill: false,
  revealRoleOnDeathDefault: false,
  nightDeathLastWords: false,
  exileLastWords: true,
  allowAbstainVote: true,
  allowSelfVote: false,
  maxTieRounds: 1,
};

/** 主流标准局：7 人「预女猎」屠边（2狼+2民+预言家+女巫+猎人）。 */
export const STANDARD_7P_BOARD_ID = "standard_7p_seer_witch_hunter";

export const standard7pBoard: BoardConfig = {
  boardId: STANDARD_7P_BOARD_ID,
  playerCount: 7,
  roles: ["werewolf", "werewolf", "seer", "witch", "hunter", "villager", "villager"],
  winConditionMode: "slay_side",
  firstNightProtectHuman: true,
  allowWerewolfSelfKill: false,
  revealRoleOnDeathDefault: false,
  nightDeathLastWords: false,
  exileLastWords: true,
  allowAbstainVote: true,
  allowSelfVote: false,
  maxTieRounds: 1,
  witchCanSelfSaveFirstNight: true,
  guardCannotRepeat: true,
};

/** 标准局默认指向 7 人板；保留 5 人板用于回归测试。 */
export const STANDARD_BOARD_ID = STANDARD_7P_BOARD_ID;

const BOARD_REGISTRY: Map<string, BoardConfig> = new Map([
  [MVP_5P_BOARD_ID, mvp5pBoard],
  [STANDARD_7P_BOARD_ID, standard7pBoard],
]);

export function getBoardConfig(boardId: string): BoardConfig | null {
  return BOARD_REGISTRY.get(boardId) ?? null;
}
