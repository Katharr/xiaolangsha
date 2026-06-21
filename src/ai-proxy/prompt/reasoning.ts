/**
 * L4 推理与表达（瘦身版）：私有/公开分离 + 与历史一致，压成一行。
 * 难度接缝保留在签名（未来按档返回不同深度）。
 */
export function reasoning(/* 未来: difficulty */): string {
  return "先在 analysisSummary 里（只有你自己看）想清楚此刻你信谁、疑谁、依据是这局的哪些具体表现；说出来和投出去的要和你之前发过的言保持一致，别只因为别人投了谁、谁话少就跟风；最后在 decisionSummary 用一句话写明你为什么这么选。";
}
