import { useEffect, useState, type ReactNode } from "react";

import { getBoardConfig } from "../rules";
import type {
  GameAction,
  GamePhase,
  HumanParticipationState,
  Role,
  VisibleInformationSnapshot,
} from "../shared";

import { NIGHT_STEP_LABEL, ROLE_LABEL } from "./labels";
import { SpeechCoachCard } from "./SpeechCoachCard";

/** 女巫从自己的私有 witch_wake 事件里读出今晚被刀者与解药/毒药剩余。 */
type WitchWake = {
  killedTargetId: string | null;
  saveAvailable: boolean;
  poisonAvailable: boolean;
};

function readWitchWake(vi: VisibleInformationSnapshot | null): WitchWake | null {
  if (!vi) {
    return null;
  }
  for (const event of [...vi.privateEvents].reverse()) {
    const result = event.payload.result as
      | {
          kind?: unknown;
          killedTargetId?: unknown;
          saveAvailable?: unknown;
          poisonAvailable?: unknown;
        }
      | undefined;
    if (result && result.kind === "witch_wake") {
      return {
        killedTargetId:
          typeof result.killedTargetId === "string" ? result.killedTargetId : null,
        saveAvailable: result.saveAvailable === true,
        poisonAvailable: result.poisonAvailable === true,
      };
    }
  }
  return null;
}

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

const DEFAULT_SETUP_ROLES: Role[] = ["werewolf", "seer", "villager"];

type WitchMode = "save" | "poison" | "skip";

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
  const [witchMode, setWitchMode] = useState<WitchMode | null>(null);

  // 相位切换时清掉上一相位残留的目标 / 女巫用药选择。
  useEffect(() => {
    setSelectedTarget(null);
    setWitchMode(null);
  }, [phase, vi?.generatedAtSeq]);

  // 自由局身份选择列表来自当前板（去重）；无板时退回默认三选一。
  const setupRoles: Role[] = (() => {
    const board = getBoardConfig(boardId);
    return board ? [...new Set(board.roles)] : DEFAULT_SETUP_ROLES;
  })();

  const labelOf = (id: string): string => {
    const found =
      vi?.alivePlayers.find((p) => p.playerId === id) ??
      vi?.deadPlayers.find((p) => p.playerId === id);
    return found ? `${found.name}（${found.seat}号）` : "某玩家";
  };

  const seatOf = (id: string): number | undefined =>
    (
      vi?.alivePlayers.find((p) => p.playerId === id) ??
      vi?.deadPlayers.find((p) => p.playerId === id)
    )?.seat;

  // data-aim：hover 时联动牌桌对应座位的金色瞄准环（纯空间对齐，零新增信息）。
  const targetButtons = (targets: string[]) => (
    <div className="target-grid">
      {targets.map((id) => (
        <button
          type="button"
          key={id}
          className={selectedTarget === id ? "target selected" : "target"}
          disabled={busy}
          data-aim={seatOf(id)}
          onClick={() => setSelectedTarget(id)}
        >
          {labelOf(id)}
        </button>
      ))}
    </div>
  );

  // 死亡旁观（非复盘）：全程只读。对局由 AI 自动打到结束，真人可静候到结局复盘，
  // 也可随时直接重开一局（按钮不受 busy 禁用，方便观战途中立即开新局）。
  if (participation === "dead_spectating" && phase !== "review") {
    return (
      <div className="action-area" aria-label="操作区">
        <p className="action-hint">
          你已出局，正在旁观。对局将自动进行，结束后可查看复盘。
        </p>
        <div className="action-row">
          <button
            type="button"
            onClick={() =>
              act({
                type: "confirm_new_game",
                idempotencyKey: nextKey("newgame"),
                playerId: humanPlayerId,
              })
            }
          >
            直接重开一局
          </button>
        </div>
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
            {setupRoles.map((role) => (
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
      const action = vi?.legalActions[0];
      if (!action || !vi?.canAct) {
        const stepKind = vi?.nightStatus?.currentStepKind;
        const waitingFor = stepKind ? NIGHT_STEP_LABEL[stepKind] : null;
        return wrap(
          <p className="action-hint">
            {waitingFor
              ? `天黑请闭眼，主持人正在等待${waitingFor}…`
              : "天黑请闭眼，等待夜晚行动结算…"}
          </p>,
        );
      }

      // 女巫：读 witch_wake 私有事件得知被刀者，三选一（救 X / 毒谁 / 放弃）。
      if (action.actionType === "witch_action") {
        const wake = readWitchWake(vi);
        const killed = wake?.killedTargetId ?? null;
        // 首夜自救受板规限制：被刀者是自己且为首夜时不提供解药（与规则层一致）。
        const selfSaveFirstNight =
          killed !== null && killed === vi.viewerId && vi.round.night === 1;
        const canSave = Boolean(killed) && wake?.saveAvailable === true && !selfSaveFirstNight;
        const canPoison = wake?.poisonAvailable === true;

        const submitWitch = () => {
          if (witchMode === "save") {
            act({
              type: "submit_witch_action",
              idempotencyKey: nextKey("witch"),
              actorId: humanPlayerId,
              witchChoice: "save",
            });
          } else if (witchMode === "poison" && selectedTarget) {
            act({
              type: "submit_witch_action",
              idempotencyKey: nextKey("witch"),
              actorId: humanPlayerId,
              witchChoice: "poison",
              targetId: selectedTarget,
            });
          } else if (witchMode === "skip") {
            act({
              type: "submit_witch_action",
              idempotencyKey: nextKey("witch"),
              actorId: humanPlayerId,
              witchChoice: "skip",
            });
          }
        };

        const submitDisabled =
          busy ||
          witchMode === null ||
          (witchMode === "poison" && !selectedTarget);

        return wrap(
          <>
            <p className="action-hint">
              {killed
                ? `今晚 ${labelOf(killed)} 倒牌了。你是女巫，请决定用药：`
                : "今晚无人被狼人击杀。你是女巫，请决定用药："}
            </p>
            <div className="action-row">
              {canSave ? (
                <button
                  type="button"
                  className={witchMode === "save" ? "target selected" : "target"}
                  disabled={busy}
                  onClick={() => {
                    setWitchMode("save");
                    setSelectedTarget(null);
                  }}
                >
                  用解药救{killed ? labelOf(killed) : ""}
                </button>
              ) : null}
              {canPoison ? (
                <button
                  type="button"
                  className={witchMode === "poison" ? "target selected" : "target"}
                  disabled={busy}
                  onClick={() => {
                    setWitchMode("poison");
                    setSelectedTarget(null);
                  }}
                >
                  用毒药毒人
                </button>
              ) : null}
              <button
                type="button"
                className={witchMode === "skip" ? "target selected" : "target"}
                disabled={busy}
                onClick={() => {
                  setWitchMode("skip");
                  setSelectedTarget(null);
                }}
              >
                不使用
              </button>
            </div>
            {witchMode === "poison" ? (
              <>
                <p className="action-hint">选择要毒杀的目标：</p>
                {targetButtons(action.legalTargets)}
              </>
            ) : null}
            <button type="button" disabled={submitDisabled} onClick={submitWitch}>
              确认用药
            </button>
          </>,
        );
      }

      // 守卫 / 狼人 / 预言家：单目标 + 提交 submit_night_action。
      const nightActionType = action.actionType as
        | "werewolf_kill"
        | "seer_check"
        | "guard_protect";
      const verb =
        nightActionType === "werewolf_kill"
          ? "击杀"
          : nightActionType === "seer_check"
            ? "查验"
            : "守护";
      const teammates = vi.teammates ?? [];
      const isWolfKill = nightActionType === "werewolf_kill";
      return wrap(
        <>
          {isWolfKill && teammates.length > 0 ? (
            <p className="action-hint">
              你的狼队友：
              {teammates
                .map((t) => `${t.name}（${t.seat}号，${t.alive ? "存活" : "已出局"}）`)
                .join("、")}
              。今晚的刀由狼队共同投票决定，平票时按你的选择来。
            </p>
          ) : null}
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
                actionType: nightActionType,
                targetId: selectedTarget,
              })
            }
          >
            提交夜晚行动
          </button>
        </>,
      );
    }

    case "hunter_shoot": {
      const action = vi?.legalActions.find((a) => a.actionType === "hunter_shoot");
      if (!action || !vi?.canAct) {
        return wrap(<p className="action-hint">等待猎人开枪…</p>);
      }
      return wrap(
        <>
          <p className="action-hint">你是猎人，可开枪带走一名玩家（也可放弃）：</p>
          {targetButtons(action.legalTargets)}
          <div className="action-row">
            <button
              type="button"
              disabled={busy || !selectedTarget}
              onClick={() =>
                selectedTarget &&
                act({
                  type: "submit_hunter_shoot",
                  idempotencyKey: nextKey("hunter"),
                  actorId: humanPlayerId,
                  targetId: selectedTarget,
                })
              }
            >
              开枪
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                act({
                  type: "submit_hunter_shoot",
                  idempotencyKey: nextKey("hunter"),
                  actorId: humanPlayerId,
                })
              }
            >
              不开枪
            </button>
          </div>
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
        <>
          <p className="action-hint">
            {vi?.canAct
              ? "轮到你发言，请在下方输入。"
              : "等待其他玩家发言…"}
          </p>
          {vi?.canAct ? (
            <SpeechCoachCard role={vi.ownRole} day={vi.round.day} />
          ) : null}
        </>,
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
      const voteRound = phase === "tie_vote" ? "tie_break" : "first";
      if (!action || !vi?.canAct) {
        // 已投出：蓝灰确认条——投票期间全页唯一出现「你投了谁」的地方（保密口径）。
        const myVote = vi?.votes.find(
          (v) =>
            v.day === vi.round.day &&
            v.voteRound === voteRound &&
            v.voterId === humanPlayerId,
        );
        if (myVote) {
          return wrap(
            <div className="vote-confirm">
              <span className="vc-main nb">
                ✓ 已投出：
                {myVote.choiceType === "abstain"
                  ? "弃票"
                  : labelOf(myVote.targetId ?? "")}
                （暗投，开票时公示）
              </span>
              <span className="vc-sub nb">
                等待其他玩家投票… 你的票只有你自己可见
              </span>
            </div>,
          );
        }
        return wrap(<p className="action-hint">等待其他玩家投票…</p>);
      }
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
