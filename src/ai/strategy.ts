import type { AiPlayerView, PlayerId } from "../domain";
import { buildAiMemory } from "./memory";
import { createSpeechIntent, renderSpeechIntent } from "./speech";
import type { AiAction, AiMemory, DecisionReason } from "./types";

function alivePlayers(view: AiPlayerView) {
  return view.players.filter((player) => player.status === "alive");
}

function scoreSnapshot(memory: AiMemory, view: AiPlayerView): DecisionReason["candidateScores"] {
  return Object.fromEntries(
    view.players.map((player) => [
      player.id,
      {
        suspicion: memory.suspicionByPlayer[player.id]?.score ?? 0,
        trust: memory.trustByPlayer[player.id]?.score ?? 0
      }
    ])
  );
}

function createReason(
  view: AiPlayerView,
  memory: AiMemory,
  chosenAction: AiAction["kind"],
  summary: string,
  targetId?: PlayerId
): DecisionReason {
  return {
    actorId: view.playerId,
    candidateScores: scoreSnapshot(memory, view),
    chosenAction,
    summary,
    targetId
  };
}

function getLatestRevoteCandidateIds(view: AiPlayerView) {
  const latestRevote = [...view.timeline]
    .reverse()
    .find(
      (event) =>
        event.type === "vote_result_resolved" &&
        event.payload.nextVoteRound === 2 &&
        Array.isArray(event.payload.tiedPlayerIds)
    );

  return Array.isArray(latestRevote?.payload.tiedPlayerIds)
    ? latestRevote.payload.tiedPlayerIds.filter((playerId): playerId is PlayerId => typeof playerId === "string")
    : null;
}

function chooseHighestSuspicionTarget(
  view: AiPlayerView,
  memory: AiMemory,
  options: {
    allowedIds?: PlayerId[] | null;
    avoidTeammates?: boolean;
  } = {}
) {
  const allowed = options.allowedIds ? new Set(options.allowedIds) : null;
  const teammateSet = new Set(memory.knownTeammates);
  const candidates = alivePlayers(view)
    .filter((player) => player.id !== view.playerId)
    .filter((player) => !allowed || allowed.has(player.id))
    .filter((player) => !options.avoidTeammates || !teammateSet.has(player.id));

  return candidates.sort((first, second) => {
    const firstSuspicion = memory.suspicionByPlayer[first.id]?.score ?? 0;
    const secondSuspicion = memory.suspicionByPlayer[second.id]?.score ?? 0;
    const firstTrust = memory.trustByPlayer[first.id]?.score ?? 0;
    const secondTrust = memory.trustByPlayer[second.id]?.score ?? 0;

    return secondSuspicion - firstSuspicion || firstTrust - secondTrust || first.seat - second.seat;
  })[0]?.id;
}

function decideWerewolfKill(view: AiPlayerView, memory: AiMemory): AiAction {
  const targetId =
    chooseHighestSuspicionTarget(view, memory, {
      avoidTeammates: true
    }) ?? chooseHighestSuspicionTarget(view, memory);

  if (!targetId) {
    throw new Error("No legal werewolf target");
  }

  return {
    actorId: view.playerId,
    kind: "werewolf_kill",
    reason: createReason(view, memory, "werewolf_kill", "优先刀非狼队友且公开压力较高的位置", targetId),
    targetId
  };
}

function decideSeerCheck(view: AiPlayerView, memory: AiMemory): AiAction {
  const checkedIds =
    view.privateInfo.kind === "seer"
      ? new Set(view.privateInfo.checkResults.map((result) => result.targetId))
      : new Set<PlayerId>();
  const uncheckedIds = alivePlayers(view)
    .filter((player) => player.id !== view.playerId && !checkedIds.has(player.id))
    .map((player) => player.id);
  const targetId =
    chooseHighestSuspicionTarget(view, memory, {
      allowedIds: uncheckedIds
    }) ?? chooseHighestSuspicionTarget(view, memory);

  if (!targetId) {
    throw new Error("No legal seer target");
  }

  return {
    actorId: view.playerId,
    kind: "seer_check",
    reason: createReason(view, memory, "seer_check", "查验当前视角下最需要确认的位置", targetId),
    targetId
  };
}

function decideWitchAction(view: AiPlayerView, memory: AiMemory): AiAction {
  if (view.privateInfo.kind !== "witch") {
    throw new Error("Witch action requires witch private info");
  }

  const { nightDeathCandidateId, potions } = view.privateInfo;
  const action = {
    poisonTargetId: null as PlayerId | null,
    useAntidote: false
  };
  let summary = "保留药水，等待更多公开信息";
  let targetId: PlayerId | undefined;

  if (nightDeathCandidateId && potions.antidote) {
    action.useAntidote = true;
    summary = "首要保证夜晚死亡信息中的玩家存活";
    targetId = nightDeathCandidateId;
  } else if (potions.poison) {
    const poisonTargetId = chooseHighestSuspicionTarget(view, memory);
    const suspicion = poisonTargetId ? memory.suspicionByPlayer[poisonTargetId]?.score ?? 0 : 0;

    if (poisonTargetId && suspicion >= 0.7) {
      action.poisonTargetId = poisonTargetId;
      summary = "使用毒药处理当前视角下高危目标";
      targetId = poisonTargetId;
    }
  }

  return {
    action,
    actorId: view.playerId,
    kind: "witch_action",
    reason: createReason(view, memory, "witch_action", summary, targetId)
  };
}

function decideSpeech(view: AiPlayerView, memory: AiMemory): AiAction {
  const intent = createSpeechIntent(memory, view);
  const renderedText = renderSpeechIntent(intent, view);

  return {
    actorId: view.playerId,
    intent,
    kind: "speech",
    reason: createReason(view, memory, "speech", "用结构化意图生成公开发言", intent.targetId),
    renderedText
  };
}

function decideVote(view: AiPlayerView, memory: AiMemory): AiAction {
  const targetId =
    chooseHighestSuspicionTarget(view, memory, {
      allowedIds: getLatestRevoteCandidateIds(view),
      avoidTeammates: view.self.role === "werewolf"
    }) ?? chooseHighestSuspicionTarget(view, memory);

  if (!targetId) {
    throw new Error("No legal vote target");
  }

  return {
    actorId: view.playerId,
    kind: "vote",
    reason: createReason(view, memory, "vote", "投给当前视角下综合怀疑最高的位置", targetId),
    targetId
  };
}

export function decideAction(view: AiPlayerView): AiAction {
  const memory = buildAiMemory(view);

  if (view.phase === "night") {
    if (view.self.role === "werewolf") {
      return decideWerewolfKill(view, memory);
    }

    if (view.self.role === "seer") {
      return decideSeerCheck(view, memory);
    }

    if (view.self.role === "witch") {
      return decideWitchAction(view, memory);
    }
  }

  if (view.phase === "day_speech") {
    return decideSpeech(view, memory);
  }

  if (view.phase === "day_vote") {
    return decideVote(view, memory);
  }

  throw new Error(`No script AI action for phase ${view.phase}`);
}
