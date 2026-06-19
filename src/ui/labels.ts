import type { Faction, GamePhase, Role, WinReason } from "../shared";

/** 角色中文名（仅用于展示真人自己的身份 / 复盘真相）。 */
export const ROLE_LABEL: Record<Role, string> = {
  werewolf: "狼人",
  seer: "预言家",
  villager: "村民",
};

export const PHASE_LABEL: Record<GamePhase, string> = {
  mode_select: "选择模式",
  role_setup: "选择身份",
  role_reveal: "身份揭示",
  night_action: "夜晚行动",
  day_announcement: "天亮播报",
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
};
