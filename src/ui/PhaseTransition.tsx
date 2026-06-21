import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

import type { GamePhase, RoundRef } from "../shared";

/**
 * 天黑 / 天亮过场（方案 C 阶段 3）。
 * 监听相位 + 轮次，当昼夜段切换时播放「眨眼遮罩 + 衬体字幕（第 N 夜 / 第 N 天）」，
 * 并在遮罩闭合的瞬间切换 body.is-day（深色夜 ↔ 暖亮昼）。
 * 纯展示层，只读 phase / round，不触碰任何逻辑或真相（ISO-001 安全）。
 */

type Segment = { key: string; label: string; isNight: boolean };

/** 把当前相位归约成「昼/夜」段；返回 null 表示无牌桌（准备/复盘），不参与过场。 */
function segmentOf(
  phase: GamePhase | null,
  round: RoundRef | undefined,
): Segment | null {
  if (!phase || !round) {
    return null;
  }
  if (phase === "review" || phase === "fast_forwarding") {
    return null;
  }
  // 开局前的几个相位归为「准备段」：让首夜进场也能播过场，但刷新直接落在夜里时不闪。
  if (
    phase === "mode_select" ||
    phase === "role_setup" ||
    phase === "role_reveal"
  ) {
    return { key: "pre", label: "", isNight: false };
  }
  if (phase === "night_action") {
    return { key: `night-${round.night}`, label: `第 ${round.night} 夜`, isNight: true };
  }
  return { key: `day-${round.day}`, label: `第 ${round.day} 天`, isNight: false };
}

type PhaseTransitionProps = {
  phase: GamePhase | null;
  round: RoundRef | undefined;
};

const LID_EASE = [0.7, 0, 0.3, 1] as const;

export function PhaseTransition({ phase, round }: PhaseTransitionProps) {
  const [overlay, setOverlay] = useState<{ label: string } | null>(null);
  const prevKey = useRef<string | null>(null);

  useEffect(() => {
    const seg = segmentOf(phase, round);
    if (!seg) {
      return;
    }
    if (seg.key === prevKey.current) {
      return;
    }
    const first = prevKey.current === null;
    prevKey.current = seg.key;

    // 首次观测（含刷新恢复落在局中）或准备段：直接切主题，不播过场，避免突兀闪屏。
    if (first || !seg.label) {
      document.body.classList.toggle("is-day", !seg.isNight);
      return;
    }

    setOverlay({ label: seg.label });
    // 遮罩闭合到底（~560ms）的瞬间切换昼夜主题，再于全程结束后收起遮罩。
    const toTheme = window.setTimeout(() => {
      document.body.classList.toggle("is-day", !seg.isNight);
    }, 560);
    const toClose = window.setTimeout(() => setOverlay(null), 1150);
    return () => {
      window.clearTimeout(toTheme);
      window.clearTimeout(toClose);
    };
  }, [phase, round?.night, round?.day]);

  return (
    <AnimatePresence>
      {overlay ? (
        <div className="phase-transition" key="phase-transition" aria-hidden="true">
          <motion.div
            className="lid top"
            initial={{ height: 0 }}
            animate={{ height: "52%" }}
            exit={{ height: 0 }}
            transition={{ duration: 0.55, ease: LID_EASE }}
          />
          <motion.div
            className="lid bottom"
            initial={{ height: 0 }}
            animate={{ height: "52%" }}
            exit={{ height: 0 }}
            transition={{ duration: 0.55, ease: LID_EASE }}
          />
          <motion.div
            className="phase-caption"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
          >
            {overlay.label}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
