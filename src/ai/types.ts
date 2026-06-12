import type {
  Camp,
  Phase,
  PlayerId,
  PlayerPrivateInfo,
  Role,
  SpeechIntent,
  WitchNightAction,
  WitchPotionState
} from "../domain";

export type StrategyProfileId =
  | "balanced"
  | "cautious"
  | "impulsive"
  | "follower"
  | "logical"
  | "deceptive_wolf";

export interface StrategyProfile {
  id: StrategyProfileId;
  suspicionBias: number;
  teammateProtection: number;
}

export interface AiMemoryPolicy {
  maxVisibleSpeechNotes: number;
  maxVoteRoundsRemembered: number;
  maxDecisionReasons: number;
  suspicionDecayPerDay: number;
}

export interface SuspicionScore {
  playerId: PlayerId;
  score: number;
  reasons: string[];
}

export type AiKnownFact =
  | {
      authoritative: true;
      day: number;
      kind: "phase_changed";
      phase: Phase;
      sourceEventId: string;
      summary: string;
    }
  | {
      authoritative: true;
      day: number;
      kind: "public_death";
      phase: Phase;
      playerIds: PlayerId[];
      sourceEventId: string;
      summary: string;
    }
  | {
      authoritative: true;
      day: number;
      kind: "vote_submitted";
      round?: number;
      sourceEventId: string;
      summary: string;
      targetId?: PlayerId;
      voterId?: PlayerId;
    }
  | {
      authoritative: true;
      day: number;
      exiledPlayerId?: PlayerId | null;
      kind: "exile_resolved";
      sourceEventId: string;
      summary: string;
    }
  | {
      authoritative: true;
      camp: Camp;
      day: number;
      kind: "seer_check_result";
      sourceEventId: string;
      summary: string;
      targetId: PlayerId;
    }
  | {
      authoritative: true;
      day: number;
      kind: "witch_potion_state";
      potions: WitchPotionState;
      sourceEventId: string;
      summary: string;
    }
  | {
      authoritative: true;
      day: number;
      kind: "wolf_teammates";
      source: "private_info";
      teammateIds: PlayerId[];
    };

export interface VisibleDeath {
  playerId: PlayerId;
  day: number;
  phase: Phase;
  summary: string;
}

export interface VisibleVote {
  voterId?: PlayerId;
  targetId?: PlayerId;
  round?: number;
  day: number;
  summary: string;
}

export interface VisibleClaim {
  actorId: PlayerId;
  claimedRole?: Role;
  reportedTargetId?: PlayerId;
  reportedCamp?: Camp;
  summary: string;
}

export interface VisibleSpeechNote {
  actorId: PlayerId;
  day: number;
  ignoredAsMetaControl: boolean;
  summary: string;
  tags: string[];
  targetId?: PlayerId;
  weight: number;
}

export interface PlayerSpeechMemory {
  aiUnderstanding: string;
  confidence: number;
  containsMetaControl: boolean;
  rawText: string;
  sourceEventId: string;
  speakerId: PlayerId;
}

export interface RoundSpeechMemory {
  day: number;
  phase: "day_speech";
  roundSummary: string;
  speeches: PlayerSpeechMemory[];
}

export interface DecisionReason {
  actorId: PlayerId;
  chosenAction: AiAction["kind"];
  summary: string;
  targetId?: PlayerId;
  candidateScores: Record<PlayerId, { suspicion: number; trust: number }>;
}

export interface AiMemory {
  knownSelf: {
    camp: Camp;
    playerId: PlayerId;
    role: Role;
    seat: number;
    status: "alive" | "dead";
  };
  knownTeammates: PlayerId[];
  knownFacts: AiKnownFact[];
  speechRounds: RoundSpeechMemory[];
  visibleDeaths: VisibleDeath[];
  visibleVotes: VisibleVote[];
  visibleClaims: VisibleClaim[];
  visibleSpeechNotes: VisibleSpeechNote[];
  ownPrivateResults: PlayerPrivateInfo;
  suspicionByPlayer: Record<PlayerId, SuspicionScore>;
  trustByPlayer: Record<PlayerId, SuspicionScore>;
  lastDecisionReasons: DecisionReason[];
  strategyProfile: StrategyProfile;
}

export type AiAction =
  | {
      actorId: PlayerId;
      kind: "werewolf_kill";
      reason: DecisionReason;
      targetId: PlayerId;
    }
  | {
      actorId: PlayerId;
      kind: "seer_check";
      reason: DecisionReason;
      targetId: PlayerId;
    }
  | {
      action: WitchNightAction;
      actorId: PlayerId;
      kind: "witch_action";
      reason: DecisionReason;
    }
  | {
      actorId: PlayerId;
      intent: SpeechIntent;
      kind: "speech";
      reason: DecisionReason;
      renderedText: string;
    }
  | {
      actorId: PlayerId;
      kind: "vote";
      reason: DecisionReason;
      targetId: PlayerId;
    };

export type { SpeechIntent };
