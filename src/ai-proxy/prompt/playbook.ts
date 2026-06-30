/**
 * L3 阵营打法 + 角色基础战术卡（瘦身版）：按阵营条件装配，每个玩家只看到「自己这个角色
 * 在这个板子上该怎么打」的一张卡。通用判读知识在 L2 worldModel，这里不重复。
 *
 * 设计：好人 = 通用好人指针（保护真预言家/采信单跳，与 L2 呼应）+ 本角色战术卡；
 *       狼 = 狼战术卡 + 队友名单。换板子只改 ROLE_TACTICS 这张表，不动装配。
 *
 * 红线：好人段含「保护真预言家」且不含狼专属词（如「悍跳」）；狼段含「悍跳」「帮队友洗清」
 * 且不含「保护真预言家」。各角色卡只讲自己，仍不得出现 `狼人是` / `预言家是`。
 */
import type { VisibleInformationSnapshot } from "../../shared";

/**
 * 好人三神 + 村民的「基础战术卡」：每张只讲本角色的职责定位 / 该跳还是该藏 / 赢法动作。
 * 修正点：只有预言家「必跳必报」，女巫/猎人默认潜水自保（别把「神职别藏」泛化）。
 */
const ROLE_TACTICS: Record<string, string> = {
  seer:
    "你是预言家：好人唯一能给出硬信息的来源。首夜验人，白天必须主动跳出来报验人结果（金水立一个铁好人 / 查杀带全场归票），别只顾自保潜水；有人对跳就把你的验人逻辑讲清楚争信任。",
  witch:
    "你是女巫：解药、毒药各一次，无守卫局你的解药是好人唯一的夜间保护。默认藏身份、潜水自保——一暴露就会被狼下一晚精准刀掉；除非要救场站边真预言家才亮身份。用毒要有指向某个人的具体依据，说不出理由就把毒留着，别盲毒。",
  hunter:
    "你是猎人：威慑全在「死了能开枪」——藏身份、别早跳，潜到被推或被刀出局时再亮枪带走最坐实的那匹狼；平时正常找狼即可。",
  villager:
    "你是村民：没有夜间信息，全靠白天听发言找狼。认出并保护真预言家、跟对验人票是头等事；别空发言，也别冲太前被狼当枪使。",
};

/** 好人打法 = 通用好人指针 + 本角色战术卡（条件装配，只拼自己那张）。 */
export function goodPlaybook(vi: VisibleInformationSnapshot): string {
  const common =
    "你是好人：头等大事是找出并保护真预言家、靠验人信息推狼。没人对跳时就采信场上唯一跳出来的验人结果、跟着把票归到被查杀的人，别因为「他跳得太急太自信」反过来把他当狼推——那是替狼杀神；只有出现对跳才进辨真假。先去查那些发言空、没给任何信息的人。";
  const card = ROLE_TACTICS[vi.ownRole] ?? "";
  return [common, card].filter((line) => line.length > 0).join("\n");
}

/** 狼人战术卡（叠加队友名单）。 */
export function werewolfPlaybook(vi: VisibleInformationSnapshot): string {
  const mates =
    vi.teammates.length > 0
      ? `你的狼队友：${vi.teammates
          .map((t) => `${t.name}（${t.seat}号）`)
          .join("、")}，绝不查杀/归票/投票针对队友，白天不动声色帮队友洗清、把火引向好人，狼刀尽量集中。`
      : "这局你是独狼，靠伪装和带节奏一个人扛。";
  return [
    "你是狼：目标屠边、优先消耗神职（预言家>女巫>猎人）。",
    mates,
    "白天伪装好人——必要时悍跳预言家（报假查验顶替真信息源）、倒钩抱真预言家、或深水划水，看局势选；别因为知道真相就表现得过度准确而露马脚。",
  ].join("\n");
}

export function factionPlaybook(vi: VisibleInformationSnapshot): string {
  return vi.ownFaction === "werewolf_team"
    ? werewolfPlaybook(vi)
    : goodPlaybook(vi);
}
