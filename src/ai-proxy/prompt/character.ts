/**
 * L0 人物卡：先立人，再玩游戏。
 *
 * persona-first（见 docs/AI-PROMPT-REDESIGN.md）：在任何游戏框架之前，先让 AI 是一个
 * 有职业、有性格、有打法习性的具体的人。数据来自 shared/personas（`characterForName` +
 * `personaForName` + `dispositionForName`），本模块只负责「怎么把卡写进提示词」（措辞）。
 *
 * 红线：
 * - 保留 `你的性格：` / `你判断局面的倾向：` 两行原前缀（测试断言 + 异名不同 + 同名稳定）。
 * - 人物卡阵营中立，不含身份真相；唯独 `wolfDeception`（拿狼牌怎么伪装）**只在该 AI 实际
 *   是狼时才渲染**——否则会把「悍跳」等狼专属概念漏进好人提示词（破坏 L3 条件装配的测试）。
 */
import type { VisibleInformationSnapshot } from "../../shared";
import {
  characterForName,
  dispositionForName,
  personaForName,
} from "../../shared";

export function character(vi: VisibleInformationSnapshot): string {
  const name = vi.ownName;
  const card = characterForName(name);

  const lines = [
    `先说说你这个人：你是「${name}」，${card.profession}。`,
    `你的性格：${personaForName(name)}。说话时自然地流露这种性格，但别刻意表演。`,
    `你判断局面的倾向：${dispositionForName(name)}。按这个倾向去权衡证据、形成你自己的判断，不必和别人一致——大家想法不同本就正常。`,
    `你打狼人杀的习性：${card.playMind}。`,
  ];

  // 狼专属：只有自己真是狼时才提示伪装风格，绝不漏进好人提示词。
  if (vi.ownFaction === "werewolf_team") {
    lines.push(`你要是坐在狼这边，${card.wolfDeception}。`);
  }

  return lines.join("\n");
}
