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
  // 目标 id 必须同时标注座位号+名字：playerId 的数字后缀和座位号无关，只列 id 会让模型
  // 「想投5号」却填错人。
  const targetLabel = (id: string): string => {
    const player = vi.alivePlayers.find((p) => p.playerId === id);
    return player ? `${id}=${player.seat}号·${player.name}` : id;
  };
  const legalTargets = vi.legalActions.flatMap((action) => action.legalTargets);
  const orderedTargets = legalTargets.length > 0 ? shuffledTargets(legalTargets, vi) : [];
  const targetsHint =
    orderedTargets.length > 0
      ? `合法目标（targetId 填等号左边的 id）：${orderedTargets.map(targetLabel).join("、")}。（顺序随机排的，不代表任何倾向，别按排序先后选人。）`
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
    case "vote": {
      // 把自己本轮发言原文直接拎出来回显：靠模型自己去 vi.speeches 大数组里捞太不可靠，
      // 是「嘴上怀疑7号、票投5号」言行不一的机械成因。
      const ownSpeech = vi.speeches
        .filter(
          (s) =>
            s.speakerId === vi.viewerId &&
            s.day === vi.round.day &&
            (s.speechKind === "day_speech" || s.speechKind === "tie_speech"),
        )
        .at(-1);
      const consistencyLine = ownSpeech
        ? `你这一轮发言的原文：「${ownSpeech.text}」——你在里面点名怀疑谁，票就投谁；除非发言之后出了新信息让你改判，否则别临时改投别人——尤其别投你刚说过要相信、要保护、或是好人的人，那样言行不一。`
        : "先回看你自己这一轮的发言点名怀疑的是谁，就把票投给那个人；除非这一轮出了新信息让你改判，否则别临时改投别人——尤其别投你刚说过要相信、要保护、或是好人的人，那样言行不一。";
      return [
        "投票放逐：暗投，你看不到别人投了谁，就按自己的判断投最该走的那个、别挑场上最软的柿子。",
        consistencyLine,
        `choiceType="target" 配 targetId 投一票，或允许时 choiceType="abstain" 弃票；不能投自己。${targetsHint}`,
      ].join("\n");
    }
    case "speech":
      return [
        "轮到你发言（只填 text）：就像在微信群里接着聊——挑这一轮你最在意的那一点说就行，可以回应某个人、附和、抬杠、吐个槽，或者只甩一句自己的态度；不用面面俱到、不用每个人都回应，也不用每次都先报「我回应谁」。",
        "按你自己的判断倾向说，别人讲过的别换个说法复读一遍；想到啥说啥，带上你自己的口气、情绪和口头禅，没把握就照实说「我也说不准，就觉得…」，挑谁也只看发言、别按座位顺序。",
        "一两句、像真人那样自然就行，别凑长、别念分析报告。",
      ].join("\n");
    case "tie_speech":
      return "平票了，再争取一下选票：用聊天口气简短重申你的立场（和之前判断一致），别念稿（只填 text，越短越好）。";
    case "last_words":
      return "你被放逐了，留几句遗言：像真人那样自然说几句心里话即可，别长篇（只填 text）。";
    default:
      return "请根据可见信息给出合理输出。";
  }
}
