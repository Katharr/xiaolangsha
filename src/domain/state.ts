import { getRuleset } from "./rulesets";
import type {
  Camp,
  GameState,
  PlayerId,
  PlayerState,
  Role,
  Ruleset,
  Seat,
  TimelineEvent,
  WitchPotionState
} from "./types";

interface CreateInitialGameStateOptions {
  rulesetId: Ruleset["id"];
  seed: string;
  humanPlayerId: PlayerId;
}

function campForRole(role: Role): Camp {
  return role === "werewolf" ? "werewolf" : "good";
}

function hashSeed(seed: string) {
  let hash = 2166136261;

  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function createSeededRandom(seed: string) {
  let state = hashSeed(seed) || 0x9e3779b9;

  return () => {
    state = Math.imul(state ^ (state >>> 15), 1 | state);
    state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);

    return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleRoles(roles: Role[], seed: string) {
  const random = createSeededRandom(seed);
  const shuffled = [...roles];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}

function createSeats(playerIds: PlayerId[]): Seat[] {
  return playerIds.map((playerId, index) => ({
    id: index + 1,
    label: `${index + 1}号`,
    playerId
  }));
}

function createPlayers(playerIds: PlayerId[], roles: Role[]): PlayerState[] {
  return playerIds.map((playerId, index) => {
    const role = roles[index];

    return {
      id: playerId,
      seat: index + 1,
      role,
      camp: campForRole(role),
      status: "alive"
    };
  });
}

function createRoleAssignedEvents(players: PlayerState[]) {
  return players.map<TimelineEvent>((player, index) => ({
    id: `event-role-assigned-${player.id}`,
    type: "role_assigned",
    day: 0,
    order: index + 2,
    visibility: { kind: "private", playerIds: [player.id] },
    payload: {
      playerId: player.id,
      role: player.role,
      camp: player.camp
    }
  }));
}

function createInitialTimeline(ruleset: Ruleset, players: PlayerState[], seed: string) {
  const werewolfIds = players
    .filter((player) => player.role === "werewolf")
    .map((player) => player.id);

  return [
    {
      id: "event-game-created",
      type: "game_created",
      day: 0,
      order: 0,
      visibility: { kind: "public" },
      payload: {
        playerCount: ruleset.playerCount,
        rulesetId: ruleset.id,
        winConditionMode: ruleset.defaultWinConditionMode
      }
    },
    {
      id: "event-phase-setup",
      type: "phase_changed",
      day: 0,
      order: 1,
      visibility: { kind: "public" },
      payload: {
        phase: "setup"
      }
    },
    ...createRoleAssignedEvents(players),
    {
      id: "event-wolf-team-revealed",
      type: "wolf_team_revealed",
      day: 0,
      order: 8,
      visibility: { kind: "wolf_team" },
      payload: {
        werewolfIds
      }
    },
    {
      id: "event-post-game-role-reveal",
      type: "post_game_role_reveal",
      day: 0,
      order: 9,
      visibility: { kind: "post_game" },
      payload: {
        rolesByPlayerId: Object.fromEntries(
          players.map((player) => [player.id, player.role])
        )
      }
    },
    {
      id: "event-system-seed",
      type: "system_seed_or_rng",
      day: 0,
      order: 10,
      visibility: { kind: "internal" },
      payload: {
        seed
      }
    },
    {
      id: "event-complete-state-snapshot",
      type: "complete_state_snapshot",
      day: 0,
      order: 11,
      visibility: { kind: "internal" },
      payload: {
        reason: "debug-only"
      }
    }
  ] satisfies TimelineEvent[];
}

export function createInitialGameState({
  humanPlayerId,
  rulesetId,
  seed
}: CreateInitialGameStateOptions): GameState {
  const ruleset = getRuleset(rulesetId);
  const playerIds = Array.from({ length: ruleset.playerCount }, (_, index) => `p${index + 1}`);

  if (!playerIds.includes(humanPlayerId)) {
    throw new Error(`Human player ${humanPlayerId} is not seated in ${ruleset.id}`);
  }

  const roles = shuffleRoles(ruleset.roles, seed);
  const seats = createSeats(playerIds);
  const players = createPlayers(playerIds, roles);
  const witchPotions = Object.fromEntries(
    players
      .filter((player) => player.role === "witch")
      .map<[PlayerId, WitchPotionState]>((player) => [
        player.id,
        {
          antidote: true,
          poison: true
        }
      ])
  );

  return {
    id: `game-${hashSeed(seed).toString(16)}`,
    ruleset,
    winConditionMode: ruleset.defaultWinConditionMode,
    phase: "setup",
    day: 0,
    humanPlayerId,
    seats,
    players,
    timeline: createInitialTimeline(ruleset, players, seed),
    seed,
    seerResults: Object.fromEntries(
      players.filter((player) => player.role === "seer").map((player) => [player.id, []])
    ),
    witchPotions,
    debugSnapshot: {
      createdBy: "src/domain",
      note: "Full GameState is for domain use only."
    }
  };
}
