export type PlayerId = string;

export interface Seat {
  id: number;
  label: string;
  playerId: PlayerId;
}

export type Role = "werewolf" | "seer" | "witch" | "villager";

export type Camp = "werewolf" | "good";

export type Phase = "setup" | "night" | "day" | "ended";

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

export type TimelineVisibility =
  | { kind: "public" }
  | { kind: "private"; playerIds: PlayerId[] }
  | { kind: "wolf_team" }
  | { kind: "post_game" }
  | { kind: "internal" };

export type TimelineEventType =
  | "game_created"
  | "role_assigned"
  | "wolf_team_revealed"
  | "phase_changed"
  | "seer_check_result"
  | "witch_potion_state_changed"
  | "post_game_role_reveal"
  | "system_seed_or_rng"
  | "complete_state_snapshot";

export interface TimelineEvent {
  id: string;
  type: TimelineEventType;
  day: number;
  order: number;
  visibility: TimelineVisibility;
  payload: Record<string, unknown>;
}

export interface SeerCheckResult {
  targetId: PlayerId;
  camp: Camp;
}

export interface WitchPotionState {
  antidote: boolean;
  poison: boolean;
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
  humanPlayerId: PlayerId;
  seats: Seat[];
  players: PlayerState[];
  timeline: TimelineEvent[];
  seed: string;
  seerResults: Record<PlayerId, SeerCheckResult[]>;
  witchPotions: Record<PlayerId, WitchPotionState>;
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
