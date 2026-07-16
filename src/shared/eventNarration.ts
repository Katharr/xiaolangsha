import {
  DEATH_CAUSE_LABEL,
  NIGHT_ACTION_VERB,
  WIN_REASON_LABEL,
} from "./labels";
import type { NightActionType } from "./enums";
import type { Player, TruthEvent } from "./models";

/**
 * 事件叙事：把单个 TruthEvent 翻成一行中文。**结构化片段**而非纯字符串，
 * 这样调用方既能拼成纯文本（debug 摘要），也能把玩家名替换成着色组件（复盘 UI）。
 *
 * 纯函数、只依赖 shared（类型 + labels），不碰 store/ui/rules——故可被 store 与 ui 共用，
 * 杜绝 store→ui 反向依赖。原实现长居 store/debugSummary.ts，现提取至此供复盘复用。
 */

/** 叙事片段：普通文字，或一个待解析/着色的玩家引用。 */
export type NarrationSegment = string | { kind: "player"; playerId: string };

/** 玩家片段构造：非字符串 id 退化为「某玩家」文字段，与旧 labelOf 的非字符串分支一致。 */
function P(id: unknown): NarrationSegment {
  return typeof id === "string" ? { kind: "player", playerId: id } : "某玩家";
}

/** 把若干玩家 id 用分隔符串成片段序列（如「狼队（A、B）」的内部）。 */
function joinPlayers(ids: unknown[], sep: string): NarrationSegment[] {
  const out: NarrationSegment[] = [];
  ids.forEach((id, i) => {
    if (i > 0) {
      out.push(sep);
    }
    out.push(P(id));
  });
  return out;
}

/** 把叙事片段拼回纯文本：玩家片段用传入的 labelOf 解析（debug 摘要用）。 */
export function segmentsToText(
  segs: NarrationSegment[],
  labelOf: (id: string) => string,
): string {
  return segs
    .map((s) => (typeof s === "string" ? s : labelOf(s.playerId)))
    .join("");
}

/**
 * 把单个 TruthEvent 渲染成一行叙事片段；返回 null 表示噪声事件、不入时间线
 * （phase_changed / players_assigned / 夜晚·投票中间态 / 认人等）。
 */
export function narrateEvent(event: TruthEvent): NarrationSegment[] | null {
  const p = event.payload;
  switch (event.type) {
    case "game_created":
      return [`对局创建（模式 ${String(p.mode ?? "?")}、板 ${String(p.boardId ?? "?")}）`];

    case "night_action_resolved":
      return nightResolvedSegments(event);

    case "hunter_shot": {
      const target = p.targetId;
      return typeof target === "string"
        ? ["猎人 ", P(p.hunterId), " 开枪带走 ", P(target)]
        : ["猎人 ", P(p.hunterId), " 选择不开枪"];
    }

    case "day_announced": {
      if (typeof p.announcementText === "string" && p.announcementText.length > 0) {
        return [`天亮：${p.announcementText}`];
      }
      const dead = Array.isArray(p.deadPlayerIds) ? p.deadPlayerIds : [];
      return dead.length > 0
        ? ["天亮：", ...joinPlayers(dead, "、"), " 倒牌"]
        : ["天亮：平安夜"];
    }

    case "speech_submitted":
    case "tie_speech_submitted":
    case "last_words_submitted": {
      const tag =
        event.type === "last_words_submitted"
          ? "【遗言】"
          : event.type === "tie_speech_submitted"
            ? "【拉票】"
            : "";
      // 发言/遗言保留原文，不截断（复盘与 debug 导出都要全文）。
      return [P(p.speakerId), `${tag}：「${String(p.text ?? "").trim()}」`];
    }

    case "vote_resolved":
      return voteResolvedSegments(event);

    case "player_died": {
      const cause = event.payload.deathCause as Player["deathCause"];
      const causeText = cause ? DEATH_CAUSE_LABEL[cause] : "出局";
      return [P(p.playerId), ` ${causeText}`];
    }

    case "win_checked":
    case "game_ended": {
      const winner = p.winner;
      const reason = p.winReason;
      // 非终局的 win_checked 不带 winner（引擎每轮结算后的内部记账），不入时间线。
      if (winner !== "werewolf_team" && winner !== "good_team") {
        return null;
      }
      const winnerText = winner === "werewolf_team" ? "狼人阵营" : "好人阵营";
      const reasonText =
        typeof reason === "string" && reason in WIN_REASON_LABEL
          ? WIN_REASON_LABEL[reason as keyof typeof WIN_REASON_LABEL]
          : "";
      const tail = reasonText ? `（${reasonText}）` : "";
      return [
        event.type === "game_ended"
          ? `游戏结束，${winnerText}获胜${tail}`
          : `胜负判定：${winnerText}获胜${tail}`,
      ];
    }

    case "fast_forward_requested":
      return ["真人请求快进到结局"];
    case "fast_forward_completed":
      return ["快进完成"];
    case "fast_forward_failed":
      return [`快进失败${typeof p.reason === "string" ? `：${p.reason}` : ""}`];

    default:
      return null;
  }
}

function nightResolvedSegments(event: TruthEvent): NarrationSegment[] | null {
  const p = event.payload;
  const actionType = p.actionType as NightActionType | undefined;
  if (!actionType || actionType === "none") {
    return null; // 女巫醒来提示（actionType="none"）不入时间线。
  }
  const result = (p.result ?? {}) as Record<string, unknown>;

  if (actionType === "werewolf_kill") {
    const actorIds = Array.isArray(p.actorIds)
      ? (p.actorIds as unknown[]).filter((id): id is string => typeof id === "string")
      : [];
    const actorSegs: NarrationSegment[] =
      actorIds.length > 0
        ? ["狼队（", ...joinPlayers(actorIds, "、"), "）"]
        : [P(p.actorId)];
    const out: NarrationSegment[] = [...actorSegs, " 击杀 ", P(p.targetId)];
    if (result.killed === false) {
      out.push("（未得手）");
    }
    const wolfVotes = result.wolfVotes as Record<string, string> | undefined;
    if (wolfVotes) {
      out.push("（刀票：");
      Object.entries(wolfVotes).forEach(([w, t], i) => {
        if (i > 0) {
          out.push("，");
        }
        out.push(P(w), "→", P(t));
      });
      out.push("）");
    }
    return out;
  }

  if (actionType === "seer_check") {
    const faction = result.factionResult === "werewolf_team" ? "狼人" : "好人";
    return ["预言家 ", P(p.actorId), " 查验 ", P(p.targetId), ` → ${faction}`];
  }

  const verb = NIGHT_ACTION_VERB[actionType];
  return [P(p.actorId), ` ${verb} `, P(p.targetId)];
}

function voteResolvedSegments(event: TruthEvent): NarrationSegment[] {
  const p = event.payload;
  const exiled = p.exiledPlayerId;
  const out: NarrationSegment[] =
    typeof exiled === "string"
      ? ["投票：", P(exiled), " 被放逐"]
      : ["投票：无人被放逐"];

  const tally = p.tally as Record<string, unknown> | undefined;
  if (tally) {
    out.push("（");
    Object.entries(tally).forEach(([id, n], i) => {
      if (i > 0) {
        out.push("，");
      }
      out.push(P(id), ` ${Number(n)}票`);
    });
    out.push("）");
  }

  const votes = Array.isArray(p.votes)
    ? (p.votes as Array<{ voterId?: unknown; choiceType?: unknown; targetId?: unknown }>)
    : [];
  if (votes.length > 0) {
    out.push("；票型：");
    votes.forEach((v, i) => {
      if (i > 0) {
        out.push("，");
      }
      if (v.choiceType === "abstain") {
        out.push(P(v.voterId), "弃票");
      } else {
        out.push(P(v.voterId), "→", P(v.targetId));
      }
    });
  }

  return out;
}
