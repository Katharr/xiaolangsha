import type {
  GameAction,
  GamePhase,
  GameMode,
  GameSession,
  GameSnapshot,
  HumanParticipationState,
  NightActionType,
  NightState,
  NightStepKind,
  PendingAction,
  Player,
  Result,
  RoundRef,
  TruthEvent,
  VisibleInformationSnapshot,
  VoteState,
  WinConditionMode,
  WinReason,
  WitchState,
} from "../shared";
import { err, gameActionSchema, ok } from "../shared";
import { getBoardConfig } from "./boards";
import {
  assignPlayersWithHumanRole,
  assignStandardPlayers,
  roleCategory,
} from "./identity";
import {
  buildNightState,
  currentNightStep,
  legalNightTargets,
  nextNightActor,
  tallyWolfKill,
  computeNightDeaths,
} from "./night";
import { buildVisibleInformation } from "./visibility";

export { buildVisibleInformation } from "./visibility";
export { getBoardConfig, MVP_5P_BOARD_ID, STANDARD_BOARD_ID } from "./boards";
export { buildReviewContext } from "./review";

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
    case "submit_witch_action":
      return submitWitchAction(validAction, context, previousEvents);
    case "submit_hunter_shoot":
      return submitHunterShoot(validAction, context, previousEvents);
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
    case "confirm_new_game":
      return confirmNewGame(validAction, context, previousEvents);
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
      seed: action.idempotencyKey,
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

  const players = context.snapshot.players;
  const startedAt = context.session.startedAt ?? context.now;
  const nextSeq = context.snapshot.lastEventSeq + 1;
  const events: TruthEvent[] = [
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
  ];
  let lastSeq = nextSeq;

  // 狼人互认：把狼队名单私发给全部狼（visibleTo=狼），好让狼的可见信息知道队友是谁。
  const werewolves = players.filter((player) => player.role === "werewolf");
  if (werewolves.length > 0) {
    lastSeq += 1;
    events.push(
      buildEvent({
        gameId: context.session.gameId,
        seq: lastSeq,
        type: "werewolf_team_revealed",
        phase: "role_reveal",
        source: "rule_engine",
        payload: {
          werewolfIds: werewolves.map((wolf) => wolf.playerId),
          werewolves: werewolves.map((wolf) => ({
            playerId: wolf.playerId,
            name: wolf.name,
            seat: wolf.seat,
          })),
        },
        idempotencyKey: action.idempotencyKey,
        now: context.now,
        visibility: {
          public: false,
          visibleTo: werewolves.map((wolf) => wolf.playerId),
          revealInReview: true,
        },
      }),
    );
  }

  lastSeq += 1;
  events.push(
    buildEvent({
      gameId: context.session.gameId,
      seq: lastSeq,
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
  );

  const { nightState, pendingAction } = enterNight({
    players,
    night: 1,
    humanPlayerId: context.session.humanPlayerId,
    humanParticipationState: context.snapshot.humanParticipationState,
  });
  const snapshot: GameSnapshot = {
    ...context.snapshot,
    lastEventSeq: lastSeq,
    gamePhase: "night_action",
    round: { night: 1, day: 0, voteRound: "none" },
    pendingAction,
    nightState,
    witchState: buildInitialWitchState(players),
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

  const snapshot = context.snapshot;
  const nightState = snapshot.nightState!;
  const step = currentNightStep(nightState);

  if (snapshot.gamePhase !== "night_action" || nightState.resolved || !step) {
    return rulesError("ACTION_NOT_ALLOWED", "Night action is not allowed now.");
  }

  // 女巫走 submit_witch_action；这里只处理守卫/狼/预言家。
  if (step.kind === "witch_action") {
    return rulesError("ACTION_NOT_ALLOWED", "It is the witch's turn, not a basic night action.");
  }

  const actor = snapshot.players.find(
    (player) => player.playerId === action.actorId,
  );

  if (
    !actor?.alive ||
    action.actionType !== step.kind ||
    !step.actorIds.includes(action.actorId) ||
    step.submittedActorIds.includes(action.actorId)
  ) {
    return rulesError("ACTION_NOT_ALLOWED", "Night action is not allowed now.");
  }

  if (!action.targetId) {
    return rulesError("INVALID_ACTION", "Night action target is required.");
  }

  if (!legalNightTargets(actor, snapshot.players, snapshot.round.night).includes(action.targetId)) {
    return rulesError("ACTION_NOT_ALLOWED", "Night action target is not legal.");
  }

  let seq = snapshot.lastEventSeq + 1;
  const events: TruthEvent[] = [
    buildEvent({
      gameId: context.session.gameId,
      seq,
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
      round: snapshot.round,
      visibility: { public: false, visibleTo: [action.actorId], revealInReview: true },
    }),
  ];
  seq += 1;

  // 预言家查验：立即私发结果（仅预言家可见）。
  if (action.actionType === "seer_check") {
    const target = snapshot.players.find((p) => p.playerId === action.targetId);
    events.push(
      buildEvent({
        gameId: context.session.gameId,
        seq,
        type: "night_action_resolved",
        phase: "night_action",
        source: "rule_engine",
        actorId: action.actorId,
        payload: {
          actorId: action.actorId,
          actionType: "seer_check",
          targetId: action.targetId,
          result: {
            kind: "seer_check_result",
            targetId: action.targetId,
            factionResult: target?.faction ?? "good_team",
          },
        },
        idempotencyKey: action.idempotencyKey,
        now: context.now,
        round: snapshot.round,
        visibility: { public: false, visibleTo: [action.actorId], revealInReview: true },
      }),
    );
    seq += 1;
  }

  let working = markNightActorSubmitted(nightState, action.actorId);
  if (action.actionType === "guard_protect") {
    working = { ...working, guardProtectedId: action.targetId };
  } else if (action.actionType === "werewolf_kill") {
    working = {
      ...working,
      wolfVotes: { ...(working.wolfVotes ?? {}), [action.actorId]: action.targetId },
    };
  }

  return continueNight({
    context,
    previousEvents,
    emittedEvents: events,
    nextSeq: seq,
    workingNight: working,
    witchState: snapshot.witchState,
    baseSnapshot: snapshot,
    viewerId: action.actorId,
    idempotencyKey: action.idempotencyKey,
  });
}

function submitWitchAction(
  action: Extract<GameAction, { type: "submit_witch_action" }>,
  context: RuleEngineContext,
  previousEvents: TruthEvent[],
): Result<RuleEngineSuccess> {
  if (!context.session || !context.snapshot || !context.snapshot.nightState) {
    return rulesError("INVALID_ACTION", "Witch action requires an existing night.");
  }

  const snapshot = context.snapshot;
  const nightState = snapshot.nightState!;
  const step = currentNightStep(nightState);

  if (
    snapshot.gamePhase !== "night_action" ||
    nightState.resolved ||
    !step ||
    step.kind !== "witch_action"
  ) {
    return rulesError("ACTION_NOT_ALLOWED", "Witch action is not allowed now.");
  }

  const witch = snapshot.players.find((p) => p.playerId === action.actorId);
  if (
    !witch?.alive ||
    witch.role !== "witch" ||
    !step.actorIds.includes(action.actorId) ||
    step.submittedActorIds.includes(action.actorId)
  ) {
    return rulesError("ACTION_NOT_ALLOWED", "Witch action is not allowed now.");
  }

  const witchState = snapshot.witchState ?? { saveAvailable: false, poisonAvailable: false };
  const board = getBoardConfig(context.session.boardId);
  let working = nightState;
  let newWitchState = witchState;
  let resolvedActionType: NightActionType = "none";
  let payloadTargetId: string | undefined;

  if (action.witchChoice === "save") {
    const killed = nightState.wolfKillTargetId;
    if (!witchState.saveAvailable || !killed) {
      return rulesError("ACTION_NOT_ALLOWED", "Witch cannot use the antidote now.");
    }
    // 主流规则：自救仅限首夜（板规 witchCanSelfSaveFirstNight 开启时）；非首夜一律不可自救。
    if (
      killed === action.actorId &&
      (snapshot.round.night !== 1 || !board?.witchCanSelfSaveFirstNight)
    ) {
      return rulesError("ACTION_NOT_ALLOWED", "Witch can only self-save on the first night.");
    }
    working = { ...working, witchSavedTargetId: killed };
    newWitchState = { ...witchState, saveAvailable: false };
    resolvedActionType = "witch_save";
    payloadTargetId = killed;
  } else if (action.witchChoice === "poison") {
    if (!witchState.poisonAvailable) {
      return rulesError("ACTION_NOT_ALLOWED", "Witch has no poison left.");
    }
    if (!action.targetId) {
      return rulesError("INVALID_ACTION", "Poison requires a target.");
    }
    const target = snapshot.players.find((p) => p.playerId === action.targetId);
    if (!target?.alive || target.playerId === action.actorId) {
      return rulesError("ACTION_NOT_ALLOWED", "Poison target is not legal.");
    }
    working = { ...working, poisonTargetId: action.targetId };
    newWitchState = { ...witchState, poisonAvailable: false };
    resolvedActionType = "witch_poison";
    payloadTargetId = action.targetId;
  }
  // witchChoice === "skip" → no state change.

  let seq = snapshot.lastEventSeq + 1;
  const events: TruthEvent[] = [
    buildEvent({
      gameId: context.session.gameId,
      seq,
      type: "night_action_submitted",
      phase: "night_action",
      source: witch.controller,
      actorId: action.actorId,
      payload: {
        actorId: action.actorId,
        actionType: resolvedActionType,
        witchChoice: action.witchChoice,
        ...(payloadTargetId ? { targetId: payloadTargetId } : {}),
      },
      idempotencyKey: action.idempotencyKey,
      now: context.now,
      round: snapshot.round,
      visibility: { public: false, visibleTo: [action.actorId], revealInReview: true },
    }),
  ];
  seq += 1;

  working = markNightActorSubmitted(working, action.actorId);

  return continueNight({
    context,
    previousEvents,
    emittedEvents: events,
    nextSeq: seq,
    workingNight: working,
    witchState: newWitchState,
    baseSnapshot: snapshot,
    viewerId: action.actorId,
    idempotencyKey: action.idempotencyKey,
  });
}

/** 把行动者记入当前步骤的 submittedActorIds（不动其它步骤）。 */
function markNightActorSubmitted(nightState: NightState, actorId: string): NightState {
  return {
    ...nightState,
    steps: nightState.steps.map((stepItem, index) =>
      index === nightState.currentStepIndex
        ? { ...stepItem, submittedActorIds: [...stepItem.submittedActorIds, actorId] }
        : stepItem,
    ),
  };
}

/**
 * 当前步骤是否已全员提交；若是则推进到下一步（狼步结算多数票刀杀目标）。
 * 返回是否应进入夜晚结算、以及刚进入的下一步类型（用于私发女巫提示）。
 */
function advanceNightStep(
  nightState: NightState,
  players: Player[],
): { nightState: NightState; enteredStepKind: NightStepKind | null; resolveNow: boolean } {
  const step = currentNightStep(nightState);
  if (!step) {
    return { nightState, enteredStepKind: null, resolveNow: true };
  }
  const aliveActors = step.actorIds.filter((id) =>
    players.some((p) => p.playerId === id && p.alive),
  );
  const done = aliveActors.every((id) => step.submittedActorIds.includes(id));
  if (!done) {
    return { nightState, enteredStepKind: null, resolveNow: false };
  }

  let next = nightState;
  if (step.kind === "werewolf_kill") {
    next = { ...next, wolfKillTargetId: tallyWolfKill(next.wolfVotes, players) };
  }
  next = { ...next, currentStepIndex: next.currentStepIndex + 1 };
  const nextStep = next.steps[next.currentStepIndex];
  if (!nextStep) {
    return { nightState: next, enteredStepKind: null, resolveNow: true };
  }
  return { nightState: next, enteredStepKind: nextStep.kind, resolveNow: false };
}

/**
 * 单个夜晚提交后的统一收尾：推进步骤；若全部步骤完成则结算夜晚，
 * 否则（进入女巫步则私发刀杀提示）更新 pendingAction 等待下一行动者。
 */
function continueNight(params: {
  context: RuleEngineContext;
  previousEvents: TruthEvent[];
  emittedEvents: TruthEvent[];
  nextSeq: number;
  workingNight: NightState;
  witchState?: WitchState;
  baseSnapshot: GameSnapshot;
  viewerId: string;
  idempotencyKey: string;
}): Result<RuleEngineSuccess> {
  const session = params.context.session!;
  const players = params.baseSnapshot.players;
  const events = [...params.emittedEvents];
  let seq = params.nextSeq;

  const advanced = advanceNightStep(params.workingNight, players);

  if (advanced.resolveNow) {
    return resolveNight({
      context: params.context,
      previousEvents: params.previousEvents,
      priorEvents: events,
      nextSeq: seq,
      nightState: advanced.nightState,
      witchState: params.witchState,
      baseSnapshot: params.baseSnapshot,
      viewerId: params.viewerId,
      idempotencyKey: params.idempotencyKey,
    });
  }

  // 进入女巫步：私发「今晚谁倒牌」给女巫（仅女巫可见），好让她决定是否用药。
  if (advanced.enteredStepKind === "witch_action") {
    const witch = players.find((p) => p.role === "witch" && p.alive);
    if (witch) {
      events.push(
        buildEvent({
          gameId: session.gameId,
          seq,
          type: "night_action_resolved",
          phase: "night_action",
          source: "rule_engine",
          actorId: witch.playerId,
          payload: {
            actorId: witch.playerId,
            actionType: "none",
            result: {
              kind: "witch_wake",
              killedTargetId: advanced.nightState.wolfKillTargetId ?? null,
              // 解药/毒药剩余次数随私有事件下发，供 UI/AI 决定可用按钮（仅女巫可见）。
              saveAvailable: params.witchState?.saveAvailable ?? false,
              poisonAvailable: params.witchState?.poisonAvailable ?? false,
            },
          },
          idempotencyKey: params.idempotencyKey,
          now: params.context.now,
          round: params.baseSnapshot.round,
          visibility: { public: false, visibleTo: [witch.playerId], revealInReview: true },
        }),
      );
      seq += 1;
    }
  }

  const pendingAction = pendingActionForNight(
    advanced.nightState,
    players,
    session.humanPlayerId,
    params.baseSnapshot.humanParticipationState,
    params.baseSnapshot.round.night,
  );
  const snapshot: GameSnapshot = {
    ...params.baseSnapshot,
    lastEventSeq: seq - 1,
    nightState: advanced.nightState,
    witchState: params.witchState,
    pendingAction,
  };
  const session2 = updateSessionSeq(session, snapshot);

  return ok({
    session: session2,
    events,
    snapshot,
    visibleInformation: buildVisibleInformation(params.viewerId, snapshot, [
      ...params.previousEvents,
      ...events,
    ]),
    nextPendingAction: pendingAction,
  });
}

function resolveNight(params: {
  context: RuleEngineContext;
  previousEvents: TruthEvent[];
  priorEvents: TruthEvent[];
  nextSeq: number;
  nightState: NightState;
  witchState?: WitchState;
  baseSnapshot: GameSnapshot;
  viewerId: string;
  idempotencyKey: string;
}): Result<RuleEngineSuccess> {
  if (!params.context.session) {
    return rulesError("INVALID_ACTION", "Night resolution requires a session.");
  }

  const session = params.context.session;
  const now = params.context.now;
  let seq = params.nextSeq;
  let players = params.baseSnapshot.players;
  const events: TruthEvent[] = [...params.priorEvents];
  const deaths = computeNightDeaths(params.nightState);
  const deathPlayerIds: string[] = [];

  // 狼刀结算（私发狼队、计入复盘）：记录今晚狼队的刀杀目标与是否得手。
  const wolfKillTargetId = params.nightState.wolfKillTargetId;
  if (wolfKillTargetId) {
    const killed = deaths.some(
      (death) => death.playerId === wolfKillTargetId && death.cause === "night_kill",
    );
    const werewolfIds = params.baseSnapshot.players
      .filter((player) => player.role === "werewolf")
      .map((player) => player.playerId);
    // 狼刀是团队决策：记录本夜每匹狼各自投了谁（wolfVotes）及全部参与者，供复盘还原细节。
    const wolfVotes = params.nightState.wolfVotes ?? {};
    const actorIds = Object.keys(wolfVotes).length > 0 ? Object.keys(wolfVotes) : werewolfIds;
    events.push(
      buildEvent({
        gameId: session.gameId,
        seq,
        type: "night_action_resolved",
        phase: "night_action",
        source: "rule_engine",
        payload: {
          actorId: actorIds[0] ?? "",
          actorIds,
          actionType: "werewolf_kill",
          targetId: wolfKillTargetId,
          result: { kind: "kill_result", targetId: wolfKillTargetId, killed, wolfVotes },
        },
        idempotencyKey: params.idempotencyKey,
        now,
        round: params.baseSnapshot.round,
        visibility: { public: false, visibleTo: werewolfIds, revealInReview: true },
      }),
    );
    seq += 1;
  }

  for (const death of deaths) {
    const deathEvent = buildEvent({
      gameId: session.gameId,
      seq,
      type: "player_died",
      phase: "night_action",
      source: "rule_engine",
      payload: {
        playerId: death.playerId,
        deathCause: death.cause,
        revealRolePublicly: false,
      },
      idempotencyKey: params.idempotencyKey,
      now,
      round: params.baseSnapshot.round,
      visibility: { public: true, visibleTo: [], revealInReview: true },
    });
    players = players.map((player) =>
      player.playerId === death.playerId
        ? {
            ...player,
            alive: false,
            deathCause: death.cause,
            deathEventId: deathEvent.eventId,
            isRoleVisiblePublicly: false,
          }
        : player,
    );
    deathPlayerIds.push(death.playerId);
    events.push(deathEvent);
    seq += 1;
  }

  const board = getBoardConfig(session.boardId);
  const mode: WinConditionMode = board?.winConditionMode ?? "simple_count";
  const winResult = checkWin(players, mode);
  const checkedAfterEventId =
    events[events.length - 1]?.eventId ?? params.baseSnapshot.lastResolvedEventId ?? "";
  events.push(
    buildEvent({
      gameId: session.gameId,
      seq,
      type: "win_checked",
      phase: "night_action",
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
  seq += 1;

  // 夜死猎人（非毒杀）在天亮播报后开枪——仅当本局尚未分出胜负时才需要。
  const nightDeadHunter = winResult
    ? undefined
    : deaths.find(
        (death) =>
          death.cause !== "poison" &&
          players.find((p) => p.playerId === death.playerId)?.role === "hunter",
      );

  const toPhase: GamePhase = winResult ? "review" : "day_announcement";
  const nextRound = winResult
    ? params.baseSnapshot.round
    : {
        ...params.baseSnapshot.round,
        day: Math.max(params.baseSnapshot.round.day, params.baseSnapshot.round.night),
        voteRound: "none" as const,
      };
  events.push(
    buildEvent({
      gameId: session.gameId,
      seq,
      type: "phase_changed",
      phase: "night_action",
      source: "rule_engine",
      payload: {
        fromPhase: "night_action",
        toPhase,
        reason: winResult ? "win_condition_met" : "night_resolved",
      },
      idempotencyKey: params.idempotencyKey,
      now,
      round: params.baseSnapshot.round,
      visibility: { public: true, visibleTo: [], revealInReview: true },
    }),
  );
  seq += 1;

  if (winResult) {
    events.push(
      buildEvent({
        gameId: session.gameId,
        seq,
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
    seq += 1;
  }

  const humanPlayer = players.find((player) => player.isHuman);
  const humanParticipationState =
    humanPlayer?.alive === false
      ? "dead_spectating"
      : params.baseSnapshot.humanParticipationState;
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
    ...params.baseSnapshot,
    lastEventSeq: seq - 1,
    gamePhase: toPhase,
    round: nextRound,
    players,
    pendingAction,
    nightState: { ...params.nightState, resolved: true, deathPlayerIds },
    witchState: params.witchState,
    humanParticipationState,
    ...(nightDeadHunter ? { pendingHunterId: nightDeadHunter.playerId, hunterShootFromExile: false } : {}),
    ...(winResult
      ? { winner: winResult.winner, winReason: winResult.winReason }
      : {}),
    lastResolvedEventId: events[events.length - 1]?.eventId,
  };
  const newSession: GameSession = {
    ...session,
    status: winResult ? "ended" : session.status,
    endedAt: winResult ? now : session.endedAt,
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

function submitHunterShoot(
  action: Extract<GameAction, { type: "submit_hunter_shoot" }>,
  context: RuleEngineContext,
  previousEvents: TruthEvent[],
): Result<RuleEngineSuccess> {
  if (!context.session || !context.snapshot) {
    return rulesError("INVALID_ACTION", "Hunter shoot requires an existing game.");
  }

  const snapshot = context.snapshot;
  if (
    snapshot.gamePhase !== "hunter_shoot" ||
    snapshot.pendingAction?.type !== "hunter_shoot" ||
    snapshot.pendingAction.actorId !== action.actorId ||
    snapshot.pendingHunterId !== action.actorId
  ) {
    return rulesError("ACTION_NOT_ALLOWED", "Hunter shoot is not allowed now.");
  }

  const hunter = snapshot.players.find((p) => p.playerId === action.actorId);
  if (!hunter) {
    return rulesError("ACTION_NOT_ALLOWED", "Hunter is not part of this game.");
  }

  let seq = snapshot.lastEventSeq + 1;
  let players = snapshot.players;
  const events: TruthEvent[] = [];

  if (action.targetId) {
    const target = snapshot.players.find((p) => p.playerId === action.targetId);
    if (!target?.alive || target.playerId === action.actorId) {
      return rulesError("ACTION_NOT_ALLOWED", "Hunter shoot target is not legal.");
    }
    const shotEvent = buildEvent({
      gameId: context.session.gameId,
      seq,
      type: "hunter_shot",
      phase: "hunter_shoot",
      source: hunter.controller,
      actorId: action.actorId,
      payload: { hunterId: action.actorId, targetId: action.targetId },
      idempotencyKey: action.idempotencyKey,
      now: context.now,
      round: snapshot.round,
      visibility: { public: true, visibleTo: [], revealInReview: true },
    });
    events.push(shotEvent);
    seq += 1;
    const deathEvent = buildEvent({
      gameId: context.session.gameId,
      seq,
      type: "player_died",
      phase: "hunter_shoot",
      source: "rule_engine",
      payload: {
        playerId: action.targetId,
        deathCause: "hunter_shot",
        sourceEventId: shotEvent.eventId,
        revealRolePublicly: false,
      },
      idempotencyKey: action.idempotencyKey,
      now: context.now,
      round: snapshot.round,
      visibility: { public: true, visibleTo: [], revealInReview: true },
    });
    players = players.map((player) =>
      player.playerId === action.targetId
        ? {
            ...player,
            alive: false,
            deathCause: "hunter_shot" as const,
            deathEventId: deathEvent.eventId,
            isRoleVisiblePublicly: false,
          }
        : player,
    );
    events.push(deathEvent);
    seq += 1;
  }

  const fromExile = snapshot.hunterShootFromExile === true;
  const clearedBase: GameSnapshot = {
    ...snapshot,
    players,
    pendingHunterId: undefined,
    hunterShootFromExile: undefined,
  };

  if (fromExile) {
    return finishDayResolution({
      context,
      previousEvents,
      priorEvents: events,
      nextSeq: seq,
      players,
      fromPhase: "hunter_shoot",
      viewerId: action.actorId,
      baseSnapshot: clearedBase,
      idempotencyKey: action.idempotencyKey,
    });
  }

  // 夜死猎人开枪后回到白天发言（除非开枪改变了胜负）。
  const board = getBoardConfig(context.session.boardId);
  const mode: WinConditionMode = board?.winConditionMode ?? "simple_count";
  const winResult = checkWin(players, mode);
  const checkedAfterEventId =
    events[events.length - 1]?.eventId ?? snapshot.lastResolvedEventId ?? "";
  events.push(
    buildEvent({
      gameId: context.session.gameId,
      seq,
      type: "win_checked",
      phase: "hunter_shoot",
      source: "rule_engine",
      payload: {
        ...(winResult
          ? { winner: winResult.winner, winReason: winResult.winReason }
          : {}),
        checkedAfterEventId,
      },
      idempotencyKey: action.idempotencyKey,
      now: context.now,
      round: snapshot.round,
      visibility: { public: Boolean(winResult), visibleTo: [], revealInReview: true },
    }),
  );
  seq += 1;

  const humanPlayer = players.find((player) => player.isHuman);
  const humanParticipationState =
    humanPlayer?.alive === false ? "dead_spectating" : snapshot.humanParticipationState;

  if (winResult) {
    events.push(
      buildEvent({
        gameId: context.session.gameId,
        seq,
        type: "phase_changed",
        phase: "hunter_shoot",
        source: "rule_engine",
        payload: { fromPhase: "hunter_shoot", toPhase: "review", reason: "win_condition_met" },
        idempotencyKey: action.idempotencyKey,
        now: context.now,
        round: snapshot.round,
        visibility: { public: true, visibleTo: [], revealInReview: true },
      }),
    );
    seq += 1;
    events.push(
      buildEvent({
        gameId: context.session.gameId,
        seq,
        type: "game_ended",
        phase: "review",
        source: "rule_engine",
        payload: { winner: winResult.winner, winReason: winResult.winReason, endedAt: context.now },
        idempotencyKey: action.idempotencyKey,
        now: context.now,
        round: snapshot.round,
        visibility: { public: true, visibleTo: [], revealInReview: true },
      }),
    );
    seq += 1;
    const reviewSnapshot: GameSnapshot = {
      ...clearedBase,
      lastEventSeq: seq - 1,
      gamePhase: "review",
      players,
      pendingAction: null,
      humanParticipationState,
      winner: winResult.winner,
      winReason: winResult.winReason,
      lastResolvedEventId: events[events.length - 1]?.eventId,
    };
    const endedSession: GameSession = {
      ...context.session,
      status: "ended",
      endedAt: context.now,
      currentEventSeq: reviewSnapshot.lastEventSeq,
      currentSnapshotSeq: reviewSnapshot.lastEventSeq,
    };
    return ok({
      session: endedSession,
      events,
      snapshot: reviewSnapshot,
      visibleInformation: buildVisibleInformation(action.actorId, reviewSnapshot, [
        ...previousEvents,
        ...events,
      ]),
      nextPendingAction: null,
    });
  }

  const speakerOrder = [...players]
    .filter((player) => player.alive)
    .sort((left, right) => left.seat - right.seat)
    .map((player) => player.playerId);
  const currentSpeakerId = speakerOrder[0];
  events.push(
    buildEvent({
      gameId: context.session.gameId,
      seq,
      type: "phase_changed",
      phase: "hunter_shoot",
      source: "rule_engine",
      payload: { fromPhase: "hunter_shoot", toPhase: "day_speech", reason: "hunter_shot_resolved" },
      idempotencyKey: action.idempotencyKey,
      now: context.now,
      round: snapshot.round,
      visibility: { public: true, visibleTo: [], revealInReview: true },
    }),
  );
  seq += 1;
  const daySpeechSnapshot: GameSnapshot = {
    ...clearedBase,
    lastEventSeq: seq - 1,
    gamePhase: "day_speech",
    players,
    humanParticipationState,
    speechState: {
      day: snapshot.round.day,
      speechKind: "day_speech",
      speakerOrder,
      currentSpeakerId,
      completedSpeakerIds: [],
    },
    pendingAction: currentSpeakerId
      ? { type: "speech", actorId: currentSpeakerId, legalTargets: [], allowAbstain: false }
      : null,
    lastResolvedEventId: events[events.length - 1]?.eventId,
  };
  const session = updateSessionSeq(context.session, daySpeechSnapshot);
  return ok({
    session,
    events,
    snapshot: daySpeechSnapshot,
    visibleInformation: buildVisibleInformation(action.actorId, daySpeechSnapshot, [
      ...previousEvents,
      ...events,
    ]),
    nextPendingAction: daySpeechSnapshot.pendingAction,
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
  const participation = context.snapshot.humanParticipationState;
  // An alive human confirms during normal play; once the human is dead and
  // spectating, the store (AI driver) re-issues this confirmation on their
  // behalf so the day announcement does not deadlock with no living confirmer.
  const isAliveHumanTurn =
    humanPlayer?.isHuman && humanPlayer.alive && participation === "alive";
  const isSpectatorAutoConfirm = participation === "dead_spectating";

  if (
    context.snapshot.gamePhase !== "day_announcement" ||
    context.session.humanPlayerId !== action.playerId ||
    !humanPlayer?.isHuman ||
    !(isAliveHumanTurn || isSpectatorAutoConfirm)
  ) {
    return rulesError("ACTION_NOT_ALLOWED", "Day announcement cannot be confirmed now.");
  }

  const nextSeq = context.snapshot.lastEventSeq + 1;
  const dayAnnouncedEvent = buildEvent({
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
        context.snapshot.players,
      ),
    },
    idempotencyKey: action.idempotencyKey,
    now: context.now,
    round: context.snapshot.round,
    visibility: { public: true, visibleTo: [], revealInReview: true },
  });

  // 夜死猎人（非毒）在播报后开枪：先进入 hunter_shoot 相位，开枪后再开始白天发言。
  const pendingHunterId = context.snapshot.pendingHunterId;
  if (pendingHunterId) {
    const phaseChangedEvent = buildEvent({
      gameId: context.session.gameId,
      seq: nextSeq + 1,
      type: "phase_changed",
      phase: "day_announcement",
      source: "rule_engine",
      payload: {
        fromPhase: "day_announcement",
        toPhase: "hunter_shoot",
        reason: "night_dead_hunter_shoots",
      },
      idempotencyKey: action.idempotencyKey,
      now: context.now,
      round: context.snapshot.round,
      visibility: { public: true, visibleTo: [], revealInReview: true },
    });
    const snapshot: GameSnapshot = {
      ...context.snapshot,
      lastEventSeq: nextSeq + 1,
      gamePhase: "hunter_shoot",
      pendingAction: {
        type: "hunter_shoot",
        actorId: pendingHunterId,
        legalTargets: context.snapshot.players
          .filter((p) => p.alive && p.playerId !== pendingHunterId)
          .map((p) => p.playerId),
        allowAbstain: true,
      },
      hunterShootFromExile: false,
    };
    const session = updateSessionSeq(context.session, snapshot);
    return ok({
      session,
      events: [dayAnnouncedEvent, phaseChangedEvent],
      snapshot,
      visibleInformation: buildVisibleInformation(action.playerId, snapshot, [
        ...previousEvents,
        dayAnnouncedEvent,
        phaseChangedEvent,
      ]),
      nextPendingAction: snapshot.pendingAction,
    });
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
  const phaseChangedEvent = buildEvent({
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
    visibility: { public: true, visibleTo: [], revealInReview: true },
  });
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
    events: [dayAnnouncedEvent, phaseChangedEvent],
    snapshot,
    visibleInformation: buildVisibleInformation(action.playerId, snapshot, [
      ...previousEvents,
      dayAnnouncedEvent,
      phaseChangedEvent,
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
    // 同时暗投：每张票在结算前只有投票者本人可见，杜绝跟票；结算时由 vote_resolved 一次性公示。
    visibility: { public: false, visibleTo: [action.voterId], revealInReview: true },
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

  // 结算时一次性公示全部票型（谁投了谁/谁弃票），随 public 的 vote_resolved 同时翻牌。
  const voteBreakdown = submissions.map((event) => ({
    voterId: String(event.payload.voterId),
    choiceType: event.payload.choiceType === "abstain" ? "abstain" : "target",
    ...(typeof event.payload.targetId === "string"
      ? { targetId: event.payload.targetId }
      : {}),
  }));

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
        votes: voteBreakdown,
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

    // 放逐一旦达成胜负（如放逐最后一狼），立即终局进复盘——跳过遗言与猎人开枪。
    const board = getBoardConfig(session.boardId);
    const winMode: WinConditionMode = board?.winConditionMode ?? "simple_count";
    if (checkWin(players, winMode)) {
      return finishDayResolution({
        context: params.context,
        previousEvents: params.previousEvents,
        priorEvents: events,
        nextSeq,
        players,
        fromPhase: votePhase,
        viewerId: params.action.voterId,
        baseSnapshot: {
          ...snapshot,
          players,
          voteState: { ...voteState, resolved: true },
        },
        idempotencyKey: params.action.idempotencyKey,
      });
    }

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

  // 放逐的猎人在遗言后开枪（放逐死因非毒，可开枪）。
  if (speaker.role === "hunter") {
    const phaseChangedEvent = buildEvent({
      gameId: context.session.gameId,
      seq: nextSeq + 1,
      type: "phase_changed",
      phase: "exile_last_words",
      source: "rule_engine",
      payload: {
        fromPhase: "exile_last_words",
        toPhase: "hunter_shoot",
        reason: "exiled_hunter_shoots",
      },
      idempotencyKey: action.idempotencyKey,
      now: context.now,
      round: snapshot.round,
      visibility: { public: true, visibleTo: [], revealInReview: true },
    });
    const nextSnapshot: GameSnapshot = {
      ...snapshot,
      lastEventSeq: nextSeq + 1,
      gamePhase: "hunter_shoot",
      pendingHunterId: action.speakerId,
      hunterShootFromExile: true,
      pendingAction: {
        type: "hunter_shoot",
        actorId: action.speakerId,
        legalTargets: snapshot.players
          .filter((p) => p.alive && p.playerId !== action.speakerId)
          .map((p) => p.playerId),
        allowAbstain: true,
      },
    };
    const nextSession = updateSessionSeq(context.session, nextSnapshot);
    return ok({
      session: nextSession,
      events: [lastWordsEvent, phaseChangedEvent],
      snapshot: nextSnapshot,
      visibleInformation: buildVisibleInformation(action.speakerId, nextSnapshot, [
        ...previousEvents,
        lastWordsEvent,
        phaseChangedEvent,
      ]),
      nextPendingAction: nextSnapshot.pendingAction,
    });
  }

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

  const board = getBoardConfig(session.boardId);
  const mode: WinConditionMode = board?.winConditionMode ?? "simple_count";
  const winResult = checkWin(players, mode);
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
  const { nightState, pendingAction } = enterNight({
    players,
    night: nextNight,
    humanPlayerId: session.humanPlayerId,
    humanParticipationState,
  });
  const snapshot: GameSnapshot = {
    ...params.baseSnapshot,
    lastEventSeq: nextSeq - 1,
    gamePhase: "night_action",
    round: { night: nextNight, day: params.baseSnapshot.round.day, voteRound: "none" },
    players,
    pendingAction,
    humanParticipationState,
    nightState,
    speechState: undefined,
    voteState: undefined,
    pendingHunterId: undefined,
    hunterShootFromExile: undefined,
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

function confirmNewGame(
  action: Extract<GameAction, { type: "confirm_new_game" }>,
  context: RuleEngineContext,
  _previousEvents: TruthEvent[],
): Result<RuleEngineSuccess> {
  if (!context.session || !context.snapshot) {
    return rulesError("INVALID_ACTION", "Starting a new game requires an existing game.");
  }

  // Allowed at review (normal "play again"), or mid-game once the human is dead
  // and spectating — a dead player may abandon the current game and restart at
  // any time without waiting for the AI to finish playing it out.
  const fromPhase = context.snapshot.gamePhase;
  if (
    fromPhase !== "review" &&
    context.snapshot.humanParticipationState !== "dead_spectating"
  ) {
    return rulesError(
      "ACTION_NOT_ALLOWED",
      "A new game can only be started from review or while spectating after death.",
    );
  }

  if (context.session.humanPlayerId !== action.playerId) {
    return rulesError("ACTION_NOT_ALLOWED", "Only the human may start a new game.");
  }

  const nextSeq = context.snapshot.lastEventSeq + 1;
  const event = buildEvent({
    gameId: context.session.gameId,
    seq: nextSeq,
    type: "phase_changed",
    phase: fromPhase,
    source: "human",
    actorId: action.playerId,
    payload: {
      fromPhase,
      toPhase: "mode_select",
      reason: "new_game_confirmed",
    },
    idempotencyKey: action.idempotencyKey,
    now: context.now,
    round: context.snapshot.round,
    visibility: { public: true, visibleTo: [], revealInReview: false },
  });
  const snapshot: GameSnapshot = {
    gameId: context.session.gameId,
    lastEventSeq: nextSeq,
    gamePhase: "mode_select",
    humanParticipationState: "alive",
    round: { night: 0, day: 0, voteRound: "none" },
    players: [],
    pendingAction: null,
  };
  const session = updateSessionSeq(context.session, snapshot);

  return ok({
    session,
    events: [event],
    snapshot,
    // players is empty here, so buildVisibleInformation would throw; the store
    // clears storage on this result and waits for the next create_game.
    visibleInformation: buildEmptyModeSelectVisibleInformation(action.playerId, snapshot),
    nextPendingAction: snapshot.pendingAction,
  });
}

function buildEmptyModeSelectVisibleInformation(
  viewerId: string,
  snapshot: GameSnapshot,
): VisibleInformationSnapshot {
  return {
    gameId: snapshot.gameId,
    viewerId,
    generatedAtSeq: snapshot.lastEventSeq,
    gamePhase: snapshot.gamePhase,
    humanParticipationState: snapshot.humanParticipationState,
    round: snapshot.round,
    ownSeat: 1,
    ownName: "你",
    ownRole: "villager",
    ownFaction: "good_team",
    teammates: [],
    alivePlayers: [],
    deadPlayers: [],
    publicEvents: [],
    privateEvents: [],
    speeches: [],
    votes: [],
    legalActions: [],
    canAct: false,
  };
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
          name: player.name,
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
    ownName: "你",
    ownRole: "villager",
    ownFaction: "good_team",
    teammates: [],
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

function getAlivePlayerIdsBySeat(snapshot: GameSnapshot): string[] {
  return [...snapshot.players]
    .filter((player) => player.alive)
    .sort((left, right) => left.seat - right.seat)
    .map((player) => player.playerId);
}

function buildDayAnnouncementText(
  deadPlayerIds: string[],
  players: Player[],
): string {
  if (deadPlayerIds.length === 0) {
    return "天亮了，昨夜平安夜。";
  }

  const label = (id: string): string => {
    const player = players.find((candidate) => candidate.playerId === id);
    return player ? `${player.name}（${player.seat}号）` : id;
  };

  return `天亮了，昨夜 ${deadPlayerIds.map(label).join("、")} 死亡，身份不公开。`;
}

function checkWin(
  players: Player[],
  mode: WinConditionMode,
): { winner: Player["faction"]; winReason: WinReason } | null {
  const alive = players.filter((player) => player.alive);
  const aliveWerewolves = alive.filter((player) => player.role === "werewolf");

  if (aliveWerewolves.length === 0) {
    return { winner: "good_team", winReason: "all_werewolves_dead" };
  }

  if (mode === "slay_side") {
    // 屠边：杀光所有「民」或所有「神」任一边，狼即胜。
    const aliveFolk = alive.filter((player) => roleCategory(player.role) === "folk");
    const aliveGods = alive.filter((player) => roleCategory(player.role) === "god");
    if (aliveFolk.length === 0) {
      return { winner: "werewolf_team", winReason: "all_folk_dead" };
    }
    if (aliveGods.length === 0) {
      return { winner: "werewolf_team", winReason: "all_gods_dead" };
    }
    return null;
  }

  // simple_count（旧 5p 回归用）：狼数 ≥ 好人数即狼胜。
  const aliveGoodPlayers = alive.filter((player) => player.faction === "good_team");
  if (aliveWerewolves.length >= aliveGoodPlayers.length) {
    return { winner: "werewolf_team", winReason: "werewolves_reach_parity" };
  }

  return null;
}

/** 构建一个新夜晚的状态机与（仅真人轮到时的）pendingAction，首夜/续夜通用。 */
function enterNight(params: {
  players: Player[];
  night: number;
  humanPlayerId: string;
  humanParticipationState: HumanParticipationState;
}): { nightState: NightState; pendingAction: PendingAction | null } {
  const nightState = buildNightState(params.players, params.night);
  const pendingAction = pendingActionForNight(
    nightState,
    params.players,
    params.humanPlayerId,
    params.humanParticipationState,
    params.night,
  );
  return { nightState, pendingAction };
}

/**
 * 夜晚的 pendingAction 只在「当前行动者就是真人且真人存活并在局中」时设置，
 * 其它情况返回 null（AI 行动由 driver 按 nightState 步骤驱动；死亡真人永不分配 pending）。
 */
function pendingActionForNight(
  nightState: NightState,
  players: Player[],
  humanPlayerId: string,
  participation: HumanParticipationState,
  night: number,
): PendingAction | null {
  const next = nextNightActor(nightState, players);
  if (!next || next.actorId !== humanPlayerId || participation !== "alive") {
    return null;
  }
  const human = players.find((p) => p.playerId === humanPlayerId);
  if (!human?.alive) {
    return null;
  }
  if (next.step.kind === "witch_action") {
    return {
      type: "witch_action",
      actorId: humanPlayerId,
      legalTargets: legalNightTargets(human, players, night),
      allowAbstain: true,
    };
  }
  return {
    type: "night_action",
    actorId: humanPlayerId,
    legalTargets: legalNightTargets(human, players, night),
    allowAbstain: false,
  };
}

/** 板上有女巫则初始化解药/毒药各一次，否则不带 witchState。 */
function buildInitialWitchState(players: Player[]): WitchState | undefined {
  return players.some((player) => player.role === "witch")
    ? { saveAvailable: true, poisonAvailable: true }
    : undefined;
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
