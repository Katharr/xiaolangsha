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

function createNightState(humanRole: Role = "villager"): EngineState {
  const created = expectOk(
    applyAction(
      {
        type: "create_game",
        idempotencyKey: `create-${humanRole}-night`,
        mode: "free",
        boardId,
        humanPlayerId,
      },
      { now: "2026-06-18T12:00:00.000Z" },
    ),
  );
  const assigned = expectOk(
    applyAction(
      {
        type: "confirm_role_setup",
        idempotencyKey: `setup-${humanRole}-night`,
        playerId: humanPlayerId,
        selectedRole: humanRole,
      },
      {
        events: created.events,
        snapshot: created.snapshot,
        session: created.session,
        now: "2026-06-18T12:00:01.000Z",
      },
    ),
  );
  const assignedEvents = [...created.events, ...assigned.events];
  const started = expectOk(
    applyAction(
      {
        type: "confirm_role_reveal",
        idempotencyKey: `reveal-${humanRole}-night`,
        playerId: humanPlayerId,
      },
      {
        events: assignedEvents,
        snapshot: assigned.snapshot,
        session: assigned.session,
        now: "2026-06-18T12:00:02.000Z",
      },
    ),
  );

  return {
    session: started.session,
    snapshot: started.snapshot,
    events: [...assignedEvents, ...started.events],
  };
}

function submitNightAction(state: EngineState, action: GameAction) {
  return applyAction(action, {
    events: state.events,
    snapshot: state.snapshot,
    session: state.session,
    now: "2026-06-18T12:00:03.000Z",
  });
}

function playerIdByRole(snapshot: GameSnapshot, role: Role): string {
  const player = snapshot.players.find((candidate) => candidate.role === role);

  if (!player) {
    throw new Error(`Missing player with role ${role}.`);
  }

  return player.playerId;
}

describe("P9-S04 first night and night resolution rules", () => {
  it("RULE-002 RULE-007 excludes human from first-night wolf targets and rejects forced human kill without TruthEvent", () => {
    const state = createNightState("villager");
    const wolfId = playerIdByRole(state.snapshot, "werewolf");
    const wolfView = buildVisibleInformation(wolfId, state.snapshot, state.events);

    expect(wolfView.legalActions[0]?.actionType).toBe("werewolf_kill");
    expect(wolfView.legalActions[0]?.legalTargets).not.toContain(humanPlayerId);

    const beforeEvents = [...state.events];
    const result = submitNightAction(state, {
      type: "submit_night_action",
      idempotencyKey: "wolf-forced-human-kill",
      actorId: wolfId,
      actionType: "werewolf_kill",
      targetId: humanPlayerId,
    });

    expectErrorCode(result, "ACTION_NOT_ALLOWED");
    expect(state.events).toEqual(beforeEvents);
  });

  it("RULE-007 rejects wolf self-kill without adding TruthEvent", () => {
    const state = createNightState("villager");
    const wolfId = playerIdByRole(state.snapshot, "werewolf");
    const beforeEvents = [...state.events];
    const result = submitNightAction(state, {
      type: "submit_night_action",
      idempotencyKey: "wolf-self-kill",
      actorId: wolfId,
      actionType: "werewolf_kill",
      targetId: wolfId,
    });

    expectErrorCode(result, "ACTION_NOT_ALLOWED");
    expect(state.events).toEqual(beforeEvents);
  });

  it("RULE-005 RULE-006 ISO-003 ISO-004 resolves wolf kill and seer check without leaking hidden identity", () => {
    const state = createNightState("villager");
    const wolfId = playerIdByRole(state.snapshot, "werewolf");
    const seerId = playerIdByRole(state.snapshot, "seer");
    const killedVillagerId =
      state.snapshot.players.find(
        (player) => player.role === "villager" && !player.isHuman,
      )?.playerId ?? "";

    const wolfSubmitted = expectOk(
      submitNightAction(state, {
        type: "submit_night_action",
        idempotencyKey: "wolf-kills-ai-villager",
        actorId: wolfId,
        actionType: "werewolf_kill",
        targetId: killedVillagerId,
      }),
    );
    const afterWolf = {
      session: wolfSubmitted.session,
      snapshot: wolfSubmitted.snapshot,
      events: [...state.events, ...wolfSubmitted.events],
    };

    expect(wolfSubmitted.events.map((event) => event.type)).toEqual([
      "night_action_submitted",
    ]);
    expect(wolfSubmitted.snapshot.gamePhase).toBe("night_action");
    expect(wolfSubmitted.snapshot.nightState?.steps[0]?.submittedActorIds).toEqual([
      wolfId,
    ]);
    expect(wolfSubmitted.snapshot.nightState?.currentStepIndex).toBe(1);

    const seerSubmitted = expectOk(
      submitNightAction(afterWolf, {
        type: "submit_night_action",
        idempotencyKey: "seer-checks-wolf",
        actorId: seerId,
        actionType: "seer_check",
        targetId: wolfId,
      }),
    );
    const allEvents = [...afterWolf.events, ...seerSubmitted.events];
    const killedPlayer = seerSubmitted.snapshot.players.find(
      (player) => player.playerId === killedVillagerId,
    );
    const seerView = buildVisibleInformation(
      seerId,
      seerSubmitted.snapshot,
      allEvents,
    );
    const humanView = buildVisibleInformation(
      humanPlayerId,
      seerSubmitted.snapshot,
      allEvents,
    );

    expect(seerSubmitted.snapshot.gamePhase).toBe("day_announcement");
    expect(seerSubmitted.snapshot.round).toEqual({
      night: 1,
      day: 1,
      voteRound: "none",
    });
    expect(seerSubmitted.snapshot.winner).toBeUndefined();
    expect(killedPlayer?.alive).toBe(false);
    expect(killedPlayer?.deathCause).toBe("night_kill");
    expect(killedPlayer?.isRoleVisiblePublicly).toBe(false);
    expect(seerSubmitted.events.map((event) => event.type)).toEqual([
      "night_action_submitted",
      "night_action_resolved",
      "night_action_resolved",
      "player_died",
      "win_checked",
      "phase_changed",
    ]);

    const seerCheck = seerView.privateEvents.find(
      (event) =>
        event.type === "night_action_resolved" &&
        event.payload.result &&
        typeof event.payload.result === "object" &&
        "factionResult" in event.payload.result,
    );
    expect(seerCheck?.payload.result).toEqual({
      kind: "seer_check_result",
      targetId: wolfId,
      factionResult: "werewolf_team",
    });
    expect(humanView.privateEvents).not.toContainEqual(seerCheck);
    expect(humanView.deadPlayers[0]?.publicRole).toBeUndefined();
    expect(
      humanView.publicEvents.find((event) => event.type === "player_died")?.payload,
    ).toEqual({
      playerId: killedVillagerId,
      deathCause: "night_kill",
      revealRolePublicly: false,
    });
  });

  it("RULE-008 rejects repeated night actor submission with a new key without duplicate facts", () => {
    const state = createNightState("villager");
    const wolfId = playerIdByRole(state.snapshot, "werewolf");
    const targetId =
      state.snapshot.players.find(
        (player) => player.role === "villager" && !player.isHuman,
      )?.playerId ?? "";
    const first = expectOk(
      submitNightAction(state, {
        type: "submit_night_action",
        idempotencyKey: "wolf-first-submission",
        actorId: wolfId,
        actionType: "werewolf_kill",
        targetId,
      }),
    );
    const afterFirst = {
      session: first.session,
      snapshot: first.snapshot,
      events: [...state.events, ...first.events],
    };
    const duplicate = submitNightAction(afterFirst, {
      type: "submit_night_action",
      idempotencyKey: "wolf-second-submission",
      actorId: wolfId,
      actionType: "werewolf_kill",
      targetId,
    });

    expectErrorCode(duplicate, "ACTION_NOT_ALLOWED");
    expect(afterFirst.events.filter((event) => event.type === "night_action_submitted")).toHaveLength(1);
    expect(afterFirst.snapshot.lastEventSeq).toBe(first.snapshot.lastEventSeq);
    expect(afterFirst.snapshot.gamePhase).toBe(first.snapshot.gamePhase);
    expect(afterFirst.snapshot.nightState).toEqual(first.snapshot.nightState);
  });

  it("RULE-008 replays the same resolving night action without duplicate events or snapshot changes", () => {
    const state = createNightState("villager");
    const wolfId = playerIdByRole(state.snapshot, "werewolf");
    const seerId = playerIdByRole(state.snapshot, "seer");
    const killedVillagerId =
      state.snapshot.players.find(
        (player) => player.role === "villager" && !player.isHuman,
      )?.playerId ?? "";
    const wolfSubmitted = expectOk(
      submitNightAction(state, {
        type: "submit_night_action",
        idempotencyKey: "wolf-kill-before-replay",
        actorId: wolfId,
        actionType: "werewolf_kill",
        targetId: killedVillagerId,
      }),
    );
    const afterWolf = {
      session: wolfSubmitted.session,
      snapshot: wolfSubmitted.snapshot,
      events: [...state.events, ...wolfSubmitted.events],
    };
    const seerAction: GameAction = {
      type: "submit_night_action",
      idempotencyKey: "seer-resolves-night-for-replay",
      actorId: seerId,
      actionType: "seer_check",
      targetId: wolfId,
    };
    const resolved = expectOk(submitNightAction(afterWolf, seerAction));
    const afterResolved = {
      session: resolved.session,
      snapshot: resolved.snapshot,
      events: [...afterWolf.events, ...resolved.events],
    };
    const replayed = expectOk(submitNightAction(afterResolved, seerAction));

    expect(replayed.events).toEqual([]);
    expect(replayed.snapshot).toEqual(resolved.snapshot);
    expect(replayed.session).toEqual(resolved.session);
  });

  it("RULE-006 advances to review when night kill reaches werewolf parity", () => {
    const state = createNightState("seer");
    const wolfId = playerIdByRole(state.snapshot, "werewolf");
    const targetId =
      state.snapshot.players.find(
        (player) => player.role === "villager" && player.alive,
      )?.playerId ?? "";
    const lateNightSnapshot: GameSnapshot = {
      ...state.snapshot,
      round: { night: 2, day: 1, voteRound: "none" },
      nightState: {
        night: 2,
        steps: [
          { kind: "werewolf_kill", actorIds: [wolfId], submittedActorIds: [] },
        ],
        currentStepIndex: 0,
        resolved: false,
        deathPlayerIds: [],
      },
      players: state.snapshot.players.map((player) =>
        player.role === "villager" && player.playerId !== targetId
          ? {
              ...player,
              alive: false,
              deathCause: "exile" as const,
              deathEventId: "test-existing-death",
            }
          : player,
      ),
    };
    const result = expectOk(
      applyAction(
        {
          type: "submit_night_action",
          idempotencyKey: "wolf-parity-kill",
          actorId: wolfId,
          actionType: "werewolf_kill",
          targetId,
        },
        {
          events: state.events,
          snapshot: lateNightSnapshot,
          session: state.session,
          now: "2026-06-18T12:00:04.000Z",
        },
      ),
    );

    expect(result.snapshot.gamePhase).toBe("review");
    expect(result.snapshot.winner).toBe("werewolf_team");
    expect(result.snapshot.winReason).toBe("werewolves_reach_parity");
    expect(result.session.status).toBe("ended");
    expect(result.events.map((event) => event.type)).toContain("game_ended");
    expect(result.events.every((event) => event.round.night === 2)).toBe(true);
  });
});
