import {
  DEATH_CAUSE_LABEL,
  FACTION_LABEL,
  NIGHT_STEP_LABEL,
  PHASE_LABEL,
  ROLE_LABEL,
  narrateEvent,
  segmentsToText,
  type AppError,
  type GameSession,
  type GameSnapshot,
  type Player,
  type TruthEvent,
} from "../shared";

import type { DriverHalt, InGameTaskType } from "./driver";

/** 时间线最多保留的事件行数（超长对局只留最近的，避免摘要又变大）。 */
const TIMELINE_MAX_LINES = 80;

export type DebugSummaryInput = {
  exportedAt: string;
  session: GameSession | null;
  snapshot: GameSnapshot | null;
  events: TruthEvent[];
  diagnostics: DriverHalt | null;
  lastError: AppError | null;
};

const TASK_LABEL: Record<InGameTaskType, string> = {
  night_action: "夜晚行动",
  witch_action: "女巫用药",
  hunter_shoot: "猎人开枪",
  speech: "发言",
  vote: "投票",
  tie_speech: "拉票发言",
  last_words: "遗言",
};

const PARTICIPATION_LABEL: Record<string, string> = {
  alive: "存活",
  dead_spectating: "已出局（旁观）",
};

type PlayerMeta = {
  seat: number;
  name: string;
  role: Player["role"];
  faction: Player["faction"];
  controller: Player["controller"];
  isHuman: boolean;
  alive: boolean;
  deathCause?: Player["deathCause"];
};

/**
 * 把整局状态折叠成**复盘式中文摘要**（纯文本），用于离线调试「卡住/没动静」。
 * 含全真相（AI 身份、夜晚密谋、查验结果），但比全量 JSON 小一个量级。纯函数、无副作用。
 */
export function buildDebugSummary(input: DebugSummaryInput): string {
  const { exportedAt, session, snapshot, events, diagnostics, lastError } = input;

  const meta = buildPlayerMeta(snapshot?.players ?? []);
  const labelOf = (id: unknown): string => {
    if (typeof id !== "string") {
      return "某玩家";
    }
    const m = meta.get(id);
    return m ? `${m.seat}号 ${m.name}` : id;
  };

  const lines: string[] = [];
  lines.push("=== 小狼杀 调试摘要 ===");
  lines.push(
    `导出时间：${exportedAt}   对局：${session?.gameId ?? snapshot?.gameId ?? "(无)"}   事件数：${events.length}`,
  );

  // 没有对局快照（入口屏）时给最小信息即可。
  if (!snapshot) {
    lines.push("");
    lines.push("（当前无进行中的对局快照。）");
    lines.push(`自动流程停止原因：${haltText(diagnostics, labelOf)}`);
    lines.push(`最近错误：${errorText(lastError)}`);
    return lines.join("\n");
  }

  // —— 当前状态 ——
  lines.push("");
  lines.push("【当前状态】");
  lines.push(`相位：${PHASE_LABEL[snapshot.gamePhase]}（${roundText(snapshot)}）`);
  lines.push(`真人：${humanLine(meta)}`);
  lines.push(`真人参与态：${PARTICIPATION_LABEL[snapshot.humanParticipationState] ?? snapshot.humanParticipationState}`);
  lines.push(`自动流程停止原因：${haltText(diagnostics, labelOf)}`);
  lines.push(`最近错误：${errorText(lastError)}`);

  // —— 卡点分析 ——
  lines.push("");
  lines.push("【卡点分析】");
  for (const line of stuckAnalysis(snapshot, meta, labelOf)) {
    lines.push(line);
  }

  // —— 身份真相 ——
  lines.push("");
  lines.push("【身份真相】");
  const sorted = [...snapshot.players].sort((a, b) => a.seat - b.seat);
  for (const p of sorted) {
    const who = p.isHuman ? "你" : "AI";
    const alive = p.alive
      ? "存活"
      : `出局·${p.deathCause ? DEATH_CAUSE_LABEL[p.deathCause] : "未知"}`;
    lines.push(
      `${p.seat}号 ${p.name}（${who}）· ${ROLE_LABEL[p.role]} · ${FACTION_LABEL[p.faction]} · ${alive}`,
    );
  }

  // —— 时间线 ——
  lines.push("");
  lines.push("【时间线】");
  const timeline: string[] = [];
  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    const segs = narrateEvent(event);
    if (segs) {
      timeline.push(`[#${event.seq} ${roundTag(event)}] ${segmentsToText(segs, labelOf)}`);
    }
  }
  if (timeline.length > TIMELINE_MAX_LINES) {
    const dropped = timeline.length - TIMELINE_MAX_LINES;
    lines.push(`（前 ${dropped} 条已省略，只显示最近 ${TIMELINE_MAX_LINES} 条）`);
    lines.push(...timeline.slice(-TIMELINE_MAX_LINES));
  } else if (timeline.length === 0) {
    lines.push("（暂无可显示的事件。）");
  } else {
    lines.push(...timeline);
  }

  return lines.join("\n");
}

function buildPlayerMeta(players: Player[]): Map<string, PlayerMeta> {
  const meta = new Map<string, PlayerMeta>();
  for (const p of players) {
    meta.set(p.playerId, {
      seat: p.seat,
      name: p.name,
      role: p.role,
      faction: p.faction,
      controller: p.controller,
      isHuman: p.isHuman,
      alive: p.alive,
      deathCause: p.deathCause,
    });
  }
  return meta;
}

function humanLine(meta: Map<string, PlayerMeta>): string {
  for (const m of meta.values()) {
    if (m.isHuman) {
      return `${m.seat}号 ${m.name} · ${ROLE_LABEL[m.role]} · ${m.alive ? "存活" : "出局"}`;
    }
  }
  return "（本局无真人）";
}

function roundText(snapshot: GameSnapshot): string {
  const { night, day } = snapshot.round;
  return snapshot.gamePhase === "night_action" ? `第 ${night} 夜` : `第 ${day} 天`;
}

function roundTag(event: TruthEvent): string {
  return event.phase === "night_action"
    ? `第${event.round.night}夜`
    : `第${event.round.day}天`;
}

function errorText(error: AppError | null): string {
  if (!error) {
    return "无";
  }
  return `${error.code} ${error.userMessage ?? error.message}`;
}

/** 把 DriverHalt 翻成一句中文；正常(idle/completed)不加 ⚠️。 */
function haltText(
  halt: DriverHalt | null,
  labelOf: (id: unknown) => string,
): string {
  if (!halt) {
    return "（无记录）";
  }
  switch (halt.reason) {
    case "idle":
      return `正常等待真人操作（相位：${PHASE_LABEL[halt.phase]}）`;
    case "completed":
      return "对局已结束";
    case "ai_error":
      return `⚠️ AI 行动失败（行动者 ${labelOf(halt.actorId)}、任务 ${TASK_LABEL[halt.taskType]}）：${halt.error.userMessage ?? halt.error.message}`;
    case "invalid_payload":
      return `⚠️ AI 返回无法执行的动作（行动者 ${labelOf(halt.actorId)}、任务 ${TASK_LABEL[halt.taskType]}）`;
    case "rule_rejected":
      return `⚠️ 规则引擎拒绝动作（${halt.action.type}）：${halt.error.userMessage ?? halt.error.message}`;
    case "max_steps":
      return "⚠️ 达到步数上限（疑似死循环）";
    default:
      return "（未知）";
  }
}

/** 按当前相位列出「在等谁出手」，并标注该玩家是 AI 还是真人——AI 卡住通常即 bug。 */
function stuckAnalysis(
  snapshot: GameSnapshot,
  meta: Map<string, PlayerMeta>,
  labelOf: (id: unknown) => string,
): string[] {
  const who = (id: string): string => {
    const m = meta.get(id);
    if (!m) {
      return labelOf(id);
    }
    return `${m.seat}号 ${m.name}（${m.isHuman ? "真人" : "AI"}·${ROLE_LABEL[m.role]}）`;
  };

  switch (snapshot.gamePhase) {
    case "night_action": {
      const night = snapshot.nightState;
      if (!night) {
        return ["夜晚状态缺失（nightState 为空）。"];
      }
      if (night.resolved) {
        return ["夜晚已结算（等待进入天亮播报）。"];
      }
      const step = night.steps[night.currentStepIndex];
      if (!step) {
        return [
          `夜晚步骤越界：currentStepIndex=${night.currentStepIndex}，共 ${night.steps.length} 步。`,
        ];
      }
      const pending = step.actorIds.filter(
        (id) => !step.submittedActorIds.includes(id),
      );
      const out = [
        `夜晚进行到第 ${night.currentStepIndex + 1}/${night.steps.length} 步：${NIGHT_STEP_LABEL[step.kind]}（未结算）`,
      ];
      if (pending.length > 0) {
        out.push(`等待出手：${pending.map(who).join("、")}  ← 卡在这`);
      } else {
        out.push("本步无待出手者（疑似推进逻辑卡住）。");
      }
      if (step.submittedActorIds.length > 0) {
        out.push(`已提交：${step.submittedActorIds.map(who).join("、")}`);
      }
      return out;
    }

    case "vote":
    case "tie_vote": {
      const vote = snapshot.voteState;
      if (!vote || vote.resolved) {
        return ["投票已结算或状态缺失。"];
      }
      const pending = vote.eligibleVoterIds.filter(
        (id) => !vote.submittedVoterIds.includes(id),
      );
      return pending.length > 0
        ? [`投票未结算，等待：${pending.map(who).join("、")}  ← 卡在这`]
        : ["所有人已投票但未结算（疑似结算逻辑卡住）。"];
    }

    case "hunter_shoot": {
      const id = snapshot.pendingHunterId ?? snapshot.pendingAction?.actorId;
      return id ? [`等待猎人 ${who(id)} 开枪。`] : ["等待猎人开枪（未找到 pendingHunterId）。"];
    }

    case "day_announcement":
      return ["等待确认天亮播报（真人存活时由真人点「进入发言」）。"];

    case "day_speech":
    case "tie_speech":
    case "exile_last_words": {
      const id = snapshot.pendingAction?.actorId;
      return id
        ? [`等待 ${who(id)} ${PHASE_LABEL[snapshot.gamePhase]}。`]
        : [`${PHASE_LABEL[snapshot.gamePhase]} 无 pendingAction（疑似卡住）。`];
    }

    default: {
      const id = snapshot.pendingAction?.actorId;
      return id
        ? [`等待 ${who(id)} 操作（${PHASE_LABEL[snapshot.gamePhase]}）。`]
        : [`当前相位 ${PHASE_LABEL[snapshot.gamePhase]}，无明显卡点。`];
    }
  }
}
