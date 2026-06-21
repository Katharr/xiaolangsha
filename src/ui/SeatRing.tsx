import { AnimatePresence, motion } from "framer-motion";
import type { ReactNode } from "react";

import type { GamePhase, VisibleInformationSnapshot } from "../shared";
import type { ChatMessage, ThinkingState } from "../store";

import { Avatar } from "./Avatar";
import { TASK_THINKING_LABEL } from "./labels";
import { PlayerName, bareName } from "./PlayerName";

/**
 * 环形牌桌（方案 C 右列上半）+ 中央舞台 + 场上速览。
 * 严格只读 vi / thinking / 最近一条发言（ISO-001）：仅显示座位、名字、你/狼队友角标、
 * 存活状态，绝不显示 AI 角色身份。座位角度只由 total 推算，兼容 5/7 人及死亡缩减。
 * 名字一律走统一的 PlayerName 组件着色（你=金、其余按座位色）。
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

type SeatRingProps = {
  vi: VisibleInformationSnapshot;
  thinking?: ThinkingState | null;
  latestSpeech?: ChatMessage | undefined;
  phase: GamePhase | null;
};

export function SeatRing({ vi, thinking, latestSpeech, phase }: SeatRingProps) {
  const spotlight = speakingSeat(thinking, latestSpeech);
  const seats = buildSeats(vi, spotlight);
  const total = seats.length;
  const isNight = phase === "night_action" || Boolean(thinking?.anonymous);

  return (
    <div className="table-wrap">
      <div className="table">
        <div className="felt" />
        <Stage
          isNight={isNight}
          thinking={thinking}
          latestSpeech={latestSpeech}
        />
        {seats.map((s, i) => {
          const ang = (-90 + (i * 360) / total) * (Math.PI / 180);
          const x = 50 + 43 * Math.cos(ang);
          const y = 50 + 44 * Math.sin(ang);
          const cls = [
            "seat",
            s.alive ? "" : "dead",
            s.speaking ? "speaking" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <div
              key={s.playerId}
              className={cls}
              style={{ left: `${x}%`, top: `${y}%` }}
            >
              <span className="avatar-wrap">
                <Avatar seat={s.seat} className="avatar" />
                {s.isViewer ? (
                  <span className="badge you">你</span>
                ) : s.isTeammate ? (
                  <span className="badge wolf">狼</span>
                ) : null}
              </span>
              <span className="nm">
                <PlayerName
                  name={s.name}
                  seat={s.seat}
                  isSelf={s.isViewer}
                  muted={!s.alive}
                />
              </span>
              <span className="st">
                {s.alive ? (s.speaking ? "发言中" : "存活") : "出局"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 中央舞台：夜晚显示月幕，白天显示当前发言者头像 + 名字 + 实时这句话。
 * 当聚光对象切换（夜↔昼、换发言者）时，用 Framer Motion 做淡入淡出的「高亮进出」。
 * 只动 opacity 不动 transform，避免覆盖 .stage 的居中 translate。
 */
function Stage({
  isNight,
  thinking,
  latestSpeech,
}: {
  isNight: boolean;
  thinking?: ThinkingState | null;
  latestSpeech?: ChatMessage | undefined;
}) {
  const { key, className, content } = stageContent(
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
  isNight: boolean,
  thinking: ThinkingState | null | undefined,
  latestSpeech: ChatMessage | undefined,
): { key: string; className: string; content: ReactNode } {
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

  // AI 思考中（非匿名）：显示其头像 + 「正在<任务>」。
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

  // 否则展示最近一条发言。
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

/** 场上速览：紧凑名单（右列下半）。存活在上、出局在下。 */
export function Roster({ vi }: { vi: VisibleInformationSnapshot }) {
  const seats = buildSeats(vi, undefined);
  const alive = seats.filter((s) => s.alive);
  const dead = seats.filter((s) => !s.alive);

  const row = (s: SeatModel) => (
    <div key={s.playerId} className={`rrow${s.alive ? "" : " dead"}`}>
      <Avatar seat={s.seat} className="ra" />
      <span className="rn">
        <PlayerName
          name={s.name}
          seat={s.seat}
          isSelf={s.isViewer}
          muted={!s.alive}
        />
      </span>
      {s.isViewer ? (
        <span className="tagy">你</span>
      ) : s.isTeammate ? (
        <span className="tagw">狼</span>
      ) : null}
      <span className="rs">{s.alive ? "存活" : "出局"}</span>
    </div>
  );

  return (
    <div className="roster">
      <h4>场上速览 · 存活 {alive.length}</h4>
      {alive.map(row)}
      {dead.length > 0 ? <h4>出局 {dead.length}</h4> : null}
      {dead.map(row)}
    </div>
  );
}
