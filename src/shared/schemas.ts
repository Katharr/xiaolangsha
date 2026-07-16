import { z } from "zod";

import {
  activeVoteRounds,
  aiTaskTypes,
  deathCauses,
  eventSources,
  eventTypes,
  factions,
  gameModes,
  gamePhases,
  gameStatuses,
  humanParticipationStates,
  nightActionTypes,
  pendingActionTypes,
  playerControllers,
  roles,
  speechKinds,
  voteChoiceTypes,
  voteRounds,
  winConditionModes,
  winReasons,
  witchChoices,
} from "./enums";
import { appErrorCodes, appErrorSources } from "./result";

const nonEmptyString = z.string().min(1);

export const gameModeSchema = z.enum(gameModes);
export const gameStatusSchema = z.enum(gameStatuses);
export const playerControllerSchema = z.enum(playerControllers);
export const roleSchema = z.enum(roles);
export const factionSchema = z.enum(factions);
export const gamePhaseSchema = z.enum(gamePhases);
export const humanParticipationStateSchema = z.enum(humanParticipationStates);
export const deathCauseSchema = z.enum(deathCauses);
export const voteChoiceTypeSchema = z.enum(voteChoiceTypes);
export const nightActionTypeSchema = z.enum(nightActionTypes);
export const witchChoiceSchema = z.enum(witchChoices);
export const winConditionModeSchema = z.enum(winConditionModes);
export const winReasonSchema = z.enum(winReasons);
export const eventSourceSchema = z.enum(eventSources);
export const pendingActionTypeSchema = z.enum(pendingActionTypes);
export const voteRoundSchema = z.enum(voteRounds);
export const activeVoteRoundSchema = z.enum(activeVoteRounds);
export const speechKindSchema = z.enum(speechKinds);
export const eventTypeSchema = z.enum(eventTypes);
export const aiTaskTypeSchema = z.enum(aiTaskTypes);

export const appErrorCodeSchema = z.enum(appErrorCodes);
export const appErrorSourceSchema = z.enum(appErrorSources);

export const appErrorSchema = z.object({
  code: appErrorCodeSchema,
  message: nonEmptyString,
  userMessage: z.string().optional(),
  retryable: z.boolean(),
  source: appErrorSourceSchema,
}).strict();

export function resultSchema<T extends z.ZodType>(dataSchema: T) {
  return z.discriminatedUnion("ok", [
    z.object({
      ok: z.literal(true),
      data: dataSchema,
    }).strict(),
    z.object({
      ok: z.literal(false),
      error: appErrorSchema,
    }).strict(),
  ]);
}

const baseActionSchema = z.object({
  idempotencyKey: nonEmptyString,
});

const voteActionSchema = baseActionSchema
  .extend({
    type: z.literal("submit_vote"),
    voterId: nonEmptyString,
    voteRound: activeVoteRoundSchema,
    choiceType: voteChoiceTypeSchema,
    targetId: z.string().optional(),
  })
  .superRefine((action, context) => {
    if (action.choiceType === "target" && !action.targetId) {
      context.addIssue({
        code: "custom",
        message: "target vote requires targetId",
        path: ["targetId"],
      });
    }
    if (action.choiceType === "abstain" && action.targetId !== undefined) {
      context.addIssue({
        code: "custom",
        message: "abstain vote must not include targetId",
        path: ["targetId"],
      });
    }
  });

export const gameActionSchema = z.discriminatedUnion("type", [
  baseActionSchema.extend({
    type: z.literal("create_game"),
    mode: gameModeSchema,
    boardId: nonEmptyString,
    humanPlayerId: nonEmptyString,
  }),
  baseActionSchema.extend({
    type: z.literal("confirm_role_setup"),
    playerId: nonEmptyString,
    selectedRole: roleSchema,
  }),
  baseActionSchema.extend({
    type: z.literal("confirm_role_reveal"),
    playerId: nonEmptyString,
  }),
  baseActionSchema.extend({
    type: z.literal("submit_night_action"),
    actorId: nonEmptyString,
    actionType: z.enum(["werewolf_kill", "seer_check", "guard_protect"]),
    targetId: z.string().optional(),
  }),
  baseActionSchema.extend({
    type: z.literal("submit_witch_action"),
    actorId: nonEmptyString,
    witchChoice: witchChoiceSchema,
    targetId: z.string().optional(),
  }),
  baseActionSchema.extend({
    type: z.literal("submit_hunter_shoot"),
    actorId: nonEmptyString,
    targetId: z.string().optional(),
  }),
  baseActionSchema.extend({
    type: z.literal("confirm_day_announcement"),
    playerId: nonEmptyString,
  }),
  baseActionSchema.extend({
    type: z.literal("submit_speech"),
    speakerId: nonEmptyString,
    text: nonEmptyString,
  }),
  voteActionSchema,
  baseActionSchema.extend({
    type: z.literal("submit_tie_speech"),
    speakerId: nonEmptyString,
    text: nonEmptyString,
  }),
  baseActionSchema.extend({
    type: z.literal("submit_last_words"),
    speakerId: nonEmptyString,
    text: nonEmptyString,
  }),
  baseActionSchema.extend({
    type: z.literal("confirm_new_game"),
    playerId: nonEmptyString,
  }),
]);

export const roundRefSchema = z.object({
  night: z.number().int().nonnegative(),
  day: z.number().int().nonnegative(),
  voteRound: voteRoundSchema,
});

export const roundStateSchema = roundRefSchema;

export const eventMetadataSchema = z.object({
  idempotencyKey: nonEmptyString,
  generatedBy: z.enum(["human", "ai", "rule_engine", "fallback"]),
  fallbackReason: z.string().optional(),
  analysisSummary: z.string().optional(),
  decisionSummary: z.string().optional(),
});

export const eventVisibilitySchema = z.object({
  public: z.boolean(),
  visibleTo: z.array(z.string()),
  revealInReview: z.boolean(),
});

export const playerSchema = z.object({
  playerId: nonEmptyString,
  gameId: nonEmptyString,
  name: nonEmptyString,
  seat: z.number().int().positive(),
  controller: playerControllerSchema,
  role: roleSchema,
  faction: factionSchema,
  alive: z.boolean(),
  deathCause: deathCauseSchema.optional(),
  deathEventId: z.string().optional(),
  isHuman: z.boolean(),
  isRoleVisiblePublicly: z.boolean(),
});

export const truthEventSchema = z.object({
  eventId: nonEmptyString,
  gameId: nonEmptyString,
  seq: z.number().int().nonnegative(),
  type: eventTypeSchema,
  phase: gamePhaseSchema,
  round: roundRefSchema,
  actorId: z.string().optional(),
  source: eventSourceSchema,
  payload: z.record(z.string(), z.unknown()),
  visibility: eventVisibilitySchema,
  metadata: eventMetadataSchema,
  createdAt: nonEmptyString,
});

export const publicPlayerRefSchema = z.object({
  playerId: nonEmptyString,
  name: nonEmptyString,
  seat: z.number().int().positive(),
  alive: z.boolean(),
  publicRole: roleSchema.optional(),
});

export const teammateRefSchema = z.object({
  playerId: nonEmptyString,
  name: nonEmptyString,
  seat: z.number().int().positive(),
  role: roleSchema,
  alive: z.boolean(),
});

export const publicDeathRefSchema = z.object({
  playerId: nonEmptyString,
  name: nonEmptyString,
  seat: z.number().int().positive(),
  deathCause: deathCauseSchema,
  round: roundRefSchema,
  publicRole: roleSchema.optional(),
});

export const visibleEventRefSchema = z.object({
  eventId: nonEmptyString,
  seq: z.number().int().nonnegative(),
  type: eventTypeSchema,
  phase: gamePhaseSchema,
  round: roundRefSchema,
  payload: z.record(z.string(), z.unknown()),
});

export const visibleSpeechSchema = z.object({
  eventId: nonEmptyString,
  speakerId: nonEmptyString,
  speakerSeat: z.number().int().positive(),
  speakerName: nonEmptyString,
  day: z.number().int().nonnegative(),
  speechKind: speechKindSchema,
  text: z.string(),
  createdAt: nonEmptyString,
});

export const visibleVoteSchema = z.object({
  eventId: nonEmptyString,
  day: z.number().int().nonnegative(),
  voteRound: activeVoteRoundSchema,
  voterId: z.string().optional(),
  voterSeat: z.number().int().positive().optional(),
  choiceType: voteChoiceTypeSchema.optional(),
  targetId: z.string().optional(),
  targetSeat: z.number().int().positive().optional(),
  tally: z.record(z.string(), z.unknown()).optional(),
});

export const legalActionSchema = z.object({
  actionType: z.union([pendingActionTypeSchema, nightActionTypeSchema]),
  actorId: nonEmptyString,
  legalTargets: z.array(z.string()),
  allowAbstain: z.boolean(),
  required: z.boolean(),
});

export const pendingActionSchema = z.object({
  type: pendingActionTypeSchema,
  actorId: z.string().optional(),
  legalTargets: z.array(z.string()),
  allowAbstain: z.boolean(),
  expiresAt: z.string().optional(),
});

export const nightStepSchema = z.object({
  kind: z.enum(["guard_protect", "werewolf_kill", "seer_check", "witch_action"]),
  actorIds: z.array(z.string()),
  submittedActorIds: z.array(z.string()),
});

export const nightStateSchema = z.object({
  night: z.number().int().nonnegative(),
  steps: z.array(nightStepSchema),
  currentStepIndex: z.number().int().nonnegative(),
  guardProtectedId: z.string().optional(),
  wolfVotes: z.record(z.string(), z.string()).optional(),
  wolfKillTargetId: z.string().optional(),
  witchSavedTargetId: z.string().optional(),
  poisonTargetId: z.string().optional(),
  resolved: z.boolean(),
  deathPlayerIds: z.array(z.string()),
});

export const witchStateSchema = z.object({
  saveAvailable: z.boolean(),
  poisonAvailable: z.boolean(),
});

export const speechStateSchema = z.object({
  day: z.number().int().nonnegative(),
  speechKind: z.enum(["day_speech", "tie_speech"]),
  speakerOrder: z.array(z.string()),
  currentSpeakerId: z.string().optional(),
  completedSpeakerIds: z.array(z.string()),
});

export const voteStateSchema = z.object({
  day: z.number().int().nonnegative(),
  voteRound: activeVoteRoundSchema,
  eligibleVoterIds: z.array(z.string()),
  submittedVoterIds: z.array(z.string()),
  candidateIds: z.array(z.string()),
  allowAbstain: z.boolean(),
  resolved: z.boolean(),
});

export const gameSnapshotSchema = z.object({
  gameId: nonEmptyString,
  lastEventSeq: z.number().int().nonnegative(),
  gamePhase: gamePhaseSchema,
  humanParticipationState: humanParticipationStateSchema,
  round: roundStateSchema,
  players: z.array(playerSchema),
  pendingAction: pendingActionSchema.optional().nullable(),
  nightState: nightStateSchema.optional(),
  witchState: witchStateSchema.optional(),
  speechState: speechStateSchema.optional(),
  voteState: voteStateSchema.optional(),
  pendingHunterId: z.string().optional(),
  hunterShootFromExile: z.boolean().optional(),
  lastResolvedEventId: z.string().optional(),
  winner: factionSchema.optional(),
  winReason: winReasonSchema.optional(),
});

export const visibleInformationSnapshotSchema = z.object({
  gameId: nonEmptyString,
  viewerId: nonEmptyString,
  generatedAtSeq: z.number().int().nonnegative(),
  gamePhase: gamePhaseSchema,
  humanParticipationState: humanParticipationStateSchema.optional(),
  round: roundStateSchema,
  ownSeat: z.number().int().positive(),
  ownName: nonEmptyString,
  ownRole: roleSchema,
  ownFaction: factionSchema,
  teammates: z.array(teammateRefSchema),
  alivePlayers: z.array(publicPlayerRefSchema),
  deadPlayers: z.array(publicDeathRefSchema),
  publicEvents: z.array(visibleEventRefSchema),
  privateEvents: z.array(visibleEventRefSchema),
  speeches: z.array(visibleSpeechSchema),
  votes: z.array(visibleVoteSchema),
  legalActions: z.array(legalActionSchema),
  canAct: z.boolean(),
  nightStatus: z
    .object({
      currentStepKind: nightStepSchema.shape.kind,
      waitingForViewer: z.boolean(),
    })
    .nullable()
    .optional(),
});

export const ruleEngineResultSchema = resultSchema(
  z.object({
    events: z.array(truthEventSchema),
    snapshot: gameSnapshotSchema,
    visibleInformation: visibleInformationSnapshotSchema,
    nextPendingAction: pendingActionSchema.optional().nullable(),
  }),
);

const inGameAiTaskRequestSchema = z.object({
  gameId: nonEmptyString,
  taskType: z.enum([
    "speech",
    "night_action",
    "witch_action",
    "hunter_shoot",
    "vote",
    "tie_speech",
    "last_words",
  ]),
  playerId: nonEmptyString,
  visibleInformation: visibleInformationSnapshotSchema,
  promptContext: z
    .object({
      currentText: z.string().optional(),
    })
    .optional(),
});

const reviewQuestionRequestSchema = z.object({
  gameId: nonEmptyString,
  taskType: z.literal("review_question"),
  questionText: nonEmptyString,
  reviewContext: z.unknown(),
});

export const aiTaskRequestSchema = z.discriminatedUnion("taskType", [
  inGameAiTaskRequestSchema,
  reviewQuestionRequestSchema,
]);

export const aiTaskPayloadSchema = z.object({
  text: z.string().optional(),
  targetId: z.string().optional(),
  choiceType: voteChoiceTypeSchema.optional(),
  actionType: z
    .enum(["werewolf_kill", "seer_check", "guard_protect"])
    .optional(),
  witchChoice: witchChoiceSchema.optional(),
  analysisSummary: z.string().optional(),
  decisionSummary: z.string().optional(),
});

export const aiTaskResponseSchema = resultSchema(aiTaskPayloadSchema);
