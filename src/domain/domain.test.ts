import { describe, expect, it } from "vitest";
import {
  buildAiPlayerView,
  buildCoachPlayerView,
  buildPlayerView,
  buildPostGameTimelineView,
  buildPublicTimelineView,
  createInitialGameState,
  getRuleset,
  type PlayerId,
  type Role
} from ".";

function roleCounts(roles: Role[]) {
  return roles.reduce<Record<Role, number>>(
    (counts, role) => ({
      ...counts,
      [role]: counts[role] + 1
    }),
    {
      seer: 0,
      villager: 0,
      werewolf: 0,
      witch: 0
    }
  );
}

function findPlayerByRole(state: ReturnType<typeof createInitialGameState>, role: Role) {
  const player = state.players.find((candidate) => candidate.role === role);

  if (!player) {
    throw new Error(`Missing player with role ${role}`);
  }

  return player;
}

function serialized(value: unknown) {
  return JSON.stringify(value);
}

describe("quick-6-v1 ruleset", () => {
  it("contains the MVP roles and reserved win condition modes", () => {
    const ruleset = getRuleset("quick-6-v1");

    expect(ruleset.id).toBe("quick-6-v1");
    expect(ruleset.roles).toHaveLength(6);
    expect(roleCounts(ruleset.roles)).toEqual({
      werewolf: 2,
      seer: 1,
      witch: 1,
      villager: 2
    });
    expect(ruleset.defaultWinConditionMode).toBe("side_elimination");
    expect(ruleset.supportedWinConditionModes).toEqual([
      "side_elimination",
      "total_elimination"
    ]);
  });

  it("assigns roles deterministically when a seed is provided", () => {
    const first = createInitialGameState({
      humanPlayerId: "p1",
      rulesetId: "quick-6-v1",
      seed: "spec01-fixed-seed"
    });
    const second = createInitialGameState({
      humanPlayerId: "p1",
      rulesetId: "quick-6-v1",
      seed: "spec01-fixed-seed"
    });

    expect(first.players.map((player) => player.role)).toEqual(
      second.players.map((player) => player.role)
    );
    expect(first.players.map((player) => player.id)).toEqual([
      "p1",
      "p2",
      "p3",
      "p4",
      "p5",
      "p6"
    ]);
  });
});

describe("player views", () => {
  it("does not leak hidden roles to a villager view", () => {
    const state = createInitialGameState({
      humanPlayerId: "p1",
      rulesetId: "quick-6-v1",
      seed: "spec01-view-seed"
    });
    const villager = findPlayerByRole(state, "villager");
    const view = buildPlayerView(state, villager.id);

    expect(view.self.role).toBe("villager");
    expect(view.players.filter((player) => player.role !== undefined)).toEqual([
      expect.objectContaining({ id: villager.id, role: "villager" })
    ]);
    expect(serialized(view)).not.toContain("seed");
    expect(serialized(view)).not.toContain("debugSnapshot");
  });

  it("shows a werewolf teammate without revealing special roles", () => {
    const state = createInitialGameState({
      humanPlayerId: "p1",
      rulesetId: "quick-6-v1",
      seed: "spec01-wolf-seed"
    });
    const werewolves = state.players.filter((player) => player.role === "werewolf");
    const view = buildAiPlayerView(state, werewolves[0].id);

    expect(view.self.role).toBe("werewolf");
    expect(view.wolfTeammateIds).toEqual([werewolves[1].id]);
    expect(view.players.filter((player) => player.role === "werewolf")).toHaveLength(2);
    expect(view.players.some((player) => player.role === "seer")).toBe(false);
    expect(view.players.some((player) => player.role === "witch")).toBe(false);
    expect(view.players.some((player) => player.role === "villager")).toBe(false);
  });

  it("keeps the seer view to self role and check result placeholders", () => {
    const state = createInitialGameState({
      humanPlayerId: "p1",
      rulesetId: "quick-6-v1",
      seed: "spec01-seer-seed"
    });
    const seer = findPlayerByRole(state, "seer");
    const view = buildPlayerView(state, seer.id);

    expect(view.self.role).toBe("seer");
    expect(view.privateInfo).toEqual({
      kind: "seer",
      checkResults: []
    });
    expect(view.players.filter((player) => player.role !== undefined)).toEqual([
      expect.objectContaining({ id: seer.id, role: "seer" })
    ]);
  });

  it("keeps the witch view to self role and potion placeholders", () => {
    const state = createInitialGameState({
      humanPlayerId: "p1",
      rulesetId: "quick-6-v1",
      seed: "spec01-witch-seed"
    });
    const witch = findPlayerByRole(state, "witch");
    const view = buildPlayerView(state, witch.id);

    expect(view.self.role).toBe("witch");
    expect(view.privateInfo).toEqual({
      kind: "witch",
      nightDeathCandidateId: null,
      potions: {
        antidote: true,
        poison: true
      }
    });
    expect(view.players.filter((player) => player.role !== undefined)).toEqual([
      expect.objectContaining({ id: witch.id, role: "witch" })
    ]);
  });

  it("lets coach see the human player's own role only", () => {
    const state = createInitialGameState({
      humanPlayerId: "p1",
      rulesetId: "quick-6-v1",
      seed: "spec01-coach-seed"
    });
    const view = buildCoachPlayerView(state, "p1");

    expect(view.self.id).toBe("p1");
    expect(view.self.role).toBe(state.players[0].role);
    expect(view.adviceScope).toBe("current_player_view");
    expect(view.players.filter((player) => player.role !== undefined)).toEqual([
      expect.objectContaining({ id: "p1", role: state.players[0].role })
    ]);
  });
});

describe("multi-view-leakage", () => {
  it("filters hidden roles, private events, post-game events, and internal data", () => {
    const state = createInitialGameState({
      humanPlayerId: "p1",
      rulesetId: "quick-6-v1",
      seed: "spec01-leakage-seed"
    });
    const villager = findPlayerByRole(state, "villager");
    const werewolf = findPlayerByRole(state, "werewolf");
    const seer = findPlayerByRole(state, "seer");
    const witch = findPlayerByRole(state, "witch");

    const villagerView = buildPlayerView(state, villager.id);
    const wolfView = buildAiPlayerView(state, werewolf.id);
    const seerView = buildAiPlayerView(state, seer.id);
    const witchView = buildAiPlayerView(state, witch.id);
    const coachView = buildCoachPlayerView(state, state.humanPlayerId);
    const publicTimeline = buildPublicTimelineView(state);
    const postGameTimeline = buildPostGameTimelineView(state);

    expect(villagerView.players.filter((player) => player.role !== undefined)).toEqual([
      expect.objectContaining({ id: villager.id, role: "villager" })
    ]);

    expect(wolfView.wolfTeammateIds.length).toBe(1);
    expect(wolfView.players.some((player) => player.role === "werewolf")).toBe(true);
    expect(wolfView.players.some((player) => player.role === "seer")).toBe(false);
    expect(wolfView.players.some((player) => player.role === "witch")).toBe(false);
    expect(wolfView.players.some((player) => player.role === "villager")).toBe(false);

    expect(seerView.self.role).toBe("seer");
    expect(seerView.privateInfo).toEqual({
      kind: "seer",
      checkResults: []
    });
    expect(seerView.players.filter((player) => player.role !== undefined)).toEqual([
      expect.objectContaining({ id: seer.id, role: "seer" })
    ]);

    expect(witchView.self.role).toBe("witch");
    expect(witchView.privateInfo.kind).toBe("witch");
    expect(witchView.players.filter((player) => player.role !== undefined)).toEqual([
      expect.objectContaining({ id: witch.id, role: "witch" })
    ]);
    expect(serialized(witchView)).not.toContain("wolfAttackSourceId");

    expect(coachView.self.id).toBe(state.humanPlayerId);
    expect(coachView.players.filter((player) => player.role !== undefined)).toEqual([
      expect.objectContaining({
        id: state.humanPlayerId,
        role: state.players.find((player) => player.id === state.humanPlayerId)?.role
      })
    ]);

    expect(publicTimeline).not.toHaveLength(0);
    expect(publicTimeline.every((event) => event.visibility.kind === "public")).toBe(true);

    expect(postGameTimeline.some((event) => event.visibility.kind === "post_game")).toBe(true);
    expect(postGameTimeline.some((event) => event.visibility.kind === "internal")).toBe(false);

    const serializedViews = [
      villagerView,
      wolfView,
      seerView,
      witchView,
      coachView,
      publicTimeline,
      postGameTimeline
    ].map(serialized);

    for (const view of serializedViews) {
      expect(view).not.toContain('"ruleset"');
      expect(view).not.toContain('"seed"');
      expect(view).not.toContain("debugSnapshot");
      expect(view).not.toContain("system_seed_or_rng");
      expect(view).not.toContain("complete_state_snapshot");
    }
  });
});
