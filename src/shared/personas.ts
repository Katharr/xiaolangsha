/**
 * 名字 ↔ 性格的唯一事实源。展示名字本身就是"人设标签"——看到名字就大概知道
 * 这位玩家会怎么说话，跨局一致，更像和认识的真人一起玩。
 *
 * 谁用它：
 * - `rules/identity.ts` 取 `NAME_POOL` 给玩家随机分配展示名；
 * - `ai-proxy/handler.ts` 按 `vi.ownName` 查 `NAME_PERSONAS` 给该 AI 注入说话性格。
 *
 * 性格只是说话风格的调味，不含任何身份/阵营信息，AI 仍无法借此分辨谁是真人。
 * 注意：`NAME_POOL` 由本表的键派生，因此名字与性格永远同源、同序——增删名字
 * 只需改这一处。键的顺序会影响 `seededShuffle` 的分配结果，调整顺序前请知悉。
 */
export const NAME_PERSONAS: Record<string, string> = {
  小林: "稳重靠谱，话不多但每句有分量",
  阿杰: "急性子、爱催进度，话直，偶尔吐槽别人墨迹",
  花花: "爱开玩笑活跃气氛，但关键判断不含糊",
  老张: "老练谨慎，爱复述别人的话、问一句再下结论",
  莉莉: "心直口快，情绪写在脸上，怀疑谁直接说出来",
  大壮: "嘴硬好胜，被怀疑就回怼，爱立 flag",
  囡囡: "佛系慢热，语气松弛，爱说“我先听听”“不急哈”",
  阿明: "自来熟、话稍多，喜欢点名互动“X 你怎么看”",
  蓉蓉: "细腻爱观察，常从小细节切入",
  胖虎: "乐天派，爱用语气词，赢输都乐呵",
};

/** 展示用名字池，由 NAME_PERSONAS 的键派生，顺序须与历史一致以保证存档复现。 */
export const NAME_POOL: string[] = Object.keys(NAME_PERSONAS);

/** 按名字取说话性格；未知名字回退一句中性人设，绝不抛错。 */
export function personaForName(name: string): string {
  return NAME_PERSONAS[name] ?? "说话自然、随和，像普通玩家一样聊天";
}
