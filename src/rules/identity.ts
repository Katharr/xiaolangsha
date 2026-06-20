import type { BoardConfig, Faction, Player, Role, RoleCategory } from "../shared";
// 展示用名字池与「名字↔性格」绑定的唯一事实源在 shared/personas.ts。
// 名字本身不含 human/ai 信息——配合可见信息已移除 controller，AI 无法分辨谁是真人。
import { NAME_POOL } from "../shared";

const standardHumanRoleOrder: Role[] = ["werewolf", "seer", "villager"];

export function getFactionForRole(role: Role): Faction {
  return role === "werewolf" ? "werewolf_team" : "good_team";
}

/** 角色大类：狼 / 神职 / 平民。用于屠边胜负判定。 */
export function roleCategory(role: Role): RoleCategory {
  if (role === "werewolf") {
    return "wolf";
  }
  if (role === "villager") {
    return "folk";
  }
  return "god"; // seer / witch / hunter / guard / idiot
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
    seed: params.idempotencyKey,
  });
}

export function assignPlayersWithHumanRole(params: {
  board: BoardConfig;
  gameId: string;
  humanPlayerId: string;
  humanRole: Role;
  /** 确定性随机种子（座位/名字洗牌），保证测试可复现、恢复一致。 */
  seed: string;
}): Player[] {
  if (!params.board.roles.includes(params.humanRole)) {
    throw new Error("Human role is not available on this board.");
  }

  const remainingRoles = [...params.board.roles];
  const humanRoleIndex = remainingRoles.indexOf(params.humanRole);
  remainingRoles.splice(humanRoleIndex, 1);

  const playerCount = params.board.roles.length;

  // 座位与名字都按种子洗牌：真人不再恒为 1 号、每局名字不同，但同 seed 可复现。
  const seats = seededShuffle(
    Array.from({ length: playerCount }, (_, index) => index + 1),
    `${params.seed}:seats`,
  );
  const names = seededShuffle(NAME_POOL, `${params.seed}:names`).slice(
    0,
    playerCount,
  );

  return [
    buildPlayer({
      gameId: params.gameId,
      playerId: params.humanPlayerId,
      name: names[0],
      seat: seats[0],
      controller: "human",
      role: params.humanRole,
      isHuman: true,
    }),
    ...remainingRoles.map((role, index) =>
      buildPlayer({
        gameId: params.gameId,
        playerId: `ai-${index + 1}`,
        name: names[index + 1],
        seat: seats[index + 1],
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
  name: string;
  seat: number;
  controller: "human" | "ai";
  role: Role;
  isHuman: boolean;
}): Player {
  return {
    playerId: params.playerId,
    gameId: params.gameId,
    name: params.name,
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
  return hashString(value) % modulo;
}

/** FNV-1a 风格的确定性哈希，纯函数、跨平台一致。 */
function hashString(value: string): number {
  let hash = 0;

  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }

  return hash;
}

/**
 * 种子确定性 Fisher-Yates 洗牌（不修改入参）。每一步的伪随机来自 `seed:index` 的哈希，
 * 保证同 seed 输出稳定、不同 seed 充分打散。
 */
function seededShuffle<T>(items: T[], seed: string): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = hashString(`${seed}:${i}`) % (i + 1);
    const temp = result[i];
    result[i] = result[j];
    result[j] = temp;
  }
  return result;
}
