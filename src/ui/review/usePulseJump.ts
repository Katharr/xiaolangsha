import { useCallback, useRef } from "react";

import { REDUCED_MOTION } from "./useScrollSpy";

/**
 * 死亡缩略带点跳：滚到锚点（block:center，与导航点跳的 start 不同）并触发
 * 金色脉冲。跨组件的一次性纯视觉动画，保留 getElementById + classList 直操
 * （remove → 强制 reflow → add 以重启动画），不值得为它引入 state。
 * 按锚点记录定时器：1.3s 内重复点击同一胶囊时，旧定时器不得掐断新脉冲。
 */
export function usePulseJump(): (anchorId: string) => void {
  const timers = useRef(new Map<string, number>());
  return useCallback((anchorId: string) => {
    const el = document.getElementById(anchorId);
    if (!el) {
      return;
    }
    el.scrollIntoView({
      behavior: REDUCED_MOTION ? "auto" : "smooth",
      block: "center",
    });
    const prev = timers.current.get(anchorId);
    if (prev !== undefined) {
      window.clearTimeout(prev);
    }
    el.classList.remove("pulse-hl");
    void el.offsetWidth;
    el.classList.add("pulse-hl");
    timers.current.set(
      anchorId,
      window.setTimeout(() => {
        el.classList.remove("pulse-hl");
        timers.current.delete(anchorId);
      }, 1300),
    );
  }, []);
}
