/**
 * L5 任务：当前 taskType 的动作纪律 + 合法目标（去偏见洗牌）。task-first 严格约束。
 *
 * 瘦身原则：关于「怎么判读跳身份/查杀/对跳」的认知已上移到 L2（worldModel）/L3（playbook），
 * 这里只留「现在这一步具体要产出什么动作」的纪律 + targetsHint，不再重复判读说明。
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
 * 候选目标去偏见洗牌：对一份副本做确定性 Fisher-Yates（种子=gameId+generatedAtSeq+ownSeat），
 * 避免模型按列表首尾位置锚定选人。**绝不改动 vi 本身**（user 段仍精确等于 vi 序列化，守 ISO 测试）。
 * 同一 vi 必得同一顺序（可复现）；不同座位通常得到不同顺序（去位置偏见）。
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
      ? `合法目标 id：${orderedTargets.join("、")}。（候选顺序是随机排的，不代表任何倾向，别按排序先后选人。）`
      : "当前没有可选目标。";

  switch (taskType) {
    case "night_action": {
      const wolfTeamNote =
        vi.ownRole === "werewolf" && vi.teammates.length > 0
          ? "今晚的刀由狼队共同投票决定：你和队友各报一个目标，多数票者被刀，平票时由真人狼拍板。和队友尽量刀同一个人，别把刀票浪费在自己队友身上。"
          : "";
      return [
        "任务：夜晚行动。先把局面想清楚再选。请根据你的身份选择 actionType（狼人=werewolf_kill，预言家=seer_check，守卫=guard_protect）并指定 targetId。",
        wolfTeamNote,
        targetsHint,
      ]
        .filter((line) => line.length > 0)
        .join("\n");
    }
    case "witch_action":
      return [
        "任务：女巫行动。你已得知今晚被刀的人（见可见信息里仅你可见的私有事件）。先想清楚再决定 witchChoice：save 救他、poison 并给出 targetId 毒一人、或 skip 放弃。解药和毒药各只有一次。",
        "用毒的纪律：毒药是你最稀缺、最容易帮倒忙的资源。决定用毒前，先确认你能在 decisionSummary 里点名「我要毒谁、依据是这局里的哪条具体证据」——某人的发言破绽、票型、预言家对跳、或公开的查杀。",
        "只要有指向某个具体人的依据就可以毒，哪怕这个判断是别人带起来的节奏、哪怕你可能被骗了、哪怕最后毒错——那都算正常发挥，不用怕。",
        "但如果你说不出针对某个具体人的理由，只是「想找狼试试」「施压」「随便毒一个赌一把」，那就 skip，把毒药留到有据的那一晚。空过一晚不用毒完全没问题，别因为「预言家死了我得做点什么」就盲毒。",
        "反过来，如果场上已经有人被对跳或公开查杀坐实成狼，那他就是你优先该毒的对象，该出手就果断出手——纪律不是叫你永远不用毒。",
        targetsHint,
      ].join("\n");
    case "hunter_shoot":
      return `任务：你是猎人且已出局，可开枪带走一名存活玩家。先想清楚带走谁最有利再开枪。给出 targetId 开枪，或留空放弃开枪。${targetsHint}`;
    case "vote":
      return [
        "任务：投票放逐。先在 analysisSummary 里想清楚再投。",
        "本局投票是所有人同时暗投、结算时一起翻牌——你现在看不到别人投了谁，所以根本无从跟票，只管按你自己的判断投出最该走的那个人。",
        "把票投在对你阵营最有利的人身上：好人要找狼、狼要带节奏，但都得基于这局讨论里的逻辑，而不是挑场上最软的柿子。",
        "你和别人结论不同很正常，按你自己的判断倾向投，不用凑大流、也别为了和别人不一样而乱投——投你真心认为最该走的那个人。",
        `然后 choiceType="target" 配 targetId 投出一票，或在允许时 choiceType="abstain" 弃票。不能投自己。${targetsHint}`,
      ].join("\n");
    case "speech":
      return [
        "任务：白天发言。用你自己的性格、像真人那样自然地说几句（仅填 text，别太长，大白话即可）。先在心里把判断想好，说出来的话要和你心里的判断一致；该带的节奏、该表的态照样表，只是用平时聊天的口气说出来。",
        "给出你自己的独立观点，别附和或复述前面人已经说过的话——如果你的判断和前面发言的人不同，就直接说出来，把分歧讲清楚比随大流更有用。",
        "选怀疑对象时只看各人发言/行为的逻辑，别按发言顺序或座位顺序锚定谁（比如别习惯性盯着前几个发言的人或某个固定座位），按你自己的判断倾向去找最该怀疑的人。",
      ].join("\n");
    case "tie_speech":
      return "任务：平票了，再争取一下选票。用聊天的口气简短重申你的立场（要和你之前的判断一致），别念稿（仅填 text，越短越自然）。";
    case "last_words":
      return "任务：你被放逐了，留几句遗言。像真人那样自然交代你的判断或心里话即可，不用长篇大论（仅填 text）。";
    default:
      return "任务：请根据可见信息给出合理输出。";
  }
}
