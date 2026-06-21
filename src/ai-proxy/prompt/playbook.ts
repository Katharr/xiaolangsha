/**
 * L3 阵营打法（瘦身版）：按阵营条件装配，好人/狼人各一两行；好人再按神职补一句产信息纪律。
 *
 * 红线：好人段含「保护真预言家」且不含狼专属词（如「悍跳」）；狼段含「悍跳」「帮队友洗清」
 * 且不含「保护真预言家」。仍不得出现 `狼人是` / `预言家是`。
 */
import type { VisibleInformationSnapshot } from "../../shared";

/** 好人打法 + 按神职补产信息纪律（修预言家潜水不报）。 */
export function goodPlaybook(vi: VisibleInformationSnapshot): string {
  const lines = [
    "你是好人：头等大事是找出并保护真预言家、靠验人信息推狼。没人对跳时就采信场上唯一跳出来的验人结果、跟着把票归到被查杀的人，别因为「他跳得太急太自信」反过来把他当狼推——那是替狼杀神；只有出现对跳才进辨真假。",
  ];
  if (vi.ownRole === "seer") {
    lines.push(
      "你就是预言家：验到金水或查杀别藏着，白天大大方方跳出来报你验了谁、结果是好是坏——这是好人翻盘的关键，别只顾自保潜水。",
    );
  } else if (vi.ownRole === "witch") {
    lines.push("你是女巫：解药、毒药各一次，看准时机用，别盲用也别一直空着。");
  } else if (vi.ownRole === "hunter") {
    lines.push("你是猎人：被票/被刀出局后可开枪带走一人，平时正常找狼即可。");
  }
  return lines.join("\n");
}

/** 狼人打法（叠加队友名单）。 */
export function werewolfPlaybook(vi: VisibleInformationSnapshot): string {
  const mates =
    vi.teammates.length > 0
      ? `你的狼队友：${vi.teammates
          .map((t) => `${t.name}（${t.seat}号）`)
          .join("、")}，绝不查杀/归票/投票针对队友，白天不动声色帮队友洗清、把火引向好人，狼刀尽量集中。`
      : "这局你是独狼，靠伪装和带节奏一个人扛。";
  return [
    "你是狼：目标屠边、优先消耗好人的神职。",
    mates,
    "必要时悍跳预言家（报假查验顶替真信息源）、扛推或对跳转移火力；装得像真好人，别因为知道真相就表现得过度准确而露马脚。",
  ].join("\n");
}

export function factionPlaybook(vi: VisibleInformationSnapshot): string {
  return vi.ownFaction === "werewolf_team"
    ? werewolfPlaybook(vi)
    : goodPlaybook(vi);
}
