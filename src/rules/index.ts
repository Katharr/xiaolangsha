import type {
  GameAction,
  GamePhase,
  GameMode,
  GameSession,
  GameSnapshot,
  NightActionType,
  PendingAction,
  Player,
  Result,
  RoundRef,
  TruthEvent,
  VisibleInformationSnapshot,
  VoteState,
  WinReason,
} from "../shared";
import { err, gameActionSchema, ok } from "../shared";
import { getBoardConfig } from "./boards";
import { assignPlayersWithHumanRole, assignStandardPlayers } from "./identity";
import { buildVisibleInformation } from "./visibility";

const MAX_DAY_SPEECH_TEXT_LENGTH = 500;

export type RuleEngineContext = {
  session?: GameSession;
  snapshot?: GameSnapshot;
  events?: TruthEvent[];
  now: string;
};

export type RuleEngineSuccess = {
  session: GameSession;
  events: TruthEvent[];
  snapshot: GameSnapshot;
  visibleInformation: VisibleInformationSnapshot;
  nextPendingAction?: PendingAction | null;
};

export function applyAction(
  action: unknown,
  context: RuleEngineContext,
): Result<RuleEngineSuccess> {
  const parsed = gameActionSchema.safeParse(action);

  if (!parsed.success) {
    return rulesError("INVALID_ACTION", "Invalid game action.");
  }

  const validAction = parsed.data as GameAction;
  const previousEvents = context.events ?? [];
  const duplicateEvents = findEventsByIdempotencyKey(
    previousEvents,
    validAction.idempotencyKey,
  );

  if (duplicateEvents.length > 0) {
    return buildNoopResult(validAction, context, previousEvents, duplicateEvents);
  }

  if (
    validAction.type === "create_game" &&
    context.snapshot &&
    context.snapshot.gamePhase !== "mode_select"
  ) {
    return rulesError("ACTION_NOT_ALLOWED", "A game is already in progress.");
  }

  switch (validAction.type) {
    case "create_game":
      return createGame(validAction, context);
    case "confirm_role_setup":
      return confirmRoleSetup(validAction, context, previousEvents);
    case "confirm_role_reveal":
      return confirmRoleReveal(validAction, context, previousEvents);
    case "submit_night_action":
      return submitNightAction(validAction, context, previousEvents);
    case "confirm_day_announcement":
      return confirmDayAnnouncement(validAction, context, previousEvents);
    case "submit_speech":
      return submitSpeech(validAction, context, previousEvents);
    case "submit_vote":
      return submitVote(validAction, context, previousEvents);
    case "submit_tie_speech":
      return submitTieSpeech(validAction, context, previousEvents);
    case "submit_last_words":
      return submitLastWords(validAction, context, previousEvents);
    default:
      return rulesError("ACTION_NOT_ALLOWED", "Action is not allowed in this slice.");
  }
}

function createGame(
  action: Extract<GameAction, { type: "create_game" }>,
  context: RuleEngineContext,
): Result<RuleEngineSuccess> {
  const board = getBoardConfig(action.boardId);

  if (!board) {
    return rulesError("INVALID_ACTION", "Unsupported board.");
  }

  const gameId = buildGameId(action.mode, action.idempotencyKey);
  const session = buildSession({
    action,
    gameId,
    currentEventSeq: action.mode === "standard" ? 3 : 1,
    currentSnapshotSeq: action.mode === "standard" ? 3 : 1,
    now: context.now,
  });

  if (action.mode === "free") {
    const snapshot = buildBaseSnapshot(gameId, "role_setup", 1, []);
    const event = buildEvent({
      gameId,
      seq: 1,
      type: "game_created",
      phase: "mode_select",
      source: "human",
      payload: {
        mode: action.mode,
        boardId: action.boardId,
        humanPlayerId: action.humanPlayerId,
      },
      idempotencyKey: action.idempotencyKey,
      now: context.now,
      visibility: { public: false, visibleTo: [], revealInReview: true },
    });

    return ok({
      session,
      events: [event],
      snapshot,
      visibleInformation: buildEmptySetupVisibleInformation(action, snapshot),
      nextPendingAction: snapshot.pendingAction,
    });
  }

  const players = assignStandardPlayers({
    board,
    gameId,
    humanPlayerId: action.humanPlayerId,
    idempotencyKey: action.idempotencyKey,
  });
  const snapshot = buildBaseSnapshot(gameId, "role_reveal", 3, players);
  const events = buildAssignmentEvents({
    action,
    gameId,
    players,
    startingSeq: 1,
    setupPhase: "mode_select",
    now: context.now,
  });
  const visibleInformation = buildVisibleInformation(
    action.humanPlayerId,
    snapshot,
    events,
  );

  return ok({
    session,
    events,
    snapshot,
    visibleInformation,
    nextPendingAction: snapshot.pendingAction,
  });
}

function confirmRoleSetup(
  action: Extract<GameAction, { type: "confirm_role_setup" }>,
  context: RuleEngineContext,
  previousEvents: TruthEvent[],
): Result<RuleEngineSuccess> {
  if (!context.session || !context.snapshot) {
    return rulesError("INVALID_ACTION", "Role setup requires an existing game.");
  }

  if (
    context.session.mode !== "free" ||
    context.snapshot.gamePhase !== "role_setup" ||
    context.session.humanPlayerId !== action.playerId
  ) {
    return rulesError("ACTION_NOT_ALLOWED", "Role setup is not allowed now.");
  }

  const board = getBoardConfig(context.session.boardId);

  if (!board || !board.roles.includes(action.selectedRole)) {
    return rulesError("INVALID_ACTION", "Selected role is not legal.");
  }

  let players;

  try {
    players = assignPlayersWithHumanRole({
      board,
      gameId: context.session.gameId,
      humanPlayerId: action.playerId,
      humanRole: action.selectedRole,
    });
  } catch {
    return rulesError("INVALID_ACTION", "Selected role cannot be assigned.");
  }

  const startingSeq = context.snapshot.lastEventSeq + 1;
  const newEvents = buildRoleAssignmentEvents({
    idempotencyKey: action.idempotencyKey,
    gameId: context.session.gameId,
    players,
    startingSeq,
    setupPhase: "role_setup",
    now: context.now,
  });
  const snapshot = buildBaseSnapshot(
    context.session.gameId,
    "role_reveal",
    startingSeq + newEvents.length - 1,
    players,
  );
  const session = {
    ...context.session,
    currentEventSeq: snapshot.lastEventSeq,
    currentSnapshotSeq: snapshot.lastEventSeq,
  };

  return ok({
    session,
    events: newEvents,
    snapshot,
    visibleInformation: buildVisibleInformation(action.playerId, snapshot, [
      ...previousEvents,
      ...newEvents,
    ]),
    nextPendingAction: snapshot.pendingAction,
  });
}

function confirmRoleReveal(
  action: Extract<GameAction, { type: "confirm_role_reveal" }>,
  context: RuleEngineContext,
  previousEvents: TruthEvent[],
): Result<RuleEngineSuccess> {
  if (!context.session || !context.snapshot) {
    return rulesError("INVALID_ACTION", "Role reveal requires an existing game.");
  }

  if (
    context.snapshot.gamePhase !== "role_reveal" ||
    context.session.humanPlayerId !== action.playerId
  ) {
    return rulesError("ACTION_NOT_ALLOWED", "Role reveal cannot be confirmed now.");
  }

  const nightActors = context.snapshot.players
    .filter((player) => player.role === "werewolf" || player.role === "seer")
    .map((player) => player.playerId);
  const human = context.snapshot.players.find((player) => player.isHuman);
  const pendingAction =
    human && (human.role === "werewolf" || human.role === "seer")
      ? {
          type: "night_action" as const,
          actorId: human.playerId,
          legalTargets: context.snapshot.players
            .filter((player) => player.alive && player.playerId !== human.playerId)
            .map((player) => player.playerId),
          allowAbstain: false,
        }
      : null;
  const startedAt = context.session.startedAt ?? context.now;
  const nextSeq = context.snapshot.lastEventSeq + 1;
  const events = [
    buildEvent({
      gameId: context.session.gameId,
      seq: nextSeq,
      type: "game_started",
      phase: "role_reveal",
      source: "human",
      actorId: action.playerId,
      payload: { firstPhase: "night_action", startedAt },
      idempotencyKey: action.idempotencyKey,
      now: context.now,
      visibility: { public: false, visibleTo: [], revealInReview: true },
    }),
    buildEvent({
      gameId: context.session.gameId,
      seq: nextSeq + 1,
      type: "phase_changed",
      phase: "role_reveal",
      source: "rule_engine",
      payload: {
        fromPhase: "role_reveal",
        toPhase: "night_action",
        reason: "human_confirmed_role_reveal",
      },
      idempotencyKey: action.idempotencyKey,
      now: context.now,
      visibility: { public: true, visibleTo: [], revealInReview: true },
    }),
  ];
  const snapshot: GameSnapshot = {
    ...context.snapshot,
    lastEventSeq: nextSeq + 1,
    gamePhase: "night_action",
    round: { night: 1, day: 0, voteRound: "none" },
    pendingAction,
    nightState: {
      night: 1,
      requiredActorIds: nightActors,
      submittedActorIds: [],
      resolved: false,
      deathPlayerIds: [],
    },
  };
  const session: GameSession = {
    ...context.session,
    status: "active",
    startedAt,
    currentEventSeq: snapshot.lastEventSeq,
    currentSnapshotSeq: snapshot.lastEventSeq,
  };

  return ok({
    session,
    events,
    snapshot,
    visibleInformation: buildVisibleInformation(action.playerId, snapshot, [
      ...previousEvents,
      ...events,
    ]),
    nextPendingAction: snapshot.pendingAction,
  });
}

function submitNightAction(
  action: Extract<GameAction, { type: "submit_night_action" }>,
  context: RuleEngineContext,
  previousEvents: TruthEvent[],
): Result<RuleEngineSuccess> {
  if (!context.session || !context.snapshot || !context.snapshot.nightState) {
    return rulesError("INVALID_ACTION", "Night action requires an existing night.");
  }

  const actor = context.snapshot.players.find(
    (player) => player.playerId === action.actorId,
  );
  const expectedActionType = getNightActionTypeForActor(actor);

  if (
    context.snapshot.gamePhase !== "night_action" ||
    context.snapshot.nightState.resolved ||
    !actor?.alive ||
    !expectedActionType ||
    action.actionType !== expectedActionType ||
    !context.snapshot.nightState.requiredActorIds.includes(action.actorId) ||
    context.snapshot.nightState.submittedActorIds.includes(action.actorId)
  ) {
    return rulesError("ACTION_NOT_ALLOWED", "Night action is not allowed now.");
  }

  if (!action.targetId) {
    return rulesError("INVALID_ACTION", "Night action target is required.");
  }

  const target = context.snapshot.players.find(
    (player) => player.playerId === action.targetId,
  );

  if (!target || !isLegalNightTarget(actor, target, context.snapshot)) {
    return rulesError("ACTION_NOT_ALLOWED", "Night action target is not legal.");
  }

  const nextSeq = context.snapshot.lastEventSeq + 1;
  const submittedEvent = buildEvent({
    gameId: context.session.gameId,
    seq: nextSeq,
    type: "night_action_submitted",
    phase: "night_action",
    source: actor.controller,
    actorId: action.actorId,
    payload: {
      actorId: action.actorId,
      actionType: action.actionType,
      targetId: action.targetId,
    },
    idempotencyKey: action.idempotencyKey,
    now: context.now,
    round: context.snapshot.round,
    visibility: {
      public: false,
      visibleTo: [action.actorId],
      revealInReview: true,
    },
  });
  const submittedActorIds = [
    ...context.snapshot.nightState.submittedActorIds,
    action.actorId,
  ];
  const submittedSnapshot: GameSnapshot = {
    ...context.snapshot,
    lastEventSeq: nextSeq,
    nightState: {
      ...context.snapshot.nightState,
      submittedActorIds,
    },
  };

  if (!hasAllNightActorsSubmitted(submittedSnapshot)) {
    const session = updateSessionSeq(context.session, submittedSnapshot);

    return ok({
      session,
      events: [submittedEvent],
      snapshot: submittedSnapshot,
      visibleInformation: buildVisibleInformation(action.actorId, submittedSnapshot, [
        ...previousEvents,
        submittedEvent,
      ]),
      nextPendingAction: submittedSnapshot.pendingAction,
    });
  }

  return resolveNight({
    action,
    context,
    previousEvents,
    submittedEvent,
    submittedSnapshot,
  });
}

function resolveNight(params: {
  action: Extract<GameAction, { type: "submit_night_action" }>;
  context: RuleEngineContext;
  previousEvents: TruthEvent[];
  submittedEvent: TruthEvent;
  submittedSnapshot: GameSnapshot;
}): Result<RuleEngineSuccess> {
  if (!params.context.session) {
    return rulesError("INVALID_ACTION", "Night resolution requires a session.");
  }

  const allEventsBeforeResolution = [
    ...params.previousEvents,
    params.submittedEvent,
  ];
  const nightSubmissions = getCurrentNightSubmissions(
    allEventsBeforeResolution,
    params.submittedSnapshot,
  );
  let nextSeq = params.submittedSnapshot.lastEventSeq + 1;
  let players = params.submittedSnapshot.players;
  const events: TruthEvent[] = [params.submittedEvent];
  const deathPlayerIds: string[] = [];
  const resolutionEventIdsByActor = new Map<string, string>();

  const wolfSubmission = nightSubmissions.find(
    (event) => event.payload.actionType === "werewolf_kill",
  );
  const seerSubmission = nightSubmissions.find(
    (event) => event.payload.actionType === "seer_check",
  );

  if (wolfSubmission) {
    const targetId = String(wolfSubmission.payload.targetId);
    const resolutionEventId = buildEventId(
      params.context.session.gameId,
      nextSeq,
      "night_action_resolved",
    );
    resolutionEventIdsByActor.set(String(wolfSubmission.actorId), resolutionEventId);
    events.push(
      buildEvent({
        gameId: params.context.session.gameId,
        seq: nextSeq,
        type: "night_action_resolved",
        phase: "night_action",
        source: "rule_engine",
        actorId: wolfSubmission.actorId,
        payload: {
          actorId: wolfSubmission.actorId,
          actionType: "werewolf_kill",
          targetId,
          result: {
            kind: "kill_result",
            targetId,
            killed: true,
            deathEventId: buildEventId(
              params.context.session.gameId,
              nextSeq + (seerSubmission ? 2 : 1),
              "player_died",
            ),
          },
        },
        idempotencyKey: params.action.idempotencyKey,
        now: params.context.now,
        round: params.submittedSnapshot.round,
        visibility: {
          public: false,
          visibleTo: [String(wolfSubmission.actorId)],
          revealInReview: true,
        },
      }),
    );
    nextSeq += 1;
  }

  if (seerSubmission) {
    const targetId = String(seerSubmission.payload.targetId);
    const target = players.find((player) => player.playerId === targetId);
    events.push(
      buildEvent({
        gameId: params.context.session.gameId,
        seq: nextSeq,
        type: "night_action_resolved",
        phase: "night_action",
        source: "rule_engine",
        actorId: seerSubmission.actorId,
        payload: {
          actorId: seerSubmission.actorId,
          actionType: "seer_check",
          targetId,
          result: {
            kind: "seer_check_result",
            targetId,
            factionResult: target?.faction ?? "good_team",
          },
        },
        idempotencyKey: params.action.idempotencyKey,
        now: params.context.now,
        round: params.submittedSnapshot.round,
        visibility: {
          public: false,
          visibleTo: [String(seerSubmission.actorId)],
          revealInReview: true,
        },
      }),
    );
    nextSeq += 1;
  }

  if (wolfSubmission) {
    const targetId = String(wolfSubmission.payload.targetId);
    const deathEvent = buildEvent({
      gameId: params.context.session.gameId,
      seq: nextSeq,
      type: "player_died",
      phase: "night_action",
      source: "rule_engine",
      payload: {
        playerId: targetId,
        deathCause: "night_kill",
        sourceEventId:
          resolutionEventIdsByActor.get(String(wolfSubmission.actorId)) ?? "",
        revealRolePublicly: false,
      },
      idempotencyKey: params.action.idempotencyKey,
      now: params.context.now,
      round: params.submittedSnapshot.round,
      visibility: {
        public: true,
        visibleTo: [],
        revealInReview: true,
      },
    });
    players = players.map((player) =>
      player.playerId === targetId
        ? {
            ...player,
            alive: false,
            deathCause: "night_kill",
            deathEventId: deathEvent.eventId,
            isRoleVisiblePublicly: false,
          }
        : player,
    );
    deathPlayerIds.push(targetId);
    events.push(deathEvent);
    nextSeq += 1;
  }

  const winResult = checkWin(players);
  const checkedAfterEventId = events[events.length - 1]?.eventId ?? params.submittedEvent.eventId;
  events.push(
    buildEvent({
      gameId: params.context.session.gameId,
      seq: nextSeq,
      type: "win_checked",
      phase: "night_action",
      source: "rule_engine",
      payload: {
        ...(winResult
          ? {
              winner: winResult.winner,
              winReason: winResult.winReason,
            }
          : {}),
        checkedAfterEventId,
      },
      idempotencyKey: params.action.idempotencyKey,
      now: params.context.now,
      round: params.submittedSnapshot.round,
      visibility: {
        public: Boolean(winResult),
        visibleTo: [],
        revealInReview: true,
      },
    }),
  );
  nextSeq += 1;

  const toPhase: GamePhase = winResult ? "review" : "day_announcement";
  const nextRound = winResult
    ? params.submittedSnapshot.round
    : {
        ...params.submittedSnapshot.round,
        day: Math.max(
          params.submittedSnapshot.round.day,
          params.submittedSnapshot.round.night,
        ),
        voteRound: "none" as const,
      };
  events.push(
    buildEvent({
      gameId: params.context.session.gameId,
      seq: nextSeq,
      type: "phase_changed",
      phase: "night_action",
      source: "rule_engine",
      payload: {
        fromPhase: "night_action",
        toPhase,
        reason: winResult ? "win_condition_met" : "night_resolved",
      },
      idempotencyKey: params.action.idempotencyKey,
      now: params.context.now,
      round: params.submittedSnapshot.round,
      visibility: {
        public: true,
        visibleTo: [],
        revealInReview: true,
      },
    }),
  );
  nextSeq += 1;

  if (winResult) {
    events.push(
      buildEvent({
        gameId: params.context.session.gameId,
        seq: nextSeq,
        type: "game_ended",
        phase: "review",
        source: "rule_engine",
        payload: {
          winner: winResult.winner,
          winReason: winResult.winReason,
          endedAt: params.context.now,
        },
        idempotencyKey: params.action.idempotencyKey,
        now: params.context.now,
        round: params.submittedSnapshot.round,
        visibility: {
          public: true,
          visibleTo: [],
          revealInReview: true,
        },
      }),
    );
    nextSeq += 1;
  }

  const humanPlayer = players.find((player) => player.isHuman);
  const humanParticipationState =
    humanPlayer?.alive === false
      ? "dead_spectating"
      : params.submittedSnapshot.humanParticipationState;
  const pendingAction =
    !winResult &&
    toPhase === "day_announcement" &&
    humanPlayer?.alive &&
    humanParticipationState === "alive"
      ? {
          type: "confirm" as const,
          actorId: humanPlayer.playerId,
          legalTargets: [],
          allowAbstain: false,
        }
      : null;
  const snapshot: GameSnapshot = {
    ...params.submittedSnapshot,
    lastEventSeq: nextSeq - 1,
    gamePhase: toPhase,
    round: nextRound,
    players,
    pendingAction,
    nightState: {
      ...params.submittedSnapshot.nightState!,
      resolved: true,
      deathPlayerIds,
    },
    humanParticipationState,
    ...(winResult
      ? {
          winner: winResult.winner,
          winReason: winResult.winReason,
          lastResolvedEventId: events[events.length - 1]?.eventId,
        }
      : {
          lastResolvedEventId: events[events.length - 1]?.eventId,
        }),
  };
  const session: GameSession = {
    ...params.context.session,
    status: winResult ? "ended" : params.context.session.status,
    endedAt: winResult ? params.context.now : params.context.session.endedAt,
    currentEventSeq: snapshot.lastEventSeq,
    currentSnapshotSeq: snapshot.lastEventSeq,
  };

  return ok({
    session,
    events,
    snapshot,
    visibleInformation: buildVisibleInformation(params.action.actorId, snapshot, [
      ...params.previousEvents,
      ...events,
    ]),
    nextPendingAction: snapshot.pendingAction,
  });
}

function confirmDayAnnouncement(
  action: Extract<GameAction, { type: "confirm_day_announcement" }>,
  context: RuleEngineContext,
  previousEvents: TruthEvent[],
): Result<RuleEngineSuccess> {
  if (!context.session || !context.snapshot) {
    return rulesError("INVALID_ACTION", "Day announcement requires an existing game.");
  }

  const humanPlayer = context.snapshot.players.find(
    (player) => player.playerId === action.playerId,
  );

  if (
    context.snapshot.gamePhase !== "day_announcement" ||
    context.session.humanPlayerId !== action.playerId ||
    !humanPlayer?.isHuman ||
    !humanPlayer.alive ||
    context.snapshot.humanParticipationState !== "alive"
  ) {
    return rulesError("ACTION_NOT_ALLOWED", "Day announcement cannot be confirmed now.");
  }

  const speakerOrder = getAlivePlayerIdsBySeat(context.snapshot);
  const currentSpeakerId = speakerOrder[0];
  const speechState = {
    day: context.snapshot.round.day,
    speechKind: "day_speech" as const,
    speakerOrder,
    currentSpeakerId,
    completedSpeakerIds: [],
  };
  const pendingAction = currentSpeakerId
    ? {
        type: "speech" as const,
        actorId: currentSpeakerId,
        legalTargets: [],
        allowAbstain: false,
      }
    : null;
  const nextSeq = context.snapshot.lastEventSeq + 1;
  const events = [
    buildEvent({
      gameId: context.session.gameId,
      seq: nextSeq,
      type: "day_announced",
      phase: "day_announcement",
      source: "rule_engine",
      actorId: action.playerId,
      payload: {
        night: context.snapshot.round.night,
        deadPlayerIds: context.snapshot.nightState?.deathPlayerIds ?? [],
        announcementText: buildDayAnnouncementText(
          context.snapshot.nightState?.deathPlayerIds ?? [],
        ),
      },
      idempotencyKey: action.idempotencyKey,
      now: context.now,
      round: context.snapshot.round,
      visibility: {
        public: true,
        visibleTo: [],
        revealInReview: true,
      },
    }),
    buildEvent({
      gameId: context.session.gameId,
      seq: nextSeq + 1,
      type: "phase_changed",
      phase: "day_announcement",
      source: "rule_engine",
      payload: {
        fromPhase: "day_announcement",
        toPhase: "day_speech",
        reason: "day_announcement_confirmed",
      },
      idempotencyKey: action.idempotencyKey,
      now: context.now,
      round: context.snapshot.round,
      visibility: {
        public: true,
        visibleTo: [],
        revealInReview: true,
      },
    }),
  ];
  const snapshot: GameSnapshot = {
    ...context.snapshot,
    lastEventSeq: nextSeq + 1,
    gamePhase: "day_speech",
    speechState,
    pendingAction,
  };
  const session = updateSessionSeq(context.session, snapshot);

  return ok({
    session,
    events,
    snapshot,
    visibleInformation: buildVisibleInformation(action.playerId, snapshot, [
      ...previousEvents,
      ...events,
    ]),
    nextPendingAction: snapshot.pendingAction,
  });
}

function submitSpeech(
  action: Extract<GameAction, { type: "submit_speech" }>,
  context: RuleEngineContext,
  previousEvents: TruthEvent[],
): Result<RuleEngineSuccess> {
  if (!context.session || !context.snapshot || !context.snapshot.speechState) {
    return rulesError("INVALID_ACTION", "Speech requires an active speech state.");
  }

  const text = action.text;

  if (
    text.trim().length === 0 ||
    text.length > MAX_DAY_SPEECH_TEXT_LENGTH
  ) {
    return rulesError("INVALID_ACTION", "Speech text is invalid.");
  }

  const speaker = context.snapshot.players.find(
    (player) => player.playerId === action.speakerId,
  );
  const speechState = context.snapshot.speechState;

  if (
    context.snapshot.gamePhase !== "day_speech" ||
    speechState.speechKind !== "day_speech" ||
    speechState.currentSpeakerId !== action.speakerId ||
    !speaker?.alive ||
    !speechState.speakerOrder.includes(action.speakerId) ||
    speechState.completedSpeakerIds.includes(action.speakerId)
  ) {
    return rulesError("ACTION_NOT_ALLOWED", "Speech is not allowed now.");
  }

  const nextSeq = context.snapshot.lastEventSeq + 1;
  const speechEvent = buildEvent({
    gameId: context.session.gameId,
    seq: nextSeq,
    type: "speech_submitted",
    phase: "day_speech",
    source: speaker.controller,
    actorId: action.speakerId,
    payload: {
      speakerId: action.speakerId,
      day: speechState.day,
      text,
    },
    idempotencyKey: action.idempotencyKey,
    now: context.now,
    round: context.snapshot.round,
    visibility: {
      public: true,
      visibleTo: [],
      revealInReview: true,
    },
  });
  const completedSpeakerIds = [
    ...speechState.completedSpeakerIds,
    action.speakerId,
  ];
  const nextSpeakerId = speechState.speakerOrder.find(
    (speakerId) =>
      !completedSpeakerIds.includes(speakerId) &&
      context.snapshot?.players.some(
        (player) => player.playerId === speakerId && player.alive,
      ),
  );

  if (nextSpeakerId) {
    const snapshot: GameSnapshot = {
      ...context.snapshot,
      lastEventSeq: nextSeq,
      speechState: {
        ...speechState,
        currentSpeakerId: nextSpeakerId,
        completedSpeakerIds,
      },
      pendingAction: {
        type: "speech",
        actorId: nextSpeakerId,
        legalTargets: [],
        allowAbstain: false,
      },
    };
    const session = updateSessionSeq(context.session, snapshot);

    return ok({
      session,
      events: [speechEvent],
      snapshot,
      visibleInformation: buildVisibleInformation(action.speakerId, snapshot, [
        ...previousEvents,
        speechEvent,
      ]),
      nextPendingAction: snapshot.pendingAction,
    });
  }

  const phaseChangedEvent = buildEvent({
    gameId: context.session.gameId,
    seq: nextSeq + 1,
    type: "phase_changed",
    phase: "day_speech",
    source: "rule_engine",
    payload: {
      fromPhase: "day_speech",
      toPhase: "vote",
      reason: "all_speeches_submitted",
    },
    idempotencyKey: action.idempotencyKey,
    now: context.now,
    round: context.snapshot.round,
    visibility: {
      public: true,
      visibleTo: [],
      revealInReview: true,
    },
  });
  const events = [speechEvent, phaseChangedEvent];
  const board = getBoardConfig(context.session.boardId);
  const eligibleVoterIds = getAlivePlayerIdsBySeat(context.snapshot);
  const voteState: VoteState = {
    day: speechState.day,
    voteRound: "first",
    eligibleVoterIds,
    submittedVoterIds: [],
    candidateIds: eligibleVoterIds,
    allowAbstain: board?.allowAbstainVote ?? true,
    resolved: false,
  };
  const snapshot: GameSnapshot = {
    ...context.snapshot,
    lastEventSeq: nextSeq + 1,
    gamePhase: "vote",
    round: { ...context.snapshot.round, voteRound: "first" },
    speechState: {
      ...speechState,
      currentSpeakerId: undefined,
      completedSpeakerIds,
    },
    voteState,
    pendingAction: null,
  };
  const session = updateSessionSeq(context.session, snapshot);

  return ok({
    session,
    events,
    snapshot,
    visibleInformation: buildVisibleInformation(action.speakerId, snapshot, [
      ...previousEvents,
      ...events,
    ]),
    nextPendingAction: snapshot.pendingAction,
  });
}

function submitVote(
  action: Extract<GameAction, { type: "submit_vote" }>,
  context: RuleEngineContext,
  previousEvents: TruthEvent[],
): Result<RuleEngineSuccess> {
  if (!context.session || !context.snapshot || !context.snapshot.voteState) {
    return rulesError("INVALID_ACTION", "Vote requires an active vote state.");
  }

  const snapshot = context.snapshot;
  const voteState = snapshot.voteState!;
  const expectedPhase = action.voteRound === "first" ? "vote" : "tie_vote";
  const voter = snapshot.players.find(
    (player) => player.playerId === action.voterId,
  );

  if (
    snapshot.gamePhase !== expectedPhase ||
    voteState.voteRound !== action.voteRound ||
    voteState.resolved ||
    !voter?.alive ||
    !voteState.eligibleVoterIds.includes(action.voterId) ||
    voteState.submittedVoterIds.includes(action.voterId)
  ) {
    return rulesError("ACTION_NOT_ALLOWED", "Vote is not allowed now.");
  }

  if (action.choiceType === "abstain") {
    if (!voteState.allowAbstain) {
      return rulesError("ACTION_NOT_ALLOWED", "Abstaining is not allowed.");
    }
  } else {
    if (!action.targetId) {
      return rulesError("INVALID_ACTION", "Vote target is required.");
    }

    if (action.targetId === action.voterId) {
      return rulesError("ACTION_NOT_ALLOWED", "Self vote is not allowed.");
    }

    const target = snapshot.players.find(
      (player) => player.playerId === action.targetId,
    );

    if (
      !target?.alive ||
      !voteState.candidateIds.includes(action.targetId)
    ) {
      return rulesError("ACTION_NOT_ALLOWED", "Vote target is not legal.");
    }
  }

  const nextSeq = snapshot.lastEventSeq + 1;
  const voteEvent = buildEvent({
    gameId: context.session.gameId,
    seq: nextSeq,
    type: "vote_submitted",
    phase: expectedPhase,
    source: voter.controller,
    actorId: action.voterId,
    payload: {
      voterId: action.voterId,
      voteRound: action.voteRound,
      choiceType: action.choiceType,
      ...(action.choiceType === "target" ? { targetId: action.targetId } : {}),
    },
    idempotencyKey: action.idempotencyKey,
    now: context.now,
    round: snapshot.round,
    visibility: {
      public: false,
      visibleTo: [action.voterId],
      revealInReview: true,
    },
  });
  const submittedVoterIds = [...voteState.submittedVoterIds, action.voterId];
  const submittedSnapshot: GameSnapshot = {
    ...snapshot,
    lastEventSeq: nextSeq,
    voteState: { ...voteState, submittedVoterIds },
  };

  if (submittedVoterIds.length < voteState.eligibleVoterIds.length) {
    const session = updateSessionSeq(context.session, submittedSnapshot);

    return ok({
      session,
      events: [voteEvent],
      snapshot: submittedSnapshot,
      visibleInformation: buildVisibleInformation(action.voterId, submittedSnapshot, [
        ...previousEvents,
        voteEvent,
      ]),
      nextPendingAction: submittedSnapshot.pendingAction,
    });
  }

  return resolveVote({
    action,
    context,
    previousEvents,
    voteEvent,
    submittedSnapshot,
  });
}

function resolveVote(params: {
  action: Extract<GameAction, { type: "submit_vote" }>;
  context: RuleEngineContext;
  previousEvents: TruthEvent[];
  voteEvent: TruthEvent;
  submittedSnapshot: GameSnapshot;
}): Result<RuleEngineSuccess> {
  if (!params.context.session) {
    return rulesError("INVALID_ACTION", "Vote resolution requires a session.");
  }

  const session = params.context.session;
  const now = params.context.now;
  const snapshot = params.submittedSnapshot;
  const voteState = snapshot.voteState!;
  const votePhase = snapshot.gamePhase;
  const submissions = getCurrentVoteSubmissions(
    [...params.previousEvents, params.voteEvent],
    voteState,
  );

  const counts = new Map<string, number>();
  for (const event of submissions) {
    if (
      event.payload.choiceType === "target" &&
      typeof event.payload.targetId === "string"
    ) {
      const targetId = event.payload.targetId;
      counts.set(targetId, (counts.get(targetId) ?? 0) + 1);
    }
  }
  const tally: Record<string, number> = {};
  for (const [targetId, count] of counts) {
    tally[targetId] = count;
  }
  const voteCounts = [...counts.values()];
  const maxVotes = voteCounts.length > 0 ? Math.max(...voteCounts) : 0;
  const topTargets = [...counts.keys()].filter(
    (targetId) => counts.get(targetId) === maxVotes,
  );
  const hasValidVotes = maxVotes > 0;
  const exiledId =
    hasValidVotes && topTargets.length === 1 ? topTargets[0] : null;
  const outcome: "exile" | "tie" | "no_exile" = exiledId
    ? "exile"
    : voteState.voteRound === "first" && hasValidVotes && topTargets.length > 1
      ? "tie"
      : "no_exile";

  let nextSeq = snapshot.lastEventSeq + 1;
  const events: TruthEvent[] = [params.voteEvent];

  events.push(
    buildEvent({
      gameId: session.gameId,
      seq: nextSeq,
      type: "vote_resolved",
      phase: votePhase,
      source: "rule_engine",
      payload: {
        voteRound: voteState.voteRound,
        day: snapshot.round.day,
        tally,
        exiledPlayerId: exiledId,
        outcome,
      },
      idempotencyKey: params.action.idempotencyKey,
      now,
      round: snapshot.round,
      visibility: { public: true, visibleTo: [], revealInReview: true },
    }),
  );
  nextSeq += 1;

  if (exiledId) {
    const exileEvent = buildEvent({
      gameId: session.gameId,
      seq: nextSeq,
      type: "exile_resolved",
      phase: votePhase,
      source: "rule_engine",
      payload: {
        playerId: exiledId,
        day: snapshot.round.day,
        revealRolePublicly: false,
      },
      idempotencyKey: params.action.idempotencyKey,
      now,
      round: snapshot.round,
      visibility: { public: true, visibleTo: [], revealInReview: true },
    });
    events.push(exileEvent);
    nextSeq += 1;

    const deathEvent = buildEvent({
      gameId: session.gameId,
      seq: nextSeq,
      type: "player_died",
      phase: votePhase,
      source: "rule_engine",
      payload: {
        playerId: exiledId,
        deathCause: "exile",
        sourceEventId: exileEvent.eventId,
        revealRolePublicly: false,
      },
      idempotencyKey: params.action.idempotencyKey,
      now,
      round: snapshot.round,
      visibility: { public: true, visibleTo: [], revealInReview: true },
    });
    events.push(deathEvent);
    nextSeq += 1;

    const players = snapshot.players.map((player) =>
      player.playerId === exiledId
        ? {
            ...player,
            alive: false,
            deathCause: "exile" as const,
            deathEventId: deathEvent.eventId,
            isRoleVisiblePublicly: false,
          }
        : player,
    );

    events.push(
      buildEvent({
        gameId: session.gameId,
        seq: nextSeq,
        type: "phase_changed",
        phase: votePhase,
        source: "rule_engine",
        payload: {
          fromPhase: votePhase,
          toPhase: "exile_last_words",
          reason: "vote_resolved_exile",
        },
        idempotencyKey: params.action.idempotencyKey,
        now,
        round: snapshot.round,
        visibility: { public: true, visibleTo: [], revealInReview: true },
      }),
    );

    const nextSnapshot: GameSnapshot = {
      ...snapshot,
      lastEventSeq: nextSeq,
      gamePhase: "exile_last_words",
      players,
      pendingAction: {
        type: "last_words",
        actorId: exiledId,
        legalTargets: [],
        allowAbstain: false,
      },
      voteState: { ...voteState, resolved: true },
      lastResolvedEventId: events[events.length - 1]?.eventId,
    };
    const nextSession = updateSessionSeq(session, nextSnapshot);

    return ok({
      session: nextSession,
      events,
      snapshot: nextSnapshot,
      visibleInformation: buildVisibleInformation(params.action.voterId, nextSnapshot, [
        ...params.previousEvents,
        ...events,
      ]),
      nextPendingAction: nextSnapshot.pendingAction,
    });
  }

  if (outcome === "tie") {
    const speakerOrder = [...snapshot.players]
      .filter((player) => player.alive && topTargets.includes(player.playerId))
      .sort((left, right) => left.seat - right.seat)
      .map((player) => player.playerId);

    events.push(
      buildEvent({
        gameId: session.gameId,
        seq: nextSeq,
        type: "phase_changed",
        phase: votePhase,
        source: "rule_engine",
        payload: {
          fromPhase: votePhase,
          toPhase: "tie_speech",
          reason: "vote_tied",
        },
        idempotencyKey: params.action.idempotencyKey,
        now,
        round: snapshot.round,
        visibility: { public: true, visibleTo: [], revealInReview: true },
      }),
    );

    const nextSnapshot: GameSnapshot = {
      ...snapshot,
      lastEventSeq: nextSeq,
      gamePhase: "tie_speech",
      speechState: {
        day: snapshot.round.day,
        speechKind: "tie_speech",
        speakerOrder,
        currentSpeakerId: speakerOrder[0],
        completedSpeakerIds: [],
      },
      pendingAction: speakerOrder[0]
        ? {
            type: "tie_speech",
            actorId: speakerOrder[0],
            legalTargets: [],
            allowAbstain: false,
          }
        : null,
      voteState: { ...voteState, resolved: true },
      lastResolvedEventId: events[events.length - 1]?.eventId,
    };
    const nextSession = updateSessionSeq(session, nextSnapshot);

    return ok({
      session: nextSession,
      events,
      snapshot: nextSnapshot,
      visibleInformation: buildVisibleInformation(params.action.voterId, nextSnapshot, [
        ...params.previousEvents,
        ...events,
      ]),
      nextPendingAction: nextSnapshot.pendingAction,
    });
  }

  // NO_EXILE: no valid votes, or a tie-break round that tied again.
  return finishDayResolution({
    context: params.context,
    previousEvents: params.previousEvents,
    priorEvents: events,
    nextSeq,
    players: snapshot.players,
    fromPhase: votePhase,
    viewerId: params.action.voterId,
    baseSnapshot: snapshot,
    idempotencyKey: params.action.idempotencyKey,
  });
}

function submitTieSpeech(
  action: Extract<GameAction, { type: "submit_tie_speech" }>,
  context: RuleEngineContext,
  previousEvents: TruthEvent[],
): Result<RuleEngineSuccess> {
  if (!context.session || !context.snapshot || !context.snapshot.speechState) {
    return rulesError("INVALID_ACTION", "Tie speech requires an active speech state.");
  }

  const text = action.text;

  if (text.trim().length === 0 || text.length > MAX_DAY_SPEECH_TEXT_LENGTH) {
    return rulesError("INVALID_ACTION", "Tie speech text is invalid.");
  }

  const snapshot = context.snapshot;
  const speechState = snapshot.speechState!;
  const speaker = snapshot.players.find(
    (player) => player.playerId === action.speakerId,
  );

  if (
    snapshot.gamePhase !== "tie_speech" ||
    speechState.speechKind !== "tie_speech" ||
    speechState.currentSpeakerId !== action.speakerId ||
    !speaker?.alive ||
    !speechState.speakerOrder.includes(action.speakerId) ||
    speechState.completedSpeakerIds.includes(action.speakerId)
  ) {
    return rulesError("ACTION_NOT_ALLOWED", "Tie speech is not allowed now.");
  }

  const nextSeq = snapshot.lastEventSeq + 1;
  const tieSpeechEvent = buildEvent({
    gameId: context.session.gameId,
    seq: nextSeq,
    type: "tie_speech_submitted",
    phase: "tie_speech",
    source: speaker.controller,
    actorId: action.speakerId,
    payload: {
      speakerId: action.speakerId,
      day: speechState.day,
      text,
    },
    idempotencyKey: action.idempotencyKey,
    now: context.now,
    round: snapshot.round,
    visibility: { public: true, visibleTo: [], revealInReview: true },
  });
  const completedSpeakerIds = [...speechState.completedSpeakerIds, action.speakerId];
  const nextSpeakerId = speechState.speakerOrder.find(
    (speakerId) =>
      !completedSpeakerIds.includes(speakerId) &&
      snapshot.players.some(
        (player) => player.playerId === speakerId && player.alive,
      ),
  );

  if (nextSpeakerId) {
    const nextSnapshot: GameSnapshot = {
      ...snapshot,
      lastEventSeq: nextSeq,
      speechState: {
        ...speechState,
        currentSpeakerId: nextSpeakerId,
        completedSpeakerIds,
      },
      pendingAction: {
        type: "tie_speech",
        actorId: nextSpeakerId,
        legalTargets: [],
        allowAbstain: false,
      },
    };
    const session = updateSessionSeq(context.session, nextSnapshot);

    return ok({
      session,
      events: [tieSpeechEvent],
      snapshot: nextSnapshot,
      visibleInformation: buildVisibleInformation(action.speakerId, nextSnapshot, [
        ...previousEvents,
        tieSpeechEvent,
      ]),
      nextPendingAction: nextSnapshot.pendingAction,
    });
  }

  const board = getBoardConfig(context.session.boardId);
  const phaseChangedEvent = buildEvent({
    gameId: context.session.gameId,
    seq: nextSeq + 1,
    type: "phase_changed",
    phase: "tie_speech",
    source: "rule_engine",
    payload: {
      fromPhase: "tie_speech",
      toPhase: "tie_vote",
      reason: "all_tie_speeches_submitted",
    },
    idempotencyKey: action.idempotencyKey,
    now: context.now,
    round: snapshot.round,
    visibility: { public: true, visibleTo: [], revealInReview: true },
  });
  const eligibleVoterIds = getAlivePlayerIdsBySeat(snapshot);
  const candidateIds = speechState.speakerOrder.filter((speakerId) =>
    snapshot.players.some(
      (player) => player.playerId === speakerId && player.alive,
    ),
  );
  const voteState: VoteState = {
    day: speechState.day,
    voteRound: "tie_break",
    eligibleVoterIds,
    submittedVoterIds: [],
    candidateIds,
    allowAbstain: board?.allowAbstainVote ?? true,
    resolved: false,
  };
  const nextSnapshot: GameSnapshot = {
    ...snapshot,
    lastEventSeq: nextSeq + 1,
    gamePhase: "tie_vote",
    round: { ...snapshot.round, voteRound: "tie_break" },
    speechState: {
      ...speechState,
      currentSpeakerId: undefined,
      completedSpeakerIds,
    },
    voteState,
    pendingAction: null,
  };
  const session = updateSessionSeq(context.session, nextSnapshot);

  return ok({
    session,
    events: [tieSpeechEvent, phaseChangedEvent],
    snapshot: nextSnapshot,
    visibleInformation: buildVisibleInformation(action.speakerId, nextSnapshot, [
      ...previousEvents,
      tieSpeechEvent,
      phaseChangedEvent,
    ]),
    nextPendingAction: nextSnapshot.pendingAction,
  });
}

function submitLastWords(
  action: Extract<GameAction, { type: "submit_last_words" }>,
  context: RuleEngineContext,
  previousEvents: TruthEvent[],
): Result<RuleEngineSuccess> {
  if (!context.session || !context.snapshot) {
    return rulesError("INVALID_ACTION", "Last words require an existing game.");
  }

  const text = action.text;

  if (text.trim().length === 0 || text.length > MAX_DAY_SPEECH_TEXT_LENGTH) {
    return rulesError("INVALID_ACTION", "Last words text is invalid.");
  }

  const snapshot = context.snapshot;

  if (
    snapshot.gamePhase !== "exile_last_words" ||
    snapshot.pendingAction?.actorId !== action.speakerId
  ) {
    return rulesError("ACTION_NOT_ALLOWED", "Last words are not allowed now.");
  }

  const speaker = snapshot.players.find(
    (player) => player.playerId === action.speakerId,
  );

  if (!speaker) {
    return rulesError("ACTION_NOT_ALLOWED", "Last words speaker is not in this game.");
  }

  const nextSeq = snapshot.lastEventSeq + 1;
  const lastWordsEvent = buildEvent({
    gameId: context.session.gameId,
    seq: nextSeq,
    type: "last_words_submitted",
    phase: "exile_last_words",
    source: speaker.controller,
    actorId: action.speakerId,
    payload: {
      speakerId: action.speakerId,
      day: snapshot.round.day,
      text,
    },
    idempotencyKey: action.idempotencyKey,
    now: context.now,
    round: snapshot.round,
    visibility: { public: true, visibleTo: [], revealInReview: true },
  });

  return finishDayResolution({
    context,
    previousEvents,
    priorEvents: [lastWordsEvent],
    nextSeq: nextSeq + 1,
    players: snapshot.players,
    fromPhase: "exile_last_words",
    viewerId: action.speakerId,
    baseSnapshot: snapshot,
    idempotencyKey: action.idempotencyKey,
  });
}

function finishDayResolution(params: {
  context: RuleEngineContext;
  previousEvents: TruthEvent[];
  priorEvents: TruthEvent[];
  nextSeq: number;
  players: Player[];
  fromPhase: GamePhase;
  viewerId: string;
  baseSnapshot: GameSnapshot;
  idempotencyKey: string;
}): Result<RuleEngineSuccess> {
  if (!params.context.session) {
    return rulesError("INVALID_ACTION", "Day resolution requires a session.");
  }

  const session = params.context.session;
  const now = params.context.now;
  const players = params.players;
  const events: TruthEvent[] = [...params.priorEvents];
  let nextSeq = params.nextSeq;

  const winResult = checkWin(players);
  const checkedAfterEventId =
    events[events.length - 1]?.eventId ?? params.baseSnapshot.lastResolvedEventId ?? "";

  events.push(
    buildEvent({
      gameId: session.gameId,
      seq: nextSeq,
      type: "win_checked",
      phase: params.fromPhase,
      source: "rule_engine",
      payload: {
        ...(winResult
          ? { winner: winResult.winner, winReason: winResult.winReason }
          : {}),
        checkedAfterEventId,
      },
      idempotencyKey: params.idempotencyKey,
      now,
      round: params.baseSnapshot.round,
      visibility: { public: Boolean(winResult), visibleTo: [], revealInReview: true },
    }),
  );
  nextSeq += 1;

  const toPhase: GamePhase = winResult ? "review" : "night_action";
  events.push(
    buildEvent({
      gameId: session.gameId,
      seq: nextSeq,
      type: "phase_changed",
      phase: params.fromPhase,
      source: "rule_engine",
      payload: {
        fromPhase: params.fromPhase,
        toPhase,
        reason: winResult ? "win_condition_met" : "day_resolved",
      },
      idempotencyKey: params.idempotencyKey,
      now,
      round: params.baseSnapshot.round,
      visibility: { public: true, visibleTo: [], revealInReview: true },
    }),
  );
  nextSeq += 1;

  if (winResult) {
    events.push(
      buildEvent({
        gameId: session.gameId,
        seq: nextSeq,
        type: "game_ended",
        phase: "review",
        source: "rule_engine",
        payload: {
          winner: winResult.winner,
          winReason: winResult.winReason,
          endedAt: now,
        },
        idempotencyKey: params.idempotencyKey,
        now,
        round: params.baseSnapshot.round,
        visibility: { public: true, visibleTo: [], revealInReview: true },
      }),
    );
    nextSeq += 1;
  }

  const humanPlayer = players.find((player) => player.isHuman);
  const humanParticipationState =
    humanPlayer?.alive === false
      ? "dead_spectating"
      : params.baseSnapshot.humanParticipationState;

  if (winResult) {
    const snapshot: GameSnapshot = {
      ...params.baseSnapshot,
      lastEventSeq: nextSeq - 1,
      gamePhase: "review",
      players,
      pendingAction: null,
      humanParticipationState,
      winner: winResult.winner,
      winReason: winResult.winReason,
      lastResolvedEventId: events[events.length - 1]?.eventId,
    };
    const newSession: GameSession = {
      ...session,
      status: "ended",
      endedAt: now,
      currentEventSeq: snapshot.lastEventSeq,
      currentSnapshotSeq: snapshot.lastEventSeq,
    };

    return ok({
      session: newSession,
      events,
      snapshot,
      visibleInformation: buildVisibleInformation(params.viewerId, snapshot, [
        ...params.previousEvents,
        ...events,
      ]),
      nextPendingAction: snapshot.pendingAction,
    });
  }

  const nextNight = params.baseSnapshot.round.night + 1;
  const nightActors = players
    .filter(
      (player) =>
        player.alive && (player.role === "werewolf" || player.role === "seer"),
    )
    .map((player) => player.playerId);
  const pendingAction =
    humanPlayer?.alive &&
    (humanPlayer.role === "werewolf" || humanPlayer.role === "seer") &&
    humanParticipationState === "alive"
      ? {
          type: "night_action" as const,
          actorId: humanPlayer.playerId,
          legalTargets: players
            .filter(
              (player) => player.alive && player.playerId !== humanPlayer.playerId,
            )
            .map((player) => player.playerId),
          allowAbstain: false,
        }
      : null;
  const snapshot: GameSnapshot = {
    ...params.baseSnapshot,
    lastEventSeq: nextSeq - 1,
    gamePhase: "night_action",
    round: { night: nextNight, day: params.baseSnapshot.round.day, voteRound: "none" },
    players,
    pendingAction,
    humanParticipationState,
    nightState: {
      night: nextNight,
      requiredActorIds: nightActors,
      submittedActorIds: [],
      resolved: false,
      deathPlayerIds: [],
    },
    speechState: undefined,
    voteState: undefined,
    lastResolvedEventId: events[events.length - 1]?.eventId,
  };
  const newSession = updateSessionSeq(session, snapshot);

  return ok({
    session: newSession,
    events,
    snapshot,
    visibleInformation: buildVisibleInformation(params.viewerId, snapshot, [
      ...params.previousEvents,
      ...events,
    ]),
    nextPendingAction: snapshot.pendingAction,
  });
}

function getCurrentVoteSubmissions(
  events: TruthEvent[],
  voteState: VoteState,
): TruthEvent[] {
  return voteState.submittedVoterIds.flatMap((voterId) => {
    const event = [...events]
      .reverse()
      .find(
        (candidate) =>
          candidate.type === "vote_submitted" &&
          candidate.actorId === voterId &&
          candidate.payload.voteRound === voteState.voteRound,
      );

    return event ? [event] : [];
  });
}

function buildNoopResult(
  action: GameAction,
  context: RuleEngineContext,
  previousEvents: TruthEvent[],
  duplicateEvents: TruthEvent[],
): Result<RuleEngineSuccess> {
  if (!context.session || !context.snapshot) {
    return rulesError("DUPLICATE_SUBMIT", "Duplicate action ignored.");
  }

  const viewerId = getViewerId(action, context.session);
  const originalViewerId = getSingleViewerIdForEvents(duplicateEvents);

  if (
    !originalViewerId ||
    viewerId !== originalViewerId ||
    !canBuildVisibleInformationForViewer(viewerId, {
      session: context.session,
      snapshot: context.snapshot,
    })
  ) {
    return rulesError("ACTION_NOT_ALLOWED", "Action actor is not part of this game.");
  }

  return ok({
    session: context.session,
    events: [],
    snapshot: context.snapshot,
    visibleInformation: buildVisibleInformation(
      viewerId,
      context.snapshot,
      previousEvents,
    ),
    nextPendingAction: context.snapshot.pendingAction,
  });
}

function getSingleViewerIdForEvents(events: TruthEvent[]): string | null {
  const viewerIds = new Set(
    events.flatMap((event) => {
      const viewerId = getViewerIdForEvent(event);

      return viewerId ? [viewerId] : [];
    }),
  );

  if (viewerIds.size !== 1) {
    return null;
  }

  return [...viewerIds][0] ?? null;
}

function getViewerIdForEvent(event: TruthEvent): string | null {
  switch (event.type) {
    case "game_created":
      return getPayloadString(event.payload, "humanPlayerId");
    case "game_started":
    case "human_role_revealed":
    case "day_announced":
    case "fast_forward_requested":
      return event.actorId ?? getPayloadString(event.payload, "playerId");
    case "night_action_submitted":
      return event.actorId ?? getPayloadString(event.payload, "actorId");
    case "speech_submitted":
    case "tie_speech_submitted":
    case "last_words_submitted":
      return event.actorId ?? getPayloadString(event.payload, "speakerId");
    case "vote_submitted":
      return event.actorId ?? getPayloadString(event.payload, "voterId");
    default:
      return null;
  }
}

function canBuildVisibleInformationForViewer(
  viewerId: string,
  context: Required<Pick<RuleEngineContext, "session" | "snapshot">>,
): boolean {
  if (context.snapshot.players.length === 0) {
    return (
      context.snapshot.gamePhase === "role_setup" &&
      viewerId === context.session.humanPlayerId
    );
  }

  return context.snapshot.players.some((player) => player.playerId === viewerId);
}

function buildSession(params: {
  action: Extract<GameAction, { type: "create_game" }>;
  gameId: string;
  currentEventSeq: number;
  currentSnapshotSeq: number;
  now: string;
}): GameSession {
  return {
    gameId: params.gameId,
    schemaVersion: "phase3-mvp-v1",
    mode: params.action.mode,
    boardId: params.action.boardId,
    status: "created",
    createdAt: params.now,
    currentEventSeq: params.currentEventSeq,
    currentSnapshotSeq: params.currentSnapshotSeq,
    humanPlayerId: params.action.humanPlayerId,
    randomSeed: params.action.idempotencyKey,
  };
}

function buildBaseSnapshot(
  gameId: string,
  gamePhase: "role_setup" | "role_reveal",
  lastEventSeq: number,
  players: GameSnapshot["players"],
): GameSnapshot {
  const pendingAction =
    gamePhase === "role_reveal"
      ? {
          type: "confirm" as const,
          actorId: players.find((player) => player.isHuman)?.playerId,
          legalTargets: [],
          allowAbstain: false,
        }
      : null;

  return {
    gameId,
    lastEventSeq,
    gamePhase,
    humanParticipationState: "alive",
    round: { night: 0, day: 0, voteRound: "none" },
    players,
    pendingAction,
  };
}

function buildAssignmentEvents(params: {
  action: {
    idempotencyKey: string;
    mode: GameMode;
    boardId: string;
    humanPlayerId: string;
  };
  gameId: string;
  players: GameSnapshot["players"];
  startingSeq: number;
  setupPhase: "mode_select" | "role_setup";
  now: string;
}): TruthEvent[] {
  return [
    buildEvent({
      gameId: params.gameId,
      seq: params.startingSeq,
      type: "game_created",
      phase: params.setupPhase,
      source: "human",
      payload: {
        mode: params.action.mode,
        boardId: params.action.boardId,
        humanPlayerId: params.action.humanPlayerId,
      },
      idempotencyKey: params.action.idempotencyKey,
      now: params.now,
      visibility: { public: false, visibleTo: [], revealInReview: true },
    }),
    ...buildRoleAssignmentEvents({
      idempotencyKey: params.action.idempotencyKey,
      gameId: params.gameId,
      players: params.players,
      startingSeq: params.startingSeq + 1,
      setupPhase: params.setupPhase,
      now: params.now,
    }),
  ];
}

function buildRoleAssignmentEvents(params: {
  idempotencyKey: string;
  gameId: string;
  players: GameSnapshot["players"];
  startingSeq: number;
  setupPhase: "mode_select" | "role_setup";
  now: string;
}): TruthEvent[] {
  const human = params.players.find((player) => player.isHuman);

  if (!human) {
    throw new Error("Assigned players must include a human.");
  }

  return [
    buildEvent({
      gameId: params.gameId,
      seq: params.startingSeq,
      type: "players_assigned",
      phase: params.setupPhase,
      source: "rule_engine",
      payload: {
        players: params.players.map((player) => ({
          playerId: player.playerId,
          seat: player.seat,
          controller: player.controller,
          role: player.role,
          faction: player.faction,
        })),
      },
      idempotencyKey: params.idempotencyKey,
      now: params.now,
      visibility: { public: false, visibleTo: [], revealInReview: true },
    }),
    buildEvent({
      gameId: params.gameId,
      seq: params.startingSeq + 1,
      type: "human_role_revealed",
      phase: "role_reveal",
      source: "rule_engine",
      actorId: human.playerId,
      payload: {
        playerId: human.playerId,
        seat: human.seat,
        role: human.role,
      },
      idempotencyKey: params.idempotencyKey,
      now: params.now,
      visibility: {
        public: false,
        visibleTo: [human.playerId],
        revealInReview: true,
      },
    }),
  ];
}

function buildEmptySetupVisibleInformation(
  action: Extract<GameAction, { type: "create_game" }>,
  snapshot: GameSnapshot,
): VisibleInformationSnapshot {
  return {
    gameId: snapshot.gameId,
    viewerId: action.humanPlayerId,
    generatedAtSeq: snapshot.lastEventSeq,
    gamePhase: snapshot.gamePhase,
    humanParticipationState: snapshot.humanParticipationState,
    round: snapshot.round,
    ownSeat: 1,
    ownRole: "villager",
    ownFaction: "good_team",
    alivePlayers: [],
    deadPlayers: [],
    publicEvents: [],
    privateEvents: [],
    speeches: [],
    votes: [],
    legalActions: [
      {
        actionType: "confirm",
        actorId: action.humanPlayerId,
        legalTargets: [],
        allowAbstain: false,
        required: true,
      },
    ],
    canAct: true,
  };
}

function buildEvent(params: {
  gameId: string;
  seq: number;
  type: TruthEvent["type"];
  phase: TruthEvent["phase"];
  source: TruthEvent["source"];
  payload: Record<string, unknown>;
  idempotencyKey: string;
  now: string;
  visibility: TruthEvent["visibility"];
  actorId?: string;
  round?: RoundRef;
}): TruthEvent {
  return {
    eventId: buildEventId(params.gameId, params.seq, params.type),
    gameId: params.gameId,
    seq: params.seq,
    type: params.type,
    phase: params.phase,
    round: params.round ?? roundForPhase(params.phase),
    actorId: params.actorId,
    source: params.source,
    payload: params.payload,
    visibility: params.visibility,
    metadata: {
      idempotencyKey: params.idempotencyKey,
      generatedBy:
        params.source === "human" || params.source === "ai"
          ? params.source
          : "rule_engine",
    },
    createdAt: params.now,
  };
}

function buildEventId(
  gameId: string,
  seq: number,
  type: TruthEvent["type"],
): string {
  return `${gameId}-${seq}-${type}`;
}

function roundForPhase(phase: TruthEvent["phase"]): RoundRef {
  if (phase === "night_action") {
    return { night: 1, day: 0, voteRound: "none" };
  }

  return { night: 0, day: 0, voteRound: "none" };
}

function findEventsByIdempotencyKey(
  events: TruthEvent[],
  idempotencyKey: string,
): TruthEvent[] {
  return events.filter((event) => event.metadata.idempotencyKey === idempotencyKey);
}

function updateSessionSeq(
  session: GameSession,
  snapshot: GameSnapshot,
): GameSession {
  return {
    ...session,
    currentEventSeq: snapshot.lastEventSeq,
    currentSnapshotSeq: snapshot.lastEventSeq,
  };
}

function getNightActionTypeForActor(
  actor: Player | undefined,
): Exclude<NightActionType, "none"> | null {
  if (actor?.role === "werewolf") {
    return "werewolf_kill";
  }

  if (actor?.role === "seer") {
    return "seer_check";
  }

  return null;
}

function isLegalNightTarget(
  actor: Player,
  target: Player,
  snapshot: GameSnapshot,
): boolean {
  if (!target.alive || target.playerId === actor.playerId) {
    return false;
  }

  if (
    actor.role === "werewolf" &&
    snapshot.round.night === 1 &&
    target.isHuman
  ) {
    return false;
  }

  return true;
}

function hasAllNightActorsSubmitted(snapshot: GameSnapshot): boolean {
  const nightState = snapshot.nightState;

  if (!nightState) {
    return false;
  }

  return nightState.requiredActorIds.every((actorId) =>
    nightState.submittedActorIds.includes(actorId),
  );
}

function getCurrentNightSubmissions(
  events: TruthEvent[],
  snapshot: GameSnapshot,
): TruthEvent[] {
  const submittedActorIds = snapshot.nightState?.submittedActorIds ?? [];

  return submittedActorIds.flatMap((actorId) => {
    const event = [...events]
      .reverse()
      .find(
        (candidate) =>
          candidate.type === "night_action_submitted" &&
          candidate.phase === "night_action" &&
          candidate.actorId === actorId,
      );

    return event ? [event] : [];
  });
}

function getAlivePlayerIdsBySeat(snapshot: GameSnapshot): string[] {
  return [...snapshot.players]
    .filter((player) => player.alive)
    .sort((left, right) => left.seat - right.seat)
    .map((player) => player.playerId);
}

function buildDayAnnouncementText(deadPlayerIds: string[]): string {
  if (deadPlayerIds.length === 0) {
    return "天亮了，昨夜平安夜。";
  }

  return `天亮了，昨夜 ${deadPlayerIds.join("、")} 死亡，身份不公开。`;
}

function checkWin(
  players: Player[],
): { winner: Player["faction"]; winReason: WinReason } | null {
  const aliveWerewolves = players.filter(
    (player) => player.alive && player.role === "werewolf",
  );
  const aliveGoodPlayers = players.filter(
    (player) => player.alive && player.faction === "good_team",
  );

  if (aliveWerewolves.length === 0) {
    return {
      winner: "good_team",
      winReason: "all_werewolves_dead",
    };
  }

  if (aliveWerewolves.length >= aliveGoodPlayers.length) {
    return {
      winner: "werewolf_team",
      winReason: "werewolves_reach_parity",
    };
  }

  return null;
}

function getViewerId(action: GameAction, session: GameSession): string {
  if ("humanPlayerId" in action) {
    return action.humanPlayerId;
  }

  if ("playerId" in action) {
    return action.playerId;
  }

  if ("actorId" in action) {
    return action.actorId;
  }

  if ("voterId" in action) {
    return action.voterId;
  }

  if ("speakerId" in action) {
    return action.speakerId;
  }

  return session.humanPlayerId;
}

function getPayloadString(
  payload: Record<string, unknown>,
  ...keys: string[]
): string | null {
  for (const key of keys) {
    const value = payload[key];

    if (typeof value === "string") {
      return value;
    }
  }

  return null;
}

function buildGameId(mode: GameMode, idempotencyKey: string): string {
  return `game-${mode}-${idempotencyKey}`;
}

function rulesError(
  code: "INVALID_ACTION" | "ACTION_NOT_ALLOWED" | "DUPLICATE_SUBMIT",
  message: string,
): Result<never> {
  return err({
    code,
    message,
    retryable: false,
    source: "rules",
  });
}
