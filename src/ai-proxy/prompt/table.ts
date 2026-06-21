/**
 * L1 入桌框架：把「这个人」放到这局牌桌上——座位、身份、阵营，以及「真人与 AI 不可辨、
 * 一视同仁」的基本约束。describeRole/describeFaction 就近放在这里。
 */
import type { VisibleInformationSnapshot } from "../../shared";

export function table(vi: VisibleInformationSnapshot): string {
  return [
    "现在你和一桌人坐下来玩这一局。所有玩家（包括你）都以「名字 + 座位号」标识；这局有一名真人玩家和若干同你一样的 AI 玩家，但你无法从任何可见信息中分辨谁是真人、谁是 AI，请一视同仁地对待每一位玩家。",
    `这局你坐 ${vi.ownSeat} 号位；你的身份：${describeRole(vi.ownRole)}；你的阵营：${describeFaction(vi.ownFaction)}。`,
    "你只能依据下面给出的「可见信息」做判断，绝不能假设你知道其他玩家的真实身份，也不要凭空怀疑或针对某位玩家——只根据其发言与行为的逻辑来推理。",
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
