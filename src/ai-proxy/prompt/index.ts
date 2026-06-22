/**
 * 薄装配器：按 L0–L6 顺序把各层组合成 system / user 两段提示词。
 *
 * 装配顺序体现「先人 → 再入桌 → 再玩 → 严格输出」：
 *   L0 character（人物卡）→ L1 table（入桌+身份）→ L2 worldModel（通用判读知识）
 *   → L3 factionPlaybook（阵营打法）→ L4 reasoning（私有/公开分离）→ L5 task（动作纪律）
 *   → L6 OUTPUT_CONTRACT（JSON 契约）。
 *
 * ISO 纪律：in-game 的 user 段精确等于 `safeStringify(vi)`（守 ISO-001 测试），system 段只由
 * vi 派生、不含他人真相；review 分支只由 reviewContext + questionText 派生。
 */
import type { z } from "zod";

import type { aiTaskRequestSchema } from "../../shared";

import { character } from "./character";
import { output, reviewOutputContract } from "./output";
import { factionPlaybook } from "./playbook";
import { reasoning } from "./reasoning";
import { task, type InGameTaskType } from "./task";
import { table } from "./table";
import { worldModel } from "./worldModel";

type AiTaskRequest = z.infer<typeof aiTaskRequestSchema>;

export interface PromptMessages {
  system: string;
  user: string;
}

/**
 * 由请求装配 system / user 两段提示词。导出以便单测直接断言「只含可见信息」。
 */
export function buildPrompt(req: AiTaskRequest): PromptMessages {
  if (req.taskType === "review_question") {
    return {
      system: [
        "你是一名 AI 狼人杀玩家，本局已经结束，正在复盘环节回答真人玩家的提问。",
        "下面提供本局的完整复盘上下文（reviewContext，含所有身份、夜晚行动、发言与投票）。",
        "请基于该上下文如实、简洁地用中文回答问题。",
        reviewOutputContract,
      ].join("\n"),
      user: [
        `问题：${req.questionText}`,
        "复盘上下文（JSON）：",
        safeStringify(req.reviewContext),
      ].join("\n"),
    };
  }

  const vi = req.visibleInformation;
  const draft = req.promptContext?.currentText;
  const taskType = req.taskType as InGameTaskType;
  // 说话习惯只在发言类任务渲染（speech/tie_speech/last_words），逻辑步不渲染（省体积）。
  const isSpeechTask =
    taskType === "speech" || taskType === "tie_speech" || taskType === "last_words";

  return {
    system: [
      character(vi, isSpeechTask), // L0
      table(vi), // L1
      worldModel(), // L2
      factionPlaybook(vi), // L3
      reasoning(), // L4
      task(taskType, vi), // L5
      output(taskType), // L6
    ]
      .filter((line) => line.length > 0)
      .join("\n"),
    user: [
      "当前可见信息（visibleInformation，JSON）：",
      safeStringify(vi),
      ...(draft ? ["", `你此前的草稿（可参考或改写）：${draft}`] : []),
    ].join("\n"),
  };
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "{}";
  }
}
