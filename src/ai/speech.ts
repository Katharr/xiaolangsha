import type { AiPlayerView, PlayerId, SpeechIntent } from "../domain";
import type { AiMemory } from "./types";

function playerSeat(view: AiPlayerView, playerId: PlayerId) {
  return view.players.find((player) => player.id === playerId)?.seat ?? Number(playerId.slice(1));
}

function campText(camp: "good" | "werewolf") {
  return camp === "werewolf" ? "狼人阵营" : "好人阵营";
}

function highestSuspicionTarget(memory: AiMemory, view: AiPlayerView) {
  const teammateSet = new Set(memory.knownTeammates);

  return view.players
    .filter(
      (player) =>
        player.status === "alive" && player.id !== view.playerId && !teammateSet.has(player.id)
    )
    .sort((first, second) => {
      const firstScore = memory.suspicionByPlayer[first.id]?.score ?? 0;
      const secondScore = memory.suspicionByPlayer[second.id]?.score ?? 0;

      return secondScore - firstScore || first.seat - second.seat;
    })[0]?.id;
}

export function createSpeechIntent(memory: AiMemory, view: AiPlayerView): SpeechIntent {
  if (view.privateInfo.kind === "seer" && view.privateInfo.checkResults.length > 0) {
    const latest = view.privateInfo.checkResults[view.privateInfo.checkResults.length - 1];

    return {
      kind: "report_check",
      summary: `${playerSeat(view, latest.targetId)}号是${campText(latest.camp)}`,
      targetId: latest.targetId
    };
  }

  const targetId = highestSuspicionTarget(memory, view);

  if (!targetId) {
    return {
      kind: "pass",
      summary: "公开信息不足，先听后置位"
    };
  }

  if (view.self.role === "werewolf") {
    return {
      kind: "question",
      summary: `把焦点放到${playerSeat(view, targetId)}号身上`,
      targetId
    };
  }

  if ((memory.suspicionByPlayer[targetId]?.score ?? 0) >= 0.45) {
    return {
      kind: "accuse",
      summary: `基于公开信息怀疑${playerSeat(view, targetId)}号`,
      targetId
    };
  }

  return {
    kind: "question",
    summary: `要求${playerSeat(view, targetId)}号补充发言理由`,
    targetId
  };
}

export function renderSpeechIntent(intent: SpeechIntent, view: AiPlayerView): string {
  const selfSeat = view.self.seat;
  const targetSeat = intent.targetId ? playerSeat(view, intent.targetId) : undefined;

  if (intent.kind === "report_check" && intent.targetId && view.privateInfo.kind === "seer") {
    const result = view.privateInfo.checkResults.find((check) => check.targetId === intent.targetId);

    return result
      ? `${selfSeat}号：我是预言家，昨晚查验${targetSeat}号，是${campText(result.camp)}。`
      : `${selfSeat}号：我有查验信息，但先不展开。`;
  }

  if (intent.kind === "accuse" && targetSeat) {
    return `${selfSeat}号：我目前更怀疑${targetSeat}号，发言和场上信息不太对。`;
  }

  if (intent.kind === "defend" && targetSeat) {
    return `${selfSeat}号：我暂时不想出${targetSeat}号，他的逻辑还说得通。`;
  }

  if (intent.kind === "question" && targetSeat) {
    return `${selfSeat}号：我想听${targetSeat}号把自己的判断再讲清楚。`;
  }

  if (intent.kind === "vote_reason" && targetSeat) {
    return `${selfSeat}号：我这一轮会投${targetSeat}号。`;
  }

  return `${selfSeat}号：我先听大家发言，暂时不下定论。`;
}
