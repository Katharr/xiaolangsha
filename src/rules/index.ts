import type {
  GameAction,
  GameMode,
  GameSession,
  GameSnapshot,
  PendingAction,
  Result,
  RoundRef,
  TruthEvent,
  VisibleInformationSnapshot,
} from "../shared";
import { err, gameActionSchema, ok } from "../shared";
import { getBoardConfig } from "./boards";
import { assignPlayersWithHumanRole, assignStandardPlayers } from "./identity";
import { buildVisibleInformation } from "./visibility";

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

  if (hasSeenIdempotencyKey(previousEvents, validAction.idempotencyKey)) {
    return buildNoopResult(validAction, context, previousEvents);
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

function buildNoopResult(
  action: GameAction,
  context: RuleEngineContext,
  previousEvents: TruthEvent[],
): Result<RuleEngineSuccess> {
  if (!context.session || !context.snapshot) {
    return rulesError("DUPLICATE_SUBMIT", "Duplicate action ignored.");
  }

  const viewerId = getViewerId(action, context.session);

  if (
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
}): TruthEvent {
  return {
    eventId: `${params.gameId}-${params.seq}-${params.type}`,
    gameId: params.gameId,
    seq: params.seq,
    type: params.type,
    phase: params.phase,
    round: roundForPhase(params.phase),
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

function roundForPhase(phase: TruthEvent["phase"]): RoundRef {
  if (phase === "night_action") {
    return { night: 1, day: 0, voteRound: "none" };
  }

  return { night: 0, day: 0, voteRound: "none" };
}

function hasSeenIdempotencyKey(
  events: TruthEvent[],
  idempotencyKey: string,
): boolean {
  return events.some((event) => event.metadata.idempotencyKey === idempotencyKey);
}

function getViewerId(action: GameAction, session: GameSession): string {
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
