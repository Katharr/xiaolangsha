export const gameModes = ["standard", "free"] as const;
export type GameMode = (typeof gameModes)[number];

export const gameStatuses = ["created", "active", "ended"] as const;
export type GameStatus = (typeof gameStatuses)[number];

export const playerControllers = ["human", "ai"] as const;
export type PlayerController = (typeof playerControllers)[number];

export const roles = [
  "werewolf",
  "seer",
  "witch",
  "hunter",
  "guard",
  "idiot",
  "villager",
] as const;
export type Role = (typeof roles)[number];

/** 角色大类，用于屠边胜负：wolf(狼) / god(神职) / folk(平民)。 */
export const roleCategories = ["wolf", "god", "folk"] as const;
export type RoleCategory = (typeof roleCategories)[number];

export const factions = ["werewolf_team", "good_team"] as const;
export type Faction = (typeof factions)[number];

export const gamePhases = [
  "mode_select",
  "role_setup",
  "role_reveal",
  "night_action",
  "day_announcement",
  "hunter_shoot",
  "day_speech",
  "vote",
  "tie_speech",
  "tie_vote",
  "exile_last_words",
  "fast_forwarding",
  "review",
] as const;
export type GamePhase = (typeof gamePhases)[number];

export const humanParticipationStates = [
  "alive",
  "dead_spectating",
  "fast_forwarded",
] as const;
export type HumanParticipationState =
  (typeof humanParticipationStates)[number];

export const deathCauses = [
  "night_kill",
  "exile",
  "poison",
  "hunter_shot",
] as const;
export type DeathCause = (typeof deathCauses)[number];

export const voteChoiceTypes = ["target", "abstain"] as const;
export type VoteChoiceType = (typeof voteChoiceTypes)[number];

export const nightActionTypes = [
  "werewolf_kill",
  "seer_check",
  "guard_protect",
  "witch_save",
  "witch_poison",
  "none",
] as const;
export type NightActionType = (typeof nightActionTypes)[number];

/** 女巫的夜间决策。 */
export const witchChoices = ["save", "poison", "skip"] as const;
export type WitchChoice = (typeof witchChoices)[number];

export const winConditionModes = ["simple_count", "slay_side", "slay_all"] as const;
export type WinConditionMode = (typeof winConditionModes)[number];

export const winReasons = [
  "all_werewolves_dead",
  "werewolves_reach_parity",
  "all_gods_dead",
  "all_folk_dead",
] as const;
export type WinReason = (typeof winReasons)[number];

export const eventSources = ["human", "ai", "rule_engine", "system"] as const;
export type EventSource = (typeof eventSources)[number];

export const pendingActionTypes = [
  "night_action",
  "witch_action",
  "hunter_shoot",
  "speech",
  "vote",
  "tie_speech",
  "last_words",
  "confirm",
] as const;
export type PendingActionType = (typeof pendingActionTypes)[number];

export const voteRounds = ["none", "first", "tie_break"] as const;
export type VoteRound = (typeof voteRounds)[number];

export const activeVoteRounds = ["first", "tie_break"] as const;
export type ActiveVoteRound = (typeof activeVoteRounds)[number];

export const speechKinds = [
  "day_speech",
  "tie_speech",
  "last_words",
] as const;
export type SpeechKind = (typeof speechKinds)[number];

export const eventTypes = [
  "game_created",
  "game_started",
  "game_ended",
  "players_assigned",
  "human_role_revealed",
  "werewolf_team_revealed",
  "phase_changed",
  "night_action_submitted",
  "night_action_resolved",
  "hunter_shot",
  "day_announced",
  "speech_submitted",
  "vote_submitted",
  "vote_resolved",
  "tie_speech_submitted",
  "exile_resolved",
  "player_died",
  "last_words_submitted",
  "win_checked",
  "fast_forward_requested",
  "fast_forward_completed",
  "fast_forward_failed",
] as const;
export type EventType = (typeof eventTypes)[number];

export const aiTaskTypes = [
  "speech",
  "night_action",
  "witch_action",
  "hunter_shoot",
  "vote",
  "tie_speech",
  "last_words",
  "review_question",
] as const;
export type AiTaskType = (typeof aiTaskTypes)[number];
