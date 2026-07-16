import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/**
 * prefers-reduced-motion：页内一次性读取（与预览一致，不监听 change）。
 * 驱动一切 scrollIntoView/scrollTo 的 behavior 三元与聚焦延时归零；
 * CSS 层另有 @media(prefers-reduced-motion) 兜底禁动画。
 */
export const REDUCED_MOTION =
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** 点跳：scroll-margin-top 写在锚点元素本身（.hero/.rwrap/#finale/.qa），这里只管滚。 */
export function goToSection(id: string): void {
  document.getElementById(id)?.scrollIntoView({
    behavior: REDUCED_MOTION ? "auto" : "smooth",
    block: "start",
  });
}

/**
 * scroll-spy：以滚动容器 40% 高度线为准，顺序取「最后一个越线」的区块。
 * 刻意不用 IntersectionObserver——短卡（平安夜）在阈值法下会闪跳（预览注释）。
 *
 * 与预览的唯一结构差异：真机滚动容器是 .app-main（overflow-y:auto），
 * 不是 window——从 rootRef 向上找 .app-main，找不到才兜底 window。
 *
 * 键盘：←/→ 在区块序列上 ±1，Home→序幕，End→终局（不是问答）；
 * 焦点在 input/textarea 时不拦截。
 */
export function useScrollSpy(
  rootRef: RefObject<HTMLElement | null>,
  ids: string[],
): { curId: string; goTo: (id: string) => void } {
  const [curId, setCurId] = useState(ids[0] ?? "prologue");
  const curRef = useRef(curId);
  curRef.current = curId;
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const idsKey = ids.join("|");

  useEffect(() => {
    const container =
      (rootRef.current?.closest(".app-main") as HTMLElement | null) ?? null;
    let tick = false;

    const spy = () => {
      tick = false;
      const list = idsRef.current;
      if (list.length === 0) {
        return;
      }
      let scrollTop: number;
      let clientH: number;
      let scrollH: number;
      let originTop: number;
      if (container) {
        scrollTop = container.scrollTop;
        clientH = container.clientHeight;
        scrollH = container.scrollHeight;
        originTop = container.getBoundingClientRect().top;
      } else {
        scrollTop = window.scrollY;
        clientH = window.innerHeight;
        scrollH = document.documentElement.scrollHeight;
        originTop = 0;
      }
      const mid = scrollTop + clientH * 0.4;
      let cur = list[0];
      for (const id of list) {
        const el = document.getElementById(id);
        if (!el) {
          continue;
        }
        // -120 提前量：区块顶越过 40% 线前一点就算「到了」。
        const top = el.getBoundingClientRect().top - originTop + scrollTop - 120;
        if (top <= mid) {
          cur = id;
        }
      }
      // 页底特判：滚到底强制最后一节（问答），否则末节永远点不亮。
      if (scrollTop + clientH >= scrollH - 4) {
        cur = list[list.length - 1];
      }
      if (cur !== curRef.current) {
        setCurId(cur);
      }
    };

    const onScroll = () => {
      if (!tick) {
        tick = true;
        requestAnimationFrame(spy);
      }
    };

    const target: HTMLElement | Window = container ?? window;
    target.addEventListener("scroll", onScroll, { passive: true });
    spy();
    return () => target.removeEventListener("scroll", onScroll);
  }, [rootRef, idsKey]);

  const goTo = useCallback((id: string) => {
    goToSection(id);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (t instanceof HTMLElement && t.matches("input, textarea")) {
        return;
      }
      const list = idsRef.current;
      const i = list.indexOf(curRef.current);
      if (e.key === "ArrowRight") {
        e.preventDefault();
        goToSection(list[Math.min(i + 1, list.length - 1)]);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goToSection(list[Math.max(i - 1, 0)]);
      } else if (e.key === "Home") {
        e.preventDefault();
        goToSection("prologue");
      } else if (e.key === "End") {
        e.preventDefault();
        goToSection("finale");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [idsKey]);

  return { curId, goTo };
}
