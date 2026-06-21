import {
  derivePlayerOutcomes,
  type Faction,
  type GameSession,
  type Player,
  type ReviewContext,
  type ReviewNightActionRef,
  type ReviewSpeechRef,
  type ReviewVoteRef,
  type TruthEvent,
  type VoteChoiceType,
  type WinReason,
} from "../shared";

/**
 * Assembles the full ground truth for the post-game review. This is the ONLY
 * place the complete history is reconstructed, and the store must call it only
 * when `gamePhase === "review"` (ISO-002). It folds the append-only event log
 * into speeches, votes and night actions, plus the final outcome.
 */
export function buildReviewContext(
  session: GameSession,
  players: Player[],
  events: TruthEvent[],
): ReviewContext {
  const speeches = events.flatMap(toReviewSpeech);
  const votes = events.flatMap(toReviewVote);
  const nightActions = events.flatMap(toReviewNightAction);
  const outcomes = derivePlayerOutcomes(players, events);
  const outcome = resolveOutcome(events, players);

  return {
    session,
    players,
    events,
    speeches,
    votes,
    nightActions,
    outcomes,
    winner: outcome.winner,
    winReason: outcome.winReason,
  };
}

function toReviewSpeech(event: TruthEvent): ReviewSpeechRef[] {
  if (
    event.type !== "speech_submitted" &&
    event.type !== "tie_speech_submitted" &&
    event.type !== "last_words_submitted"
  ) {
    return [];
  }

  return [
    {
      eventId: event.eventId,
      speakerId: String(event.payload.speakerId),
      day: Number(event.payload.day),
      speechKind:
        event.type === "last_words_submitted"
          ? "last_words"
          : event.type === "tie_speech_submitted"
            ? "tie_speech"
            : "day_speech",
      text: String(event.payload.text),
      createdAt: event.createdAt,
    },
  ];
}

function toReviewVote(event: TruthEvent): ReviewVoteRef[] {
  if (event.type !== "vote_submitted") {
    return [];
  }

  const choiceType: VoteChoiceType =
    event.payload.choiceType === "abstain" ? "abstain" : "target";

  return [
    {
      eventId: event.eventId,
      day: event.round.day,
      voteRound: event.round.voteRound === "tie_break" ? "tie_break" : "first",
      voterId: String(event.payload.voterId),
      choiceType,
      ...(typeof event.payload.targetId === "string"
        ? { targetId: event.payload.targetId }
        : {}),
    },
  ];
}

const REVIEW_NIGHT_ACTION_TYPES = [
  "werewolf_kill",
  "seer_check",
  "guard_protect",
  "witch_save",
  "witch_poison",
] as const;

function toReviewNightAction(event: TruthEvent): ReviewNightActionRef[] {
  if (event.type !== "night_action_resolved") {
    return [];
  }

  const raw = event.payload.actionType;
  const actionType = (REVIEW_NIGHT_ACTION_TYPES as readonly string[]).includes(
    String(raw),
  )
    ? (raw as ReviewNightActionRef["actionType"])
    : null;
  // 跳过非具体行动的 resolved（如女巫醒来提示 actionType="none"）。
  if (!actionType) {
    return [];
  }

  const actorIds = Array.isArray(event.payload.actorIds)
    ? event.payload.actorIds.filter((id): id is string => typeof id === "string")
    : [];

  return [
    {
      eventId: event.eventId,
      night: event.round.night,
      actorId: String(event.payload.actorId ?? event.actorId ?? ""),
      ...(actorIds.length > 0 ? { actorIds } : {}),
      actionType,
      ...(typeof event.payload.targetId === "string"
        ? { targetId: event.payload.targetId }
        : {}),
      result:
        event.payload.result && typeof event.payload.result === "object"
          ? (event.payload.result as Record<string, unknown>)
          : {},
    },
  ];
}

function resolveOutcome(
  events: TruthEvent[],
  players: Player[],
): { winner: Faction; winReason: WinReason } {
  const ended = [...events]
    .reverse()
    .find(
      (event) =>
        (event.type === "game_ended" || event.type === "win_checked") &&
        isFaction(event.payload.winner) &&
        isWinReason(event.payload.winReason),
    );

  if (ended) {
    return {
      winner: ended.payload.winner as Faction,
      winReason: ended.payload.winReason as WinReason,
    };
  }

  // Fallback: derive from the final player roster (review should always have a
  // recorded outcome, but never leave the context without one).
  const aliveWerewolves = players.filter(
    (player) => player.alive && player.role === "werewolf",
  );

  if (aliveWerewolves.length === 0) {
    return { winner: "good_team", winReason: "all_werewolves_dead" };
  }

  return { winner: "werewolf_team", winReason: "werewolves_reach_parity" };
}

function isFaction(value: unknown): value is Faction {
  return value === "good_team" || value === "werewolf_team";
}

function isWinReason(value: unknown): value is WinReason {
  return (
    value === "all_werewolves_dead" ||
    value === "werewolves_reach_parity" ||
    value === "all_gods_dead" ||
    value === "all_folk_dead"
  );
}
