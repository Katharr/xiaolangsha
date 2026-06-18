import { describe, expect, it } from "vitest";

import type { GameAction, Role, TruthEvent } from "../shared";
import { applyAction } from "./index";

const boardId = "mvp_5p_wolf_seer_3villagers";
const humanPlayerId = "human-1";

function expectRoleCounts(roles: Role[]) {
  expect(roles.filter((role) => role === "werewolf")).toHaveLength(1);
  expect(roles.filter((role) => role === "seer")).toHaveLength(1);
  expect(roles.filter((role) => role === "villager")).toHaveLength(3);
}

function createStandardGame() {
  const action: GameAction = {
    type: "create_game",
    idempotencyKey: "create-standard-1",
    mode: "standard",
    boardId,
    humanPlayerId,
  };

  return applyAction(action, { now: "2026-06-18T12:00:00.000Z" });
}

function createFreeGame() {
  const action: GameAction = {
    type: "create_game",
    idempotencyKey: "create-free-guard-1",
    mode: "free",
    boardId,
    humanPlayerId,
  };

  return applyAction(action, { now: "2026-06-18T12:00:00.000Z" });
}

describe("P9-S03 create game and role reveal rules", () => {
  it("RULE-001 ISO-001 creates a standard 5 player game without leaking other roles", () => {
    const result = createStandardGame();

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    const { events, snapshot, visibleInformation } = result.data;
    const human = snapshot.players.find((player) => player.isHuman);

    expect(snapshot.gamePhase).toBe("role_reveal");
    expect(snapshot.humanParticipationState).toBe("alive");
    expect(snapshot.players).toHaveLength(5);
    expect(snapshot.players.filter((player) => player.controller === "human")).toHaveLength(1);
    expect(snapshot.players.filter((player) => player.controller === "ai")).toHaveLength(4);
    expect(new Set(snapshot.players.map((player) => player.seat)).size).toBe(5);
    expectRoleCounts(snapshot.players.map((player) => player.role));
    expect(human?.playerId).toBe(humanPlayerId);

    expect(events.map((event) => event.type)).toEqual([
      "game_created",
      "players_assigned",
      "human_role_revealed",
    ]);
    expect(events.every((event) => event.metadata.idempotencyKey === "create-standard-1")).toBe(true);

    expect(visibleInformation.viewerId).toBe(humanPlayerId);
    expect(visibleInformation.ownRole).toBe(human?.role);
    expect(visibleInformation.alivePlayers).toHaveLength(5);
    expect(visibleInformation.alivePlayers.filter((player) => player.publicRole !== undefined)).toHaveLength(0);
    expect(visibleInformation.privateEvents).toHaveLength(1);
    expect(visibleInformation.privateEvents[0]?.type).toBe("human_role_revealed");
  });

  it("RULE-001 supports free mode role setup by fixing the human role and filling AI seats", () => {
    const created = applyAction(
      {
        type: "create_game",
        idempotencyKey: "create-free-1",
        mode: "free",
        boardId,
        humanPlayerId,
      },
      { now: "2026-06-18T12:00:00.000Z" },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) {
      throw new Error(created.error.message);
    }

    expect(created.data.snapshot.gamePhase).toBe("role_setup");
    expect(created.data.snapshot.players).toHaveLength(0);

    const confirmed = applyAction(
      {
        type: "confirm_role_setup",
        idempotencyKey: "setup-free-1",
        playerId: humanPlayerId,
        selectedRole: "seer",
      },
      {
        events: created.data.events,
        snapshot: created.data.snapshot,
        session: created.data.session,
        now: "2026-06-18T12:00:01.000Z",
      },
    );

    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) {
      throw new Error(confirmed.error.message);
    }

    const human = confirmed.data.snapshot.players.find((player) => player.isHuman);

    expect(confirmed.data.snapshot.gamePhase).toBe("role_reveal");
    expect(human?.role).toBe("seer");
    expectRoleCounts(confirmed.data.snapshot.players.map((player) => player.role));
    expect(confirmed.data.events.map((event) => event.type)).toEqual([
      "players_assigned",
      "human_role_revealed",
    ]);
    expect(confirmed.data.visibleInformation.ownRole).toBe("seer");
    expect(confirmed.data.visibleInformation.alivePlayers.filter((player) => player.publicRole !== undefined)).toHaveLength(0);
  });

  it("STATE-001 advances role reveal confirmation only from role_reveal to night_action", () => {
    const created = createStandardGame();
    expect(created.ok).toBe(true);
    if (!created.ok) {
      throw new Error(created.error.message);
    }

    const confirmed = applyAction(
      {
        type: "confirm_role_reveal",
        idempotencyKey: "reveal-1",
        playerId: humanPlayerId,
      },
      {
        events: created.data.events,
        snapshot: created.data.snapshot,
        session: created.data.session,
        now: "2026-06-18T12:00:02.000Z",
      },
    );

    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) {
      throw new Error(confirmed.error.message);
    }

    expect(confirmed.data.snapshot.gamePhase).toBe("night_action");
    expect(confirmed.data.snapshot.round).toEqual({
      night: 1,
      day: 0,
      voteRound: "none",
    });
    expect(confirmed.data.snapshot.nightState?.resolved).toBe(false);
    expect(confirmed.data.events.map((event) => event.type)).toEqual([
      "game_started",
      "phase_changed",
    ]);
    expect(confirmed.data.visibleInformation.gamePhase).toBe("night_action");

    const illegal = applyAction(
      {
        type: "confirm_role_reveal",
        idempotencyKey: "reveal-illegal-1",
        playerId: humanPlayerId,
      },
      {
        events: [...created.data.events, ...confirmed.data.events],
        snapshot: confirmed.data.snapshot,
        session: confirmed.data.session,
        now: "2026-06-18T12:00:03.000Z",
      },
    );

    expect(illegal.ok).toBe(false);
    if (!illegal.ok) {
      expect(illegal.error.code).toBe("ACTION_NOT_ALLOWED");
    }
  });

  it("RULE-008 rejects missing keys and treats duplicate keys as no-op facts", () => {
    const missingKey = applyAction(
      {
        type: "create_game",
        mode: "standard",
        boardId,
        humanPlayerId,
      },
      { now: "2026-06-18T12:00:00.000Z" },
    );

    expect(missingKey.ok).toBe(false);
    if (!missingKey.ok) {
      expect(missingKey.error.code).toBe("INVALID_ACTION");
    }

    const created = createStandardGame();
    expect(created.ok).toBe(true);
    if (!created.ok) {
      throw new Error(created.error.message);
    }

    const duplicate = applyAction(
      {
        type: "confirm_role_reveal",
        idempotencyKey: "create-standard-1",
        playerId: humanPlayerId,
      },
      {
        events: created.data.events,
        snapshot: created.data.snapshot,
        session: created.data.session,
        now: "2026-06-18T12:00:02.000Z",
      },
    );

    expect(duplicate.ok).toBe(true);
    if (!duplicate.ok) {
      throw new Error(duplicate.error.message);
    }

    expect(duplicate.data.events).toHaveLength(0);
    expect(duplicate.data.snapshot).toEqual(created.data.snapshot);
  });

  it("STATE-001 rejects illegal role setup actions without adding TruthEvent", () => {
    const created = createStandardGame();
    expect(created.ok).toBe(true);
    if (!created.ok) {
      throw new Error(created.error.message);
    }

    const existingEvents: TruthEvent[] = created.data.events;
    const illegal = applyAction(
      {
        type: "confirm_role_setup",
        idempotencyKey: "setup-illegal-1",
        playerId: humanPlayerId,
        selectedRole: "werewolf",
      },
      {
        events: existingEvents,
        snapshot: created.data.snapshot,
        session: created.data.session,
        now: "2026-06-18T12:00:01.000Z",
      },
    );

    expect(illegal.ok).toBe(false);
    if (!illegal.ok) {
      expect(illegal.error.code).toBe("ACTION_NOT_ALLOWED");
    }
    expect(existingEvents).toHaveLength(3);
  });

  it("STATE-001 rejects create_game inside role_reveal without replacing the current game", () => {
    const created = createStandardGame();
    expect(created.ok).toBe(true);
    if (!created.ok) {
      throw new Error(created.error.message);
    }

    const originalEvents = [...created.data.events];
    const originalSnapshot = structuredClone(created.data.snapshot);
    const illegalCreate = applyAction(
      {
        type: "create_game",
        idempotencyKey: "create-standard-2",
        mode: "standard",
        boardId,
        humanPlayerId,
      },
      {
        events: created.data.events,
        snapshot: created.data.snapshot,
        session: created.data.session,
        now: "2026-06-18T12:00:04.000Z",
      },
    );

    expect(illegalCreate.ok).toBe(false);
    if (!illegalCreate.ok) {
      expect(illegalCreate.error.code).toBe("ACTION_NOT_ALLOWED");
    }
    expect(created.data.events).toEqual(originalEvents);
    expect(created.data.snapshot).toEqual(originalSnapshot);
  });

  it("STATE-001 rejects create_game inside role_setup without replacing the current game", () => {
    const created = createFreeGame();
    expect(created.ok).toBe(true);
    if (!created.ok) {
      throw new Error(created.error.message);
    }

    const originalEvents = [...created.data.events];
    const originalSnapshot = structuredClone(created.data.snapshot);
    const illegalCreate = applyAction(
      {
        type: "create_game",
        idempotencyKey: "create-free-guard-2",
        mode: "free",
        boardId,
        humanPlayerId,
      },
      {
        events: created.data.events,
        snapshot: created.data.snapshot,
        session: created.data.session,
        now: "2026-06-18T12:00:04.000Z",
      },
    );

    expect(illegalCreate.ok).toBe(false);
    if (!illegalCreate.ok) {
      expect(illegalCreate.error.code).toBe("ACTION_NOT_ALLOWED");
    }
    expect(created.data.events).toEqual(originalEvents);
    expect(created.data.snapshot).toEqual(originalSnapshot);
  });

  it("RULE-008 returns Result error instead of throwing when duplicate key has an unknown viewer", () => {
    const created = createStandardGame();
    expect(created.ok).toBe(true);
    if (!created.ok) {
      throw new Error(created.error.message);
    }

    const duplicateWithUnknownViewer = () =>
      applyAction(
        {
          type: "confirm_role_reveal",
          idempotencyKey: "create-standard-1",
          playerId: "not-in-this-game",
        },
        {
          events: created.data.events,
          snapshot: created.data.snapshot,
          session: created.data.session,
          now: "2026-06-18T12:00:05.000Z",
        },
      );

    expect(duplicateWithUnknownViewer).not.toThrow();
    const result = duplicateWithUnknownViewer();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ACTION_NOT_ALLOWED");
    }
  });
});
