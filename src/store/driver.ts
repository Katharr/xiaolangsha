import type { AiClient, AiTaskPayload, AiTaskRequest } from "../ai-client";
import { applyAction, buildVisibleInformation } from "../rules";
import type {
  ActiveVoteRound,
  AppError,
  GameAction,
  GameSession,
  GameSnapshot,
  TruthEvent,
  VisibleInformationSnapshot,
} from "../shared";

const MAX_SPEECH_LENGTH = 500;
const DEFAULT_MAX_STEPS = 300;

/** 局中（非复盘）AI 任务类型——driver 只产出这些。 */
export type InGameTaskType =
  | "night_action"
  | "witch_action"
  | "hunter_shoot"
  | "speech"
  | "vote"
  | "tie_speech"
  | "last_words";

/** driver 持有的三件套，与规则引擎成功结果同形。 */
export type DriverState = {
  session: GameSession;
  snapshot: GameSnapshot;
  events: TruthEvent[];
};

/**
 * 下一步驱动动作：
 * - `ai`：某个 AI 玩家需要经 LLM/脚本决策。
 * - `auto_confirm_day`：真人已死且在快进中，由 driver 代为确认天亮播报，避免死锁。
 */
export type DriverStep =
  | { kind: "ai"; actorId: string; taskType: InGameTaskType }
  | { kind: "auto_confirm_day"; playerId: string };

/**
 * 自动轮转循环停下的原因（诊断用，进调试日志 / 触发提示）：
 * - `idle`：正常停在某相位等真人操作（不是 bug）。
 * - `completed`：对局已结束。
 * - `ai_error`/`invalid_payload`/`rule_rejected`/`max_steps`：异常停止，流程没法自动往下走，
 *   这正是「卡住、没动静」的根因，应提示用户导出日志。
 */
export type DriverHalt =
  | { reason: "idle"; phase: GameSnapshot["gamePhase"] }
  | { reason: "completed" }
  | {
      reason: "ai_error";
      actorId: string;
      taskType: InGameTaskType;
      error: AppError;
    }
  | { reason: "invalid_payload"; actorId: string; taskType: InGameTaskType }
  | { reason: "rule_rejected"; action: GameAction; error: AppError }
  | { reason: "max_steps" };

/** halt.reason 是否属于「异常卡住」（需要提示用户 / 值得排查）。 */
export function isAbnormalHalt(halt: DriverHalt | null): boolean {
  return (
    halt !== null &&
    halt.reason !== "idle" &&
    halt.reason !== "completed"
  );
}

/**
 * 根据当前快照决定 driver 下一步要替谁出手；返回 null 表示该停（轮到真人、
 * 真人已死但未快进、或已到终局/设置阶段）。投票与夜晚是并行模型——按未提交者挑第一个 AI。
 */
export function nextDriverStep(
  state: DriverState,
  humanPlayerId: string,
): DriverStep | null {
  const { snapshot, session } = state;

  if (session.status === "ended") {
    return null;
  }

  const playerById = (id: string) =>
    snapshot.players.find((player) => player.playerId === id);
  const isFastForward = snapshot.humanParticipationState === "fast_forwarded";

  switch (snapshot.gamePhase) {
    case "night_action": {
      const nightState = snapshot.nightState;
      if (!nightState || nightState.resolved) {
        return null;
      }
      const step = nightState.steps[nightState.currentStepIndex];
      if (!step) {
        return null;
      }
      const actorId = step.actorIds.find(
        (id) =>
          !step.submittedActorIds.includes(id) &&
          Boolean(playerById(id)?.alive),
      );
      if (!actorId) {
        return null;
      }
      const player = playerById(actorId);
      if (!player || player.controller !== "ai") {
        return null; // 轮到真人行动，停下等 UI。
      }
      const taskType: InGameTaskType =
        step.kind === "witch_action" ? "witch_action" : "night_action";
      return { kind: "ai", actorId, taskType };
    }

    case "hunter_shoot": {
      const actorId = snapshot.pendingAction?.actorId;
      if (!actorId) {
        return null;
      }
      const player = playerById(actorId);
      if (!player) {
        return null;
      }
      // AI 猎人自动开枪；真人猎人由 UI 决定，除非真人已死且正在快进。
      if (player.controller === "ai" || isFastForward) {
        return { kind: "ai", actorId, taskType: "hunter_shoot" };
      }
      return null;
    }

    case "day_announcement": {
      // 真人存活时由真人在 UI 确认；只有真人已死并选择快进时 driver 代为确认。
      return isFastForward
        ? { kind: "auto_confirm_day", playerId: humanPlayerId }
        : null;
    }

    case "day_speech":
    case "tie_speech":
    case "exile_last_words": {
      const actorId = snapshot.pendingAction?.actorId;
      if (!actorId) {
        return null;
      }
      const player = playerById(actorId);
      if (!player || player.controller !== "ai") {
        return null; // 轮到真人，停下等 UI。
      }
      const taskType = taskTypeForPhase(snapshot.gamePhase);
      return taskType ? { kind: "ai", actorId, taskType } : null;
    }

    case "vote":
    case "tie_vote": {
      const voteState = snapshot.voteState;
      if (!voteState || voteState.resolved) {
        return null;
      }
      const aiVoter = voteState.eligibleVoterIds.find((id) => {
        if (voteState.submittedVoterIds.includes(id)) {
          return false;
        }
        const player = playerById(id);
        return Boolean(player && player.controller === "ai" && player.alive);
      });
      return aiVoter ? { kind: "ai", actorId: aiVoter, taskType: "vote" } : null;
    }

    default:
      // mode_select / role_setup / role_reveal / fast_forwarding / review：driver 不介入。
      return null;
  }
}

export function taskTypeForPhase(
  phase: GameSnapshot["gamePhase"],
): InGameTaskType | null {
  switch (phase) {
    case "night_action":
      return "night_action";
    case "day_speech":
      return "speech";
    case "tie_speech":
      return "tie_speech";
    case "exile_last_words":
      return "last_words";
    case "vote":
    case "tie_vote":
      return "vote";
    default:
      return null;
  }
}

/** 仅含 visibleInformation 的请求——物理上无法泄露超出该 AI 可见的真相（ISO-001）。 */
function buildRequest(
  step: Extract<DriverStep, { kind: "ai" }>,
  visibleInformation: VisibleInformationSnapshot,
  gameId: string,
): AiTaskRequest {
  return {
    gameId,
    taskType: step.taskType,
    playerId: step.actorId,
    visibleInformation,
  };
}

/** 把 AI 返回的载荷转成合法 GameAction；无法构造合法动作时返回 null（由调用方停止）。 */
export function payloadToAction(params: {
  step: Extract<DriverStep, { kind: "ai" }>;
  payload: AiTaskPayload;
  snapshot: GameSnapshot;
  idempotencyKey: string;
}): GameAction | null {
  const { step, payload, snapshot, idempotencyKey } = params;

  switch (step.taskType) {
    case "night_action": {
      const actor = snapshot.players.find(
        (player) => player.playerId === step.actorId,
      );
      const actionType =
        payload.actionType ??
        (actor?.role === "werewolf"
          ? "werewolf_kill"
          : actor?.role === "seer"
            ? "seer_check"
            : actor?.role === "guard"
              ? "guard_protect"
              : undefined);
      if (!actionType) {
        return null;
      }
      return {
        type: "submit_night_action",
        idempotencyKey,
        actorId: step.actorId,
        actionType,
        ...(payload.targetId ? { targetId: payload.targetId } : {}),
      };
    }

    case "witch_action":
      return {
        type: "submit_witch_action",
        idempotencyKey,
        actorId: step.actorId,
        witchChoice: payload.witchChoice ?? "skip",
        ...(payload.targetId ? { targetId: payload.targetId } : {}),
      };

    case "hunter_shoot":
      return {
        type: "submit_hunter_shoot",
        idempotencyKey,
        actorId: step.actorId,
        ...(payload.targetId ? { targetId: payload.targetId } : {}),
      };

    case "speech":
      return {
        type: "submit_speech",
        idempotencyKey,
        speakerId: step.actorId,
        text: clampText(payload.text, "（无发言）"),
      };

    case "tie_speech":
      return {
        type: "submit_tie_speech",
        idempotencyKey,
        speakerId: step.actorId,
        text: clampText(payload.text, "（无发言）"),
      };

    case "last_words":
      return {
        type: "submit_last_words",
        idempotencyKey,
        speakerId: step.actorId,
        text: clampText(payload.text, "（无遗言）"),
      };

    case "vote": {
      const voteRound: ActiveVoteRound =
        snapshot.gamePhase === "tie_vote" ? "tie_break" : "first";
      const choiceType = payload.choiceType ?? "target";
      if (choiceType === "abstain") {
        return {
          type: "submit_vote",
          idempotencyKey,
          voterId: step.actorId,
          voteRound,
          choiceType: "abstain",
        };
      }
      if (!payload.targetId) {
        return null;
      }
      return {
        type: "submit_vote",
        idempotencyKey,
        voterId: step.actorId,
        voteRound,
        choiceType: "target",
        targetId: payload.targetId,
      };
    }

    default:
      return null;
  }
}

export type DriverOptions = {
  ai: AiClient;
  humanPlayerId: string;
  /** 固定字符串（测试用确定性 now）或每步取一次的时钟函数（真实运行）。 */
  now: string | (() => string);
  onStep?: (state: DriverState) => void | Promise<void>;
  /** 在调用某个 AI 的 `respond` 之前触发，供 UI 显示「谁在思考」。 */
  onActorThinking?: (info: {
    actorId: string;
    taskType: InGameTaskType;
  }) => void;
  /** 循环结束时回报停下的原因（诊断用：正常等真人 / 还是异常卡住）。 */
  onHalt?: (halt: DriverHalt) => void;
  /** 防御性步数上限，避免规则/AI 异常造成死循环。 */
  maxSteps?: number;
};

/**
 * 自动轮转循环：反复替 AI（及快进时的天亮确认）出手，直到轮到真人、真人已死未快进、
 * 或到达 review/终局。每步都走规则引擎 `applyAction`，规则拒绝即停（防死循环）。
 */
export async function runAiDriver(
  initial: DriverState,
  options: DriverOptions,
): Promise<DriverState> {
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  let state = initial;
  // 默认假设跑满步数上限；任一 break 都会把它改写成真实原因。
  let halt: DriverHalt = { reason: "max_steps" };

  for (let stepCount = 0; stepCount < maxSteps; stepCount += 1) {
    const step = nextDriverStep(state, options.humanPlayerId);
    if (!step) {
      halt =
        state.session.status === "ended"
          ? { reason: "completed" }
          : { reason: "idle", phase: state.snapshot.gamePhase };
      break;
    }

    const now =
      typeof options.now === "function" ? options.now() : options.now;
    const seq = state.snapshot.lastEventSeq;
    let action: GameAction | null;

    if (step.kind === "auto_confirm_day") {
      action = {
        type: "confirm_day_announcement",
        idempotencyKey: `${state.snapshot.gameId}-drv-confirm-day-${seq}`,
        playerId: step.playerId,
      };
    } else {
      const visibleInformation = buildVisibleInformation(
        step.actorId,
        state.snapshot,
        state.events,
      );
      const request = buildRequest(
        step,
        visibleInformation,
        state.snapshot.gameId,
      );
      options.onActorThinking?.({
        actorId: step.actorId,
        taskType: step.taskType,
      });
      const response = await options.ai.respond(request);
      if (!response.ok) {
        // withFallback 应保证有兜底；万一仍失败，停下避免死循环。
        halt = {
          reason: "ai_error",
          actorId: step.actorId,
          taskType: step.taskType,
          error: response.error,
        };
        break;
      }
      action = payloadToAction({
        step,
        payload: response.data,
        snapshot: state.snapshot,
        idempotencyKey: `${state.snapshot.gameId}-drv-${step.actorId}-${step.taskType}-${seq}`,
      });
    }

    if (!action) {
      halt =
        step.kind === "ai"
          ? {
              reason: "invalid_payload",
              actorId: step.actorId,
              taskType: step.taskType,
            }
          : { reason: "idle", phase: state.snapshot.gamePhase };
      break;
    }

    const result = applyAction(action, {
      session: state.session,
      snapshot: state.snapshot,
      events: state.events,
      now,
    });
    if (!result.ok) {
      halt = { reason: "rule_rejected", action, error: result.error };
      break;
    }

    state = {
      session: result.data.session,
      snapshot: result.data.snapshot,
      events: [...state.events, ...result.data.events],
    };

    await options.onStep?.(state);
  }

  options.onHalt?.(halt);
  return state;
}

function clampText(text: string | undefined, fallback: string): string {
  const trimmed = (text ?? "").trim();
  if (trimmed.length === 0) {
    return fallback;
  }
  return trimmed.length > MAX_SPEECH_LENGTH
    ? trimmed.slice(0, MAX_SPEECH_LENGTH)
    : trimmed;
}
