import type { AppError, AppErrorCode } from "../shared";

/**
 * 把 AppError 翻成给玩家看的中文。
 *
 * 规则引擎（rules/）刻意只产出英文技术 message、不填 userMessage——保持模块边界，
 * 规则层不感知 UI 文案。中文展示集中在这一层（store/ui）。
 *
 * 优先级：error.userMessage（如 store 自填的中文）> message 精准细分 > code 兜底。
 * 原始 error.message 仍保留在 AppError 上作开发期日志线索，只是不直接展示。
 */

/** 各错误码的中文兜底文案。 */
const CODE_FALLBACK: Record<AppErrorCode, string> = {
  INVALID_ACTION: "操作无效，请重试。",
  ACTION_NOT_ALLOWED: "当前阶段不能执行该操作。",
  DUPLICATE_SUBMIT: "该操作已提交，请勿重复。",
  STORAGE_LOAD_FAILED: "读取存档失败，可能需要重新开局。",
  STORAGE_SAVE_FAILED: "保存进度失败，请稍后重试。",
  AI_TIMEOUT: "AI 响应超时，已切换到本地兜底继续游戏。",
  AI_JSON_INVALID: "AI 返回格式异常，已切换到本地兜底继续游戏。",
  AI_UNAVAILABLE: "AI 暂时不可用，已切换到本地兜底继续游戏。",
  SNAPSHOT_CORRUPTED: "存档已损坏，已重置为新对局。",
  REPLAY_FAILED: "对局恢复失败，已重置为新对局。",
};

/**
 * 高频规则 message 的精准细分（命中则覆盖 code 兜底）。
 * 键是规则引擎里写死的英文串（见 src/rules/index.ts 的 rulesError 调用）。
 */
const MESSAGE_OVERRIDES: Record<string, string> = {
  // 投票
  "Self vote is not allowed.": "不能投自己，请另选目标。",
  "Vote target is not legal.": "该投票目标不可选（已出局或不在候选名单）。",
  "Vote target is required.": "请先选择一名投票目标。",
  "Abstaining is not allowed.": "本局不允许弃票。",
  "Vote is not allowed now.": "现在不是你的投票时机。",
  // 夜晚行动
  "Night action target is not legal.": "该夜晚目标不可选。",
  "Night action target is required.": "请先选择一个行动目标。",
  "Night action is not allowed now.": "现在不能进行夜晚行动。",
  // 发言 / 拉票 / 遗言
  "Speech text is invalid.": "发言不能为空，且不能超过 500 字。",
  "Tie speech text is invalid.": "拉票发言不能为空，且不能超过 500 字。",
  "Last words text is invalid.": "遗言不能为空，且不能超过 500 字。",
  "Speech is not allowed now.": "现在还没轮到你发言。",
};

/** 把一个 AppError 映射成展示用的中文消息。永不返回空串。 */
export function toUserMessage(error: AppError): string {
  if (error.userMessage && error.userMessage.trim().length > 0) {
    return error.userMessage;
  }
  const override = MESSAGE_OVERRIDES[error.message];
  if (override) {
    return override;
  }
  return CODE_FALLBACK[error.code] ?? "发生未知错误，请重试。";
}
