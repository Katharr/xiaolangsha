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

export function getBoardConfig(boardId: string): BoardConfig | null {
  if (boardId !== MVP_5P_BOARD_ID) {
    return null;
  }

  return mvp5pBoard;
}
