import { describe, expect, it } from "vitest";

import type {
  GameAction,
  GameSession,
  GameSnapshot,
  Role,
  TruthEvent,
} from "../shared";
import { applyAction, type RuleEngineSuccess } from "./index";
import { buildVisibleInformation } from "./visibility";

const boardId = "mvp_5p_wolf_seer_3villagers";
const humanPlayerId = "human-1";

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

function createNightState(humanRole: Role = "villager"): EngineState {
  const created = expectOk(
    applyAction(
      {
        type: "create_game",
        idempotencyKey: `create-${humanRole}-day-speech`,
        mode: "free",
        boardId,
        humanPlayerId,
      },
      { now: "2026-06-19T09:00:00.000Z" },
    ),
  );
  const assigned = expectOk(
    applyAction(
      {
        type: "confirm_role_setup",
        idempotencyKey: `setup-${humanRole}-day-speech`,
        playerId: humanPlayerId,
        selectedRole: humanRole,
      },
      {
        events: created.events,
        snapshot: created.snapshot,
        session: created.session,
        now: "2026-06-19T09:00:01.000Z",
      },
    ),
  );
  const assignedEvents = [...created.events, ...assigned.events];
  const started = expectOk(
    applyAction(
      {
        type: "confirm_role_reveal",
        idempotencyKey: `reveal-${humanRole}-day-speech`,
        playerId: humanPlayerId,
      },
      {
        events: assignedEvents,
        snapshot: assigned.snapshot,
        session: assigned.session,
        now: "2026-06-19T09:00:02.000Z",
      },
    ),
  );

  return {
    session: started.session,
    snapshot: started.snapshot,
    events: [...assignedEvents, ...started.events],
  };
}

function createDayAnnouncementState(): EngineState {
  const state = createNightState("villager");
  const wolfId = playerIdByRole(state.snapshot, "werewolf");
  const seerId = playerIdByRole(state.snapshot, "seer");
  const killedVillagerId =
    state.snapshot.players.find(
      (player) => player.role === "villager" && !player.isHuman,
    )?.playerId ?? "";

  const wolfSubmitted = expectOk(
    applyAction(
      {
        type: "submit_night_action",
        idempotencyKey: "day-speech-wolf-kill",
        actorId: wolfId,
        actionType: "werewolf_kill",
        targetId: killedVillagerId,
      },
      {
        events: state.events,
        snapshot: state.snapshot,
        session: state.session,
        now: "2026-06-19T09:00:03.000Z",
      },
    ),
  );
  const afterWolf = appendState(state, wolfSubmitted);
  const seerSubmitted = expectOk(
    applyAction(
      {
        type: "submit_night_action",
        idempotencyKey: "day-speech-seer-check",
        actorId: seerId,
        actionType: "seer_check",
        targetId: wolfId,
      },
      {
        events: afterWolf.events,
        snapshot: afterWolf.snapshot,
        session: afterWolf.session,
        now: "2026-06-19T09:00:04.000Z",
      },
    ),
  );

  return appendState(afterWolf, seerSubmitted);
}

function confirmDayAnnouncement(state: EngineState, idempotencyKey: string) {
  return applyAction(
    {
      type: "confirm_day_announcement",
      idempotencyKey,
      playerId: humanPlayerId,
    },
    {
      events: state.events,
      snapshot: state.snapshot,
      session: state.session,
      now: "2026-06-19T09:00:05.000Z",
    },
  );
}

function submitSpeech(
  state: EngineState,
  action: Extract<GameAction, { type: "submit_speech" }>,
) {
  return applyAction(action, {
    events: state.events,
    snapshot: state.snapshot,
    session: state.session,
    now: "2026-06-19T09:00:06.000Z",
  });
}

function resolveNightToDayAnnouncement(): {
  result: RuleEngineSuccess;
  state: EngineState;
} {
  const state = createNightState("villager");
  const wolfId = playerIdByRole(state.snapshot, "werewolf");
  const seerId = playerIdByRole(state.snapshot, "seer");
  const killedVillagerId =
    state.snapshot.players.find(
      (player) => player.role === "villager" && !player.isHuman,
    )?.playerId ?? "";

  const wolfSubmitted = expectOk(
    applyAction(
      {
        type: "submit_night_action",
        idempotencyKey: "day-speech-wolf-kill",
        actorId: wolfId,
        actionType: "werewolf_kill",
        targetId: killedVillagerId,
      },
      {
        events: state.events,
        snapshot: state.snapshot,
        session: state.session,
        now: "2026-06-19T09:00:03.000Z",
      },
    ),
  );
  const afterWolf = appendState(state, wolfSubmitted);
  const seerSubmitted = expectOk(
    applyAction(
      {
        type: "submit_night_action",
        idempotencyKey: "day-speech-seer-check",
        actorId: seerId,
        actionType: "seer_check",
        targetId: wolfId,
      },
      {
        events: afterWolf.events,
        snapshot: afterWolf.snapshot,
        session: afterWolf.session,
        now: "2026-06-19T09:00:04.000Z",
      },
    ),
  );

  return {
    result: seerSubmitted,
    state: appendState(afterWolf, seerSubmitted),
  };
}

function playerIdByRole(snapshot: GameSnapshot, role: Role): string {
  const player = snapshot.players.find((candidate) => candidate.role === role);

  if (!player) {
    throw new Error(`Missing player with role ${role}.`);
  }

  return player.playerId;
}

function alivePlayerIdsBySeat(snapshot: GameSnapshot): string[] {
  return [...snapshot.players]
    .filter((player) => player.alive)
    .sort((left, right) => left.seat - right.seat)
    .map((player) => player.playerId);
}

function expectNoRoleLeakInPayloads(events: TruthEvent[]) {
  const payloadText = JSON.stringify(events.map((event) => event.payload));

  expect(payloadText).not.toMatch(
    /werewolf|seer|villager|good_team|werewolf_team/,
  );
}

describe("P9-S05 day announcement and ordered day speech rules", () => {
  it("UI-003 exposes day announcement confirm to alive human visible information after night resolution", () => {
    const { result, state } = resolveNightToDayAnnouncement();
    const humanView = buildVisibleInformation(
      humanPlayerId,
      result.snapshot,
      state.events,
    );
    const expectedPendingAction = {
      type: "confirm" as const,
      actorId: humanPlayerId,
      legalTargets: [],
      allowAbstain: false,
    };

    expect(result.snapshot.gamePhase).toBe("day_announcement");
    expect(result.snapshot.pendingAction).toEqual(expectedPendingAction);
    expect(result.nextPendingAction).toEqual(expectedPendingAction);
    expect(humanView.canAct).toBe(true);
    expect(humanView.legalActions).toEqual([
      {
        actionType: "confirm",
        actorId: humanPlayerId,
        legalTargets: [],
        allowAbstain: false,
        required: true,
      },
    ]);
  });

  it("STATE-001 RULE-007 confirms day announcement and creates ordered speech state without leaking roles", () => {
    const state = createDayAnnouncementState();
    const expectedOrder = alivePlayerIdsBySeat(state.snapshot);
    const expectedDeadPlayerIds = state.snapshot.nightState?.deathPlayerIds ?? [];
    const confirmed = expectOk(
      confirmDayAnnouncement(state, "confirm-day-announcement-positive"),
    );
    const dayAnnounced = confirmed.events.find(
      (event) => event.type === "day_announced",
    );
    const visibleDayAnnounced = confirmed.visibleInformation.publicEvents.find(
      (event) => event.type === "day_announced",
    );

    expect(confirmed.events.map((event) => event.type)).toEqual([
      "day_announced",
      "phase_changed",
    ]);
    expect(dayAnnounced?.payload).toEqual({
      night: 1,
      deadPlayerIds: expectedDeadPlayerIds,
      announcementText: expect.stringMatching(/^天亮了，/),
    });
    expect(visibleDayAnnounced?.payload).toEqual(dayAnnounced?.payload);
    expect(confirmed.snapshot.gamePhase).toBe("day_speech");
    expect(confirmed.snapshot.speechState).toEqual({
      day: 1,
      speechKind: "day_speech",
      speakerOrder: expectedOrder,
      currentSpeakerId: expectedOrder[0],
      completedSpeakerIds: [],
    });
    expect(confirmed.snapshot.pendingAction).toEqual({
      type: "speech",
      actorId: expectedOrder[0],
      legalTargets: [],
      allowAbstain: false,
    });
    expectNoRoleLeakInPayloads(confirmed.events);
  });

  it("UI-003 exposes speech only to the current speaker visible information after day confirmation", () => {
    const announcementState = createDayAnnouncementState();
    const confirmed = expectOk(
      confirmDayAnnouncement(
        announcementState,
        "confirm-day-announcement-visible-speech",
      ),
    );
    const afterConfirmed = appendState(announcementState, confirmed);
    const currentSpeakerId = confirmed.snapshot.speechState?.currentSpeakerId ?? "";
    const nonCurrentSpeakerId =
      confirmed.snapshot.players.find(
        (player) => player.alive && player.playerId !== currentSpeakerId,
      )?.playerId ?? "";
    const deadPlayerId =
      confirmed.snapshot.players.find((player) => !player.alive)?.playerId ?? "";

    const currentSpeakerView = buildVisibleInformation(
      currentSpeakerId,
      confirmed.snapshot,
      afterConfirmed.events,
    );
    const nonCurrentSpeakerView = buildVisibleInformation(
      nonCurrentSpeakerId,
      confirmed.snapshot,
      afterConfirmed.events,
    );
    const deadPlayerView = buildVisibleInformation(
      deadPlayerId,
      confirmed.snapshot,
      afterConfirmed.events,
    );
    const deadHumanSpeechSnapshot: GameSnapshot = {
      ...confirmed.snapshot,
      humanParticipationState: "dead_spectating",
      players: confirmed.snapshot.players.map((player) =>
        player.playerId === humanPlayerId
          ? {
              ...player,
              alive: false,
              deathCause: "night_kill" as const,
              deathEventId: "test-human-death",
            }
          : player,
      ),
      speechState: {
        day: 1,
        speechKind: "day_speech",
        speakerOrder: [humanPlayerId],
        currentSpeakerId: humanPlayerId,
        completedSpeakerIds: [],
      },
      pendingAction: {
        type: "speech",
        actorId: humanPlayerId,
        legalTargets: [],
        allowAbstain: false,
      },
    };
    const deadHumanView = buildVisibleInformation(
      humanPlayerId,
      deadHumanSpeechSnapshot,
      afterConfirmed.events,
    );

    expect(currentSpeakerView.canAct).toBe(true);
    expect(currentSpeakerView.legalActions).toEqual([
      {
        actionType: "speech",
        actorId: currentSpeakerId,
        legalTargets: [],
        allowAbstain: false,
        required: true,
      },
    ]);
    expect(nonCurrentSpeakerView.canAct).toBe(false);
    expect(nonCurrentSpeakerView.legalActions).toEqual([]);
    expect(deadPlayerView.canAct).toBe(false);
    expect(deadPlayerView.legalActions).toEqual([]);
    expect(deadHumanView.canAct).toBe(false);
    expect(deadHumanView.legalActions).toEqual([]);
  });

  it("STATE-001 records each current speaker once and advances to vote after all alive players speak", () => {
    const announcementState = createDayAnnouncementState();
    const announced = expectOk(
      confirmDayAnnouncement(
        announcementState,
        "confirm-day-announcement-for-speeches",
      ),
    );
    let state = appendState(announcementState, announced);
    const speakerOrder = announced.snapshot.speechState?.speakerOrder ?? [];

    speakerOrder.forEach((speakerId, index) => {
      const isLastSpeaker = index === speakerOrder.length - 1;
      const submitted = expectOk(
        submitSpeech(state, {
          type: "submit_speech",
          idempotencyKey: `day-speech-${speakerId}`,
          speakerId,
          text: `I am speaking from ${speakerId}.`,
        }),
      );

      expect(submitted.events.map((event) => event.type)).toEqual(
        isLastSpeaker ? ["speech_submitted", "phase_changed"] : ["speech_submitted"],
      );
      expect(submitted.events[0]?.payload).toEqual({
        speakerId,
        day: 1,
        text: `I am speaking from ${speakerId}.`,
      });

      state = appendState(state, submitted);
      expect(state.snapshot.speechState?.completedSpeakerIds).toEqual(
        speakerOrder.slice(0, index + 1),
      );

      if (isLastSpeaker) {
        expect(state.snapshot.gamePhase).toBe("vote");
        expect(state.snapshot.speechState?.currentSpeakerId).toBeUndefined();
        expect(state.snapshot.pendingAction).toBeNull();
      } else {
        expect(state.snapshot.gamePhase).toBe("day_speech");
        expect(state.snapshot.speechState?.currentSpeakerId).toBe(
          speakerOrder[index + 1],
        );
        expect(state.snapshot.pendingAction).toEqual({
          type: "speech",
          actorId: speakerOrder[index + 1],
          legalTargets: [],
          allowAbstain: false,
        });
      }
    });

    expect(state.events.filter((event) => event.type === "speech_submitted")).toHaveLength(
      speakerOrder.length,
    );
    expectNoRoleLeakInPayloads(
      state.events.filter((event) =>
        ["day_announced", "speech_submitted", "phase_changed"].includes(
          event.type,
        ),
      ),
    );
  });

  it("RULE-008 replays day confirmation and speech idempotency keys as no-op results", () => {
    const state = createDayAnnouncementState();
    const confirmed = expectOk(
      confirmDayAnnouncement(state, "confirm-day-announcement-replay"),
    );
    const afterConfirmed = appendState(state, confirmed);
    const replayedConfirm = expectOk(
      confirmDayAnnouncement(afterConfirmed, "confirm-day-announcement-replay"),
    );

    expect(replayedConfirm.events).toEqual([]);
    expect(replayedConfirm.snapshot).toEqual(confirmed.snapshot);

    const speakerId = confirmed.snapshot.speechState?.currentSpeakerId ?? "";
    const firstSpeech = expectOk(
      submitSpeech(afterConfirmed, {
        type: "submit_speech",
        idempotencyKey: "speech-replay-key",
        speakerId,
        text: "This line should be written once.",
      }),
    );
    const afterFirstSpeech = appendState(afterConfirmed, firstSpeech);
    const replayedSpeech = expectOk(
      submitSpeech(afterFirstSpeech, {
        type: "submit_speech",
        idempotencyKey: "speech-replay-key",
        speakerId,
        text: "This line should be written once.",
      }),
    );

    expect(replayedSpeech.events).toEqual([]);
    expect(replayedSpeech.snapshot).toEqual(firstSpeech.snapshot);
  });

  it("RULE-008 rejects duplicate idempotency key replay when the current viewer differs from the original owner", () => {
    const announcementState = createDayAnnouncementState();
    const wolfId = playerIdByRole(announcementState.snapshot, "werewolf");
    const seerReplayAsWolf = applyAction(
      {
        type: "submit_night_action",
        idempotencyKey: "day-speech-seer-check",
        actorId: wolfId,
        actionType: "seer_check",
        targetId: humanPlayerId,
      },
      {
        events: announcementState.events,
        snapshot: announcementState.snapshot,
        session: announcementState.session,
        now: "2026-06-19T09:00:05.000Z",
      },
    );

    expectErrorCode(seerReplayAsWolf, "ACTION_NOT_ALLOWED");

    const announced = expectOk(
      confirmDayAnnouncement(
        announcementState,
        "confirm-day-announcement-owner-binding",
      ),
    );
    const afterConfirmed = appendState(announcementState, announced);
    const speakerOrder = announced.snapshot.speechState?.speakerOrder ?? [];
    const currentSpeakerId = speakerOrder[0] ?? "";
    const nextSpeakerId = speakerOrder[1] ?? "";
    const firstSpeech = expectOk(
      submitSpeech(afterConfirmed, {
        type: "submit_speech",
        idempotencyKey: "speech-owner-binding-key",
        speakerId: currentSpeakerId,
        text: "Only the original speaker may replay this key.",
      }),
    );
    const afterFirstSpeech = appendState(afterConfirmed, firstSpeech);
    const replayedAsNextSpeaker = submitSpeech(afterFirstSpeech, {
      type: "submit_speech",
      idempotencyKey: "speech-owner-binding-key",
      speakerId: nextSpeakerId,
      text: "Trying to reuse another player's key.",
    });

    expectErrorCode(replayedAsNextSpeaker, "ACTION_NOT_ALLOWED");

    const originalSpeechEvent = afterFirstSpeech.events.find(
      (event) =>
        event.type === "speech_submitted" &&
        event.metadata.idempotencyKey === "speech-owner-binding-key",
    );
    if (!originalSpeechEvent) {
      throw new Error("Missing speech event for conflict test.");
    }

    const conflictingOwnerEvent: TruthEvent = {
      ...originalSpeechEvent,
      eventId: "test-conflicting-owner-event",
      seq: originalSpeechEvent.seq + 1,
      actorId: nextSpeakerId,
      payload: {
        ...originalSpeechEvent.payload,
        speakerId: nextSpeakerId,
      },
    };
    const replayedWithConflictingOwners = submitSpeech(
      {
        ...afterFirstSpeech,
        events: [...afterFirstSpeech.events, conflictingOwnerEvent],
      },
      {
        type: "submit_speech",
        idempotencyKey: "speech-owner-binding-key",
        speakerId: currentSpeakerId,
        text: "Even the original owner cannot replay a conflicted key.",
      },
    );

    expectErrorCode(replayedWithConflictingOwners, "ACTION_NOT_ALLOWED");
  });

  it("RULE-007 STATE-001 rejects day confirmation outside day_announcement or from non-human players", () => {
    const nightState = createNightState("villager");
    const rejectedInNight = applyAction(
      {
        type: "confirm_day_announcement",
        idempotencyKey: "confirm-day-in-night",
        playerId: humanPlayerId,
      },
      {
        events: nightState.events,
        snapshot: nightState.snapshot,
        session: nightState.session,
        now: "2026-06-19T09:00:05.000Z",
      },
    );

    expectErrorCode(rejectedInNight, "ACTION_NOT_ALLOWED");

    const state = createDayAnnouncementState();
    const aiPlayerId = state.snapshot.players.find((player) => !player.isHuman)
      ?.playerId ?? "";
    const beforeEvents = [...state.events];
    const beforeSnapshot = structuredClone(state.snapshot);
    const rejectedForAi = applyAction(
      {
        type: "confirm_day_announcement",
        idempotencyKey: "confirm-day-from-ai",
        playerId: aiPlayerId,
      },
      {
        events: state.events,
        snapshot: state.snapshot,
        session: state.session,
        now: "2026-06-19T09:00:05.000Z",
      },
    );

    expectErrorCode(rejectedForAi, "ACTION_NOT_ALLOWED");
    expect(state.events).toEqual(beforeEvents);
    expect(state.snapshot).toEqual(beforeSnapshot);
  });

  it("RULE-007 STATE-001 rejects dead human day confirmation without changing facts or snapshot", () => {
    const state = createDayAnnouncementState();
    const deadHumanSnapshot: GameSnapshot = {
      ...state.snapshot,
      humanParticipationState: "dead_spectating",
      players: state.snapshot.players.map((player) =>
        player.playerId === humanPlayerId
          ? {
              ...player,
              alive: false,
              deathCause: "night_kill",
              deathEventId: "test-human-death",
            }
          : player,
      ),
    };
    const beforeEvents = [...state.events];
    const beforeSnapshot = structuredClone(deadHumanSnapshot);
    const rejected = applyAction(
      {
        type: "confirm_day_announcement",
        idempotencyKey: "dead-human-confirm-day",
        playerId: humanPlayerId,
      },
      {
        events: state.events,
        snapshot: deadHumanSnapshot,
        session: state.session,
        now: "2026-06-19T09:00:05.000Z",
      },
    );

    expectErrorCode(rejected, "ACTION_NOT_ALLOWED");
    expect(state.events).toEqual(beforeEvents);
    expect(deadHumanSnapshot).toEqual(beforeSnapshot);
  });

  it("RULE-007 UI-003 rejects invalid speech text, non-turn speakers, dead speakers, and repeat submissions", () => {
    const announcementState = createDayAnnouncementState();
    const announced = expectOk(
      confirmDayAnnouncement(
        announcementState,
        "confirm-day-announcement-negative-speech",
      ),
    );
    const state = appendState(announcementState, announced);
    const speakerOrder = announced.snapshot.speechState?.speakerOrder ?? [];
    const currentSpeakerId = speakerOrder[0] ?? "";
    const nextSpeakerId = speakerOrder[1] ?? "";
    const beforeSnapshot = structuredClone(state.snapshot);

    expectErrorCode(
      submitSpeech(state, {
        type: "submit_speech",
        idempotencyKey: "empty-speech",
        speakerId: currentSpeakerId,
        text: "",
      }),
      "INVALID_ACTION",
    );
    expectErrorCode(
      submitSpeech(state, {
        type: "submit_speech",
        idempotencyKey: "blank-speech",
        speakerId: currentSpeakerId,
        text: "   ",
      }),
      "INVALID_ACTION",
    );
    expectErrorCode(
      submitSpeech(state, {
        type: "submit_speech",
        idempotencyKey: "long-speech",
        speakerId: currentSpeakerId,
        text: "x".repeat(501),
      }),
      "INVALID_ACTION",
    );
    expectErrorCode(
      submitSpeech(state, {
        type: "submit_speech",
        idempotencyKey: "out-of-turn-speech",
        speakerId: nextSpeakerId,
        text: "I should wait for my turn.",
      }),
      "ACTION_NOT_ALLOWED",
    );
    expect(state.snapshot).toEqual(beforeSnapshot);

    const firstSpeech = expectOk(
      submitSpeech(state, {
        type: "submit_speech",
        idempotencyKey: "first-valid-speech",
        speakerId: currentSpeakerId,
        text: "I spoke already.",
      }),
    );
    const afterFirstSpeech = appendState(state, firstSpeech);
    const repeatedWithNewKey = submitSpeech(afterFirstSpeech, {
      type: "submit_speech",
      idempotencyKey: "repeat-valid-speech-new-key",
      speakerId: currentSpeakerId,
      text: "I should not speak twice.",
    });

    expectErrorCode(repeatedWithNewKey, "ACTION_NOT_ALLOWED");
    expect(afterFirstSpeech.events.filter((event) => event.type === "speech_submitted")).toHaveLength(1);

    const deadSpeakerId =
      afterFirstSpeech.snapshot.players.find((player) => !player.alive)
        ?.playerId ?? "";
    const malformedDeadTurn: GameSnapshot = {
      ...afterFirstSpeech.snapshot,
      gamePhase: "day_speech",
      speechState: {
        day: 1,
        speechKind: "day_speech",
        speakerOrder: [deadSpeakerId],
        currentSpeakerId: deadSpeakerId,
        completedSpeakerIds: [],
      },
      pendingAction: {
        type: "speech",
        actorId: deadSpeakerId,
        legalTargets: [],
        allowAbstain: false,
      },
    };
    const deadSpeakerResult = submitSpeech(
      {
        ...afterFirstSpeech,
        snapshot: malformedDeadTurn,
      },
      {
        type: "submit_speech",
        idempotencyKey: "dead-speaker-speech",
        speakerId: deadSpeakerId,
        text: "Dead players cannot affect the day.",
      },
    );

    expectErrorCode(deadSpeakerResult, "ACTION_NOT_ALLOWED");
  });
});
