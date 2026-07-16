import { Fragment, useEffect, useRef } from "react";

import { seatColorVar } from "../PlayerName";
import { REDUCED_MOTION } from "./useScrollSpy";

/** 导航一节：序幕 / 各轮次（dots=该轮死亡座位） / 终局 / 问AI。 */
export type NavSection = {
  id: string;
  label: string;
  dots?: number[];
  qa?: boolean;
};

/**
 * 进度轨导航：宽屏（>1280px）为左侧固定竖轨（节点圆点 + 轨线），
 * ≤1280px 退化为吸顶横条药丸（.np-conn 横线连接段）。
 * .cur/.seen 全由 curId 派生 className；当前节点变化时在轨内滚动居中。
 */
export function ReviewNav({
  sections,
  curId,
  qaPending,
  onGo,
}: {
  sections: NavSection[];
  curId: string;
  qaPending: boolean;
  onGo: (id: string) => void;
}) {
  const navRef = useRef<HTMLElement | null>(null);
  const idx = sections.findIndex((s) => s.id === curId);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) {
      return;
    }
    const pill = nav.querySelector<HTMLElement>(".np.cur");
    if (!pill) {
      return;
    }
    const wide =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(min-width:1281px)").matches;
    if (wide) {
      // 侧栏模式：竖向滚动让当前节点居中。
      nav.scrollTo({
        top: pill.offsetTop - nav.clientHeight / 2 + pill.clientHeight / 2,
        behavior: REDUCED_MOTION ? "auto" : "smooth",
      });
    } else {
      // 吸顶横条模式：横向滚动让当前节点居中。
      nav.scrollTo({
        left: pill.offsetLeft - nav.clientWidth / 2 + pill.clientWidth / 2,
        behavior: REDUCED_MOTION ? "auto" : "smooth",
      });
    }
  }, [curId]);

  return (
    <nav className="navbar" ref={navRef} aria-label="复盘进度导航">
      <div className="nav-inner">
        {sections.map((s, i) => (
          <Fragment key={s.id}>
            {i > 0 && !s.qa ? <span className="np-conn" /> : null}
            <button
              type="button"
              className={[
                "np",
                s.qa ? "np-qa" : "",
                i === idx ? "cur" : "",
                i < idx ? "seen" : "",
                s.qa && qaPending ? "pending" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => onGo(s.id)}
            >
              <span>{s.label}</span>
              <span className="np-dots">
                {(s.dots ?? []).map((seat, j) => (
                  <i key={j} style={{ background: seatColorVar(seat) }} />
                ))}
              </span>
            </button>
          </Fragment>
        ))}
      </div>
    </nav>
  );
}
