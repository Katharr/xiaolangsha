import type {
  DeathCause,
  Faction,
  GamePhase,
  NightActionType,
  Role,
  WinReason,
} from "./enums";
import type { NightStepKind } from "./models";

/**
 * 领域枚举 → 简体中文的展示映射，单一来源。
 * 放在 shared 是因为 ui（聊天室/复盘）与 store（调试摘要导出）都要用，
 * 若留在 ui 会让 store 反向依赖 ui 形成依赖环。这里只有常量、无逻辑、无副作用。
 */

/** 角色中文名（展示真人自己身份 / 复盘真相 / 调试摘要）。 */
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

/** 死因中文（复盘 / 调试摘要展示）。 */
export const DEATH_CAUSE_LABEL: Record<DeathCause, string> = {
  night_kill: "夜里出局",
  exile: "被放逐",
  poison: "被毒杀",
  hunter_shot: "被枪杀",
};

/** 夜晚具体行动的动词（复盘 / 调试摘要时间线）。 */
export const NIGHT_ACTION_VERB: Record<Exclude<NightActionType, "none">, string> =
  {
    werewolf_kill: "击杀",
    seer_check: "查验",
    guard_protect: "守护",
    witch_save: "用解药救",
    witch_poison: "用毒药毒",
  };
