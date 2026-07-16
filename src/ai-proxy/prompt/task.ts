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
        "投票放逐：暗投，你看不到别人投了谁，就按自己的判断投最该走的那个、别挑场上最软的柿子；也别因为谁「话说得太死、太冲」就投他——风格不是狼证，投你推理里最可能是狼的那个人。",
        consistencyLine,
        "你发言之后别人给出的带理由归票号召也算新信息：如果你自己的怀疑本来就不笃定，而场上有人明确归票到另一个人，就把票并过去——首要目标是把人投出去，票分散等于好人集体弃权。有公开查杀时仍优先跟查杀。",
        `choiceType="target" 配 targetId 投一票，或允许时 choiceType="abstain" 弃票；不能投自己。${targetsHint}`,
      ].join("\n");
    }
    case "speech": {
      // 发言顺位就地推断（不改 vi，仿 vote case 从 vi.speeches 捞数据）：发言序在阶段开始时
      // 冻结为存活玩家按座位升序，且发言阶段中途无人死亡（猎人枪/遗言都在进入 day_speech 前
      // 结算），所以「本日已有 day_speech 条数 vs 存活人数」能精确判断首位/末位。
      const spoken = vi.speeches.filter(
        (s) => s.day === vi.round.day && s.speechKind === "day_speech",
      ).length;
      const aliveCount = vi.alivePlayers.length;
      const isFirst = spoken === 0;
      const isLast = aliveCount > 0 && spoken === aliveCount - 1;
      const positionLine = isFirst
        ? "你是这轮第一个开口的，前面没人可回应，别硬凑回应：把昨晚的结果捋一句、表个态，再说说你今天想重点听谁讲，给全场开个头。"
        : isLast
          ? "你是这轮最后一个发言的，你说完全场就直接投票，归票是你的活：一句话捋清场上的分歧，明确点名你今天要投谁、给出核心理由，喊大家把票并到一起——票一散谁都推不出去，好人白亏一天。这条可以多说两句，别怕长。"
          : "至少落下一条实在内容：点评一个已发言的人（信还是不信、为什么，针对他实际说过的话），或给出你自己的怀疑对象加理由，或直接报你今天准备票谁——别只喊「我是好人先过」这种没信息的空话。";
      return [
        "轮到你发言（只填 text）：就像在微信群里接着聊——挑这一轮你最在意的那一点说就行，可以回应某个人、附和、抬杠、吐个槽，或者只甩一句自己的态度；不用面面俱到、不用每个人都回应，也不用每次都先报「我回应谁」。",
        positionLine,
        "按你自己的判断倾向说，别人讲过的别换个说法复读一遍；想到啥说啥，带上你自己的口气、情绪和口头禅，没把握就照实说「我也说不准，就觉得…」，挑谁也只看发言、别按座位顺序。",
        "一两句、像真人那样自然就行，别凑长、别念分析报告。",
      ].join("\n");
    }
    case "tie_speech":
      return "平票了，再争取一下选票：用聊天口气简短重申你的立场（和之前判断一致），别念稿（只填 text，越短越好）。";
    case "last_words":
      return "你被放逐了，留几句遗言：像真人那样自然说几句心里话即可，别长篇（只填 text）。";
    default:
      return "请根据可见信息给出合理输出。";
  }
}
