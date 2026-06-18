import type {
  GameSnapshot,
  LegalAction,
  Player,
  PublicDeathRef,
  PublicPlayerRef,
  TruthEvent,
  VisibleEventRef,
  VisibleInformationSnapshot,
  VisibleSpeech,
  VisibleVote,
} from "../shared";

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
    ownRole: viewer.role,
    ownFaction: viewer.faction,
    alivePlayers: snapshot.players
      .filter((player) => player.alive)
      .map(toPublicPlayerRef),
    deadPlayers: snapshot.players
      .filter((player) => !player.alive && player.deathCause)
      .map(toPublicDeathRef),
    publicEvents: events
      .filter((event) => event.visibility.public)
      .map(toVisibleEventRef),
    privateEvents: events
      .filter((event) => event.visibility.visibleTo.includes(viewerId))
      .map(toVisibleEventRef),
    speeches: events.flatMap(toVisibleSpeech),
    votes: events.flatMap(toVisibleVote),
    legalActions: getLegalActions(viewer, snapshot),
    canAct: canViewerAct(viewer, snapshot),
  };
}

function toPublicPlayerRef(player: Player): PublicPlayerRef {
  return {
    playerId: player.playerId,
    seat: player.seat,
    controller: player.controller,
    alive: player.alive,
    ...(player.isRoleVisiblePublicly ? { publicRole: player.role } : {}),
  };
}

function toPublicDeathRef(player: Player): PublicDeathRef {
  return {
    playerId: player.playerId,
    seat: player.seat,
    deathCause: player.deathCause ?? "night_kill",
    round: { night: 0, day: 0, voteRound: "none" },
    ...(player.isRoleVisiblePublicly ? { publicRole: player.role } : {}),
  };
}

function toVisibleEventRef(event: TruthEvent): VisibleEventRef {
  return {
    eventId: event.eventId,
    seq: event.seq,
    type: event.type,
    phase: event.phase,
    round: event.round,
    payload: event.payload,
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

function toVisibleVote(event: TruthEvent): VisibleVote[] {
  if (event.type !== "vote_submitted") {
    return [];
  }

  return [
    {
      eventId: event.eventId,
      day: event.round.day,
      voteRound:
        event.round.voteRound === "tie_break" ? "tie_break" : "first",
      voterId: String(event.payload.voterId),
      choiceType:
        event.payload.choiceType === "abstain" ? "abstain" : "target",
      ...(typeof event.payload.targetId === "string"
        ? { targetId: event.payload.targetId }
        : {}),
    },
  ];
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
    const nightActionType =
      viewer.role === "werewolf"
        ? "werewolf_kill"
        : viewer.role === "seer"
          ? "seer_check"
          : null;

    if (!nightActionType) {
      return [];
    }

    return [
      {
        actionType: nightActionType,
        actorId: viewer.playerId,
        legalTargets: snapshot.players
          .filter((player) => isLegalNightTarget(viewer, player, snapshot))
          .map((player) => player.playerId),
        allowAbstain: false,
        required: true,
      },
    ];
  }

  return [];
}

function canViewerAct(viewer: Player, snapshot: GameSnapshot): boolean {
  if (snapshot.gamePhase === "night_action") {
    return (
      viewer.alive &&
      (viewer.role === "werewolf" || viewer.role === "seer") &&
      Boolean(snapshot.nightState?.requiredActorIds.includes(viewer.playerId)) &&
      !snapshot.nightState?.resolved &&
      !snapshot.nightState?.submittedActorIds.includes(viewer.playerId)
    );
  }

  return snapshot.pendingAction?.actorId === viewer.playerId;
}

function isLegalNightTarget(
  viewer: Player,
  target: Player,
  snapshot: GameSnapshot,
): boolean {
  if (!target.alive || target.playerId === viewer.playerId) {
    return false;
  }

  if (
    viewer.role === "werewolf" &&
    snapshot.round.night === 1 &&
    target.isHuman
  ) {
    return false;
  }

  return true;
}
