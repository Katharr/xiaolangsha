import { useEffect, useState, type ReactNode } from "react";

import type {
  GameAction,
  GamePhase,
  HumanParticipationState,
  Role,
  VisibleInformationSnapshot,
} from "../shared";

import { ROLE_LABEL } from "./labels";

export type ActionAreaProps = {
  phase: GamePhase | null;
  participation: HumanParticipationState | null;
  vi: VisibleInformationSnapshot | null;
  busy: boolean;
  humanPlayerId: string;
  boardId: string;
  nextKey: (prefix: string) => string;
  act: (action: GameAction) => void;
};

const SETUP_ROLES: Role[] = ["werewolf", "seer", "villager"];

/**
 * 结构化操作区：按 gamePhase × humanParticipationState 渲染当前合法动作按钮，
 * 每个按钮提交带唯一 idempotencyKey 的 GameAction。自由发言/遗言走下方 TextInput，
 * 此处只在那些相位给出提示。所有目标列表来自 vi.legalActions（ISO-001）。
 */
export function ActionArea({
  phase,
  participation,
  vi,
  busy,
  humanPlayerId,
  boardId,
  nextKey,
  act,
}: ActionAreaProps) {
  const [selectedRole, setSelectedRole] = useState<Role>("villager");
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);

  // 相位切换时清掉上一相位残留的目标选择。
  useEffect(() => {
    setSelectedTarget(null);
  }, [phase, vi?.generatedAtSeq]);

  const labelOf = (id: string): string => {
    const found =
      vi?.alivePlayers.find((p) => p.playerId === id) ??
      vi?.deadPlayers.find((p) => p.playerId === id);
    return found ? `${found.name}（${found.seat}号）` : "某玩家";
  };

  const targetButtons = (targets: string[]) => (
    <div className="target-grid">
      {targets.map((id) => (
        <button
          type="button"
          key={id}
          className={selectedTarget === id ? "target selected" : "target"}
          disabled={busy}
          onClick={() => setSelectedTarget(id)}
        >
          {labelOf(id)}
        </button>
      ))}
    </div>
  );

  // 死亡旁观（非复盘）：全程只读，仅提供快进 / 继续旁观。
  if (participation === "dead_spectating" && phase !== "review") {
    return (
      <div className="action-area" aria-label="操作区">
        <p className="action-hint">你已出局，正在旁观。</p>
        <div className="action-row">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              act({
                type: "request_fast_forward",
                idempotencyKey: nextKey("ff"),
                playerId: humanPlayerId,
              })
            }
          >
            快进到结局
          </button>
          <button type="button" disabled={busy}>
            继续旁观
          </button>
        </div>
      </div>
    );
  }

  if (phase === "fast_forwarding" || participation === "fast_forwarded") {
    return (
      <div className="action-area" aria-label="操作区">
        <p className="action-hint">正在自动推进至结局…</p>
      </div>
    );
  }

  const wrap = (children: ReactNode) => (
    <div className="action-area" aria-label="操作区">
      {children}
    </div>
  );

  switch (phase) {
    case null:
    case "mode_select":
      return wrap(
        <div className="action-row">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              act({
                type: "create_game",
                idempotencyKey: nextKey("create"),
                mode: "standard",
                boardId,
                humanPlayerId,
              })
            }
          >
            开始标准局
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              act({
                type: "create_game",
                idempotencyKey: nextKey("create"),
                mode: "free",
                boardId,
                humanPlayerId,
              })
            }
          >
            练习 / 自由局
          </button>
        </div>,
      );

    case "role_setup":
      return wrap(
        <>
          <p className="action-hint">选择你的身份（自由局）：</p>
          <div className="action-row">
            {SETUP_ROLES.map((role) => (
              <button
                type="button"
                key={role}
                className={selectedRole === role ? "target selected" : "target"}
                disabled={busy}
                onClick={() => setSelectedRole(role)}
              >
                {ROLE_LABEL[role]}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              act({
                type: "confirm_role_setup",
                idempotencyKey: nextKey("setup"),
                playerId: humanPlayerId,
                selectedRole,
              })
            }
          >
            确认身份
          </button>
        </>,
      );

    case "role_reveal":
      return wrap(
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            act({
              type: "confirm_role_reveal",
              idempotencyKey: nextKey("reveal"),
              playerId: humanPlayerId,
            })
          }
        >
          确认进入首夜
        </button>,
      );

    case "night_action": {
      const action = vi?.legalActions.find(
        (a) => a.actionType === "werewolf_kill" || a.actionType === "seer_check",
      );
      if (!action || !vi?.canAct) {
        return wrap(<p className="action-hint">天黑请闭眼，等待夜晚行动结算…</p>);
      }
      const verb = action.actionType === "werewolf_kill" ? "击杀" : "查验";
      return wrap(
        <>
          <p className="action-hint">选择今晚要{verb}的目标：</p>
          {targetButtons(action.legalTargets)}
          <button
            type="button"
            disabled={busy || !selectedTarget}
            onClick={() =>
              selectedTarget &&
              act({
                type: "submit_night_action",
                idempotencyKey: nextKey("night"),
                actorId: humanPlayerId,
                actionType: action.actionType as "werewolf_kill" | "seer_check",
                targetId: selectedTarget,
              })
            }
          >
            提交夜晚行动
          </button>
        </>,
      );
    }

    case "day_announcement":
      return wrap(
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            act({
              type: "confirm_day_announcement",
              idempotencyKey: nextKey("day"),
              playerId: humanPlayerId,
            })
          }
        >
          进入发言
        </button>,
      );

    case "day_speech":
      return wrap(
        <p className="action-hint">
          {vi?.canAct
            ? "轮到你发言，请在下方输入。"
            : "等待其他玩家发言…"}
        </p>,
      );

    case "tie_speech":
      return wrap(
        <p className="action-hint">
          {vi?.canAct
            ? "轮到你拉票发言，请在下方输入。"
            : "平票拉票中，等待其他玩家…"}
        </p>,
      );

    case "exile_last_words":
      return wrap(
        <p className="action-hint">
          {vi?.canAct ? "你被放逐，请在下方留下遗言。" : "等待遗言…"}
        </p>,
      );

    case "vote":
    case "tie_vote": {
      const action = vi?.legalActions.find((a) => a.actionType === "vote");
      if (!action || !vi?.canAct) {
        return wrap(<p className="action-hint">等待其他玩家投票…</p>);
      }
      const voteRound = phase === "tie_vote" ? "tie_break" : "first";
      const submitVote = (target: string | null) => {
        if (target) {
          act({
            type: "submit_vote",
            idempotencyKey: nextKey("vote"),
            voterId: humanPlayerId,
            voteRound,
            choiceType: "target",
            targetId: target,
          });
        } else {
          act({
            type: "submit_vote",
            idempotencyKey: nextKey("vote"),
            voterId: humanPlayerId,
            voteRound,
            choiceType: "abstain",
          });
        }
      };
      return wrap(
        <>
          <p className="action-hint">
            {phase === "tie_vote" ? "请进行二次投票：" : "请投票放逐一名玩家："}
          </p>
          {targetButtons(action.legalTargets)}
          <div className="action-row">
            <button
              type="button"
              disabled={busy || !selectedTarget}
              onClick={() => submitVote(selectedTarget)}
            >
              提交投票
            </button>
            {action.allowAbstain ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => submitVote(null)}
              >
                弃票
              </button>
            ) : null}
          </div>
        </>,
      );
    }

    default:
      return wrap(<p className="action-hint">请稍候…</p>);
  }
}
