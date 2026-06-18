import type { BoardConfig, Faction, Player, Role } from "../shared";

const standardHumanRoleOrder: Role[] = ["werewolf", "seer", "villager"];

export function getFactionForRole(role: Role): Faction {
  return role === "werewolf" ? "werewolf_team" : "good_team";
}

export function assignStandardPlayers(params: {
  board: BoardConfig;
  gameId: string;
  humanPlayerId: string;
  idempotencyKey: string;
}): Player[] {
  const roleIndex = stableIndex(params.idempotencyKey, standardHumanRoleOrder.length);
  return assignPlayersWithHumanRole({
    board: params.board,
    gameId: params.gameId,
    humanPlayerId: params.humanPlayerId,
    humanRole: standardHumanRoleOrder[roleIndex] ?? "villager",
  });
}

export function assignPlayersWithHumanRole(params: {
  board: BoardConfig;
  gameId: string;
  humanPlayerId: string;
  humanRole: Role;
}): Player[] {
  if (!params.board.roles.includes(params.humanRole)) {
    throw new Error("Human role is not available on this board.");
  }

  const remainingRoles = [...params.board.roles];
  const humanRoleIndex = remainingRoles.indexOf(params.humanRole);
  remainingRoles.splice(humanRoleIndex, 1);

  return [
    buildPlayer({
      gameId: params.gameId,
      playerId: params.humanPlayerId,
      seat: 1,
      controller: "human",
      role: params.humanRole,
      isHuman: true,
    }),
    ...remainingRoles.map((role, index) =>
      buildPlayer({
        gameId: params.gameId,
        playerId: `ai-${index + 1}`,
        seat: index + 2,
        controller: "ai",
        role,
        isHuman: false,
      }),
    ),
  ];
}

function buildPlayer(params: {
  gameId: string;
  playerId: string;
  seat: number;
  controller: "human" | "ai";
  role: Role;
  isHuman: boolean;
}): Player {
  return {
    playerId: params.playerId,
    gameId: params.gameId,
    seat: params.seat,
    controller: params.controller,
    role: params.role,
    faction: getFactionForRole(params.role),
    alive: true,
    isHuman: params.isHuman,
    isRoleVisiblePublicly: false,
  };
}

function stableIndex(value: string, modulo: number): number {
  let hash = 0;

  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }

  return hash % modulo;
}
