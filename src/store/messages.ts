import type {
  AppError,
  Faction,
  VisibleEventRef,
  VisibleInformationSnapshot,
} from "../shared";

import { toUserMessage } from "./errorMessages";

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
  /** 发言者展示名「名字（N号）」，供 UI 渲染气泡头部（speech 类消息用）。 */
  speakerLabel?: string;
  /** 发言者座位号，供 UI 取头像配色（speech 类消息用）。 */
  speakerSeat?: number;
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
  const meta = buildPlayerMeta(vi);
  const byEventId = new Map<string, VisibleEventRef>();
  for (const event of [...vi.publicEvents, ...vi.privateEvents]) {
    byEventId.set(event.eventId, event);
  }
  const ordered = [...byEventId.values()].sort((a, b) => a.seq - b.seq);

  const messages: ChatMessage[] = [];
  for (const event of ordered) {
    const message = mapEvent(event, vi, meta);
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
  meta: Map<string, PlayerMeta>,
): ChatMessage | null {
  const labelOf = (id: unknown) =>
    typeof id === "string" ? (meta.get(id)?.label ?? "某玩家") : "某玩家";

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
        speakerLabel: labelOf(speakerId),
        speakerSeat: meta.get(speakerId)?.seat,
        self: speakerId === vi.viewerId,
        text: `${prefix}${text}`,
      };
    }

    case "vote_submitted": {
      const voterId = String(event.payload.voterId ?? "");
      const text =
        event.payload.choiceType === "abstain"
          ? `${labelOf(voterId)} 弃票。`
          : `${labelOf(voterId)} 投票给 ${labelOf(event.payload.targetId)}。`;
      return {
        id: event.eventId,
        seq: event.seq,
        kind: "vote_result",
        text,
      };
    }

    case "vote_resolved": {
      return {
        id: event.eventId,
        seq: event.seq,
        kind: "vote_result",
        text: formatVoteResult(event, meta),
      };
    }

    case "player_died": {
      const cause =
        event.payload.deathCause === "exile" ? "被放逐" : "夜里出局";
      return {
        id: event.eventId,
        seq: event.seq,
        kind: "host",
        text: `${labelOf(event.payload.playerId)} ${cause}。`,
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
          text: `[仅你可见] 你查验了 ${labelOf(result.targetId)}，结果为：${faction}。`,
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
      // 其余事件（phase_changed / night_action_submitted /
      // game_created / game_started / win_checked / fast_forward_* 等）不入流。
      return null;
  }
}

function formatVoteResult(
  event: VisibleEventRef,
  meta: Map<string, PlayerMeta>,
): string {
  const labelOf = (id: string) => meta.get(id)?.label ?? "某玩家";
  const tally = event.payload.tally as Record<string, unknown> | undefined;
  const exiledPlayerId = event.payload.exiledPlayerId;

  // 同时翻牌：把每个人投了谁/弃票一次性公示出来。
  const breakdown = Array.isArray(event.payload.votes)
    ? (event.payload.votes as Array<{
        voterId?: unknown;
        choiceType?: unknown;
        targetId?: unknown;
      }>)
    : [];
  const breakdownParts = breakdown.map((vote) => {
    const voter = labelOf(String(vote.voterId ?? ""));
    return vote.choiceType === "abstain"
      ? `${voter} 弃票`
      : `${voter}→${labelOf(String(vote.targetId ?? ""))}`;
  });
  const breakdownText =
    breakdownParts.length > 0 ? `\n票型：${breakdownParts.join("，")}` : "";

  const parts: string[] = [];
  if (tally) {
    for (const [playerId, count] of Object.entries(tally)) {
      parts.push(`${labelOf(playerId)} ${Number(count)}票`);
    }
  }
  const tallyText = parts.length > 0 ? `（${parts.join("，")}）` : "";
  if (typeof exiledPlayerId === "string") {
    return `投票结果：${labelOf(exiledPlayerId)} 被放逐。${tallyText}${breakdownText}`;
  }
  return `投票结果：无人被放逐。${tallyText}${breakdownText}`;
}

type PlayerMeta = { seat: number; name: string; label: string };

/** 把可见信息里的玩家映射成 id → {座位, 名字, 「名字（N号）」标签}。 */
function buildPlayerMeta(
  vi: VisibleInformationSnapshot,
): Map<string, PlayerMeta> {
  const meta = new Map<string, PlayerMeta>();
  const put = (playerId: string, name: string, seat: number) => {
    meta.set(playerId, { seat, name, label: `${name}（${seat}号）` });
  };
  for (const player of vi.alivePlayers) {
    put(player.playerId, player.name, player.seat);
  }
  for (const player of vi.deadPlayers) {
    put(player.playerId, player.name, player.seat);
  }
  return meta;
}

function errorMessage(error: AppError, seq: number): ChatMessage {
  return {
    id: `error-${seq}-${error.code}`,
    seq: seq + 0.5,
    kind: "system",
    text: toUserMessage(error),
  };
}
