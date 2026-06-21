import type { DeathCause } from "./enums";
import type { Player, PlayerOutcome, TruthEvent } from "./models";

/**
 * 玩家结局派生（结局速览数据源）：纯函数、只依赖 shared，直接扫 append-only 事件流还原
 * （含 `night_action_submitted` 里仅女巫可见的毒杀，故凶手归属比旧版「夜晚行动」更全）。
 * 仅在 review 阶段使用（ISO-002）。`PlayerOutcome` 类型定义在 models.ts。
 */
export function derivePlayerOutcomes(
  players: Player[],
  events: TruthEvent[],
): PlayerOutcome[] {
  // 每人取第一条 player_died（出局只发生一次），用于拿死亡相位/回合。
  const deathEvents = new Map<string, TruthEvent>();
  for (const e of events) {
    if (e.type !== "player_died") {
      continue;
    }
    const pid = e.payload.playerId;
    if (typeof pid === "string" && !deathEvents.has(pid)) {
      deathEvents.set(pid, e);
    }
  }

  return players.map((player) => {
    if (player.alive) {
      return { playerId: player.playerId, alive: true, killerIds: [] };
    }

    const death = deathEvents.get(player.playerId);
    const cause =
      (death?.payload.deathCause as DeathCause | undefined) ?? player.deathCause;
    const phaseKind: "night" | "day" | undefined = death
      ? death.phase === "night_action"
        ? "night"
        : "day"
      : undefined;
    const deathRound = death
      ? phaseKind === "night"
        ? death.round.night
        : death.round.day
      : undefined;

    return {
      playerId: player.playerId,
      alive: false,
      deathCause: cause,
      deathPhaseKind: phaseKind,
      deathRound,
      killerIds: findKillerIds(cause, player.playerId, death, events),
      ...(cause === "exile"
        ? { exileVotes: findExileVotes(player.playerId, events) }
        : {}),
    };
  });
}

function findKillerIds(
  cause: DeathCause | undefined,
  victimId: string,
  death: TruthEvent | undefined,
  events: TruthEvent[],
): string[] {
  switch (cause) {
    case "night_kill": {
      const kill = events.find(
        (e) =>
          e.type === "night_action_resolved" &&
          e.payload.actionType === "werewolf_kill" &&
          e.payload.targetId === victimId &&
          (death ? e.round.night === death.round.night : true),
      );
      const actorIds = kill && Array.isArray(kill.payload.actorIds)
        ? kill.payload.actorIds.filter((id): id is string => typeof id === "string")
        : [];
      return actorIds;
    }
    case "poison": {
      // 毒杀以 night_action_submitted 记录（仅女巫可见、revealInReview）。
      const poison = events.find(
        (e) =>
          e.type === "night_action_submitted" &&
          e.payload.actionType === "witch_poison" &&
          e.payload.targetId === victimId,
      );
      const actor = poison?.payload.actorId;
      return typeof actor === "string" ? [actor] : [];
    }
    case "hunter_shot": {
      const shot = events.find(
        (e) => e.type === "hunter_shot" && e.payload.targetId === victimId,
      );
      const hunter = shot?.payload.hunterId;
      return typeof hunter === "string" ? [hunter] : [];
    }
    default:
      return [];
  }
}

function findExileVotes(victimId: string, events: TruthEvent[]): number | undefined {
  const resolved = events.find(
    (e) => e.type === "vote_resolved" && e.payload.exiledPlayerId === victimId,
  );
  const tally = resolved?.payload.tally;
  if (tally && typeof tally === "object") {
    const n = (tally as Record<string, unknown>)[victimId];
    if (typeof n === "number") {
      return n;
    }
  }
  return undefined;
}
