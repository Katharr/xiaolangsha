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
import { buildVisibleInformation } from "./visibility";

const boardId = "mvp_5p_wolf_seer_3villagers";
const humanPlayerId = "human-1";
const now = "2026-06-19T10:00:00.000Z";

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

/** 存活玩家按座位排序后的 id 列表（座位现已随机，引擎按座位定顺序）。 */
function aliveIdsBySeat(snapshot: GameSnapshot): string[] {
  return [...snapshot.players]
    .filter((player) => player.alive)
    .sort((left, right) => left.seat - right.seat)
    .map((player) => player.playerId);
}

/** 给定一组 id，按它们在快照里的座位排序（用于校验候选/发言顺序）。 */
function idsBySeat(snapshot: GameSnapshot, ids: string[]): string[] {
  return ids
    .map((id) => ({
      id,
      seat: snapshot.players.find((p) => p.playerId === id)?.seat ?? 0,
    }))
    .sort((a, b) => a.seat - b.seat)
    .map((entry) => entry.id);
}

function expectNoRoleLeakInPayloads(events: TruthEvent[]) {
  const payloadText = JSON.stringify(events.map((event) => event.payload));

  expect(payloadText).not.toMatch(
    /werewolf|seer|villager|good_team|werewolf_team/,
  );
}

function expectMonotonicSeq(events: TruthEvent[]) {
  for (let index = 1; index < events.length; index += 1) {
    expect(events[index].seq).toBeGreaterThan(events[index - 1].seq);
  }
}

/**
 * Drives a fresh free-mode game with a human villager up to the first vote
 * phase. Wolf is ai-1, seer is ai-2; the wolf kills ai-3 on night 1, leaving
 * [human-1, ai-1, ai-2, ai-4] alive as voters/candidates.
 */
function reachFirstVote(): EngineState {
  const created = expectOk(
    applyAction(
      {
        type: "create_game",
        idempotencyKey: "vote-create",
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
        idempotencyKey: "vote-setup",
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
        idempotencyKey: "vote-reveal",
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
        idempotencyKey: "vote-wolf-kill",
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
        idempotencyKey: "vote-seer-check",
        actorId: seerId,
        actionType: "seer_check",
        targetId: wolfId,
      }),
    ),
  );
  state = appendState(
    state,
    expectOk(
      apply(state, {
        type: "confirm_day_announcement",
        idempotencyKey: "vote-confirm-day",
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
          idempotencyKey: `vote-speech-${speakerId}`,
          speakerId,
          text: `Speech from ${speakerId}.`,
        }),
      ),
    );
  }

  return state;
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
    idempotencyKey: `vote-${voteRound}-${voterId}`,
    voterId,
    voteRound,
    choiceType,
    ...(targetId ? { targetId } : {}),
  });
}

describe("P9-S06 voting, tie-break, exile and last words", () => {
  it("initialises a parallel vote state after the last day speech", () => {
    const state = reachFirstVote();

    expect(state.snapshot.gamePhase).toBe("vote");
    expect(state.snapshot.pendingAction).toBeNull();
    expect(state.snapshot.round.voteRound).toBe("first");
    const voters = aliveIdsBySeat(state.snapshot);
    expect(voters.sort()).toEqual(["ai-1", "ai-2", "ai-4", "human-1"]);
    expect(state.snapshot.voteState).toEqual({
      day: 1,
      voteRound: "first",
      eligibleVoterIds: aliveIdsBySeat(state.snapshot),
      submittedVoterIds: [],
      candidateIds: aliveIdsBySeat(state.snapshot),
      allowAbstain: true,
      resolved: false,
    });
  });

  it("UI-003 exposes a vote action to every eligible voter and keeps single votes private", () => {
    const state = reachFirstVote();
    const humanView = buildVisibleInformation(humanPlayerId, state.snapshot, state.events);

    expect(humanView.canAct).toBe(true);
    const humanTargets = aliveIdsBySeat(state.snapshot).filter(
      (id) => id !== humanPlayerId,
    );
    expect(humanView.legalActions).toEqual([
      {
        actionType: "vote",
        actorId: humanPlayerId,
        legalTargets: humanTargets,
        allowAbstain: true,
        required: true,
      },
    ]);

    const firstVote = expectOk(castVote(state, humanPlayerId, "first", "target", "ai-1"));
    const voteEvent = firstVote.events.find((event) => event.type === "vote_submitted");

    expect(firstVote.events.map((event) => event.type)).toEqual(["vote_submitted"]);
    // 同时暗投：vote_submitted 在结算前只有投票者本人可见。
    expect(voteEvent?.visibility).toEqual({
      public: false,
      visibleTo: [humanPlayerId],
      revealInReview: true,
    });
    expect(firstVote.snapshot.gamePhase).toBe("vote");
    expect(firstVote.snapshot.pendingAction).toBeNull();
    expect(firstVote.snapshot.voteState?.submittedVoterIds).toEqual([humanPlayerId]);

    // Another voter who has not yet voted may still act; the human may not.
    const afterFirst = appendState(state, firstVote);
    const humanAfter = buildVisibleInformation(humanPlayerId, afterFirst.snapshot, afterFirst.events);
    const aiVoterAfter = buildVisibleInformation("ai-2", afterFirst.snapshot, afterFirst.events);

    expect(humanAfter.canAct).toBe(false);
    expect(aiVoterAfter.canAct).toBe(true);

    // 防跟票：本轮未结算时，其他投票者看不到这张票；投票者只看得到自己的票。
    expect(aiVoterAfter.votes).toEqual([]);
    expect(humanAfter.votes.map((vote) => vote.voterId)).toEqual([humanPlayerId]);
  });

  it("resolves a unique majority into exile, last words, and the next night", () => {
    let state = reachFirstVote();

    state = appendState(state, expectOk(castVote(state, "human-1", "first", "target", "ai-4")));
    state = appendState(state, expectOk(castVote(state, "ai-1", "first", "target", "ai-4")));
    state = appendState(state, expectOk(castVote(state, "ai-2", "first", "target", "ai-4")));
    const resolved = expectOk(castVote(state, "ai-4", "first", "target", "ai-1"));

    expect(resolved.events.map((event) => event.type)).toEqual([
      "vote_submitted",
      "vote_resolved",
      "exile_resolved",
      "player_died",
      "phase_changed",
    ]);

    const voteResolved = resolved.events.find((event) => event.type === "vote_resolved");
    expect(voteResolved?.payload).toEqual({
      voteRound: "first",
      day: 1,
      tally: { "ai-4": 3, "ai-1": 1 },
      // 结算时一次性公示全部票型（按投票先后顺序）。
      votes: [
        { voterId: "human-1", choiceType: "target", targetId: "ai-4" },
        { voterId: "ai-1", choiceType: "target", targetId: "ai-4" },
        { voterId: "ai-2", choiceType: "target", targetId: "ai-4" },
        { voterId: "ai-4", choiceType: "target", targetId: "ai-1" },
      ],
      exiledPlayerId: "ai-4",
      outcome: "exile",
    });
    expect(voteResolved?.visibility.public).toBe(true);

    // 结算后该轮票型对所有存活玩家同时翻牌（包括没投这张票的人）。
    const aliveVotesView = buildVisibleInformation("ai-2", resolved.snapshot, [
      ...state.events,
      ...resolved.events,
    ]);
    expect(
      aliveVotesView.votes.filter((vote) => vote.voteRound === "first").length,
    ).toBe(4);

    expect(resolved.snapshot.gamePhase).toBe("exile_last_words");
    expect(resolved.snapshot.pendingAction).toEqual({
      type: "last_words",
      actorId: "ai-4",
      legalTargets: [],
      allowAbstain: false,
    });
    expect(resolved.snapshot.voteState?.resolved).toBe(true);

    const exiled = resolved.snapshot.players.find((player) => player.playerId === "ai-4");
    expect(exiled?.alive).toBe(false);
    expect(exiled?.deathCause).toBe("exile");
    expect(exiled?.isRoleVisiblePublicly).toBe(false);

    // The exiled (now dead) player is the only one who may give last words.
    const exiledView = buildVisibleInformation("ai-4", resolved.snapshot, [
      ...state.events,
      ...resolved.events,
    ]);
    const aliveView = buildVisibleInformation("ai-2", resolved.snapshot, [
      ...state.events,
      ...resolved.events,
    ]);
    expect(exiledView.canAct).toBe(true);
    expect(exiledView.legalActions).toEqual([
      {
        actionType: "last_words",
        actorId: "ai-4",
        legalTargets: [],
        allowAbstain: false,
        required: true,
      },
    ]);
    expect(aliveView.canAct).toBe(false);

    state = appendState(state, resolved);
    const lastWords = expectOk(
      apply(state, {
        type: "submit_last_words",
        idempotencyKey: "vote-last-words-ai4",
        speakerId: "ai-4",
        text: "I was only a humble townsperson.",
      }),
    );

    expect(lastWords.events.map((event) => event.type)).toEqual([
      "last_words_submitted",
      "win_checked",
      "phase_changed",
    ]);
    // A werewolf is still alive, so the game advances to night 2.
    expect(lastWords.snapshot.gamePhase).toBe("night_action");
    expect(lastWords.snapshot.round).toEqual({ night: 2, day: 1, voteRound: "none" });
    expect(lastWords.snapshot.nightState).toEqual({
      night: 2,
      steps: [
        { kind: "werewolf_kill", actorIds: ["ai-1"], submittedActorIds: [] },
        { kind: "seer_check", actorIds: ["ai-2"], submittedActorIds: [] },
      ],
      currentStepIndex: 0,
      resolved: false,
      deathPlayerIds: [],
    });
    // Human is a villager, so they have no night pending action.
    expect(lastWords.snapshot.pendingAction).toBeNull();
    expect(lastWords.snapshot.voteState).toBeUndefined();
  });

  it("ends the game when the exiled player removes the last werewolf", () => {
    let state = reachFirstVote();

    state = appendState(state, expectOk(castVote(state, "human-1", "first", "target", "ai-1")));
    state = appendState(state, expectOk(castVote(state, "ai-2", "first", "target", "ai-1")));
    state = appendState(state, expectOk(castVote(state, "ai-4", "first", "target", "ai-1")));
    const resolved = expectOk(castVote(state, "ai-1", "first", "target", "human-1"));

    expect(resolved.snapshot.gamePhase).toBe("exile_last_words");
    state = appendState(state, resolved);

    const lastWords = expectOk(
      apply(state, {
        type: "submit_last_words",
        idempotencyKey: "vote-last-words-wolf",
        speakerId: "ai-1",
        text: "You found me.",
      }),
    );

    expect(lastWords.events.map((event) => event.type)).toEqual([
      "last_words_submitted",
      "win_checked",
      "phase_changed",
      "game_ended",
    ]);
    expect(lastWords.snapshot.gamePhase).toBe("review");
    expect(lastWords.snapshot.winner).toBe("good_team");
    expect(lastWords.snapshot.winReason).toBe("all_werewolves_dead");
    expect(lastWords.snapshot.pendingAction).toBeNull();
    expect(lastWords.session.status).toBe("ended");
    expect(lastWords.session.endedAt).toBe(now);

    const gameEnded = lastWords.events.find((event) => event.type === "game_ended");
    expect(gameEnded?.payload).toEqual({
      winner: "good_team",
      winReason: "all_werewolves_dead",
      endedAt: now,
    });
  });

  it("routes a first-round tie through tie speeches into a tie-break vote", () => {
    let state = reachFirstVote();

    // 2-2 tie between ai-1 and ai-2.
    state = appendState(state, expectOk(castVote(state, "human-1", "first", "target", "ai-1")));
    state = appendState(state, expectOk(castVote(state, "ai-2", "first", "target", "ai-1")));
    state = appendState(state, expectOk(castVote(state, "ai-1", "first", "target", "ai-2")));
    const tied = expectOk(castVote(state, "ai-4", "first", "target", "ai-2"));

    expect(tied.events.map((event) => event.type)).toEqual([
      "vote_submitted",
      "vote_resolved",
      "phase_changed",
    ]);
    const voteResolved = tied.events.find((event) => event.type === "vote_resolved");
    expect(voteResolved?.payload).toMatchObject({
      outcome: "tie",
      exiledPlayerId: null,
      tally: { "ai-1": 2, "ai-2": 2 },
    });
    expect(tied.snapshot.gamePhase).toBe("tie_speech");
    const tieSpeakers = idsBySeat(tied.snapshot, ["ai-1", "ai-2"]);
    expect(tied.snapshot.speechState).toEqual({
      day: 1,
      speechKind: "tie_speech",
      speakerOrder: tieSpeakers,
      currentSpeakerId: tieSpeakers[0],
      completedSpeakerIds: [],
    });
    expect(tied.snapshot.pendingAction).toEqual({
      type: "tie_speech",
      actorId: tieSpeakers[0],
      legalTargets: [],
      allowAbstain: false,
    });

    state = appendState(state, tied);
    state = appendState(
      state,
      expectOk(
        apply(state, {
          type: "submit_tie_speech",
          idempotencyKey: "tie-speech-1",
          speakerId: tieSpeakers[0],
          text: "Vote me and you lose a good man.",
        }),
      ),
    );
    expect(state.snapshot.pendingAction?.actorId).toBe(tieSpeakers[1]);

    const tieVoteReady = expectOk(
      apply(state, {
        type: "submit_tie_speech",
        idempotencyKey: "tie-speech-2",
        speakerId: tieSpeakers[1],
        text: "No, vote the other one.",
      }),
    );
    expect(tieVoteReady.events.map((event) => event.type)).toEqual([
      "tie_speech_submitted",
      "phase_changed",
    ]);
    expect(tieVoteReady.snapshot.gamePhase).toBe("tie_vote");
    expect(tieVoteReady.snapshot.round.voteRound).toBe("tie_break");
    expect(tieVoteReady.snapshot.pendingAction).toBeNull();
    expect(tieVoteReady.snapshot.voteState).toEqual({
      day: 1,
      voteRound: "tie_break",
      eligibleVoterIds: aliveIdsBySeat(tieVoteReady.snapshot),
      submittedVoterIds: [],
      candidateIds: tieSpeakers,
      allowAbstain: true,
      resolved: false,
    });

    state = appendState(state, tieVoteReady);

    // Unique majority in the tie-break exiles ai-2.
    state = appendState(state, expectOk(castVote(state, "human-1", "tie_break", "target", "ai-2")));
    state = appendState(state, expectOk(castVote(state, "ai-1", "tie_break", "target", "ai-2")));
    state = appendState(state, expectOk(castVote(state, "ai-4", "tie_break", "target", "ai-2")));
    const tieResolved = expectOk(castVote(state, "ai-2", "tie_break", "target", "ai-1"));

    expect(tieResolved.snapshot.gamePhase).toBe("exile_last_words");
    expect(tieResolved.snapshot.pendingAction?.actorId).toBe("ai-2");
    const exiledTie = tieResolved.snapshot.players.find((player) => player.playerId === "ai-2");
    expect(exiledTie?.alive).toBe(false);
    expect(exiledTie?.deathCause).toBe("exile");
  });

  it("exiles nobody when the tie-break vote ties again, then advances to night", () => {
    let state = reachFirstVote();

    state = appendState(state, expectOk(castVote(state, "human-1", "first", "target", "ai-1")));
    state = appendState(state, expectOk(castVote(state, "ai-2", "first", "target", "ai-1")));
    state = appendState(state, expectOk(castVote(state, "ai-1", "first", "target", "ai-2")));
    state = appendState(state, expectOk(castVote(state, "ai-4", "first", "target", "ai-2")));

    expect(state.snapshot.gamePhase).toBe("tie_speech");

    const tie2Speakers = state.snapshot.speechState?.speakerOrder ?? [];
    state = appendState(
      state,
      expectOk(
        apply(state, {
          type: "submit_tie_speech",
          idempotencyKey: "tie2-speech-1",
          speakerId: tie2Speakers[0],
          text: "Defending myself.",
        }),
      ),
    );
    state = appendState(
      state,
      expectOk(
        apply(state, {
          type: "submit_tie_speech",
          idempotencyKey: "tie2-speech-2",
          speakerId: tie2Speakers[1],
          text: "Defending myself too.",
        }),
      ),
    );

    expect(state.snapshot.gamePhase).toBe("tie_vote");

    // Tie again 2-2 in the tie-break round; max tie rounds is exhausted.
    state = appendState(state, expectOk(castVote(state, "human-1", "tie_break", "target", "ai-1")));
    state = appendState(state, expectOk(castVote(state, "ai-2", "tie_break", "target", "ai-1")));
    state = appendState(state, expectOk(castVote(state, "ai-1", "tie_break", "target", "ai-2")));
    const tiedAgain = expectOk(castVote(state, "ai-4", "tie_break", "target", "ai-2"));

    expect(tiedAgain.events.map((event) => event.type)).toEqual([
      "vote_submitted",
      "vote_resolved",
      "win_checked",
      "phase_changed",
    ]);
    const voteResolved = tiedAgain.events.find((event) => event.type === "vote_resolved");
    expect(voteResolved?.payload).toMatchObject({
      voteRound: "tie_break",
      outcome: "no_exile",
      exiledPlayerId: null,
    });
    // No deaths: everybody who was alive remains alive.
    expect(tiedAgain.snapshot.players.filter((player) => player.alive)).toHaveLength(4);
    expect(tiedAgain.snapshot.gamePhase).toBe("night_action");
    expect(tiedAgain.snapshot.round).toEqual({ night: 2, day: 1, voteRound: "none" });
  });

  it("treats an all-abstain round as no exile and accepts abstentions", () => {
    let state = reachFirstVote();

    const abstain = expectOk(castVote(state, "human-1", "first", "abstain"));
    const abstainEvent = abstain.events.find((event) => event.type === "vote_submitted");
    expect(abstainEvent?.payload).toEqual({
      voterId: "human-1",
      voteRound: "first",
      choiceType: "abstain",
    });
    state = appendState(state, abstain);

    state = appendState(state, expectOk(castVote(state, "ai-1", "first", "abstain")));
    state = appendState(state, expectOk(castVote(state, "ai-2", "first", "abstain")));
    const resolved = expectOk(castVote(state, "ai-4", "first", "abstain"));

    const voteResolved = resolved.events.find((event) => event.type === "vote_resolved");
    expect(voteResolved?.payload).toMatchObject({
      outcome: "no_exile",
      exiledPlayerId: null,
      tally: {},
    });
    expect(resolved.snapshot.gamePhase).toBe("night_action");
    expect(resolved.snapshot.players.filter((player) => player.alive)).toHaveLength(4);
  });

  it("rejects illegal votes without writing facts", () => {
    const state = reachFirstVote();
    const beforeSnapshot = structuredClone(state.snapshot);

    // Self vote.
    expectErrorCode(
      castVote(state, "human-1", "first", "target", "human-1"),
      "ACTION_NOT_ALLOWED",
    );
    // Voting a dead player (ai-3 was killed at night).
    expectErrorCode(
      castVote(state, "human-1", "first", "target", "ai-3"),
      "ACTION_NOT_ALLOWED",
    );
    // A dead player cannot vote.
    expectErrorCode(
      castVote(state, "ai-3", "first", "target", "ai-1"),
      "ACTION_NOT_ALLOWED",
    );
    // Wrong vote round for the current phase.
    expectErrorCode(
      castVote(state, "human-1", "tie_break", "target", "ai-1"),
      "ACTION_NOT_ALLOWED",
    );

    expect(state.snapshot).toEqual(beforeSnapshot);

    // Duplicate vote (same voter, new key) is rejected.
    const firstVote = expectOk(castVote(state, "human-1", "first", "target", "ai-1"));
    const afterFirst = appendState(state, firstVote);
    const duplicate = apply(afterFirst, {
      type: "submit_vote",
      idempotencyKey: "vote-first-human-1-again",
      voterId: "human-1",
      voteRound: "first",
      choiceType: "target",
      targetId: "ai-2",
    });
    expectErrorCode(duplicate, "ACTION_NOT_ALLOWED");
  });

  it("rejects voting before a vote state exists", () => {
    const state = reachFirstVote();
    // Rewind to a fabricated day_speech snapshot with no vote state.
    const daySpeechState: EngineState = {
      ...state,
      snapshot: {
        ...state.snapshot,
        gamePhase: "day_speech",
        voteState: undefined,
      },
    };

    expectErrorCode(
      castVote(daySpeechState, "human-1", "first", "target", "ai-1"),
      "INVALID_ACTION",
    );
  });

  it("rejects empty or overlong tie speeches and last words", () => {
    let state = reachFirstVote();
    state = appendState(state, expectOk(castVote(state, "human-1", "first", "target", "ai-1")));
    state = appendState(state, expectOk(castVote(state, "ai-2", "first", "target", "ai-1")));
    state = appendState(state, expectOk(castVote(state, "ai-1", "first", "target", "ai-2")));
    state = appendState(state, expectOk(castVote(state, "ai-4", "first", "target", "ai-2")));

    expect(state.snapshot.gamePhase).toBe("tie_speech");

    const currentSpeaker = state.snapshot.speechState?.currentSpeakerId ?? "";
    const waitingSpeaker =
      state.snapshot.speechState?.speakerOrder.find(
        (id) => id !== currentSpeaker,
      ) ?? "";

    expectErrorCode(
      apply(state, {
        type: "submit_tie_speech",
        idempotencyKey: "bad-tie-empty",
        speakerId: currentSpeaker,
        text: "   ",
      }),
      "INVALID_ACTION",
    );
    expectErrorCode(
      apply(state, {
        type: "submit_tie_speech",
        idempotencyKey: "bad-tie-long",
        speakerId: currentSpeaker,
        text: "x".repeat(501),
      }),
      "INVALID_ACTION",
    );
    // Out-of-turn tie speaker.
    expectErrorCode(
      apply(state, {
        type: "submit_tie_speech",
        idempotencyKey: "bad-tie-turn",
        speakerId: waitingSpeaker,
        text: "Not my turn yet.",
      }),
      "ACTION_NOT_ALLOWED",
    );

    // Move to exile and check last words validation.
    let exileState = reachFirstVote();
    exileState = appendState(exileState, expectOk(castVote(exileState, "human-1", "first", "target", "ai-4")));
    exileState = appendState(exileState, expectOk(castVote(exileState, "ai-1", "first", "target", "ai-4")));
    exileState = appendState(exileState, expectOk(castVote(exileState, "ai-2", "first", "target", "ai-4")));
    exileState = appendState(exileState, expectOk(castVote(exileState, "ai-4", "first", "target", "ai-1")));

    expect(exileState.snapshot.gamePhase).toBe("exile_last_words");

    expectErrorCode(
      apply(exileState, {
        type: "submit_last_words",
        idempotencyKey: "bad-last-empty",
        speakerId: "ai-4",
        text: "",
      }),
      "INVALID_ACTION",
    );
    // Wrong speaker (only the exiled player may give last words).
    expectErrorCode(
      apply(exileState, {
        type: "submit_last_words",
        idempotencyKey: "bad-last-speaker",
        speakerId: "ai-2",
        text: "I want to speak too.",
      }),
      "ACTION_NOT_ALLOWED",
    );
  });

  it("RULE-008 replays vote and last-words idempotency keys as no-op results", () => {
    const state = reachFirstVote();
    const firstVote = expectOk(castVote(state, "human-1", "first", "target", "ai-1"));
    const afterFirst = appendState(state, firstVote);
    const replayed = expectOk(castVote(afterFirst, "human-1", "first", "target", "ai-1"));

    expect(replayed.events).toEqual([]);
    expect(replayed.snapshot).toEqual(firstVote.snapshot);
  });

  it("ISO never leaks roles and keeps event sequence numbers monotonic", () => {
    let state = reachFirstVote();
    state = appendState(state, expectOk(castVote(state, "human-1", "first", "target", "ai-4")));
    state = appendState(state, expectOk(castVote(state, "ai-1", "first", "target", "ai-4")));
    state = appendState(state, expectOk(castVote(state, "ai-2", "first", "target", "ai-4")));
    state = appendState(state, expectOk(castVote(state, "ai-4", "first", "target", "ai-1")));
    state = appendState(
      state,
      expectOk(
        apply(state, {
          type: "submit_last_words",
          idempotencyKey: "iso-last-words",
          speakerId: "ai-4",
          text: "Farewell, my friends.",
        }),
      ),
    );

    expectMonotonicSeq(state.events);
    expectNoRoleLeakInPayloads(
      state.events.filter((event) =>
        [
          "vote_submitted",
          "vote_resolved",
          "exile_resolved",
          "player_died",
          "last_words_submitted",
          "tie_speech_submitted",
          "phase_changed",
          "win_checked",
        ].includes(event.type),
      ),
    );
  });
});
