// 领域枚举→中文的展示映射已迁到 src/shared/labels.ts（单一来源，ui 与 store 共用）。
// 这里再导出，保持现有 `from "./labels"` 的 ui 导入不变。
export {
  ROLE_LABEL,
  PHASE_LABEL,
  FACTION_LABEL,
  WIN_REASON_LABEL,
  NIGHT_STEP_LABEL,
  DEATH_CAUSE_LABEL,
  NIGHT_ACTION_VERB,
} from "../shared";

import type { Role } from "../shared";

/** own 座位角色胶囊 hover 的职责文案（身份卡的归宿）——仅 ui 用。 */
export const ROLE_DUTY: Record<Role, string> = {
  werewolf: "狼人 · 狼人阵营 · 每夜与同伴袭击一人",
  seer: "预言家 · 好人阵营 · 每夜可查验一人身份",
  witch: "女巫 · 好人阵营 · 一瓶解药一瓶毒药，各限用一次",
  hunter: "猎人 · 好人阵营 · 出局时可开枪带走一人",
  guard: "守卫 · 好人阵营 · 每夜守护一人",
  idiot: "白痴 · 好人阵营 · 被放逐时翻牌免死",
  villager: "村民 · 好人阵营 · 无夜间能力，靠发言与投票推理",
};

/** AI 思考指示器里展示的任务文案（按 driver 的 InGameTaskType）——仅 ui 用。 */
export const TASK_THINKING_LABEL: Record<string, string> = {
  night_action: "夜晚行动",
  witch_action: "夜晚行动",
  hunter_shoot: "猎人开枪",
  speech: "发言",
  vote: "投票",
  tie_speech: "拉票发言",
  last_words: "遗言",
};
