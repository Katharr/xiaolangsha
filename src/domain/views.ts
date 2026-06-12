import type {
  AiPlayerView,
  CoachPlayerView,
  GameState,
  PlayerId,
  PlayerPrivateInfo,
  PlayerState,
  PlayerView,
  PublicPlayerState,
  TimelineEvent
} from "./types";

function getPlayer(gameState: GameState, playerId: PlayerId) {
  const player = gameState.players.find((candidate) => candidate.id === playerId);

  if (!player) {
    throw new Error(`Unknown player: ${playerId}`);
  }

  return player;
}

function isWerewolf(gameState: GameState, playerId: PlayerId) {
  return getPlayer(gameState, playerId).role === "werewolf";
}

function isVisibleToPlayer(gameState: GameState, playerId: PlayerId, event: TimelineEvent) {
  switch (event.visibility.kind) {
    case "public":
      return true;
    case "private":
      return event.visibility.playerIds.includes(playerId);
    case "wolf_team":
      return isWerewolf(gameState, playerId);
    case "post_game":
    case "internal":
      return false;
  }
}

function buildVisiblePlayers(
  gameState: GameState,
  viewer: PlayerState,
  options: { includeWolfTeam: boolean }
): PublicPlayerState[] {
  const werewolfIds = new Set(
    gameState.players
      .filter((player) => player.role === "werewolf")
      .map((player) => player.id)
  );

  return gameState.players.map((player) => {
    const visiblePlayer: PublicPlayerState = {
      id: player.id,
      seat: player.seat,
      status: player.status
    };

    if (player.id === viewer.id) {
      return {
        ...visiblePlayer,
        role: player.role,
        camp: player.camp
      };
    }

    if (options.includeWolfTeam && viewer.role === "werewolf" && werewolfIds.has(player.id)) {
      return {
        ...visiblePlayer,
        role: "werewolf",
        camp: "werewolf"
      };
    }

    return visiblePlayer;
  });
}

function buildPrivateInfo(gameState: GameState, viewer: PlayerState): PlayerPrivateInfo {
  if (viewer.role === "werewolf") {
    return {
      kind: "werewolf",
      teammateIds: gameState.players
        .filter((player) => player.role === "werewolf" && player.id !== viewer.id)
        .map((player) => player.id)
    };
  }

  if (viewer.role === "seer") {
    return {
      kind: "seer",
      checkResults: gameState.seerResults[viewer.id] ?? []
    };
  }

  if (viewer.role === "witch") {
    return {
      kind: "witch",
      nightDeathCandidateId:
        gameState.phase === "night" ? gameState.currentNight?.werewolfKill?.targetId ?? null : null,
      potions: gameState.witchPotions[viewer.id] ?? {
        antidote: false,
        poison: false
      }
    };
  }

  return {
    kind: "villager"
  };
}

function buildBasePlayerView(
  gameState: GameState,
  playerId: PlayerId,
  _perspective: PlayerView["perspective"] | AiPlayerView["perspective"] | CoachPlayerView["perspective"],
  options: { includeWolfTeam: boolean }
): PlayerView {
  const viewer = getPlayer(gameState, playerId);

  return {
    perspective: "player",
    playerId,
    phase: gameState.phase,
    day: gameState.day,
    self: {
      id: viewer.id,
      seat: viewer.seat,
      status: viewer.status,
      role: viewer.role,
      camp: viewer.camp
    },
    players: buildVisiblePlayers(gameState, viewer, options),
    privateInfo: buildPrivateInfo(gameState, viewer),
    timeline: gameState.timeline.filter((event) =>
      isVisibleToPlayer(gameState, playerId, event)
    )
  };
}

export function buildPlayerView(gameState: GameState, playerId: PlayerId): PlayerView {
  return buildBasePlayerView(gameState, playerId, "player", {
    includeWolfTeam: false
  });
}

export function buildAiPlayerView(gameState: GameState, playerId: PlayerId): AiPlayerView {
  const view = buildBasePlayerView(gameState, playerId, "ai", {
    includeWolfTeam: true
  });
  const viewer = getPlayer(gameState, playerId);

  return {
    ...view,
    perspective: "ai",
    wolfTeammateIds:
      viewer.role === "werewolf" && view.privateInfo.kind === "werewolf"
        ? view.privateInfo.teammateIds
        : []
  };
}

export function buildCoachPlayerView(
  gameState: GameState,
  humanPlayerId: PlayerId
): CoachPlayerView {
  const view = buildBasePlayerView(gameState, humanPlayerId, "coach", {
    includeWolfTeam: false
  });

  return {
    ...view,
    perspective: "coach",
    adviceScope: "current_player_view"
  };
}

export function buildPublicTimelineView(gameState: GameState): TimelineEvent[] {
  return gameState.timeline.filter((event) => event.visibility.kind === "public");
}

export function buildPostGameTimelineView(gameState: GameState): TimelineEvent[] {
  return gameState.timeline.filter(
    (event) =>
      event.visibility.kind === "public" ||
      event.visibility.kind === "post_game" ||
      event.postGameVisible === true
  );
}
