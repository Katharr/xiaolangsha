import type { Result, VisibleInformationSnapshot } from "../shared";
import { ok } from "../shared";

import type { AiClient, AiTaskPayload, AiTaskRequest } from "./types";

/**
 * 确定性脚本兜底 AI。
 *
 * 纪律（ISO-001）：只读传入的 `VisibleInformationSnapshot`（局中任务）或
 * `reviewContext`（复盘），绝不接触完整真相。所有输出都是**合法**的
 * `AiTaskPayload`，且 `respond` 恒返回 `ok(...)`——这是「LLM 全挂时游戏照样跑完」
 * 的保证。决策按 `gameId+seq+playerId+taskType` 播种，重放完全可复现。
 */
export class ScriptedAiClient implements AiClient {
  async respond(req: AiTaskRequest): Promise<Result<AiTaskPayload>> {
    if (req.taskType === "review_question") {
      return ok({
        text: `（脚本AI复盘）关于「${req.questionText}」：根据已公开的记录，本局胜负已定，更细节的推理可回看上方真相日志。`,
      });
    }

    const vi = req.visibleInformation;
    const seed = `${vi.gameId}:${vi.generatedAtSeq}:${req.playerId}:${req.taskType}`;

    switch (req.taskType) {
      case "night_action":
        return ok(decideNightAction(vi, seed));
      case "vote":
        return ok(decideVote(vi, seed));
      case "speech":
        return ok({ text: composeSpeech(vi) });
      case "tie_speech":
        return ok({ text: composeTieSpeech(vi) });
      case "last_words":
        return ok({ text: composeLastWords(vi) });
      default:
        // 类型上不可达；保底返回空发言而非抛错。
        return ok({ text: "（脚本AI）我暂时没有更多要补充的。" });
    }
  }
}

function decideNightAction(
  vi: VisibleInformationSnapshot,
  seed: string,
): AiTaskPayload {
  const action = vi.legalActions.find(
    (legal) =>
      legal.actionType === "werewolf_kill" || legal.actionType === "seer_check",
  );

  if (!action) {
    return {};
  }

  const targetId = pickSeeded(action.legalTargets, seed);
  return {
    actionType: action.actionType as "werewolf_kill" | "seer_check",
    ...(targetId ? { targetId } : {}),
  };
}

function decideVote(
  vi: VisibleInformationSnapshot,
  seed: string,
): AiTaskPayload {
  const action = vi.legalActions.find((legal) => legal.actionType === "vote");

  if (!action) {
    return { choiceType: "abstain" };
  }

  const candidates = action.legalTargets;

  // 预言家可凭自己的私有查验结果锁定已知狼人（若该狼仍是候选）。
  if (vi.ownRole === "seer") {
    const knownWolf = findKnownWerewolf(vi, candidates);
    if (knownWolf) {
      return { choiceType: "target", targetId: knownWolf };
    }
  }

  const targetId = pickSeeded(candidates, seed);
  if (!targetId) {
    return action.allowAbstain
      ? { choiceType: "abstain" }
      : { choiceType: "target" };
  }

  return { choiceType: "target", targetId };
}

/** 扫描预言家自己的私有事件，找出已查验为狼且仍在候选里的目标。 */
function findKnownWerewolf(
  vi: VisibleInformationSnapshot,
  candidates: string[],
): string | undefined {
  for (const event of vi.privateEvents) {
    const result = event.payload.result as
      | { kind?: unknown; targetId?: unknown; factionResult?: unknown }
      | undefined;
    if (
      result &&
      result.kind === "seer_check_result" &&
      result.factionResult === "werewolf_team" &&
      typeof result.targetId === "string" &&
      candidates.includes(result.targetId)
    ) {
      return result.targetId;
    }
  }
  return undefined;
}

function composeSpeech(vi: VisibleInformationSnapshot): string {
  return `（${vi.ownSeat}号）我先发言。目前公开信息还不足以下定论，我会继续观察各位的表态再判断谁更可疑。`;
}

function composeTieSpeech(vi: VisibleInformationSnapshot): string {
  return `（${vi.ownSeat}号）出现平票，我重申一下立场，请大家在二次投票时慎重选择。`;
}

function composeLastWords(vi: VisibleInformationSnapshot): string {
  return `（${vi.ownSeat}号）我被放逐了，把后续交给还活着的各位，请尽快找出真正的狼人。`;
}

/** FNV-1a 字符串哈希，纯函数、跨平台一致。 */
function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** 按种子从候选中确定性挑一个；空数组返回 undefined。 */
function pickSeeded<T>(items: T[], seed: string): T | undefined {
  if (items.length === 0) {
    return undefined;
  }
  return items[hashString(seed) % items.length];
}
