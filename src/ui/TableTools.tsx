/**
 * 牌桌左下角幽灵圆钮组：❔图例 / 重开新局 / 导出日志（原顶部状态条按钮的归宿）。
 * 复盘态无牌桌，但 ReviewPanel 自带「开始新局」、halt-banner 内嵌导出按钮兜底。
 */
export function TableTools({
  onToggleLegend,
  legendRemind,
  onNewGame,
  onExportDebug,
}: {
  onToggleLegend: () => void;
  legendRemind: boolean;
  onNewGame: () => void;
  onExportDebug: () => void;
}) {
  return (
    <div className="tbl-tools">
      <button
        type="button"
        className={`tool-btn${legendRemind ? " remind" : ""}`}
        title="桌面标记图例"
        aria-label="桌面标记图例"
        onClick={onToggleLegend}
      >
        ?
      </button>
      <button
        type="button"
        className="tool-btn"
        title="重开新局"
        aria-label="重开新局"
        onClick={onNewGame}
      >
        ↺
      </button>
      <button
        type="button"
        className="tool-btn"
        title="导出日志"
        aria-label="导出日志"
        onClick={onExportDebug}
      >
        ⛏
      </button>
    </div>
  );
}
