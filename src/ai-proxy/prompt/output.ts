/**
 * L6 输出契约。JSON 字段约定——严格（动作/JSON 正确性不靠人设松绑）。
 * review 分支也复用本段。
 */
export const OUTPUT_CONTRACT = [
  "你必须只输出一个 JSON 对象，不要包含任何额外文字或 Markdown 代码块。",
  "JSON 字段（按需填写）：",
  "- text: string —— 你的发言/遗言/拉票文本（发言类任务必填）。",
  '- choiceType: "target" | "abstain" —— 投票任务用，target 表示投某人，abstain 表示弃票。',
  "- targetId: string —— 行动/投票的目标玩家 id，必须取自可见信息给出的合法目标。",
  '- actionType: "werewolf_kill" | "seer_check" | "guard_protect" —— 狼刀/预言家查验/守卫守护任务用。',
  '- witchChoice: "save" | "poison" | "skip" —— 女巫任务用：救被刀者 / 用毒药（配 targetId）/ 放弃。',
  "- analysisSummary: string —— （可选）你的私下分析，不会展示给其他玩家。",
  "- decisionSummary: string —— （可选）你做出该决策的简要理由，不会展示给其他玩家。",
].join("\n");
