import type {
  Camp,
  CurrentDayState,
  GameState,
  Phase,
  PlayerId,
  PlayerState,
  SpeechIntent,
  TimelineEvent,
  TimelineEventType,
  TimelineVisibility,
  WinCheckResult,
  WitchNightAction,
  WitchPotionState
} from "./types";

interface TimelineEventInput {
  type: TimelineEventType;
  visibility: TimelineVisibility;
  summary: string;
  actorId?: PlayerId;
  targetId?: PlayerId;
  payload?: Record<string, unknown>;
  postGameVisible?: boolean;
}

function getPlayer(gameState: GameState, playerId: PlayerId): PlayerState {
  const player = gameState.players.find((candidate) => candidate.id === playerId);

  if (!player) {
    throw new Error(`Unknown player: ${playerId}`);
  }

  return player;
}

function getAlivePlayer(gameState: GameState, playerId: PlayerId): PlayerState {
  const player = getPlayer(gameState, playerId);

  if (player.status !== "alive") {
    throw new Error(`Player ${playerId} is not alive`);
  }

  return player;
}

function requirePhase(gameState: GameState, phase: Phase) {
  if (gameState.phase !== phase) {
    throw new Error(`Expected phase ${phase}, received ${gameState.phase}`);
  }
}

function nextOrder(gameState: GameState) {
  return gameState.timeline.reduce((max, event) => Math.max(max, event.order), -1) + 1;
}

function createEvent(
  gameState: GameState,
  input: TimelineEventInput,
  order = nextOrder(gameState)
): TimelineEvent {
  return {
    id: `event-${order.toString().padStart(4, "0")}-${input.type}`,
    type: input.type,
    phase: gameState.phase,
    day: gameState.day,
    order,
    actorId: input.actorId,
    targetId: input.targetId,
    visibility: input.visibility,
    summary: input.summary,
    payload: input.payload ?? {},
    postGameVisible: input.postGameVisible
  };
}

function appendEvent(gameState: GameState, input: TimelineEventInput): GameState {
  return {
    ...gameState,
    timeline: [...gameState.timeline, createEvent(gameState, input)]
  };
}

function appendEvents(gameState: GameState, inputs: TimelineEventInput[]): GameState {
  let nextState = gameState;

  for (const input of inputs) {
    nextState = appendEvent(nextState, input);
  }

  return nextState;
}

function setPhase(gameState: GameState, phase: Phase, summary: string): GameState {
  const nextState = {
    ...gameState,
    phase
  };

  return appendEvent(nextState, {
    type: "phase_changed",
    visibility: { kind: "public" },
    summary,
    payload: {
      phase
    }
  });
}

function getAlivePlayers(gameState: GameState) {
  return gameState.players.filter((player) => player.status === "alive");
}

function getAliveWitches(gameState: GameState) {
  return getAlivePlayers(gameState).filter((player) => player.role === "witch");
}

function getAliveSeers(gameState: GameState) {
  return getAlivePlayers(gameState).filter((player) => player.role === "seer");
}

function getAliveWerewolves(gameState: GameState) {
  return getAlivePlayers(gameState).filter((player) => player.role === "werewolf");
}

function createEmptyDay(number: number): CurrentDayState {
  return {
    number,
    speeches: {},
    voteRound: 1,
    votesByRound: {
      1: {},
      2: {}
    },
    revoteCandidateIds: null,
    exileCandidateId: null
  };
}

function getCurrentNight(gameState: GameState) {
  if (!gameState.currentNight) {
    throw new Error("No active night");
  }

  return gameState.currentNight;
}

function getPotions(gameState: GameState, witchId: PlayerId): WitchPotionState {
  return (
    gameState.witchPotions[witchId] ?? {
      antidote: false,
      poison: false
    }
  );
}

function replacePotions(
  gameState: GameState,
  witchId: PlayerId,
  potions: WitchPotionState
): GameState {
  return {
    ...gameState,
    witchPotions: {
      ...gameState.witchPotions,
      [witchId]: potions
    }
  };
}

function replacePlayers(gameState: GameState, deadPlayerIds: PlayerId[]): GameState {
  if (deadPlayerIds.length === 0) {
    return gameState;
  }

  const deadSet = new Set(deadPlayerIds);

  return {
    ...gameState,
    players: gameState.players.map((player) => ({
      ...player,
      status: deadSet.has(player.id) ? "dead" : player.status
    }))
  };
}

function sortedBySeat(gameState: GameState, playerIds: PlayerId[]) {
  return [...playerIds].sort(
    (firstId, secondId) => getPlayer(gameState, firstId).seat - getPlayer(gameState, secondId).seat
  );
}

function appendWinCheckEvent(gameState: GameState, result: WinCheckResult): GameState {
  const aliveCounts = gameState.players.reduce(
    (counts, player) => {
      if (player.status !== "alive") {
        return counts;
      }

      if (player.role === "werewolf") {
        counts.werewolves += 1;
      } else if (player.role === "villager") {
        counts.villagers += 1;
        counts.good += 1;
      } else {
        counts.specials += 1;
        counts.good += 1;
      }

      return counts;
    },
    {
      good: 0,
      specials: 0,
      villagers: 0,
      werewolves: 0
    }
  );

  return appendEvent(gameState, {
    type: "win_condition_checked",
    visibility: { kind: "internal" },
    summary: "检查胜利条件",
    payload: {
      aliveCounts,
      mode: gameState.winConditionMode,
      reason: result.reason,
      winner: result.winner
    }
  });
}

function appendPostGameRoleReveal(gameState: GameState): GameState {
  if (gameState.timeline.some((event) => event.type === "post_game_role_reveal")) {
    return gameState;
  }

  return appendEvent(gameState, {
    type: "post_game_role_reveal",
    visibility: { kind: "post_game" },
    summary: "赛后揭晓全部身份",
    payload: {
      rolesByPlayerId: Object.fromEntries(
        gameState.players.map((player) => [
          player.id,
          {
            camp: player.camp,
            role: player.role,
            status: player.status
          }
        ])
      )
    }
  });
}

function finishGameIfWon(gameState: GameState): GameState {
  const result = checkWinCondition(gameState);
  let nextState = appendWinCheckEvent(gameState, result);

  if (!result.winner) {
    return nextState;
  }

  nextState = {
    ...nextState,
    winner: result.winner
  };
  nextState = setPhase(nextState, "ended", "游戏结束");
  nextState = appendEvent(nextState, {
    type: "game_over",
    visibility: { kind: "public" },
    summary: `${result.winner === "good" ? "好人阵营" : "狼人阵营"}获胜`,
    payload: {
      reason: result.reason,
      winner: result.winner
    }
  });

  return appendPostGameRoleReveal(nextState);
}

function validateNightActor(gameState: GameState, actorId: PlayerId, role: PlayerState["role"]) {
  requirePhase(gameState, "night");

  const actor = getAlivePlayer(gameState, actorId);

  if (actor.role !== role) {
    throw new Error(`Player ${actorId} is not a ${role}`);
  }

  return actor;
}

export function startNight(gameState: GameState): GameState {
  if (gameState.winner) {
    throw new Error("Cannot start a night after game over");
  }

  if (!["setup", "exile"].includes(gameState.phase)) {
    throw new Error(`Cannot start night from phase ${gameState.phase}`);
  }

  const nightNumber = gameState.day + 1;
  let nextState: GameState = {
    ...gameState,
    day: nightNumber,
    phase: "night",
    currentNight: {
      number: nightNumber,
      resolved: false,
      seerChecks: {},
      werewolfKill: null,
      witchActions: {}
    },
    currentDay: createEmptyDay(nightNumber)
  };

  nextState = appendEvent(nextState, {
    type: "phase_changed",
    visibility: { kind: "public" },
    summary: `进入第 ${nightNumber} 夜`,
    payload: {
      phase: "night"
    }
  });

  const requests: TimelineEventInput[] = [];

  if (getAliveWerewolves(nextState).length > 0) {
    requests.push({
      type: "night_action_requested",
      visibility: { kind: "wolf_team" },
      summary: "狼人阵营请选择夜晚刀人目标",
      payload: {
        actionKind: "werewolf_kill"
      },
      postGameVisible: true
    });
  }

  for (const seer of getAliveSeers(nextState)) {
    requests.push({
      type: "night_action_requested",
      actorId: seer.id,
      visibility: { kind: "private", playerIds: [seer.id] },
      summary: `${seer.seat}号预言家请选择查验目标`,
      payload: {
        actionKind: "seer_check"
      },
      postGameVisible: true
    });
  }

  for (const witch of getAliveWitches(nextState)) {
    requests.push({
      type: "night_action_requested",
      actorId: witch.id,
      visibility: { kind: "private", playerIds: [witch.id] },
      summary: `${witch.seat}号女巫等待夜晚死亡信息`,
      payload: {
        actionKind: "witch_action"
      },
      postGameVisible: true
    });
  }

  return appendEvents(nextState, requests);
}

export function submitWerewolfKill(
  gameState: GameState,
  actorId: PlayerId,
  targetId: PlayerId
): GameState {
  const actor = validateNightActor(gameState, actorId, "werewolf");
  const target = getAlivePlayer(gameState, targetId);
  const currentNight = getCurrentNight(gameState);

  if (currentNight.werewolfKill) {
    throw new Error("Werewolf kill has already been submitted");
  }

  let nextState: GameState = {
    ...gameState,
    currentNight: {
      ...currentNight,
      werewolfKill: {
        actorId: actor.id,
        targetId: target.id
      }
    }
  };

  nextState = appendEvent(nextState, {
    type: "night_action_submitted",
    actorId: actor.id,
    targetId: target.id,
    visibility: { kind: "wolf_team" },
    summary: "狼人阵营提交夜晚刀人目标",
    payload: {
      actionKind: "werewolf_kill",
      actorId: actor.id,
      targetId: target.id
    },
    postGameVisible: true
  });

  for (const witch of getAliveWitches(nextState)) {
    nextState = appendEvent(nextState, {
      type: "witch_death_prompt",
      actorId: witch.id,
      targetId: target.id,
      visibility: { kind: "private", playerIds: [witch.id] },
      summary: "女巫收到夜晚死亡信息",
      payload: {
        deathCandidateId: target.id
      },
      postGameVisible: true
    });
  }

  return nextState;
}

export function submitSeerCheck(
  gameState: GameState,
  seerId: PlayerId,
  targetId: PlayerId
): GameState {
  const seer = validateNightActor(gameState, seerId, "seer");
  const target = getAlivePlayer(gameState, targetId);
  const currentNight = getCurrentNight(gameState);

  if (currentNight.seerChecks[seer.id]) {
    throw new Error(`Seer ${seer.id} has already checked this night`);
  }

  const result = {
    camp: target.camp,
    targetId: target.id
  };

  let nextState: GameState = {
    ...gameState,
    currentNight: {
      ...currentNight,
      seerChecks: {
        ...currentNight.seerChecks,
        [seer.id]: target.id
      }
    },
    seerResults: {
      ...gameState.seerResults,
      [seer.id]: [...(gameState.seerResults[seer.id] ?? []), result]
    }
  };

  nextState = appendEvent(nextState, {
    type: "night_action_submitted",
    actorId: seer.id,
    targetId: target.id,
    visibility: { kind: "private", playerIds: [seer.id] },
    summary: `${seer.seat}号预言家提交查验目标`,
    payload: {
      actionKind: "seer_check",
      actorId: seer.id,
      targetId: target.id
    },
    postGameVisible: true
  });

  return appendEvent(nextState, {
    type: "seer_check_result",
    actorId: seer.id,
    targetId: target.id,
    visibility: { kind: "private", playerIds: [seer.id] },
    summary: "预言家收到查验结果",
    payload: result,
    postGameVisible: true
  });
}

export function submitWitchAction(
  gameState: GameState,
  witchId: PlayerId,
  action: WitchNightAction
): GameState {
  const witch = validateNightActor(gameState, witchId, "witch");
  const currentNight = getCurrentNight(gameState);
  const poisonTargetId = action.poisonTargetId ?? null;
  const usesAntidote = action.useAntidote === true;

  if (usesAntidote && poisonTargetId) {
    throw new Error("Witch cannot use antidote and poison in the same night");
  }

  if (currentNight.witchActions[witch.id]) {
    throw new Error(`Witch ${witch.id} has already submitted an action this night`);
  }

  const potions = getPotions(gameState, witch.id);
  let nextPotions = {
    ...potions
  };

  if (usesAntidote) {
    if (!currentNight.werewolfKill) {
      throw new Error("Witch has no night death candidate to save");
    }

    if (!potions.antidote) {
      throw new Error("Witch antidote has already been used");
    }

    nextPotions = {
      ...nextPotions,
      antidote: false
    };
  }

  if (poisonTargetId) {
    getAlivePlayer(gameState, poisonTargetId);

    if (!potions.poison) {
      throw new Error("Witch poison has already been used");
    }

    nextPotions = {
      ...nextPotions,
      poison: false
    };
  }

  let nextState: GameState = replacePotions(
    {
      ...gameState,
      currentNight: {
        ...currentNight,
        witchActions: {
          ...currentNight.witchActions,
          [witch.id]: {
            useAntidote: usesAntidote,
            poisonTargetId
          }
        }
      }
    },
    witch.id,
    nextPotions
  );

  nextState = appendEvent(nextState, {
    type: "night_action_submitted",
    actorId: witch.id,
    targetId: poisonTargetId ?? currentNight.werewolfKill?.targetId,
    visibility: { kind: "private", playerIds: [witch.id] },
    summary: `${witch.seat}号女巫提交夜晚行动`,
    payload: {
      actionKind: "witch_action",
      actorId: witch.id,
      poisonTargetId,
      useAntidote: usesAntidote
    },
    postGameVisible: true
  });

  return appendEvent(nextState, {
    type: "witch_potion_state_changed",
    actorId: witch.id,
    visibility: { kind: "private", playerIds: [witch.id] },
    summary: "女巫药水状态更新",
    payload: {
      potions: nextPotions
    },
    postGameVisible: true
  });
}

export function resolveNight(gameState: GameState): GameState {
  requirePhase(gameState, "night");

  const currentNight = getCurrentNight(gameState);
  const savedPlayerIds = new Set<PlayerId>();
  const poisonedPlayerIds = new Set<PlayerId>();

  for (const action of Object.values(currentNight.witchActions)) {
    if (action.useAntidote && currentNight.werewolfKill) {
      savedPlayerIds.add(currentNight.werewolfKill.targetId);
    }

    if (action.poisonTargetId) {
      poisonedPlayerIds.add(action.poisonTargetId);
    }
  }

  const deadPlayerIds = new Set<PlayerId>();

  if (currentNight.werewolfKill && !savedPlayerIds.has(currentNight.werewolfKill.targetId)) {
    deadPlayerIds.add(currentNight.werewolfKill.targetId);
  }

  for (const playerId of poisonedPlayerIds) {
    deadPlayerIds.add(playerId);
  }

  let nextState: GameState = replacePlayers(gameState, [...deadPlayerIds]);
  nextState = {
    ...nextState,
    currentNight: {
      ...currentNight,
      resolved: true
    }
  };
  nextState = setPhase(nextState, "day_speech", `进入第 ${nextState.day} 天发言阶段`);
  nextState = appendEvent(nextState, {
    type: "night_death_announced",
    visibility: { kind: "public" },
    summary:
      deadPlayerIds.size === 0
        ? "昨夜平安夜"
        : `昨夜死亡：${sortedBySeat(nextState, [...deadPlayerIds])
            .map((playerId) => `${getPlayer(nextState, playerId).seat}号`)
            .join("、")}`,
    payload: {
      deadPlayerIds: sortedBySeat(nextState, [...deadPlayerIds])
    }
  });

  return finishGameIfWon(nextState);
}

export function submitSpeechIntent(
  gameState: GameState,
  actorId: PlayerId,
  intent: SpeechIntent,
  renderedText: string
): GameState {
  requirePhase(gameState, "day_speech");

  const actor = getAlivePlayer(gameState, actorId);

  if (gameState.currentDay.speeches[actor.id]) {
    throw new Error(`Player ${actor.id} has already spoken today`);
  }

  let nextState: GameState = {
    ...gameState,
    currentDay: {
      ...gameState.currentDay,
      speeches: {
        ...gameState.currentDay.speeches,
        [actor.id]: {
          intent,
          renderedText
        }
      }
    }
  };

  nextState = appendEvent(nextState, {
    type: "speech_intent_recorded",
    actorId: actor.id,
    visibility: { kind: "private", playerIds: [actor.id] },
    summary: `${actor.seat}号记录结构化发言意图`,
    payload: {
      actorId: actor.id,
      intent
    },
    postGameVisible: true
  });

  return appendEvent(nextState, {
    type: "speech_rendered",
    actorId: actor.id,
    visibility: { kind: "public" },
    summary: `${actor.seat}号公开发言`,
    payload: {
      actorId: actor.id,
      text: renderedText
    }
  });
}

export function startVoting(gameState: GameState): GameState {
  requirePhase(gameState, "day_speech");

  return setPhase(
    {
      ...gameState,
      currentDay: {
        ...gameState.currentDay,
        voteRound: 1,
        votesByRound: {
          1: {},
          2: {}
        },
        revoteCandidateIds: null,
        exileCandidateId: null
      }
    },
    "day_vote",
    `进入第 ${gameState.day} 天投票阶段`
  );
}

export function submitVote(
  gameState: GameState,
  voterId: PlayerId,
  targetId: PlayerId
): GameState {
  requirePhase(gameState, "day_vote");

  const voter = getAlivePlayer(gameState, voterId);
  const target = getAlivePlayer(gameState, targetId);
  const round = gameState.currentDay.voteRound;

  if (
    round === 2 &&
    gameState.currentDay.revoteCandidateIds &&
    !gameState.currentDay.revoteCandidateIds.includes(target.id)
  ) {
    throw new Error(`Revote target ${target.id} is not in the tied candidate list`);
  }

  const roundVotes = gameState.currentDay.votesByRound[round] ?? {};

  if (roundVotes[voter.id]) {
    throw new Error(`Player ${voter.id} has already voted in round ${round}`);
  }

  const nextState: GameState = {
    ...gameState,
    currentDay: {
      ...gameState.currentDay,
      votesByRound: {
        ...gameState.currentDay.votesByRound,
        [round]: {
          ...roundVotes,
          [voter.id]: target.id
        }
      }
    }
  };

  return appendEvent(nextState, {
    type: "vote_submitted",
    actorId: voter.id,
    targetId: target.id,
    visibility: { kind: "public" },
    summary: `${voter.seat}号投票给${target.seat}号`,
    payload: {
      round,
      targetId: target.id,
      voterId: voter.id
    }
  });
}

function countVotes(votes: Record<PlayerId, PlayerId>) {
  return Object.values(votes).reduce<Record<PlayerId, number>>((counts, targetId) => {
    counts[targetId] = (counts[targetId] ?? 0) + 1;

    return counts;
  }, {});
}

function resolveVoteCounts(voteCounts: Record<PlayerId, number>) {
  const entries = Object.entries(voteCounts);

  if (entries.length === 0) {
    return {
      highestCount: 0,
      tiedPlayerIds: [] as PlayerId[]
    };
  }

  const highestCount = Math.max(...entries.map(([, count]) => count));

  return {
    highestCount,
    tiedPlayerIds: entries
      .filter(([, count]) => count === highestCount)
      .map(([playerId]) => playerId)
  };
}

export function resolveVote(gameState: GameState): GameState {
  requirePhase(gameState, "day_vote");

  const round = gameState.currentDay.voteRound;
  const votes = gameState.currentDay.votesByRound[round] ?? {};
  const voteCounts = countVotes(votes);
  const { highestCount, tiedPlayerIds } = resolveVoteCounts(voteCounts);
  const sortedTiedPlayerIds = sortedBySeat(gameState, tiedPlayerIds);

  if (round === 1 && sortedTiedPlayerIds.length > 1) {
    const nextState = appendEvent(
      {
        ...gameState,
        currentDay: {
          ...gameState.currentDay,
          revoteCandidateIds: sortedTiedPlayerIds,
          voteRound: 2,
          votesByRound: {
            ...gameState.currentDay.votesByRound,
            2: {}
          }
        }
      },
      {
        type: "vote_result_resolved",
        visibility: { kind: "public" },
        summary: "首轮投票平票，进入一次重投",
        payload: {
          highestCount,
          nextVoteRound: 2,
          round,
          tiedPlayerIds: sortedTiedPlayerIds,
          voteCounts
        }
      }
    );

    return nextState;
  }

  const exileCandidateId =
    sortedTiedPlayerIds.length === 1 ? sortedTiedPlayerIds[0] : null;
  const nextState: GameState = {
    ...gameState,
    phase: "exile",
    currentDay: {
      ...gameState.currentDay,
      exileCandidateId
    }
  };

  return appendEvent(nextState, {
    type: "vote_result_resolved",
    visibility: { kind: "public" },
    summary: exileCandidateId
      ? `${getPlayer(gameState, exileCandidateId).seat}号成为放逐候选`
      : "重投后仍然平票，本轮无人出局",
    payload: {
      exileCandidateId,
      highestCount,
      round,
      tiedPlayerIds: sortedTiedPlayerIds,
      voteCounts
    }
  });
}

export function resolveExile(gameState: GameState): GameState {
  requirePhase(gameState, "exile");

  const exileCandidateId = gameState.currentDay.exileCandidateId;
  let nextState = exileCandidateId
    ? replacePlayers(gameState, [exileCandidateId])
    : gameState;

  nextState = appendEvent(nextState, {
    type: "exile_resolved",
    targetId: exileCandidateId ?? undefined,
    visibility: { kind: "public" },
    summary: exileCandidateId
      ? `${getPlayer(gameState, exileCandidateId).seat}号被放逐出局`
      : "本轮无人被放逐",
    payload: {
      exiledPlayerId: exileCandidateId
    }
  });

  return finishGameIfWon(nextState);
}

export function checkWinCondition(gameState: GameState): WinCheckResult {
  const alivePlayers = getAlivePlayers(gameState);
  const aliveWerewolves = alivePlayers.filter((player) => player.role === "werewolf");
  const aliveGoodPlayers = alivePlayers.filter((player) => player.camp === "good");
  const aliveVillagers = alivePlayers.filter((player) => player.role === "villager");
  const aliveSpecials = alivePlayers.filter(
    (player) => player.role === "seer" || player.role === "witch"
  );

  if (aliveWerewolves.length === 0) {
    return {
      reason: "all_werewolves_dead",
      winner: "good"
    };
  }

  if (gameState.winConditionMode === "side_elimination") {
    if (aliveVillagers.length === 0) {
      return {
        reason: "all_villagers_dead",
        winner: "werewolf"
      };
    }

    if (aliveSpecials.length === 0) {
      return {
        reason: "all_specials_dead",
        winner: "werewolf"
      };
    }
  }

  if (gameState.winConditionMode === "total_elimination" && aliveGoodPlayers.length === 0) {
    return {
      reason: "all_good_dead",
      winner: "werewolf"
    };
  }

  return {
    reason: "no_winner",
    winner: null
  };
}
