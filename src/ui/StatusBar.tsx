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
  /** 点击「导出日志」调试按钮的回调；未提供则不渲染按钮。 */
  onExportDebug?: () => void;
  /** 点击「重开新局」的回调（结束本局回主界面选模式）；未提供则不渲染按钮。 */
  onNewGame?: () => void;
};

/** 重开新局：任何时候结束当前对局、返回主界面重新选模式。始终可点（不随 busy 禁用）。 */
function NewGameButton({ onNewGame }: { onNewGame?: () => void }) {
  if (!onNewGame) {
    return null;
  }
  return (
    <button
      type="button"
      className="status-newgame"
      title="结束当前对局，返回主界面重新选择模式"
      onClick={onNewGame}
    >
      🔄 重开新局
    </button>
  );
}

/** 调试按钮：导出本局完整日志，方便排查「卡住没动静」。始终可点（不随 busy 禁用）。 */
function DebugButton({ onExportDebug }: { onExportDebug?: () => void }) {
  if (!onExportDebug) {
    return null;
  }
  return (
    <button
      type="button"
      className="status-debug"
      title="导出本局完整日志（JSON），用于排查问题"
      onClick={onExportDebug}
    >
      ⛏ 导出日志
    </button>
  );
}

/**
 * 顶部细条（方案 C topbar）：相位 / 轮次 / 真人自己的身份 / 旁观标 + 右侧调试按钮。
 * 玩家名单已移到右列「场上速览」。严格不显示 AI 身份、不显示真相日志（ISO-001）。
 */
export function StatusBar({
  phase,
  participation,
  vi,
  onExportDebug,
  onNewGame,
}: StatusBarProps) {
  const phaseText = phase ? PHASE_LABEL[phase] : "准备中";

  if (!vi) {
    return (
      <header className="status-bar" aria-label="状态栏">
        <span className="status-phase">{phaseText}</span>
        <DebugButton onExportDebug={onExportDebug} />
      </header>
    );
  }

  const isNight = phase === "night_action";
  const roundText = isNight ? `第 ${vi.round.night} 夜` : `第 ${vi.round.day} 天`;
  const spectating = participation && participation !== "alive";

  return (
    <header className="status-bar" aria-label="状态栏">
      <span className="status-phase">{phaseText}</span>
      <span className="status-round">{roundText}</span>
      <span className="status-role">你是：{ROLE_LABEL[vi.ownRole]}</span>
      {spectating ? <span className="status-tag">旁观中</span> : null}
      <NewGameButton onNewGame={onNewGame} />
      <DebugButton onExportDebug={onExportDebug} />
    </header>
  );
}
