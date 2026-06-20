import type {
  NightState,
  NightStep,
  NightStepKind,
  Player,
} from "../shared";

/**
 * 顺序夜晚的纯函数辅助。事件/快照拼装仍在 index.ts；这里只负责
 * 「按角色构建夜晚步骤」「狼队唱票」「夜晚死亡结算」三件确定性逻辑。
 */

/** 夜晚步骤的固定顺序（守卫→狼→预言家→女巫）。猎人不在夜晚。 */
const NIGHT_ORDER: NightStepKind[] = [
  "guard_protect",
  "werewolf_kill",
  "seer_check",
  "witch_action",
];

function actorsForStep(kind: NightStepKind, alivePlayers: Player[]): string[] {
  switch (kind) {
    case "guard_protect":
      return alivePlayers.filter((p) => p.role === "guard").map((p) => p.playerId);
    case "werewolf_kill":
      return alivePlayers.filter((p) => p.role === "werewolf").map((p) => p.playerId);
    case "seer_check":
      return alivePlayers.filter((p) => p.role === "seer").map((p) => p.playerId);
    case "witch_action":
      return alivePlayers.filter((p) => p.role === "witch").map((p) => p.playerId);
    default:
      return [];
  }
}

/** 按当晚存活角色构建夜晚步骤（无对应存活角色的步骤直接省略）。 */
export function buildNightSteps(players: Player[]): NightStep[] {
  const alive = players.filter((p) => p.alive);
  const steps: NightStep[] = [];
  for (const kind of NIGHT_ORDER) {
    const actorIds = actorsForStep(kind, alive);
    if (actorIds.length > 0) {
      steps.push({ kind, actorIds, submittedActorIds: [] });
    }
  }
  return steps;
}

/** 构建一个全新的 NightState（首夜/续夜通用）。 */
export function buildNightState(players: Player[], night: number): NightState {
  return {
    night,
    steps: buildNightSteps(players),
    currentStepIndex: 0,
    resolved: false,
    deathPlayerIds: [],
  };
}

/** 当前步骤（可能为 undefined，表示夜晚步骤已全部完成、应结算）。 */
export function currentNightStep(nightState: NightState): NightStep | undefined {
  return nightState.steps[nightState.currentStepIndex];
}

/**
 * 某个夜晚行动者的合法目标（纯函数，不依赖快照）：
 * - 守卫：所有存活者（含自己，可自守）。
 * - 狼人：存活且非自己；首夜（night===1）不能刀真人。
 * - 预言家：存活且非自己。
 * - 女巫：所有存活者（毒药目标；解药目标隐含为被刀者，无需在此给出）。
 */
export function legalNightTargets(
  actor: Player,
  players: Player[],
  night: number,
): string[] {
  const alive = players.filter((p) => p.alive);
  switch (actor.role) {
    case "guard":
      return alive.map((p) => p.playerId);
    case "werewolf":
      return alive
        .filter(
          (p) =>
            p.playerId !== actor.playerId && !(night === 1 && p.isHuman),
        )
        .map((p) => p.playerId);
    case "seer":
      return alive
        .filter((p) => p.playerId !== actor.playerId)
        .map((p) => p.playerId);
    case "witch":
      // 女巫毒药不能毒自己（规则层 submitWitchAction 也会拦截），故排除自身。
      return alive
        .filter((p) => p.playerId !== actor.playerId)
        .map((p) => p.playerId);
    default:
      return [];
  }
}

/** 当前步骤里尚未提交、且仍存活的行动者；返回第一个用于设 pendingAction。 */
export function nextNightActor(
  nightState: NightState,
  players: Player[],
): { actorId: string; step: NightStep } | null {
  const step = currentNightStep(nightState);
  if (!step) {
    return null;
  }
  const actorId = step.actorIds.find(
    (id) =>
      !step.submittedActorIds.includes(id) &&
      players.some((p) => p.playerId === id && p.alive),
  );
  return actorId ? { actorId, step } : null;
}

/**
 * 狼队唱票：多数票目标。平票时**优先按真人狼的选择**裁定（这是真人的游戏，平票由他拍板）；
 * 若没有真人狼、或真人狼的票不在平票集合里，再退回座位最小者。空票返回 undefined。
 */
export function tallyWolfKill(
  wolfVotes: Record<string, string> | undefined,
  players: Player[],
): string | undefined {
  if (!wolfVotes) {
    return undefined;
  }
  const counts = new Map<string, number>();
  for (const targetId of Object.values(wolfVotes)) {
    counts.set(targetId, (counts.get(targetId) ?? 0) + 1);
  }
  if (counts.size === 0) {
    return undefined;
  }
  const maxVotes = Math.max(...counts.values());
  const top = [...counts.entries()]
    .filter(([, c]) => c === maxVotes)
    .map(([id]) => id);
  if (top.length === 1) {
    return top[0];
  }
  // 平票 → 真人狼说了算：若真人狼也投了平票集合里的某人，就听他的。
  const humanWolf = players.find((p) => p.isHuman && p.role === "werewolf");
  const humanPick = humanWolf ? wolfVotes[humanWolf.playerId] : undefined;
  if (humanPick && top.includes(humanPick)) {
    return humanPick;
  }
  // 否则退回座位最小者。
  const bySeat = top
    .map((id) => ({ id, seat: players.find((p) => p.playerId === id)?.seat ?? 999 }))
    .sort((a, b) => a.seat - b.seat);
  return bySeat[0]?.id;
}

/**
 * 夜晚死亡结算（纯函数）：
 * - 被刀者存活 iff (被守卫守护 XOR 被女巫解药救) —— 同守同救失效（都对同一人 → 死）。
 * - 毒药目标必死（守卫/解药不挡毒）。
 * 返回去重后的死亡列表与各自死因。
 */
export function computeNightDeaths(nightState: NightState): Array<{
  playerId: string;
  cause: "night_kill" | "poison";
}> {
  const deaths: Array<{ playerId: string; cause: "night_kill" | "poison" }> = [];
  const killed = nightState.wolfKillTargetId;
  if (killed) {
    const guarded = nightState.guardProtectedId === killed;
    const saved = nightState.witchSavedTargetId === killed;
    const survives = guarded !== saved; // XOR：恰好一个保护才活；同守同救(都true)→死
    if (!survives) {
      deaths.push({ playerId: killed, cause: "night_kill" });
    }
  }
  const poisoned = nightState.poisonTargetId;
  if (poisoned && poisoned !== killed) {
    deaths.push({ playerId: poisoned, cause: "poison" });
  } else if (poisoned && poisoned === killed) {
    // 同时被刀又被毒：确保在列表里（死因记 poison 不影响存活，已死则去重）。
    if (!deaths.some((d) => d.playerId === poisoned)) {
      deaths.push({ playerId: poisoned, cause: "poison" });
    }
  }
  return deaths;
}
