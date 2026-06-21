/**
 * L6 输出契约（瘦身版）。按 taskType 只列**当前这步用得到的字段**，不再每条都把全部字段
 * 铺一遍——既省体积，也少给弱模型干扰项。analysisSummary/decisionSummary 始终保留（私有推理）。
 */
import type { InGameTaskType } from "./task";

const FIELD_LINES: Record<InGameTaskType, string[]> = {
  speech: ["- text: 你的发言。"],
  tie_speech: ["- text: 你的拉票发言。"],
  last_words: ["- text: 你的遗言。"],
  vote: [
    '- choiceType: "target"(投人) 或 "abstain"(弃票)。',
    "- targetId: 投票目标 id（投人时必填，取自合法目标）。",
  ],
  night_action: [
    '- actionType: "werewolf_kill" | "seer_check" | "guard_protect"。',
    "- targetId: 行动目标 id（取自合法目标）。",
  ],
  witch_action: [
    '- witchChoice: "save" | "poison" | "skip"。',
    "- targetId: 用毒时填要毒的人 id。",
  ],
  hunter_shoot: ["- targetId: 开枪目标 id；放弃则留空。"],
};

const TAIL = [
  "- analysisSummary: （可选）你的私下分析，不展示给别人。",
  "- decisionSummary: （可选）你这么选的简要理由，不展示给别人。",
];

export function output(taskType: InGameTaskType): string {
  return [
    "只输出一个 JSON 对象（不要任何额外文字或 Markdown 代码块），按需填这些字段：",
    ...(FIELD_LINES[taskType] ?? []),
    ...TAIL,
  ].join("\n");
}

/** 复盘问答用的极简契约（只需 text）。 */
export const reviewOutputContract =
  "只输出一个 JSON 对象（不要额外文字或代码块），把回答填进 text 字段即可。";
