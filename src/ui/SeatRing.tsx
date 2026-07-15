import { AnimatePresence, motion } from "framer-motion";
import type { ReactNode } from "react";

import "./table.css";

import type { GamePhase, VisibleInformationSnapshot } from "../shared";
import type { ChatMessage, ThinkingState } from "../store";

import { Avatar } from "./Avatar";
import { ROLE_DUTY, ROLE_LABEL, TASK_THINKING_LABEL } from "./labels";
import { PlayerName, bareName } from "./PlayerName";
import { TablePlaque } from "./TablePlaque";
import { TableTools } from "./TableTools";

/**
 * 大牌桌（圆桌剧场 v3「信息上桌」，中列视觉主体）：
 * 座位铭牌（头像 + 名牌 + 徽标行）+ 桌心铭牌 + 中央舞台 + 左下工具钮。
 * 严格只读 vi / thinking / 最近一条发言（ISO-001）：私密标记只来自 viewer
 * 自己的 vi（队友/自己身份），绝不显示他人 AI 角色。座位角度只由 total 推算，
 * 兼容 5/7 人及死亡缩减。名字一律走统一的 PlayerName 组件着色。
 *
 * 舞台优先级（投票态必须排在 isNight 之前——AI 并发暗投的匿名思考
 * 不能把白天投票顶成「天黑请闭眼」月幕）：
 *   veil(投票中) → night → thinking(非匿名) → latestSpeech → idle。
 */

type SeatModel = {
  playerId: string;
  seat: number;
  name: string;
  alive: boolean;
  isViewer: boolean;
  isTeammate: boolean;
  speaking: boolean;
};

/** 当前发言/行动者的座位号：优先 AI 思考中（非匿名），否则取最近一条发言。 */
function speakingSeat(
  thinking: ThinkingState | null | undefined,
  latestSpeech: ChatMessage | undefined,
): number | undefined {
  if (thinking && !thinking.anonymous && thinking.seat) {
    return thinking.seat;
  }
  return latestSpeech?.speakerSeat;
}

function buildSeats(
  vi: VisibleInformationSnapshot,
  spotlight: number | undefined,
): SeatModel[] {
  const teammateIds = new Set(vi.teammates.map((t) => t.playerId));
  const toModel = (
    player: { playerId: string; seat: number; name: string },
    alive: boolean,
  ): SeatModel => ({
    playerId: player.playerId,
    seat: player.seat,
    name: player.name,
    alive,
    isViewer: player.playerId === vi.viewerId,
    isTeammate: teammateIds.has(player.playerId),
    speaking: alive && player.seat === spotlight,
  });
  return [
    ...vi.alivePlayers.map((p) => toModel(p, true)),
    ...vi.deadPlayers.map((p) => toModel(p, false)),
  ].sort((a, b) => a.seat - b.seat);
}

/** 座位极角坐标（-90° 起正上方，顺时针均分）。y 半径 42%：给铭牌留高。 */
export function seatPos(index: number, total: number): { x: number; y: number } {
  const ang = ((-90 + (index * 360) / total) * Math.PI) / 180;
  return { x: 50 + 43 * Math.cos(ang), y: 50 + 42 * Math.sin(ang) };
}

type SeatRingProps = {
  vi: VisibleInformationSnapshot;
  thinking?: ThinkingState | null;
  latestSpeech?: ChatMessage | undefined;
  phase: GamePhase | null;
  spectating: boolean;
  onNewGame: () => void;
  onExportDebug: () => void;
};

export function SeatRing({
  vi,
  thinking,
  latestSpeech,
  phase,
  spectating,
  onNewGame,
  onExportDebug,
}: SeatRingProps) {
  const spotlight = speakingSeat(thinking, latestSpeech);
  const seats = buildSeats(vi, spotlight);
  const total = seats.length;
  const isVoting = phase === "vote" || phase === "tie_vote";
  // 匿名思考默认视为夜幕，但投票暗投的匿名思考除外（那是白天，交给 veil 态）。
  const isNight =
    phase === "night_action" ||
    (Boolean(thinking?.anonymous) && thinking?.taskType !== "vote");
  const canVote =
    vi.canAct && vi.legalActions.some((a) => a.actionType === "vote");

  return (
    <div className="table-wrap" aria-label="牌桌">
      <div className={`table${isVoting ? " veiled" : ""}`}>
        <div className="felt" />
        <TablePlaque phase={phase} vi={vi} spectating={spectating} />
        <Stage
          isVoting={isVoting}
          canVote={canVote}
          phase={phase}
          isNight={isNight}
          thinking={thinking}
          latestSpeech={latestSpeech}
        />
        {seats.map((s, i) => {
          const pos = seatPos(i, total);
          const cls = [
            "seat",
            s.alive ? "" : "dead",
            s.speaking ? "speaking" : "",
            pos.y < 50 ? "s-top" : "s-bot",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <div
              key={s.playerId}
              className={cls}
              data-seat={s.seat}
              style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
            >
              <div className="avwrap">
                <Avatar seat={s.seat} className="avatar" />
                {s.isViewer ? <span className="badge you">你</span> : null}
              </div>
              <div className="plate">
                <div className="p-name">
                  <PlayerName
                    name={s.name}
                    seat={s.seat}
                    isSelf={s.isViewer}
                    muted={!s.alive}
                  />
                </div>
                <SeatTokenRow seat={s} vi={vi} />
                {s.speaking ? <div className="p-st nb">发言中</div> : null}
              </div>
            </div>
          );
        })}
        <TableTools onNewGame={onNewGame} onExportDebug={onExportDebug} />
      </div>
    </div>
  );
}

/**
 * 座位铭牌徽标行（阶段一版：狼队友 token + own 角色胶囊）。
 * 私密 token 只从 vi.teammates / vi.ownRole 派生（ISO-001）；
 * 私密 tooltip 一律以「仅你可见」结尾。查验/救毒/死因等完整 token
 * 系统在阶段二由 seatTokens selector 接管。
 */
function SeatTokenRow({
  seat,
  vi,
}: {
  seat: SeatModel;
  vi: VisibleInformationSnapshot;
}) {
  const tokens: ReactNode[] = [];
  if (seat.isTeammate) {
    tokens.push(
      <span
        key="mate"
        className="tk tk-wolf tt"
        data-tip="你的狼队友 · 仅你可见"
      >
        狼
      </span>,
    );
  }
  if (seat.isViewer) {
    tokens.push(
      <span
        key="role"
        className={`tk-role tt${vi.ownFaction === "werewolf_team" ? " wolfy" : ""}`}
        data-tip={ROLE_DUTY[vi.ownRole]}
        aria-label={`你的身份：${ROLE_LABEL[vi.ownRole]}`}
      >
        {ROLE_LABEL[vi.ownRole]}
      </span>,
    );
  }
  if (tokens.length === 0) {
    return null;
  }
  return <div className="p-row">{tokens}</div>;
}

/**
 * 中央舞台：投票 veil 幕布 / 夜晚月幕 / 当前发言者。
 * 用 Framer Motion 做淡入淡出的「高亮进出」；只动 opacity 不动 transform，
 * 避免覆盖 .stage 的居中 translate。
 */
function Stage({
  isVoting,
  canVote,
  phase,
  isNight,
  thinking,
  latestSpeech,
}: {
  isVoting: boolean;
  canVote: boolean;
  phase: GamePhase | null;
  isNight: boolean;
  thinking?: ThinkingState | null;
  latestSpeech?: ChatMessage | undefined;
}) {
  const { key, className, content } = stageContent(
    isVoting,
    canVote,
    phase,
    isNight,
    thinking,
    latestSpeech,
  );
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={key}
        className={className}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.28 }}
      >
        {content}
      </motion.div>
    </AnimatePresence>
  );
}

/** 计算舞台当前内容 + 用于 AnimatePresence 切换的稳定 key。 */
function stageContent(
  isVoting: boolean,
  canVote: boolean,
  phase: GamePhase | null,
  isNight: boolean,
  thinking: ThinkingState | null | undefined,
  latestSpeech: ChatMessage | undefined,
): { key: string; className: string; content: ReactNode } {
  // ① 投票中：暗投幕布（零计票结构——保密红线，全部票向只在开票后出现）。
  if (isVoting) {
    return {
      key: `veil-${phase}`,
      className: "stage veil",
      content: (
        <>
          <span className="stg-title">
            <span className="nb">
              {phase === "tie_vote" ? "平票加赛" : "投票表决"}
            </span>
          </span>
          <span className="stg-sub">
            {canVote ? (
              <span className="nb">请在右下操作区投出你的一票</span>
            ) : (
              <>
                <span className="nb">暗投进行中</span>
                <span className="typing">
                  <span className="dot" />
                  <span className="dot" />
                  <span className="dot" />
                </span>
              </>
            )}
          </span>
          <div className="vbox" aria-hidden="true" />
          <span className="veil-note">
            <span className="nb">所有选票将在开票时一次性公示</span>
          </span>
        </>
      ),
    };
  }

  // ② 夜晚：月幕。
  if (isNight) {
    return {
      key: "night",
      className: "stage night",
      content: (
        <>
          <span className="spk-av" aria-hidden="true" />
          <span className="spk-name">夜幕</span>
          <span className="spk-line">天黑请闭眼，夜晚行动进行中…</span>
        </>
      ),
    };
  }

  // ③ AI 思考中（非匿名）：显示其头像 + 「正在<任务>」。
  if (thinking && !thinking.anonymous && thinking.seat) {
    const task = TASK_THINKING_LABEL[thinking.taskType] ?? "行动";
    return {
      key: `think-${thinking.seat}`,
      className: "stage",
      content: (
        <>
          <Avatar seat={thinking.seat} className="spk-av" />
          <span className="spk-name">
            <PlayerName name={thinking.name ?? "?"} seat={thinking.seat} />
          </span>
          <span className="spk-line">正在{task}…</span>
        </>
      ),
    };
  }

  // ④ 否则展示最近一条发言。
  if (latestSpeech?.speakerSeat) {
    return {
      key: `speech-${latestSpeech.id}`,
      className: "stage",
      content: (
        <>
          <Avatar seat={latestSpeech.speakerSeat} className="spk-av" />
          <span className="spk-name">
            <PlayerName
              name={bareName(
                latestSpeech.speakerLabel,
                latestSpeech.speakerSeat,
              )}
              seat={latestSpeech.speakerSeat}
              isSelf={latestSpeech.self}
            />
          </span>
          <span className="spk-line">{latestSpeech.text}</span>
        </>
      ),
    };
  }

  return {
    key: "idle",
    className: "stage",
    content: (
      <>
        <span className="spk-av" aria-hidden="true" />
        <span className="spk-name">等待发言</span>
        <span className="spk-line">尚无人发言。</span>
      </>
    ),
  };
}
