import type { ReactNode } from "react";

import type { NightArchive, SeatRef } from "../../shared";
import { AtkToken, Mp, NarrList, Nm, ResultBadge } from "./parts";

/**
 * 夜卡（.rcard.night）：行动真相（.arow，狼队分歧 .split 全宽）→
 * 死亡结算（平安夜 .peace / .dbn，毒杀带 .masked 掩蔽措辞标注）→ 叙事保底。
 */
export function NightCard({
  archive,
  humanPlayerId,
  nameOf,
  onAskRound,
}: {
  archive: NightArchive;
  humanPlayerId: string;
  nameOf: (playerId: string) => ReactNode;
  onAskRound: (label: string) => void;
}) {
  const you = (p: SeatRef) => p.playerId === humanPlayerId;

  return (
    <section className="rwrap" id={archive.id}>
      <div className="rcard night">
        <div className="rhead">
          ☾ {archive.label}
          <button
            type="button"
            className="askbtn"
            onClick={() => onAskRound(archive.label)}
          >
            问这一轮
          </button>
        </div>
        <div className="rbody">
          <div className="sec-t">行动真相</div>
          {archive.actions.map((a) => (
            <div className="arow" key={a.key}>
              <Mp p={a.actor} you={you(a.actor)} />
              <AtkToken kind={a.kind} />
              {a.target ? (
                <Mp p={a.target} you={you(a.target)} />
              ) : a.kind === "skip" ? (
                <span className="none-t">空过 · 不用药</span>
              ) : null}
              <ResultBadge kind={a.kind} badge={a.badge} />
              <span className="hid">对局中隐藏</span>
              {a.wolfSplit ? (
                <div className="split">
                  🐺 狼队分歧：
                  {a.wolfSplit.map((w, i) => (
                    <span key={w.wolf.playerId}>
                      {i > 0 ? " ／ " : ""}
                      <Nm p={w.wolf} /> 刀 {w.target.seat}号
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
          {archive.emptyNote ? (
            <div className="empty">{archive.emptyNote}</div>
          ) : null}

          <div className="sec-t">死亡结算</div>
          {archive.deaths.length === 0 ? (
            <div className="peace">
              🌙 平安夜
              <small>昨夜无人出局 — 刀口与用药真相见上方行动区</small>
            </div>
          ) : (
            archive.deaths.map((d) => (
              <div
                className={`dbn${d.masked ? " poison" : ""}`}
                id={d.anchorId}
                key={d.anchorId}
              >
                ☠ <Nm p={d.victim} /> 出局 —{" "}
                <span className="truth">{d.truthText}</span>
                {d.extra ? <span className="rb rb-poison">{d.extra}</span> : null}
                {d.masked ? (
                  <span className="masked">
                    对局中显示为：夜里出局（死法不公布 · 规则铁律② ·
                    复盘揭示真相）
                  </span>
                ) : null}
              </div>
            ))
          )}

          <NarrList lines={archive.narr} nameOf={nameOf} />
        </div>
      </div>
    </section>
  );
}
