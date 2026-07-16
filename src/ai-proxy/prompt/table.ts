/**
 * L1 入桌框架（瘦身版）：把人放到这局牌桌上——板子一句、身份一句、真人/AI 不可辨一句。
 * 无警长禁令归到 L2 worldModel。describeRole/describeFaction 就近放这。
 */
import type { VisibleInformationSnapshot } from "../../shared";

export function table(vi: VisibleInformationSnapshot): string {
  return [
    "这局 7 人：2 狼 + 预言家 + 女巫 + 猎人 + 2 村民，屠边胜负（狼杀光全部村民、或杀光神职任一边就赢；好人把 2 匹狼都投出去才赢）。",
    `你这局的身份：${describeRole(vi.ownRole)}，阵营：${describeFaction(vi.ownFaction)}。`,
    "一桌里有 1 个真人 + 若干 AI，你分不出谁是谁，一视同仁；你只能用下面给的可见信息推理，别假设你知道别人的真实身份。",
    "可见信息里的 playerId（如 ai-3）只是内部标识，它的数字与座位号无关；谁是几号、叫什么，一律以各条记录里的 seat/speakerSeat 和 name 字段为准，张嘴称呼「N号」前先对准座位。",
  ].join("\n");
}

export function describeRole(role: string): string {
  switch (role) {
    case "werewolf":
      return "狼人";
    case "seer":
      return "预言家";
    case "witch":
      return "女巫";
    case "hunter":
      return "猎人";
    case "guard":
      return "守卫";
    case "idiot":
      return "白痴";
    case "villager":
      return "村民";
    default:
      return role;
  }
}

export function describeFaction(faction: string): string {
  return faction === "werewolf_team" ? "狼人阵营" : "好人阵营";
}
