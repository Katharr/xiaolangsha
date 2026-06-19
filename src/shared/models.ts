import type {
  ActiveVoteRound,
  DeathCause,
  EventSource,
  EventType,
  Faction,
  GameMode,
  GamePhase,
  GameStatus,
  HumanParticipationState,
  NightActionType,
  PendingActionType,
  PlayerController,
  Role,
  SpeechKind,
  VoteChoiceType,
  VoteRound,
  WinConditionMode,
  WinReason,
} from "./enums";

export type GameSession = {
  gameId: string;
  schemaVersion: string;
  mode: GameMode;
  boardId: string;
  status: GameStatus;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  currentEventSeq: number;
  currentSnapshotSeq: number;
  humanPlayerId: string;
  randomSeed?: string;
};

export type BoardConfig = {
  boardId: string;
  playerCount: number;
  roles: Role[];
  winConditionMode: WinConditionMode;
  firstNightProtectHuman: boolean;
  allowWerewolfSelfKill: boolean;
  revealRoleOnDeathDefault: boolean;
  nightDeathLastWords: boolean;
  exileLastWords: boolean;
  allowAbstainVote: boolean;
  allowSelfVote: boolean;
  maxTieRounds: number;
  /** 女巫是否可在首夜对自己用解药（默认 false）。 */
  witchCanSelfSaveFirstNight?: boolean;
  /** 守卫是否禁止连续两夜守同一人（默认 true，本期未上守卫可忽略）。 */
  guardCannotRepeat?: boolean;
};

export type Player = {
  playerId: string;
  gameId: string;
  /** 展示用昵称（含真人）；局中以「名字（N号）」称呼，不泄露 human/ai 身份。 */
  name: string;
  seat: number;
  controller: PlayerController;
  role: Role;
  faction: Faction;
  alive: boolean;
  deathCause?: DeathCause;
  deathEventId?: string;
  isHuman: boolean;
  isRoleVisiblePublicly: boolean;
};

export type RoundRef = {
  night: number;
  day: number;
  voteRound: VoteRound;
};

export type RoundState = RoundRef;

export type PendingAction = {
  type: PendingActionType;
  actorId?: string;
  legalTargets: string[];
  allowAbstain: boolean;
  expiresAt?: string;
};

/** 夜晚某一步（按角色）：守卫守护 / 狼队刀人 / 预言家查验 / 女巫用药。 */
export type NightStepKind =
  | "guard_protect"
  | "werewolf_kill"
  | "seer_check"
  | "witch_action";

export type NightStep = {
  kind: NightStepKind;
  /** 该步需要行动的玩家（狼队为全部存活狼）。 */
  actorIds: string[];
  submittedActorIds: string[];
};

/**
 * 顺序夜晚状态机：按 `steps` 顺序逐步行动，`currentStepIndex` 指向当前步。
 * 累积字段仅供引擎内部结算，绝不进入任何 public 事件（信息隔离 ISO-001）。
 */
export type NightState = {
  night: number;
  steps: NightStep[];
  currentStepIndex: number;
  /** 守卫本夜守护的目标。 */
  guardProtectedId?: string;
  /** 狼队各自的刀票：wolfId → targetId。 */
  wolfVotes?: Record<string, string>;
  /** 狼队结算后的最终刀杀目标。 */
  wolfKillTargetId?: string;
  /** 女巫本夜用解药救下的目标（救被刀者）。 */
  witchSavedTargetId?: string;
  /** 女巫本夜毒杀的目标。 */
  poisonTargetId?: string;
  resolved: boolean;
  deathPlayerIds: string[];
};

/** 女巫全局用药状态（解药/毒药各一次），随快照持久化。 */
export type WitchState = {
  saveAvailable: boolean;
  poisonAvailable: boolean;
};

export type SpeechState = {
  day: number;
  speechKind: Exclude<SpeechKind, "last_words">;
  speakerOrder: string[];
  currentSpeakerId?: string;
  completedSpeakerIds: string[];
};

export type VoteState = {
  day: number;
  voteRound: ActiveVoteRound;
  eligibleVoterIds: string[];
  submittedVoterIds: string[];
  candidateIds: string[];
  allowAbstain: boolean;
  resolved: boolean;
};

export type EventVisibility = {
  public: boolean;
  visibleTo: string[];
  revealInReview: boolean;
};

export type EventMetadata = {
  idempotencyKey: string;
  generatedBy: "human" | "ai" | "rule_engine" | "fallback";
  fallbackReason?: string;
  analysisSummary?: string;
  decisionSummary?: string;
};

export type TruthEvent = {
  eventId: string;
  gameId: string;
  seq: number;
  type: EventType;
  phase: GamePhase;
  round: RoundRef;
  actorId?: string;
  source: EventSource;
  payload: Record<string, unknown>;
  visibility: EventVisibility;
  metadata: EventMetadata;
  createdAt: string;
};

export type GameSnapshot = {
  gameId: string;
  lastEventSeq: number;
  gamePhase: GamePhase;
  humanParticipationState: HumanParticipationState;
  round: RoundState;
  players: Player[];
  pendingAction?: PendingAction | null;
  nightState?: NightState;
  witchState?: WitchState;
  speechState?: SpeechState;
  voteState?: VoteState;
  /** 待开枪的猎人 id（死亡触发，相位 hunter_shoot 时存在）。 */
  pendingHunterId?: string;
  /** 猎人开枪由放逐触发（true）还是夜死触发（false）——决定开枪后回到夜晚还是白天发言。 */
  hunterShootFromExile?: boolean;
  /** 猎人开枪后需要恢复到的相位推进意图（内部流转用）。 */
  lastResolvedEventId?: string;
  winner?: Faction;
  winReason?: WinReason;
};

export type PublicPlayerRef = {
  playerId: string;
  /** 展示用昵称。注意：刻意不含 controller，AI 据此无法区分真人/AI（ISO-001）。 */
  name: string;
  seat: number;
  alive: boolean;
  publicRole?: Role;
};

export type PublicDeathRef = {
  playerId: string;
  name: string;
  seat: number;
  deathCause: DeathCause;
  round: RoundRef;
  publicRole?: Role;
};

export type VisibleEventRef = {
  eventId: string;
  seq: number;
  type: EventType;
  phase: GamePhase;
  round: RoundRef;
  payload: Record<string, unknown>;
};

export type VisibleSpeech = {
  eventId: string;
  speakerId: string;
  day: number;
  speechKind: SpeechKind;
  text: string;
  createdAt: string;
};

export type VisibleVote = {
  eventId: string;
  day: number;
  voteRound: ActiveVoteRound;
  voterId?: string;
  choiceType?: VoteChoiceType;
  targetId?: string;
  tally?: Record<string, unknown>;
};

export type LegalAction = {
  actionType: PendingActionType | NightActionType;
  actorId: string;
  legalTargets: string[];
  allowAbstain: boolean;
  required: boolean;
};

export type VisibleInformationSnapshot = {
  gameId: string;
  viewerId: string;
  generatedAtSeq: number;
  gamePhase: GamePhase;
  humanParticipationState?: HumanParticipationState;
  round: RoundState;
  ownSeat: number;
  ownName: string;
  ownRole: Role;
  ownFaction: Faction;
  alivePlayers: PublicPlayerRef[];
  deadPlayers: PublicDeathRef[];
  publicEvents: VisibleEventRef[];
  privateEvents: VisibleEventRef[];
  speeches: VisibleSpeech[];
  votes: VisibleVote[];
  legalActions: LegalAction[];
  canAct: boolean;
};

export type ReviewSpeechRef = {
  eventId: string;
  speakerId: string;
  day: number;
  speechKind: SpeechKind;
  text: string;
  createdAt: string;
};

export type ReviewVoteRef = {
  eventId: string;
  day: number;
  voteRound: ActiveVoteRound;
  voterId: string;
  choiceType: VoteChoiceType;
  targetId?: string;
};

export type ReviewNightActionRef = {
  eventId: string;
  night: number;
  actorId: string;
  actionType: Exclude<NightActionType, "none">;
  targetId?: string;
  result: Record<string, unknown>;
};

export type ReviewContext = {
  session: GameSession;
  players: Player[];
  events: TruthEvent[];
  speeches: ReviewSpeechRef[];
  votes: ReviewVoteRef[];
  nightActions: ReviewNightActionRef[];
  winner: Faction;
  winReason: WinReason;
};

export type CurrentGameRecord = {
  gameId: string;
  schemaVersion: string;
  session: GameSession;
  snapshotRef?: {
    gameId: string;
    lastEventSeq: number;
  };
};
