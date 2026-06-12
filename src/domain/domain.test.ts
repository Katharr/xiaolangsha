import { describe, expect, it } from "vitest";
import {
  buildAiPlayerView,
  buildCoachPlayerView,
  buildPlayerView,
  buildPostGameTimelineView,
  buildPublicTimelineView,
  checkWinCondition,
  createInitialGameState,
  getRuleset,
  resolveExile,
  resolveNight,
  resolveVote,
  startNight,
  startVoting,
  submitSeerCheck,
  submitSpeechIntent,
  submitVote,
  submitWerewolfKill,
  submitWitchAction,
  type GameState,
  type PlayerId,
  type Role,
  type WinConditionMode
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

const SPEC02_ROLE_ORDER: Role[] = [
  "villager",
  "werewolf",
  "werewolf",
  "seer",
  "witch",
  "villager"
];

function createSpec02State(winConditionMode: WinConditionMode = "side_elimination"): GameState {
  return createInitialGameState({
    humanPlayerId: "p1",
    roleOrder: SPEC02_ROLE_ORDER,
    rulesetId: "quick-6-v1",
    seed: "spec02-scripted-seed",
    winConditionMode
  });
}

function markDead(state: GameState, playerIds: PlayerId[]): GameState {
  return {
    ...state,
    players: state.players.map((player) => ({
      ...player,
      status: playerIds.includes(player.id) ? "dead" : player.status
    }))
  };
}

function recordDefaultSpeeches(state: GameState): GameState {
  return state.players
    .filter((player) => player.status === "alive")
    .reduce(
      (nextState, player) =>
        submitSpeechIntent(
          nextState,
          player.id,
          {
            kind: "neutral",
            summary: `${player.seat}号基于公开信息发言`
          },
          `${player.seat}号：我先听后置位发言，暂时不下定论。`
        ),
      state
    );
}

function runSpec02CompletedGame(): GameState {
  let state = createSpec02State();

  state = startNight(state);
  state = submitWerewolfKill(state, "p2", "p6");
  state = submitSeerCheck(state, "p4", "p2");
  state = submitWitchAction(state, "p5", {
    poisonTargetId: "p2"
  });
  state = resolveNight(state);
  state = recordDefaultSpeeches(state);
  state = startVoting(state);
  state = submitVote(state, "p1", "p3");
  state = submitVote(state, "p3", "p1");
  state = submitVote(state, "p4", "p3");
  state = submitVote(state, "p5", "p3");
  state = resolveVote(state);
  state = resolveExile(state);

  return state;
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

    expect(postGameTimeline.some((event) => event.postGameVisible === true)).toBe(true);
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

describe("spec02 rules engine and timeline", () => {
  it("can complete a deterministic 6-player game and reveal the full post-game timeline", () => {
    const state = runSpec02CompletedGame();
    const publicTimeline = buildPublicTimelineView(state);
    const postGameTimeline = buildPostGameTimelineView(state);

    expect(state.phase).toBe("ended");
    expect(state.winner).toBe("good");
    expect(state.players.find((player) => player.id === "p2")?.status).toBe("dead");
    expect(state.players.find((player) => player.id === "p3")?.status).toBe("dead");
    expect(state.timeline.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "game_created",
        "role_assigned",
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
        "post_game_role_reveal"
      ])
    );
    expect(publicTimeline.some((event) => event.type === "post_game_role_reveal")).toBe(false);
    expect(postGameTimeline.some((event) => event.type === "post_game_role_reveal")).toBe(true);
    expect(postGameTimeline.some((event) => event.type === "night_action_submitted")).toBe(true);
  });

  it("rejects illegal night targets", () => {
    let state = markDead(createSpec02State(), ["p6"]);
    state = startNight(state);

    expect(() => submitWerewolfKill(state, "p2", "p6")).toThrow(/not alive/i);
    expect(() => submitSeerCheck(state, "p4", "missing-player")).toThrow(/unknown player/i);
  });

  it("prevents dead players from speaking or voting", () => {
    let state = createSpec02State();

    state = startNight(state);
    state = submitWerewolfKill(state, "p2", "p6");
    state = resolveNight(state);

    expect(() =>
      submitSpeechIntent(
        state,
        "p6",
        {
          kind: "neutral",
          summary: "已死亡玩家尝试发言"
        },
        "我还想发言。"
      )
    ).toThrow(/not alive/i);

    state = recordDefaultSpeeches(state);
    state = startVoting(state);

    expect(() => submitVote(state, "p6", "p1")).toThrow(/not alive/i);
  });

  it("keeps seer check results private to the seer during the game", () => {
    let state = createSpec02State();

    state = startNight(state);
    state = submitSeerCheck(state, "p4", "p2");

    const villagerView = buildPlayerView(state, "p1");
    const seerView = buildPlayerView(state, "p4");

    expect(serialized(villagerView)).not.toContain("seer_check_result");
    expect(seerView.privateInfo).toEqual({
      kind: "seer",
      checkResults: [
        {
          camp: "werewolf",
          targetId: "p2"
        }
      ]
    });
    expect(seerView.timeline.some((event) => event.type === "seer_check_result")).toBe(true);
  });

  it("updates witch potion state after a legal potion use", () => {
    let state = createSpec02State();

    state = startNight(state);
    state = submitWerewolfKill(state, "p2", "p6");
    state = submitWitchAction(state, "p5", {
      poisonTargetId: "p2"
    });

    const witchView = buildPlayerView(state, "p5");

    expect(witchView.privateInfo).toEqual({
      kind: "witch",
      nightDeathCandidateId: "p6",
      potions: {
        antidote: true,
        poison: false
      }
    });
    expect(() =>
      submitWitchAction(state, "p5", {
        poisonTargetId: "p3"
      })
    ).toThrow(/already submitted|poison/i);
  });

  it("handles one revote and exiles no one if the revote is still tied", () => {
    let state = createSpec02State();

    state = startNight(state);
    state = submitWerewolfKill(state, "p2", "p6");
    state = submitWitchAction(state, "p5", {
      useAntidote: true
    });
    state = resolveNight(state);
    state = recordDefaultSpeeches(state);
    state = startVoting(state);

    for (const [voterId, targetId] of [
      ["p1", "p2"],
      ["p2", "p1"],
      ["p3", "p1"],
      ["p4", "p2"],
      ["p5", "p2"],
      ["p6", "p1"]
    ] satisfies [PlayerId, PlayerId][]) {
      state = submitVote(state, voterId, targetId);
    }

    state = resolveVote(state);

    expect(state.phase).toBe("day_vote");
    expect(state.currentDay.voteRound).toBe(2);
    expect(state.currentDay.revoteCandidateIds).toEqual(["p1", "p2"]);

    for (const [voterId, targetId] of [
      ["p1", "p2"],
      ["p2", "p1"],
      ["p3", "p1"],
      ["p4", "p2"],
      ["p5", "p2"],
      ["p6", "p1"]
    ] satisfies [PlayerId, PlayerId][]) {
      state = submitVote(state, voterId, targetId);
    }

    state = resolveVote(state);
    state = resolveExile(state);

    expect(state.currentDay.exileCandidateId).toBeNull();
    expect(state.players.every((player) => player.status === "alive")).toBe(true);
    expect(state.phase).toBe("exile");
  });

  it("supports side elimination and total elimination win checks", () => {
    let state = markDead(createSpec02State("side_elimination"), ["p1"]);

    state = startNight(state);
    state = submitWerewolfKill(state, "p2", "p6");
    state = resolveNight(state);

    expect(state.winner).toBe("werewolf");

    state = markDead(createSpec02State("side_elimination"), ["p5"]);
    state = startNight(state);
    state = submitWerewolfKill(state, "p2", "p4");
    state = resolveNight(state);

    expect(state.winner).toBe("werewolf");

    const totalModeBefore = markDead(createSpec02State("total_elimination"), ["p1", "p6"]);
    const totalModeAfter = markDead(createSpec02State("total_elimination"), [
      "p1",
      "p4",
      "p5",
      "p6"
    ]);

    expect(checkWinCondition(totalModeBefore).winner).toBeNull();
    expect(checkWinCondition(totalModeAfter).winner).toBe("werewolf");
  });
});

describe("spec02 multi-view-leakage", () => {
  it("filters night actions, checks, potions, votes, win checks, and post-game reveals by perspective", () => {
    const state = runSpec02CompletedGame();
    const villagerView = buildPlayerView(state, "p1");
    const wolfView = buildAiPlayerView(state, "p3");
    const seerView = buildAiPlayerView(state, "p4");
    const witchView = buildAiPlayerView(state, "p5");
    const coachView = buildCoachPlayerView(state, "p1");
    const publicTimeline = buildPublicTimelineView(state);
    const postGameTimeline = buildPostGameTimelineView(state);

    expect(serialized(publicTimeline)).not.toContain("werewolf_kill");
    expect(serialized(publicTimeline)).not.toContain("seer_check_result");
    expect(serialized(publicTimeline)).not.toContain("witch_potion_state_changed");
    expect(serialized(publicTimeline)).not.toContain("role_assigned");
    expect(serialized(publicTimeline)).not.toContain("win_condition_checked");

    expect(wolfView.wolfTeammateIds).toEqual(["p2"]);
    expect(wolfView.timeline.some((event) => event.type === "night_action_submitted")).toBe(true);
    expect(wolfView.players.some((player) => player.role === "seer")).toBe(false);
    expect(wolfView.players.some((player) => player.role === "witch")).toBe(false);
    expect(wolfView.players.some((player) => player.role === "villager")).toBe(false);

    expect(seerView.privateInfo).toEqual({
      kind: "seer",
      checkResults: [
        {
          camp: "werewolf",
          targetId: "p2"
        }
      ]
    });
    expect(seerView.players.filter((player) => player.role !== undefined)).toEqual([
      expect.objectContaining({ id: "p4", role: "seer" })
    ]);

    expect(witchView.privateInfo).toEqual({
      kind: "witch",
      nightDeathCandidateId: null,
      potions: {
        antidote: true,
        poison: false
      }
    });
    expect(witchView.timeline.some((event) => event.type === "witch_death_prompt")).toBe(true);
    expect(serialized(witchView)).not.toContain("wolfAttackSourceId");
    expect(serialized(witchView)).not.toContain('"role":"werewolf"');

    expect(coachView.self.id).toBe("p1");
    expect(coachView.players.filter((player) => player.role !== undefined)).toEqual([
      expect.objectContaining({ id: "p1", role: "villager" })
    ]);
    expect(serialized(coachView)).not.toContain("seer_check_result");
    expect(serialized(coachView)).not.toContain("witch_potion_state_changed");

    expect(postGameTimeline.some((event) => event.type === "post_game_role_reveal")).toBe(true);
    expect(postGameTimeline.some((event) => event.type === "night_action_submitted")).toBe(true);
    expect(postGameTimeline.some((event) => event.type === "seer_check_result")).toBe(true);
    expect(postGameTimeline.some((event) => event.type === "witch_potion_state_changed")).toBe(
      true
    );

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
      expect(view).not.toContain("llm_request_payload");
      expect(view).not.toContain("complete_state_snapshot");
    }
  });
});
