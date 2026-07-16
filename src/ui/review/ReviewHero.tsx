import { Fragment, type CSSProperties } from "react";

import type { ReviewPrologue } from "../../shared";
import { Avatar } from "../Avatar";

/**
 * 第0幕 · 终局揭示：结果横幅（.banner）+ 身份揭示墙（.wall，翻面入场）
 * + 死亡缩略带（.strip，点跳 + 金脉冲）。数据全部来自 prologue 派生结构。
 */
export function ReviewHero({
  prologue,
  onJumpDeath,
}: {
  prologue: ReviewPrologue;
  onJumpDeath: (anchorId: string) => void;
}) {
  const wolfWin = prologue.winner === "werewolf_team";
  // 身份墙死因胶囊用短标签（deathOrder 里带 causeShort），按座位反查。
  const chipBySeat = new Map(prologue.deathOrder.map((c) => [c.seat, c]));

  return (
    <section className="hero" id="prologue">
      <div className={`banner ${wolfWin ? "win-wolf" : "win-good"}`}>
        <div className="b-kicker">— 复 盘 · 真 相 卷 轴 —</div>
        <div className="b-title">
          {wolfWin ? "🐺 " : "🌾 "}
          {prologue.winTitle}
        </div>
        <div className="b-sub">
          {prologue.winReasonText} · {prologue.boardNote}
        </div>
        <div className="b-hint">
          身份与死因已全部揭示 · 点击时间轴节点或死亡时序可跳转对应轮次
        </div>
      </div>

      <div className="wall">
        {prologue.players.map((card, i) => {
          const wolf = card.faction === "werewolf_team";
          const chip = chipBySeat.get(card.seat);
          return (
            <div
              key={card.playerId}
              className={`wcard ${wolf ? "fw" : "fg"}${card.alive ? "" : " dead"}`}
              style={{ "--i": i } as CSSProperties}
            >
              {wolf ? <span className="w-wolfmark">🐺</span> : null}
              <span className="wav">
                <Avatar seat={card.seat} className="pav pav-46" />
              </span>
              <div className="w-name">
                {card.name}
                {card.isHuman ? <span className="mp-you">你</span> : null}
              </div>
              <div className="w-no">{card.seat}号</div>
              <div className={`w-role${wolf ? " wolfr" : ""}`}>{card.roleLabel}</div>
              {card.death ? (
                <span
                  className="dchip"
                  title={`${card.death.roundLabel} ${card.death.causeLabel}`}
                >
                  {chip?.causeShort ?? card.death.causeLabel} ·{" "}
                  {card.death.roundLabel}
                  {card.death.exileVotes !== undefined ? (
                    <i className="xn">×{card.death.exileVotes}</i>
                  ) : null}
                </span>
              ) : (
                <span className="dchip alive">存活</span>
              )}
            </div>
          );
        })}
      </div>

      <div className="strip">
        <span className="s-lbl">死亡时序</span>
        {prologue.deathOrder.length === 0 ? (
          <span>本局无人出局</span>
        ) : (
          prologue.deathOrder.map((d, i) => (
            <Fragment key={d.anchorId}>
              {i > 0 ? <span className="s-arr">→</span> : null}
              <button
                type="button"
                className="schip"
                title="点击跳转到对应轮次"
                onClick={() => onJumpDeath(d.anchorId)}
              >
                ☠ {d.seat}号{d.name} · {d.causeShort}
                {d.exileVotes !== undefined ? (
                  <i className="xn">×{d.exileVotes}</i>
                ) : null}
              </button>
            </Fragment>
          ))
        )}
      </div>
    </section>
  );
}
