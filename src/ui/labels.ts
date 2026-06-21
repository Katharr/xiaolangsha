import type {
  Faction,
  GamePhase,
  NightStepKind,
  Role,
  WinReason,
} from "../shared";

/** 角色中文名（仅用于展示真人自己的身份 / 复盘真相）。 */
export const ROLE_LABEL: Record<Role, string> = {
  werewolf: "狼人",
  seer: "预言家",
  witch: "女巫",
  hunter: "猎人",
  guard: "守卫",
  idiot: "白痴",
  villager: "村民",
};

export const PHASE_LABEL: Record<GamePhase, string> = {
  mode_select: "选择模式",
  role_setup: "选择身份",
  role_reveal: "身份揭示",
  night_action: "夜晚行动",
  day_announcement: "天亮播报",
  hunter_shoot: "猎人开枪",
  day_speech: "白天发言",
  vote: "投票",
  tie_speech: "拉票发言",
  tie_vote: "二次投票",
  exile_last_words: "放逐遗言",
  fast_forwarding: "快进中",
  review: "复盘",
};

export const FACTION_LABEL: Record<Faction, string> = {
  werewolf_team: "狼人阵营",
  good_team: "好人阵营",
};

export const WIN_REASON_LABEL: Record<WinReason, string> = {
  all_werewolves_dead: "屠尽所有狼人",
  werewolves_reach_parity: "狼人达到人数优势",
  all_gods_dead: "屠尽所有神职",
  all_folk_dead: "屠尽所有平民",
};

/** 夜晚各步骤的角色行动文案（主持人播报「等待 XX…」）。 */
export const NIGHT_STEP_LABEL: Record<NightStepKind, string> = {
  guard_protect: "守卫守护",
  werewolf_kill: "狼人行动",
  seer_check: "预言家查验",
  witch_action: "女巫用药",
};

/** AI 思考指示器里展示的任务文案（按 driver 的 InGameTaskType）。 */
export const TASK_THINKING_LABEL: Record<string, string> = {
  night_action: "夜晚行动",
  witch_action: "夜晚行动",
  hunter_shoot: "猎人开枪",
  speech: "发言",
  vote: "投票",
  tie_speech: "拉票发言",
  last_words: "遗言",
};
