export type PlayerId = string;

export interface Seat {
  id: number;
  label: string;
  playerId: PlayerId;
}

export type Role = "werewolf" | "seer" | "witch" | "villager";

export type Camp = "werewolf" | "good";

export type Phase = "setup" | "night" | "day_speech" | "day_vote" | "exile" | "ended";

export type PlayerStatus = "alive" | "dead";

export interface PlayerState {
  id: PlayerId;
  seat: number;
  role: Role;
  camp: Camp;
  status: PlayerStatus;
}

export type WinConditionMode = "side_elimination" | "total_elimination";

export interface Ruleset {
  id: "quick-6-v1";
  name: string;
  playerCount: number;
  roles: Role[];
  defaultWinConditionMode: WinConditionMode;
  supportedWinConditionModes: WinConditionMode[];
}

export const TIMELINE_VISIBILITY_KINDS = [
  "public",
  "private",
  "wolf_team",
  "post_game",
  "internal"
] as const;

export type TimelineVisibility =
  | { kind: "public" }
  | { kind: "private"; playerIds: PlayerId[] }
  | { kind: "wolf_team" }
  | { kind: "post_game" }
  | { kind: "internal" };

export const TIMELINE_EVENT_TYPES = [
  "game_created",
  "role_assigned",
  "wolf_team_revealed",
  "phase_changed",
  "night_action_requested",
  "night_action_submitted",
  "seer_check_result",
  "witch_death_prompt",
  "witch_potion_state_changed",
  "night_death_announced",
  "speech_intent_recorded",
  "speech_rendered",
  "vote_submitted",
  "vote_result_resolved",
  "exile_resolved",
  "win_condition_checked",
  "game_over",
  "post_game_role_reveal",
  "ai_decision_reason",
  "coach_question",
  "coach_advice",
  "llm_request_payload",
  "system_seed_or_rng",
  "complete_state_snapshot"
] as const;

export type TimelineEventType = (typeof TIMELINE_EVENT_TYPES)[number];

export interface TimelineEvent {
  id: string;
  type: TimelineEventType;
  phase: Phase;
  day: number;
  order: number;
  actorId?: PlayerId;
  targetId?: PlayerId;
  visibility: TimelineVisibility;
  summary: string;
  payload: Record<string, unknown>;
  postGameVisible?: boolean;
}

export interface SeerCheckResult {
  targetId: PlayerId;
  camp: Camp;
}

export interface WitchPotionState {
  antidote: boolean;
  poison: boolean;
}

export interface WitchNightAction {
  useAntidote?: boolean;
  poisonTargetId?: PlayerId | null;
}

export interface SpeechIntent {
  kind: string;
  summary: string;
  claimedRole?: Role;
  targetId?: PlayerId;
}

export interface CurrentNightState {
  number: number;
  werewolfKill: {
    actorId: PlayerId;
    targetId: PlayerId;
  } | null;
  seerChecks: Record<PlayerId, PlayerId>;
  witchActions: Record<PlayerId, WitchNightAction>;
  resolved: boolean;
}

export interface CurrentDayState {
  number: number;
  speeches: Record<
    PlayerId,
    {
      intent: SpeechIntent;
      renderedText: string;
    }
  >;
  voteRound: 1 | 2;
  votesByRound: Record<number, Record<PlayerId, PlayerId>>;
  revoteCandidateIds: PlayerId[] | null;
  exileCandidateId: PlayerId | null;
}

export interface WinCheckResult {
  winner: Camp | null;
  reason:
    | "all_werewolves_dead"
    | "all_villagers_dead"
    | "all_specials_dead"
    | "all_good_dead"
    | "no_winner";
}

export type PlayerPrivateInfo =
  | { kind: "werewolf"; teammateIds: PlayerId[] }
  | { kind: "seer"; checkResults: SeerCheckResult[] }
  | { kind: "witch"; nightDeathCandidateId: PlayerId | null; potions: WitchPotionState }
  | { kind: "villager" };

export interface GameState {
  id: string;
  ruleset: Ruleset;
  winConditionMode: WinConditionMode;
  phase: Phase;
  day: number;
  winner: Camp | null;
  humanPlayerId: PlayerId;
  seats: Seat[];
  players: PlayerState[];
  timeline: TimelineEvent[];
  seed: string;
  seerResults: Record<PlayerId, SeerCheckResult[]>;
  witchPotions: Record<PlayerId, WitchPotionState>;
  currentNight: CurrentNightState | null;
  currentDay: CurrentDayState;
  debugSnapshot: {
    createdBy: "src/domain";
    note: string;
  };
}

export interface PublicPlayerState {
  id: PlayerId;
  seat: number;
  status: PlayerStatus;
  role?: Role;
  camp?: Camp;
}

export interface PlayerView {
  perspective: "player";
  playerId: PlayerId;
  phase: Phase;
  day: number;
  self: PublicPlayerState & { role: Role; camp: Camp };
  players: PublicPlayerState[];
  privateInfo: PlayerPrivateInfo;
  timeline: TimelineEvent[];
}

export interface AiPlayerView extends Omit<PlayerView, "perspective"> {
  perspective: "ai";
  wolfTeammateIds: PlayerId[];
}

export interface CoachPlayerView extends Omit<PlayerView, "perspective"> {
  perspective: "coach";
  adviceScope: "current_player_view";
}
