import { describe, expect, it } from "vitest";

import type {
  ActiveVoteRound,
  GameAction,
  GameSession,
  GameSnapshot,
  Role,
  TruthEvent,
  VoteChoiceType,
} from "../shared";
import { applyAction, type RuleEngineSuccess } from "./index";
import { buildReviewContext } from "./review";

const boardId = "mvp_5p_wolf_seer_3villagers";
const humanPlayerId = "human-1";
const now = "2026-06-19T11:00:00.000Z";

type EngineState = {
  session: GameSession;
  snapshot: GameSnapshot;
  events: TruthEvent[];
};

function expectOk(result: ReturnType<typeof applyAction>): RuleEngineSuccess {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.error.message);
  }

  return result.data;
}

function expectErrorCode(
  result: ReturnType<typeof applyAction>,
  code: "INVALID_ACTION" | "ACTION_NOT_ALLOWED" | "DUPLICATE_SUBMIT",
) {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error("Expected action to be rejected.");
  }

  expect(result.error.code).toBe(code);
}

function appendState(state: EngineState, result: RuleEngineSuccess): EngineState {
  return {
    session: result.session,
    snapshot: result.snapshot,
    events: [...state.events, ...result.events],
  };
}

function apply(state: EngineState, action: GameAction): ReturnType<typeof applyAction> {
  return applyAction(action, {
    events: state.events,
    snapshot: state.snapshot,
    session: state.session,
    now,
  });
}

function playerIdByRole(snapshot: GameSnapshot, role: Role): string {
  const player = snapshot.players.find((candidate) => candidate.role === role);

  if (!player) {
    throw new Error(`Missing player with role ${role}.`);
  }

  return player.playerId;
}

function castVote(
  state: EngineState,
  voterId: string,
  voteRound: ActiveVoteRound,
  choiceType: VoteChoiceType,
  targetId?: string,
): ReturnType<typeof applyAction> {
  return apply(state, {
    type: "submit_vote",
    idempotencyKey: `ff-vote-${voteRound}-${voterId}`,
    voterId,
    voteRound,
    choiceType,
    ...(targetId ? { targetId } : {}),
  });
}

/** Drives a fresh free-mode game with a human villager up to night resolution
 *  (the day_announcement phase, human still alive). Wolf=ai-1, seer=ai-2; the
 *  wolf kills ai-3 on night 1. */
function reachDayAnnouncement(): EngineState {
  const created = expectOk(
    applyAction(
      {
        type: "create_game",
        idempotencyKey: "ff-create",
        mode: "free",
        boardId,
        humanPlayerId,
      },
      { now },
    ),
  );
  let state: EngineState = {
    session: created.session,
    snapshot: created.snapshot,
    events: created.events,
  };

  state = appendState(
    state,
    expectOk(
      apply(state, {
        type: "confirm_role_setup",
        idempotencyKey: "ff-setup",
        playerId: humanPlayerId,
        selectedRole: "villager",
      }),
    ),
  );
  state = appendState(
    state,
    expectOk(
      apply(state, {
        type: "confirm_role_reveal",
        idempotencyKey: "ff-reveal",
        playerId: humanPlayerId,
      }),
    ),
  );

  const wolfId = playerIdByRole(state.snapshot, "werewolf");
  const seerId = playerIdByRole(state.snapshot, "seer");
  const killedVillagerId =
    state.snapshot.players.find(
      (player) => player.role === "villager" && !player.isHuman,
    )?.playerId ?? "";

  state = appendState(
    state,
    expectOk(
      apply(state, {
        type: "submit_night_action",
        idempotencyKey: "ff-wolf-kill",
        actorId: wolfId,
        actionType: "werewolf_kill",
        targetId: killedVillagerId,
      }),
    ),
  );
  state = appendState(
    state,
    expectOk(
      apply(state, {
        type: "submit_night_action",
        idempotencyKey: "ff-seer-check",
        actorId: seerId,
        actionType: "seer_check",
        targetId: wolfId,
      }),
    ),
  );

  return state;
}

/** Continues from day_announcement through the day speeches into the vote
 *  phase. */
function reachFirstVote(): EngineState {
  let state = reachDayAnnouncement();
  state = appendState(
    state,
    expectOk(
      apply(state, {
        type: "confirm_day_announcement",
        idempotencyKey: "ff-confirm-day",
        playerId: humanPlayerId,
      }),
    ),
  );

  const speakerOrder = state.snapshot.speechState?.speakerOrder ?? [];
  for (const speakerId of speakerOrder) {
    state = appendState(
      state,
      expectOk(
        apply(state, {
          type: "submit_speech",
          idempotencyKey: `ff-speech-${speakerId}`,
          speakerId,
          text: `Speech from ${speakerId}.`,
        }),
      ),
    );
  }

  return state;
}

/** Reaches review by exiling the lone werewolf (good team wins). */
function reachReview(): EngineState {
  let state = reachFirstVote();
  state = appendState(state, expectOk(castVote(state, "human-1", "first", "target", "ai-1")));
  state = appendState(state, expectOk(castVote(state, "ai-2", "first", "target", "ai-1")));
  state = appendState(state, expectOk(castVote(state, "ai-4", "first", "target", "ai-1")));
  state = appendState(state, expectOk(castVote(state, "ai-1", "first", "target", "human-1")));

  expect(state.snapshot.gamePhase).toBe("exile_last_words");
  state = appendState(
    state,
    expectOk(
      apply(state, {
        type: "submit_last_words",
        idempotencyKey: "ff-wolf-last-words",
        speakerId: "ai-1",
        text: "Well played.",
      }),
    ),
  );

  expect(state.snapshot.gamePhase).toBe("review");
  return state;
}

/** Exiles the human, leaving them dead and spectating at the start of night 2. */
function reachHumanDeadSpectating(): EngineState {
  let state = reachFirstVote();
  state = appendState(state, expectOk(castVote(state, "ai-1", "first", "target", "human-1")));
  state = appendState(state, expectOk(castVote(state, "ai-2", "first", "target", "human-1")));
  state = appendState(state, expectOk(castVote(state, "ai-4", "first", "target", "human-1")));
  state = appendState(state, expectOk(castVote(state, "human-1", "first", "target", "ai-1")));

  expect(state.snapshot.gamePhase).toBe("exile_last_words");
  expect(state.snapshot.pendingAction?.actorId).toBe(humanPlayerId);

  state = appendState(
    state,
    expectOk(
      apply(state, {
        type: "submit_last_words",
        idempotencyKey: "ff-human-last-words",
        speakerId: humanPlayerId,
        text: "Avenge me.",
      }),
    ),
  );

  return state;
}

describe("P9-S11 fast forward, new game and review context", () => {
  it("rejects fast forward while the human is still alive", () => {
    const state = reachFirstVote();
    const beforeSnapshot = structuredClone(state.snapshot);

    expectErrorCode(
      apply(state, {
        type: "request_fast_forward",
        idempotencyKey: "ff-alive-reject",
        playerId: humanPlayerId,
      }),
      "ACTION_NOT_ALLOWED",
    );
    expect(state.snapshot).toEqual(beforeSnapshot);
  });

  it("flips a dead spectating human to fast_forwarded without assigning them a pending action", () => {
    const state = reachHumanDeadSpectating();

    expect(state.snapshot.gamePhase).toBe("night_action");
    expect(state.snapshot.round.night).toBe(2);
    expect(state.snapshot.humanParticipationState).toBe("dead_spectating");
    expect(state.snapshot.pendingAction).toBeNull();
    expect(
      state.snapshot.players.find((player) => player.isHuman)?.alive,
    ).toBe(false);

    const fastForward = expectOk(
      apply(state, {
        type: "request_fast_forward",
        idempotencyKey: "ff-request",
        playerId: humanPlayerId,
      }),
    );

    expect(fastForward.events.map((event) => event.type)).toEqual([
      "fast_forward_requested",
    ]);
    expect(fastForward.snapshot.humanParticipationState).toBe("fast_forwarded");
    // The dead human is never handed a pending action.
    expect(fastForward.snapshot.pendingAction).toBeNull();

    const requestEvent = fastForward.events[0];
    expect(requestEvent.visibility).toEqual({
      public: false,
      visibleTo: [humanPlayerId],
      revealInReview: true,
    });

    // A second request (new key) is rejected once already fast-forwarding.
    const afterFastForward = appendState(state, fastForward);
    expectErrorCode(
      apply(afterFastForward, {
        type: "request_fast_forward",
        idempotencyKey: "ff-request-again",
        playerId: humanPlayerId,
      }),
      "ACTION_NOT_ALLOWED",
    );
  });

  it("lets the day announcement advance while fast-forwarding even though the human is dead", () => {
    const announcement = reachDayAnnouncement();
    // Simulate the human having died and chosen to fast-forward.
    const fastForwardSnapshot: GameSnapshot = {
      ...announcement.snapshot,
      humanParticipationState: "fast_forwarded",
      pendingAction: null,
      players: announcement.snapshot.players.map((player) =>
        player.isHuman
          ? {
              ...player,
              alive: false,
              deathCause: "night_kill" as const,
              deathEventId: "test-human-death",
            }
          : player,
      ),
    };
    const fastForwardState: EngineState = {
      ...announcement,
      snapshot: fastForwardSnapshot,
    };

    const confirmed = expectOk(
      apply(fastForwardState, {
        type: "confirm_day_announcement",
        idempotencyKey: "ff-confirm-during-ff",
        playerId: humanPlayerId,
      }),
    );

    expect(confirmed.snapshot.gamePhase).toBe("day_speech");
    // Speaker order excludes the dead human; the next actor is an AI.
    const speakerOrder = confirmed.snapshot.speechState?.speakerOrder ?? [];
    expect(speakerOrder).not.toContain(humanPlayerId);
    expect(confirmed.snapshot.pendingAction?.actorId).toBe(speakerOrder[0]);
    expect(confirmed.snapshot.pendingAction?.actorId).not.toBe(humanPlayerId);
  });

  it("still rejects a dead_spectating (not fast-forwarded) human from confirming the day", () => {
    const announcement = reachDayAnnouncement();
    const deadSpectatingSnapshot: GameSnapshot = {
      ...announcement.snapshot,
      humanParticipationState: "dead_spectating",
      players: announcement.snapshot.players.map((player) =>
        player.isHuman ? { ...player, alive: false } : player,
      ),
    };

    expectErrorCode(
      applyAction(
        {
          type: "confirm_day_announcement",
          idempotencyKey: "ff-dead-spectate-reject",
          playerId: humanPlayerId,
        },
        {
          events: announcement.events,
          snapshot: deadSpectatingSnapshot,
          session: announcement.session,
          now,
        },
      ),
      "ACTION_NOT_ALLOWED",
    );
  });

  it("confirms a new game only from review and resets to an empty mode_select snapshot", () => {
    const review = reachReview();

    // Not allowed mid-game.
    const midGame = reachFirstVote();
    expectErrorCode(
      apply(midGame, {
        type: "confirm_new_game",
        idempotencyKey: "ff-new-game-midgame",
        playerId: humanPlayerId,
      }),
      "ACTION_NOT_ALLOWED",
    );

    // Not allowed for a non-human player id.
    expectErrorCode(
      apply(review, {
        type: "confirm_new_game",
        idempotencyKey: "ff-new-game-wrong-player",
        playerId: "ai-2",
      }),
      "ACTION_NOT_ALLOWED",
    );

    const reset = expectOk(
      apply(review, {
        type: "confirm_new_game",
        idempotencyKey: "ff-new-game",
        playerId: humanPlayerId,
      }),
    );

    expect(reset.events.map((event) => event.type)).toEqual(["phase_changed"]);
    expect(reset.snapshot.gamePhase).toBe("mode_select");
    expect(reset.snapshot.players).toEqual([]);
    expect(reset.snapshot.pendingAction).toBeNull();
    expect(reset.snapshot.round).toEqual({ night: 0, day: 0, voteRound: "none" });
    expect(reset.visibleInformation.canAct).toBe(false);
    expect(reset.visibleInformation.legalActions).toEqual([]);
  });

  it("buildReviewContext assembles the full ground truth at review", () => {
    const review = reachReview();
    const context = buildReviewContext(
      review.session,
      review.snapshot.players,
      review.events,
    );

    expect(context.winner).toBe("good_team");
    expect(context.winReason).toBe("all_werewolves_dead");

    // Both night 1 resolutions (wolf kill + seer check) are present.
    expect(context.nightActions).toHaveLength(2);
    expect(context.nightActions.map((action) => action.actionType).sort()).toEqual([
      "seer_check",
      "werewolf_kill",
    ]);

    // Four day speeches plus the werewolf's last words.
    const daySpeeches = context.speeches.filter(
      (speech) => speech.speechKind === "day_speech",
    );
    const lastWords = context.speeches.filter(
      (speech) => speech.speechKind === "last_words",
    );
    expect(daySpeeches).toHaveLength(4);
    expect(lastWords).toHaveLength(1);
    expect(lastWords[0].speakerId).toBe("ai-1");

    // Four first-round votes, each carrying its voter and choice.
    expect(context.votes).toHaveLength(4);
    expect(context.votes.every((vote) => vote.voteRound === "first")).toBe(true);
    const humanVote = context.votes.find((vote) => vote.voterId === "human-1");
    expect(humanVote?.choiceType).toBe("target");
    expect(humanVote?.targetId).toBe("ai-1");

    // The dead werewolf and the night-killed villager are in the final roster.
    const wolf = context.players.find((player) => player.playerId === "ai-1");
    expect(wolf?.alive).toBe(false);
    expect(wolf?.deathCause).toBe("exile");
  });
});
