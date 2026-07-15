import { useEffect, useRef, useState } from "react";

import type { VisibleInformationSnapshot } from "../shared";

import { collectResolved, type Resolved } from "./seatTokens";

/**
 * 投票揭示状态机（竞态纪律，基准 preview/vote-mockup-v3.html 注释）：
 * - 已见 eventId 集合放组件 ref：挂载首帧把当前全部 vote_resolved 灌成已见、
 *   不触发动画——Dexie 刷新恢复 / 复盘返回 / 组件重挂一律直出终态不重播。
 * - 之后 diff 出新事件才播揭示；脚本兜底连发多条时全部记已见、只播 seq 最大一条。
 * - calming（开票退让期）：揭示同帧开启 ~2.6s，桌面既有 token 降透明 +
 *   felt 金脉冲；clearTimeout 防连发叠加，unmount 清理。
 * 宿主是 SeatRing（牌桌容器）：review/重开卸载即自动重置，生命周期天然正确。
 */
export function useVoteReveal(vi: VisibleInformationSnapshot): {
  reveal: Resolved | null;
  calming: boolean;
} {
  const seenRef = useRef<Set<string> | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [reveal, setReveal] = useState<Resolved | null>(null);
  const [calming, setCalming] = useState(false);

  useEffect(() => {
    const resolved = [...collectResolved(vi).values()].sort(
      (a, b) => a.seq - b.seq,
    );
    if (seenRef.current === null) {
      seenRef.current = new Set(resolved.map((r) => r.eventId));
      return;
    }
    const seen = seenRef.current;
    const fresh = resolved.filter((r) => !seen.has(r.eventId));
    if (fresh.length === 0) {
      return;
    }
    for (const r of fresh) {
      seen.add(r.eventId);
    }
    const latest = fresh[fresh.length - 1];
    setReveal(latest);
    setCalming(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCalming(false), 2600);
  }, [vi]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  return { reveal, calming };
}
