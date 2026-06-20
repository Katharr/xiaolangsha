import type {
  GamePhase,
  HumanParticipationState,
  VisibleInformationSnapshot,
} from "../shared";

import { PHASE_LABEL, ROLE_LABEL } from "./labels";

type StatusBarProps = {
  phase: GamePhase | null;
  participation: HumanParticipationState | null;
  vi: VisibleInformationSnapshot | null;
};

type SeatRow = {
  seat: number;
  name: string;
  isViewer: boolean;
  alive: boolean;
  isTeammate: boolean;
};

/**
 * 顶部状态栏：相位 / 轮次 / 真人自己的身份 / 玩家存活简表。
 * 严格不显示 AI 身份、不显示真相日志（ISO-001）。
 */
export function StatusBar({ phase, participation, vi }: StatusBarProps) {
  const phaseText = phase ? PHASE_LABEL[phase] : "准备中";

  if (!vi) {
    return (
      <header className="status-bar" aria-label="状态栏">
        <span className="status-phase">{phaseText}</span>
      </header>
    );
  }

  const isNight = phase === "night_action";
  const roundText = isNight ? `第 ${vi.round.night} 夜` : `第 ${vi.round.day} 天`;

  const teammateIds = new Set(vi.teammates.map((t) => t.playerId));
  const rows: SeatRow[] = [
    ...vi.alivePlayers.map((player) => ({
      seat: player.seat,
      name: player.name,
      isViewer: player.playerId === vi.viewerId,
      alive: true,
      isTeammate: teammateIds.has(player.playerId),
    })),
    ...vi.deadPlayers.map((player) => ({
      seat: player.seat,
      name: player.name,
      isViewer: player.playerId === vi.viewerId,
      alive: false,
      isTeammate: teammateIds.has(player.playerId),
    })),
  ].sort((a, b) => a.seat - b.seat);

  const spectating = participation && participation !== "alive";

  return (
    <header className="status-bar" aria-label="状态栏">
      <div className="status-line">
        <span className="status-phase">{phaseText}</span>
        <span className="status-round">{roundText}</span>
        <span className="status-role">你是：{ROLE_LABEL[vi.ownRole]}</span>
        {spectating ? <span className="status-tag">旁观中</span> : null}
      </div>
      <ul className="status-players">
        {rows.map((row) => (
          <li
            key={row.seat}
            className={row.alive ? "seat-alive" : "seat-dead"}
          >
            {row.name}（{row.seat}号）{row.isViewer ? "·你" : ""}
            {row.isTeammate ? "·狼队友" : ""}{" "}
            {row.alive ? "存活" : "出局"}
          </li>
        ))}
      </ul>
    </header>
  );
}
