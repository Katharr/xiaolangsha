import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";

import type { GameAction, Player, Result, ReviewContext } from "../shared";
import { deriveRoundArchives } from "../shared";
import { toUserMessage } from "../store";

import { PlayerName } from "./PlayerName";
import { DayCard } from "./review/DayCard";
import { FinaleCard } from "./review/FinaleCard";
import { NightCard } from "./review/NightCard";
import { ReviewHero } from "./review/ReviewHero";
import { ReviewNav, type NavSection } from "./review/ReviewNav";
import { ReviewQa, type QaEntry } from "./review/ReviewQa";
import { usePulseJump } from "./review/usePulseJump";
import { REDUCED_MOTION, useScrollSpy } from "./review/useScrollSpy";
import "./review.css";

export type ReviewPanelProps = {
  reviewContext: ReviewContext;
  busy: boolean;
  humanPlayerId: string;
  nextKey: (prefix: string) => string;
  act: (action: GameAction) => void;
  askReview: (question: string) => Promise<Result<string>>;
  /** 导出本局调试日志（复盘态没有牌桌工具钮，这里是正常结局的唯一导出入口）。 */
  onExportDebug: () => void;
};

/**
 * 复盘面板「真相卷轴」：仅 review 阶段渲染 store 组装的完整真相
 * （ISO-002 由 store 在调用点保证）。数据一律来自 deriveRoundArchives
 * 的派生结构，组件内不散扫 events。
 * 结构 = 侧边进度轨导航 → 序幕（横幅+身份墙+死亡带）→ 夜/天交错时间流
 * → 终局卡 → 幕后问答 → 按钮行；预览基准 preview/review-timeline-mockup.html。
 */
export function ReviewPanel({
  reviewContext,
  busy,
  humanPlayerId,
  nextKey,
  act,
  askReview,
  onExportDebug,
}: ReviewPanelProps) {
  const archives = useMemo(
    () => deriveRoundArchives(reviewContext),
    [reviewContext],
  );

  const byId = useMemo(() => {
    const map = new Map<string, Player>();
    for (const p of reviewContext.players) {
      map.set(p.playerId, p);
    }
    return map;
  }, [reviewContext.players]);

  // 叙事保底 segments 里的玩家 → 统一着色名（PlayerName）。
  const nameOf = useCallback(
    (playerId: string): ReactNode => {
      const p = byId.get(playerId);
      return p ? (
        <PlayerName name={p.name} seat={p.seat} isSelf={p.isHuman} />
      ) : (
        <span className="pname">某玩家</span>
      );
    },
    [byId],
  );

  const sections = useMemo<NavSection[]>(
    () => [
      { id: "prologue", label: "序幕" },
      ...archives.rounds.map((r) => ({
        id: r.id,
        label: `${r.kind === "night" ? "☾ 夜" : "☀ 天"}${r.n}`,
        dots: r.dots,
      })),
      { id: "finale", label: "终局" },
      { id: "qa", label: "问AI", qa: true },
    ],
    [archives],
  );

  const rootRef = useRef<HTMLDivElement | null>(null);
  const { curId, goTo } = useScrollSpy(
    rootRef,
    useMemo(() => sections.map((s) => s.id), [sections]),
  );
  const pulseJump = usePulseJump();

  // ── 幕后问答 state（只存内存，不持久化）。──────────────────
  const [qaLog, setQaLog] = useState<QaEntry[]>([]);
  const [qaId, setQaId] = useState(0);
  // 追问进行中显示的问题：await 期间先把问题上屏 + typing 三点，让用户看到「已点到、在等待」。
  const [pending, setPending] = useState<string | null>(null);
  const [qaCtx, setQaCtx] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleSend = async () => {
    const question = draft.trim();
    if (!question || pending !== null || busy) {
      return;
    }
    setDraft("");
    setPending(question);
    try {
      const result = await askReview(question);
      const answer = result.ok ? result.data : toUserMessage(result.error);
      const id = qaId + 1;
      setQaId(id);
      setQaLog((log) => [...log, { id, question, answer }]);
    } finally {
      setPending(null);
    }
  };

  // 「问这一轮」：设置情境 → 滚到问答区 → 预填输入，待滚动到位再聚焦。
  const askRound = (label: string) => {
    setQaCtx(label);
    goTo("qa");
    setDraft(`关于${label}：`);
    window.setTimeout(
      () => inputRef.current?.focus({ preventScroll: true }),
      REDUCED_MOTION ? 0 : 450,
    );
  };

  return (
    <div className="rv" ref={rootRef} aria-label="复盘">
      <ReviewNav
        sections={sections}
        curId={curId}
        qaPending={pending !== null}
        onGo={goTo}
      />
      <div className="page">
        <ReviewHero prologue={archives.prologue} onJumpDeath={pulseJump} />

        <div className="flow">
          {archives.rounds.map((round) =>
            round.kind === "night" ? (
              <NightCard
                key={round.id}
                archive={round}
                humanPlayerId={humanPlayerId}
                nameOf={nameOf}
                onAskRound={askRound}
              />
            ) : (
              <DayCard
                key={round.id}
                archive={round}
                humanPlayerId={humanPlayerId}
                byId={byId}
                nameOf={nameOf}
                onAskRound={askRound}
              />
            ),
          )}
          <FinaleCard finale={archives.finale} />
        </div>

        <ReviewQa
          qaLog={qaLog}
          pending={pending}
          qaCtx={qaCtx}
          draft={draft}
          setDraft={setDraft}
          busy={busy}
          inputRef={inputRef}
          onSend={handleSend}
        />

        <div className="btnrow">
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() =>
              act({
                type: "confirm_new_game",
                idempotencyKey: nextKey("newgame"),
                playerId: humanPlayerId,
              })
            }
          >
            🔄 开始新局
          </button>
          <button type="button" className="btn ghost" onClick={onExportDebug}>
            ⬇ 导出本局记录
          </button>
        </div>
      </div>
    </div>
  );
}
