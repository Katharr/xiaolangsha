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
