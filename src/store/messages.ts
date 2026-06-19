import type {
  AppError,
  Faction,
  VisibleEventRef,
  VisibleInformationSnapshot,
} from "../shared";

/**
 * 聊天流消息种类。messages 只从 visibleInformation（+ 最近一次 AppError）派生，
 * 组件物理上拿不到 snapshot/events（ISO-001）。
 */
export type ChatMessageKind =
  | "host" // 主持人/系统播报（公开事件）
  | "private_info" // [仅你可见] 私有信息（如预言家查验）
  | "speech" // 玩家发言（原文逐字）
  | "vote_result" // 投票结算（票型，仅座位不含身份）
  | "system"; // 错误等系统提示

export type ChatMessage = {
  id: string;
  seq: number;
  kind: ChatMessageKind;
  text: string;
  speakerId?: string;
  /** 该消息是否出自当前 viewer 自己（UI 用于右对齐等）。 */
  self?: boolean;
};

/**
 * 把当前 viewer 的可见信息映射成有序消息流。M6 的 UI 会在此基础上细化样式，
 * 但映射规则（哪些事件可见、措辞不泄身份）集中在这里。
 */
export function deriveMessages(
  visibleInformation: VisibleInformationSnapshot | null,
  error?: AppError | null,
): ChatMessage[] {
  if (!visibleInformation) {
    return error ? [errorMessage(error, 0)] : [];
  }

  const vi = visibleInformation;
  const seatById = buildSeatLookup(vi);
  const byEventId = new Map<string, VisibleEventRef>();
  for (const event of [...vi.publicEvents, ...vi.privateEvents]) {
    byEventId.set(event.eventId, event);
  }
  const ordered = [...byEventId.values()].sort((a, b) => a.seq - b.seq);

  const messages: ChatMessage[] = [];
  for (const event of ordered) {
    const message = mapEvent(event, vi, seatById);
    if (message) {
      messages.push(message);
    }
  }

  if (error) {
    messages.push(errorMessage(error, vi.generatedAtSeq));
  }

  return messages;
}

function mapEvent(
  event: VisibleEventRef,
  vi: VisibleInformationSnapshot,
  seatById: Map<string, number>,
): ChatMessage | null {
  const seatOf = (id: unknown) =>
    typeof id === "string" ? (seatById.get(id) ?? "?") : "?";

  switch (event.type) {
    case "day_announced": {
      const text =
        typeof event.payload.announcementText === "string"
          ? event.payload.announcementText
          : "天亮了。";
      return { id: event.eventId, seq: event.seq, kind: "host", text };
    }

    case "speech_submitted":
    case "tie_speech_submitted":
    case "last_words_submitted": {
      const speakerId = String(event.payload.speakerId ?? "");
      const text = String(event.payload.text ?? "");
      const prefix =
        event.type === "last_words_submitted"
          ? "【遗言】"
          : event.type === "tie_speech_submitted"
            ? "【拉票】"
            : "";
      return {
        id: event.eventId,
        seq: event.seq,
        kind: "speech",
        speakerId,
        self: speakerId === vi.viewerId,
        text: `${seatOf(speakerId)}号：${prefix}${text}`,
      };
    }

    case "vote_resolved": {
      return {
        id: event.eventId,
        seq: event.seq,
        kind: "vote_result",
        text: formatVoteResult(event, seatById),
      };
    }

    case "player_died": {
      const cause =
        event.payload.deathCause === "exile" ? "被放逐" : "夜里出局";
      return {
        id: event.eventId,
        seq: event.seq,
        kind: "host",
        text: `${seatOf(event.payload.playerId)}号 ${cause}。`,
      };
    }

    case "night_action_resolved": {
      const result = event.payload.result as
        | { kind?: unknown; targetId?: unknown; factionResult?: unknown }
        | undefined;
      if (result && result.kind === "seer_check_result") {
        const faction =
          result.factionResult === "werewolf_team" ? "狼人" : "好人";
        return {
          id: event.eventId,
          seq: event.seq,
          kind: "private_info",
          text: `[仅你可见] 你查验了 ${seatOf(result.targetId)}号，结果为：${faction}。`,
        };
      }
      return null;
    }

    case "game_ended": {
      const winner = event.payload.winner as Faction | undefined;
      const label =
        winner === "werewolf_team"
          ? "狼人阵营"
          : winner === "good_team"
            ? "好人阵营"
            : "未知";
      return {
        id: event.eventId,
        seq: event.seq,
        kind: "host",
        text: `游戏结束，${label}获胜。`,
      };
    }

    default:
      // 其余事件（phase_changed / night_action_submitted / vote_submitted /
      // game_created / game_started / win_checked / fast_forward_* 等）不入流。
      return null;
  }
}

function formatVoteResult(
  event: VisibleEventRef,
  seatById: Map<string, number>,
): string {
  const tally = event.payload.tally as Record<string, unknown> | undefined;
  const exiledPlayerId = event.payload.exiledPlayerId;
  const parts: string[] = [];
  if (tally) {
    for (const [playerId, count] of Object.entries(tally)) {
      parts.push(`${seatById.get(playerId) ?? "?"}号 ${Number(count)}票`);
    }
  }
  const tallyText = parts.length > 0 ? `（${parts.join("，")}）` : "";
  if (typeof exiledPlayerId === "string") {
    return `投票结果：${seatById.get(exiledPlayerId) ?? "?"}号 被放逐。${tallyText}`;
  }
  return `投票结果：无人被放逐。${tallyText}`;
}

function buildSeatLookup(vi: VisibleInformationSnapshot): Map<string, number> {
  const seatById = new Map<string, number>();
  for (const player of vi.alivePlayers) {
    seatById.set(player.playerId, player.seat);
  }
  for (const player of vi.deadPlayers) {
    seatById.set(player.playerId, player.seat);
  }
  return seatById;
}

function errorMessage(error: AppError, seq: number): ChatMessage {
  return {
    id: `error-${seq}-${error.code}`,
    seq: seq + 0.5,
    kind: "system",
    text: error.userMessage ?? error.message,
  };
}
