import type { GamePhase, VisibleInformationSnapshot } from "../shared";
import { NIGHT_STEP_LABEL, PHASE_LABEL } from "./labels";

/**
 * 桌心铭牌：轮次 + 阶段 + 存活 三合一（顶部状态条的替身，位于舞台上方环带）。
 * 夜晚时阶段位显示 nightStatus 播报（与消息流的「等待XX…」同源，非机密）；
 * 投票中转 vote 蓝灰变体；旁观时缀灰 tag。只读 vi（ISO-001）。
 */
export function TablePlaque({
  phase,
  vi,
  spectating,
}: {
  phase: GamePhase | null;
  vi: VisibleInformationSnapshot;
  spectating: boolean;
}) {
  const isNight = phase === "night_action";
  const roundText = isNight
    ? `第 ${vi.round.night} 夜`
    : vi.round.day > 0
      ? `第 ${vi.round.day} 天`
      : "开局";
  const stepKind = vi.nightStatus?.currentStepKind;
  const phaseText =
    isNight && stepKind
      ? `等待${NIGHT_STEP_LABEL[stepKind]}…`
      : phase
        ? PHASE_LABEL[phase]
        : "准备中";
  const alive = vi.alivePlayers.length;
  const total = alive + vi.deadPlayers.length;
  const voting = phase === "vote" || phase === "tie_vote";

  return (
    <div className={`plaque${voting ? " vote" : ""}`}>
      <span className="pq-round nb">{roundText}</span>
      <span className="pq-phase nb">{phaseText}</span>
      <span className="pq-alive nb">
        存活 {alive}/{total}
      </span>
      {spectating ? <span className="pq-tag nb">旁观中</span> : null}
    </div>
  );
}
