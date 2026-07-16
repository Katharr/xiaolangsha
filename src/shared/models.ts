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
  /** 女巫是否可在首夜自救（主流规则 true；非首夜自救一律禁止，与此开关无关）。 */
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
  /** 说话人座位号。playerId 的数字后缀与座位无关（座位开局被打乱），称呼「N号」必须以此为准。 */
  speakerSeat: number;
  speakerName: string;
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
  /** 投票人/目标座位号，同 VisibleSpeech.speakerSeat：playerId 后缀 ≠ 座位号。 */
  voterSeat?: number;
  choiceType?: VoteChoiceType;
  targetId?: string;
  targetSeat?: number;
  tally?: Record<string, unknown>;
};

export type LegalAction = {
  actionType: PendingActionType | NightActionType;
  actorId: string;
  legalTargets: string[];
  allowAbstain: boolean;
  required: boolean;
};

/**
 * 同阵营队友（viewer 合法知晓其身份的人）。当前仅狼人之间互相可见：开局狼队认人，
 * 死后仍记得谁是队友。神职/村民之间互不知晓，故该字段对他们为空。
 */
export type TeammateRef = {
  playerId: string;
  name: string;
  seat: number;
  role: Role;
  alive: boolean;
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
  /** 狼人才有：你的狼队友（含已出局的）。其它身份为空数组。 */
  teammates: TeammateRef[];
  alivePlayers: PublicPlayerRef[];
  deadPlayers: PublicDeathRef[];
  publicEvents: VisibleEventRef[];
  privateEvents: VisibleEventRef[];
  speeches: VisibleSpeech[];
  votes: VisibleVote[];
  legalActions: LegalAction[];
  canAct: boolean;
  /**
   * 夜晚进度播报（非机密）：当前轮到哪类角色行动，供主持人条 / 操作区展示
   * 「天黑请闭眼，等待预言家查验…」之类的提示。非 night_action 或夜晚已结算时为 null。
   * 只暴露「当前在等哪个角色」，不含任何具体行动者身份（ISO-001）。
   */
  nightStatus?: NightProgress | null;
};

/** 夜晚进度（非机密）：当前夜晚步骤的角色种类，以及是否在等 viewer 本人行动。 */
export type NightProgress = {
  currentStepKind: NightStepKind;
  /** 当前步是否在等待 viewer 本人出手（true 时 UI 应给控件而非旁观文案）。 */
  waitingForViewer: boolean;
};

export type ReviewSpeechRef = {
  eventId: string;
  speakerId: string;
  /** 同 VisibleSpeech.speakerSeat：playerId 后缀 ≠ 座位号，复盘问答的 AI 也要直接拿到座位。 */
  speakerSeat: number;
  speakerName: string;
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
  voterSeat?: number;
  choiceType: VoteChoiceType;
  targetId?: string;
  targetSeat?: number;
};

export type ReviewNightActionRef = {
  eventId: string;
  night: number;
  actorId: string;
  /** 团队行动（狼刀）的全部参与者；个人行动留空。复盘据此展示「狼队：谁、各投谁」。 */
  actorIds?: string[];
  actionType: Exclude<NightActionType, "none">;
  targetId?: string;
  result: Record<string, unknown>;
};

/**
 * 玩家结局：复盘「结局速览」的数据源。每人最终生死、怎么死的、第几夜/天、责任方是谁。
 * 由 shared/reviewOutcome.ts 的 derivePlayerOutcomes 扫事件流还原。仅 review 阶段使用。
 */
export type PlayerOutcome = {
  playerId: string;
  alive: boolean;
  deathCause?: DeathCause;
  /** 出局发生在第几夜或第几天的序号（配合 deathPhaseKind 决定「第N夜」还是「第N天」）。 */
  deathRound?: number;
  /** 死亡相位类别：夜晚（被刀/被毒）或白天（被放逐/被猎人带走）。 */
  deathPhaseKind?: "night" | "day";
  /** 责任方玩家 id：狼刀=全部行动狼、毒杀=女巫、猎人带走=猎人；放逐无单一凶手，留空。 */
  killerIds: string[];
  /** 放逐得票数（仅 deathCause==="exile" 时有）。 */
  exileVotes?: number;
};

export type ReviewContext = {
  session: GameSession;
  players: Player[];
  events: TruthEvent[];
  speeches: ReviewSpeechRef[];
  votes: ReviewVoteRef[];
  nightActions: ReviewNightActionRef[];
  /** 每人结局（生死/死因/第几夜·天/责任方），供「结局速览」直接渲染。 */
  outcomes: PlayerOutcome[];
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
