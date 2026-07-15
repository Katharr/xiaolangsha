import type {
  DeathCause,
  GameSnapshot,
  LegalAction,
  NightActionType,
  NightProgress,
  Player,
  PublicDeathRef,
  PublicPlayerRef,
  RoundRef,
  TeammateRef,
  TruthEvent,
  VisibleEventRef,
  VisibleInformationSnapshot,
  VisibleSpeech,
  VisibleVote,
} from "../shared";
import { currentNightStep, legalNightTargets } from "./night";

export function buildVisibleInformation(
  viewerId: string,
  snapshot: GameSnapshot,
  events: TruthEvent[],
): VisibleInformationSnapshot {
  const viewer = snapshot.players.find((player) => player.playerId === viewerId);

  if (!viewer) {
    throw new Error("Viewer is not part of this game.");
  }

  return {
    gameId: snapshot.gameId,
    viewerId,
    generatedAtSeq: snapshot.lastEventSeq,
    gamePhase: snapshot.gamePhase,
    humanParticipationState: viewer.isHuman
      ? snapshot.humanParticipationState
      : undefined,
    round: snapshot.round,
    ownSeat: viewer.seat,
    ownName: viewer.name,
    ownRole: viewer.role,
    ownFaction: viewer.faction,
    teammates: collectTeammates(viewer, snapshot.players),
    alivePlayers: snapshot.players
      .filter((player) => player.alive)
      .map(toPublicPlayerRef),
    deadPlayers: snapshot.players
      .filter((player) => !player.alive && player.deathCause)
      .map((player) =>
        toPublicDeathRef(
          player,
          player.deathEventId
            ? roundByEventId(events, player.deathEventId)
            : undefined,
        ),
      ),
    publicEvents: events
      .filter((event) => event.visibility.public)
      .map(toVisibleEventRef),
    privateEvents: events
      .filter((event) => event.visibility.visibleTo.includes(viewerId))
      .map(toVisibleEventRef),
    speeches: events.flatMap(toVisibleSpeech),
    votes: collectVisibleVotes(events, viewerId),
    legalActions: getLegalActions(viewer, snapshot),
    canAct: canViewerAct(viewer, snapshot),
    nightStatus: buildNightStatus(viewer, snapshot),
  };
}

/**
 * 夜晚进度播报：当前夜晚步骤在等哪个角色（守卫/狼人/预言家/女巫），
 * 以及是否在等 viewer 本人。仅暴露「角色种类」，不含任何具体行动者身份（ISO-001）。
 * 非 night_action 或夜晚已结算 / 无当前步时返回 null。
 */
function buildNightStatus(
  viewer: Player,
  snapshot: GameSnapshot,
): NightProgress | null {
  if (snapshot.gamePhase !== "night_action") {
    return null;
  }
  const nightState = snapshot.nightState;
  if (!nightState || nightState.resolved) {
    return null;
  }
  const step = currentNightStep(nightState);
  if (!step) {
    return null;
  }
  const waitingForViewer =
    viewer.alive &&
    !(viewer.isHuman && snapshot.humanParticipationState !== "alive") &&
    step.actorIds.includes(viewer.playerId) &&
    !step.submittedActorIds.includes(viewer.playerId);
  return { currentStepKind: step.kind, waitingForViewer };
}

/**
 * 同阵营队友：仅狼人之间互相知晓身份（开局认人，死后仍记得）。其它身份返回空数组。
 * 含已出局的队友，便于狼人在白天/复盘里记清谁是自己人。
 */
function collectTeammates(viewer: Player, players: Player[]): TeammateRef[] {
  if (viewer.role !== "werewolf") {
    return [];
  }
  return players
    .filter((p) => p.role === "werewolf" && p.playerId !== viewer.playerId)
    .map((p) => ({
      playerId: p.playerId,
      name: p.name,
      seat: p.seat,
      role: p.role,
      alive: p.alive,
    }));
}

function toPublicPlayerRef(player: Player): PublicPlayerRef {
  return {
    playerId: player.playerId,
    name: player.name,
    seat: player.seat,
    alive: player.alive,
    ...(player.isRoleVisiblePublicly ? { publicRole: player.role } : {}),
  };
}

/**
 * 规则铁律：夜死不公布死法——被毒对外一律归并为「夜里出局」，让博弈多样化
 * （好人无法白拿「场上有女巫在用毒」的信息）。白天死法（放逐/猎人枪）仍公开。
 * 女巫自己的用毒记录走 privateEvents 不受影响；复盘经 reviewContext 读
 * TruthEvent 真相（ISO-002），也不受影响。
 */
function maskNightDeathCause(cause: DeathCause): DeathCause {
  return cause === "poison" ? "night_kill" : cause;
}

/** 死亡事件的回合（PublicDeathRef.round 的数据源；找不到时退回 0 占位）。 */
function roundByEventId(
  events: TruthEvent[],
  eventId: string,
): RoundRef | undefined {
  return events.find((event) => event.eventId === eventId)?.round;
}

function toPublicDeathRef(player: Player, round?: RoundRef): PublicDeathRef {
  return {
    playerId: player.playerId,
    name: player.name,
    seat: player.seat,
    deathCause: maskNightDeathCause(player.deathCause ?? "night_kill"),
    round: round ?? { night: 0, day: 0, voteRound: "none" },
    ...(player.isRoleVisiblePublicly ? { publicRole: player.role } : {}),
  };
}

function toVisibleEventRef(event: TruthEvent): VisibleEventRef {
  // player_died 是公共事件且 payload 带真实死因：对局内可见层同样掩蔽毒杀。
  let payload = event.payload;
  if (event.type === "player_died" && payload.deathCause === "poison") {
    payload = { ...payload, deathCause: maskNightDeathCause("poison") };
  }
  return {
    eventId: event.eventId,
    seq: event.seq,
    type: event.type,
    phase: event.phase,
    round: event.round,
    payload,
  };
}

function toVisibleSpeech(event: TruthEvent): VisibleSpeech[] {
  if (
    event.type !== "speech_submitted" &&
    event.type !== "tie_speech_submitted" &&
    event.type !== "last_words_submitted"
  ) {
    return [];
  }

  return [
    {
      eventId: event.eventId,
      speakerId: String(event.payload.speakerId),
      day: Number(event.payload.day),
      speechKind:
        event.type === "last_words_submitted"
          ? "last_words"
          : event.type === "tie_speech_submitted"
            ? "tie_speech"
            : "day_speech",
      text: String(event.payload.text),
      createdAt: event.createdAt,
    },
  ];
}

function toVisibleVote(event: TruthEvent): VisibleVote {
  return {
    eventId: event.eventId,
    day: event.round.day,
    voteRound: event.round.voteRound === "tie_break" ? "tie_break" : "first",
    voterId: String(event.payload.voterId),
    choiceType: event.payload.choiceType === "abstain" ? "abstain" : "target",
    ...(typeof event.payload.targetId === "string"
      ? { targetId: event.payload.targetId }
      : {}),
  };
}

/**
 * 同时暗投：结算前每个 viewer 只看得到自己投的票（杜绝跟票）；某轮一旦结算
 * （出现该 day+voteRound 的 vote_resolved），该轮全部票型对所有人同时翻牌。
 */
function collectVisibleVotes(
  events: TruthEvent[],
  viewerId: string,
): VisibleVote[] {
  const resolvedRounds = new Set<string>();
  for (const event of events) {
    if (event.type === "vote_resolved") {
      resolvedRounds.add(`${event.round.day}:${event.round.voteRound}`);
    }
  }

  const votes: VisibleVote[] = [];
  for (const event of events) {
    if (event.type !== "vote_submitted") {
      continue;
    }
    const voterId = String(event.payload.voterId);
    const revealed = resolvedRounds.has(
      `${event.round.day}:${event.round.voteRound}`,
    );
    if (voterId !== viewerId && !revealed) {
      continue;
    }
    votes.push(toVisibleVote(event));
  }
  return votes;
}

function getLegalActions(viewer: Player, snapshot: GameSnapshot): LegalAction[] {
  if (!canViewerAct(viewer, snapshot)) {
    return [];
  }

  if (snapshot.gamePhase === "role_reveal") {
    return [
      {
        actionType: "confirm",
        actorId: viewer.playerId,
        legalTargets: [],
        allowAbstain: false,
        required: true,
      },
    ];
  }

  if (snapshot.gamePhase === "night_action") {
    // canViewerAct 已确保 viewer 是当前步骤的行动者；按角色给出动作类型。
    const targets = legalNightTargets(viewer, snapshot.players, snapshot.round.night);
    if (viewer.role === "witch") {
      return [
        {
          actionType: "witch_action",
          actorId: viewer.playerId,
          legalTargets: targets,
          allowAbstain: true,
          required: true,
        },
      ];
    }
    const nightActionType: NightActionType | null =
      viewer.role === "werewolf"
        ? "werewolf_kill"
        : viewer.role === "seer"
          ? "seer_check"
          : viewer.role === "guard"
            ? "guard_protect"
            : null;
    if (!nightActionType) {
      return [];
    }
    return [
      {
        actionType: nightActionType,
        actorId: viewer.playerId,
        legalTargets: targets,
        allowAbstain: false,
        required: true,
      },
    ];
  }

  if (snapshot.gamePhase === "hunter_shoot") {
    return [
      {
        actionType: "hunter_shoot",
        actorId: viewer.playerId,
        legalTargets: snapshot.players
          .filter((player) => player.alive && player.playerId !== viewer.playerId)
          .map((player) => player.playerId),
        allowAbstain: true,
        required: true,
      },
    ];
  }

  if (snapshot.gamePhase === "day_announcement") {
    return [
      {
        actionType: "confirm",
        actorId: viewer.playerId,
        legalTargets: [],
        allowAbstain: false,
        required: true,
      },
    ];
  }

  if (snapshot.gamePhase === "day_speech") {
    return [
      {
        actionType: "speech",
        actorId: viewer.playerId,
        legalTargets: [],
        allowAbstain: false,
        required: true,
      },
    ];
  }

  if (snapshot.gamePhase === "vote" || snapshot.gamePhase === "tie_vote") {
    const voteState = snapshot.voteState;

    if (!voteState) {
      return [];
    }

    return [
      {
        actionType: "vote",
        actorId: viewer.playerId,
        legalTargets: voteState.candidateIds.filter(
          (candidateId) => candidateId !== viewer.playerId,
        ),
        allowAbstain: voteState.allowAbstain,
        required: true,
      },
    ];
  }

  if (snapshot.gamePhase === "tie_speech") {
    return [
      {
        actionType: "tie_speech",
        actorId: viewer.playerId,
        legalTargets: [],
        allowAbstain: false,
        required: true,
      },
    ];
  }

  if (snapshot.gamePhase === "exile_last_words") {
    return [
      {
        actionType: "last_words",
        actorId: viewer.playerId,
        legalTargets: [],
        allowAbstain: false,
        required: true,
      },
    ];
  }

  return [];
}

function canViewerAct(viewer: Player, snapshot: GameSnapshot): boolean {
  // The exiled player gives last words / a dead hunter shoots after they are
  // already dead, so these must be handled before the generic alive guard.
  if (snapshot.gamePhase === "exile_last_words" || snapshot.gamePhase === "hunter_shoot") {
    return snapshot.pendingAction?.actorId === viewer.playerId;
  }

  if (!viewer.alive) {
    return false;
  }

  if (viewer.isHuman && snapshot.humanParticipationState !== "alive") {
    return false;
  }

  if (snapshot.gamePhase === "night_action") {
    const nightState = snapshot.nightState;
    if (!nightState || nightState.resolved) {
      return false;
    }
    const step = currentNightStep(nightState);
    if (!step) {
      return false;
    }
    return (
      step.actorIds.includes(viewer.playerId) &&
      !step.submittedActorIds.includes(viewer.playerId)
    );
  }

  if (snapshot.gamePhase === "vote" || snapshot.gamePhase === "tie_vote") {
    const voteState = snapshot.voteState;

    if (!voteState || voteState.resolved) {
      return false;
    }

    return (
      voteState.eligibleVoterIds.includes(viewer.playerId) &&
      !voteState.submittedVoterIds.includes(viewer.playerId)
    );
  }

  return snapshot.pendingAction?.actorId === viewer.playerId;
}
