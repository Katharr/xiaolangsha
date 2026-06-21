/**
 * L5 任务（瘦身版）：每个 taskType 只留「这一步具体做什么」的动作纪律 + 合法目标洗牌。
 * 判读知识在 L2/L3，这里不重复；发言纪律（短、口语、别复述）放最后、离输出最近、权重最高。
 */
import type { VisibleInformationSnapshot } from "../../shared";

export type InGameTaskType =
  | "speech"
  | "night_action"
  | "witch_action"
  | "hunter_shoot"
  | "vote"
  | "tie_speech"
  | "last_words";

/**
 * 候选目标去偏见洗牌：对副本做确定性 Fisher-Yates（种子=gameId+generatedAtSeq+ownSeat），
 * 避免模型按列表首尾锚定。**绝不改 vi 本身**（user 段仍精确等于 vi 序列化，守 ISO 测试）。
 */
export function shuffledTargets(
  targets: string[],
  vi: VisibleInformationSnapshot,
): string[] {
  const seed = `${vi.gameId}#${vi.generatedAtSeq}#${vi.ownSeat}`;
  // FNV-1a 把种子串压成 32 位整数。
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // xorshift32 作为确定性 PRNG。
  let state = hash >>> 0 || 1;
  const nextInt = (): number => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state >>> 0;
  };
  const copy = targets.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = nextInt() % (i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function task(taskType: InGameTaskType, vi: VisibleInformationSnapshot): string {
  const legalTargets = vi.legalActions.flatMap((action) => action.legalTargets);
  const orderedTargets = legalTargets.length > 0 ? shuffledTargets(legalTargets, vi) : [];
  const targetsHint =
    orderedTargets.length > 0
      ? `合法目标 id：${orderedTargets.join("、")}。（顺序随机排的，不代表任何倾向，别按排序先后选人。）`
      : "当前没有可选目标。";

  switch (taskType) {
    case "night_action": {
      const wolfTeamNote =
        vi.ownRole === "werewolf" && vi.teammates.length > 0
          ? "狼刀由狼队投票决定，尽量和队友刀同一个人，别把刀票浪费在队友身上。"
          : "";
      return [
        "夜晚行动：按你的身份选 actionType（狼=werewolf_kill，预言家=seer_check，守卫=guard_protect）并给 targetId。",
        wolfTeamNote,
        targetsHint,
      ]
        .filter((line) => line.length > 0)
        .join("\n");
    }
    case "witch_action":
      return [
        "女巫行动：你已得知今晚被刀的人。决定 witchChoice——save 救他 / poison 配 targetId 毒一人 / skip 放弃；解药、毒药各只一次。",
        "用毒要有指向某个具体人的依据（发言破绽、票型、对跳、公开查杀）；说不出具体理由就 skip 把毒留着，别盲毒、也别因为「得做点什么」乱毒；已被坐实的狼就果断毒。",
        targetsHint,
      ].join("\n");
    case "hunter_shoot":
      return `你是猎人且已出局，可开枪带走一名存活玩家：想清楚带走谁最有利，给 targetId 开枪，或留空放弃。${targetsHint}`;
    case "vote":
      return [
        "投票放逐：暗投，你看不到别人投了谁，就按自己的判断投最该走的那个、别挑场上最软的柿子。",
        `choiceType="target" 配 targetId 投一票，或允许时 choiceType="abstain" 弃票；不能投自己。${targetsHint}`,
      ].join("\n");
    case "speech":
      return "轮到你发言（只填 text）：用你自己的口气说一两句大白话，给出你自己的独立判断（信谁/疑谁）；别附和或复述前面人已经说过的话，选怀疑对象只看发言逻辑、别按发言顺序或座位顺序锚定人；像真人那样自然，别长篇、别念分析报告。";
    case "tie_speech":
      return "平票了，再争取一下选票：用聊天口气简短重申你的立场（和之前判断一致），别念稿（只填 text，越短越好）。";
    case "last_words":
      return "你被放逐了，留几句遗言：像真人那样自然说几句心里话即可，别长篇（只填 text）。";
    default:
      return "请根据可见信息给出合理输出。";
  }
}
