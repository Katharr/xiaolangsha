/**
 * L0 人物卡（瘦身版）：先立人，再玩游戏。两三行，不堆原则。
 *
 * 保留 `你的性格：` / `你判断局面的倾向：` 两行原前缀（测试 + 异名分歧的根）。第一行同时
 * 钉「你就是 N 号本人，别怀疑自己」——修弱模型把自己当第三方嫌疑人分析的自我指涉 bug。
 *
 * `playMind` 字段仍保留在 shared/personas 数据里（未来可用），但**不再渲染进提示词**以省体积；
 * `wolfDeception` 只在该 AI 实际是狼时渲染，绝不漏给好人。
 * `speechHabit`（说话习惯）只在**发言类任务**渲染（`renderSpeechHabit=true`，由装配层按 taskType 传入），
 * 让发言长短/抢话度/口头禅天然分化、打散「全桌四五句报告腔雷同」；逻辑步不渲染、省体积。
 */
import type { VisibleInformationSnapshot } from "../../shared";
import {
  characterForName,
  dispositionForName,
  personaForName,
} from "../../shared";

export function character(
  vi: VisibleInformationSnapshot,
  renderSpeechHabit = false,
): string {
  const name = vi.ownName;
  const card = characterForName(name);

  const lines = [
    `你是「${name}」，${card.profession}。你坐 ${vi.ownSeat} 号位——场上的「${vi.ownSeat}号」就是你本人，别把自己当成需要怀疑的对象。`,
    `你的性格：${personaForName(name)}。说话自然带出来就行，别刻意表演。`,
    `你判断局面的倾向：${dispositionForName(name)}。按这个倾向权衡，和别人想法不同很正常。`,
  ];

  if (renderSpeechHabit) {
    lines.push(`你说话的习惯：${card.speechHabit}。照这个习惯说，别人怎么说是别人的事。`);
  }

  if (vi.ownFaction === "werewolf_team") {
    lines.push(`你坐在狼这边时的伪装风格：${card.wolfDeception}。`);
  }

  return lines.join("\n");
}
