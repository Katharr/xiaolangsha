import { Fragment, type ReactNode } from "react";

import type {
  DayArchive,
  Player,
  SeatRef,
  SpeechRow,
  VoteSectionArchive,
} from "../../shared";
import { Avatar } from "../Avatar";
import { ROLE_LABEL } from "../labels";
import { seatColorVar } from "../PlayerName";
import { NarrList, Nm, SpeechFold } from "./parts";

/**
 * 天卡（.rcard.day）：死讯公告（.annc）→ 猎人开枪（.shot，时序归卡头）→
 * 发言折叠（.sp-list）→ 投票区（.vblock，平票加赛夹 .tie-div + 拉票）→
 * 遗言 → 终局注（.endnote，铁律③）→ 叙事保底。
 */
export function DayCard({
  archive,
  humanPlayerId,
  byId,
  nameOf,
  onAskRound,
}: {
  archive: DayArchive;
  humanPlayerId: string;
  byId: Map<string, Player>;
  nameOf: (playerId: string) => ReactNode;
  onAskRound: (label: string) => void;
}) {
  const you = (p: SeatRef) => p.playerId === humanPlayerId;
  const shot = archive.hunterShot;
  const shotTarget = shot?.target ? byId.get(shot.target.playerId) : undefined;

  return (
    <section className="rwrap" id={archive.id}>
      <div className="rcard day">
        <div className="rhead">
          ☀ {archive.label}
          <button
            type="button"
            className="askbtn"
            onClick={() => onAskRound(archive.label)}
          >
            问这一轮
          </button>
        </div>
        <div className="rbody">
          {archive.announce ? (
            <div className="annc">☀ {archive.announce.text}</div>
          ) : null}

          {shot ? (
            <div className="shot" id={shot.anchorId}>
              🔫 <Nm p={shot.hunter} /> 亮出猎人身份，开枪带走{" "}
              <Nm p={shot.target} />
              {shotTarget ? (
                <>
                  {" "}
                  — 真身：
                  {shotTarget.faction === "werewolf_team" ? (
                    <b className="fw">狼人</b>
                  ) : (
                    <b className="fg">{ROLE_LABEL[shotTarget.role]}（好人）</b>
                  )}
                </>
              ) : null}
            </div>
          ) : null}

          {archive.speeches.length > 0 ? (
            <>
              <div className="sec-t">发言（点击展开全文）</div>
              <div className="sp-list">
                {archive.speeches.map((s) => (
                  <SpeechFold key={s.key} row={s} you={you(s.speaker)} />
                ))}
              </div>
            </>
          ) : null}

          <VoteBlock
            votes={archive.votes}
            tieSpeeches={archive.tieSpeeches}
            isYou={you}
          />

          {archive.lastWords.length > 0 ? (
            <>
              <div className="sec-t">遗言</div>
              {archive.lastWords.map((s) => (
                <SpeechFold key={s.key} row={s} you={you(s.speaker)} extraCls="lastw" />
              ))}
            </>
          ) : null}

          {archive.endNote ? (
            <div className="endnote">🏁 {archive.endNote}</div>
          ) : null}

          <NarrList lines={archive.narr} nameOf={nameOf} />
        </div>
      </div>
    </section>
  );
}

/**
 * 投票区：票数一律来自派生结构（源头是 vote_resolved.payload.tally），
 * UI 绝不自数 voters；平票节之后插 .tie-div + 拉票发言，结果行 .vres
 * 追加在所有轮次之后（放逐揭真身 / 平票流局说明）。
 */
function VoteBlock({
  votes,
  tieSpeeches,
  isYou,
}: {
  votes: VoteSectionArchive[];
  tieSpeeches: SpeechRow[];
  isYou: (p: SeatRef) => boolean;
}) {
  if (votes.length === 0) {
    return null;
  }
  const last = votes[votes.length - 1];

  return (
    <div className="vblock">
      {votes.map((v) => (
        <Fragment key={v.key}>
          <div className="v-sub">🗳️ {v.subLabel}</div>
          {v.groups.map((g) => (
            <div
              className={`vg${g.exiled ? " vg-exiled" : ""}`}
              key={g.target.playerId}
            >
              <span className="vg-arr">→</span>
              <Avatar seat={g.target.seat} className="pav pav-18" />
              <b className="nb" style={{ color: seatColorVar(g.target.seat) }}>
                {g.target.seat}号{g.target.name}
              </b>
              <span className="vg-n">×{g.count}</span>
              <span className="vg-sep">｜</span>
              <span className="vg-chips">
                {g.voters.map((voter) => (
                  <span
                    key={voter.playerId}
                    title={`${voter.seat}号 ${voter.name}`}
                  >
                    <Avatar seat={voter.seat} className="pav pav-16" />
                  </span>
                ))}
              </span>
              <span className="vg-names">
                {g.voters.map((voter) => `${voter.seat}号`).join("·")}
              </span>
            </div>
          ))}
          {v.abstains.length > 0 ? (
            <div className="vg abs">
              <span className="vg-arr">→</span>
              <span>弃票</span>
              <span className="vg-n vg-n-plain">×{v.abstains.length}</span>
              <span className="vg-sep">｜</span>
              <span className="vg-names vg-names-on">
                {v.abstains.map((a) => `${a.seat}号${a.name}`).join("·")}
              </span>
            </div>
          ) : null}
          {v.outcome === "tie" ? (
            <>
              <div className="tie-div">平票 · 加赛</div>
              {tieSpeeches.map((s) => (
                <SpeechFold key={s.key} row={s} you={isYou(s.speaker)} />
              ))}
            </>
          ) : null}
        </Fragment>
      ))}
      {last.outcome === "exile" && last.exiled ? (
        <div className="vres" id={last.exiled.anchorId}>
          ⚖ <Nm p={last.exiled} /> 被放逐（{last.exiled.count}票）— 真身：
          {last.exiled.faction === "werewolf_team" ? (
            <span className="fw">狼人</span>
          ) : (
            <span className="fg">{ROLE_LABEL[last.exiled.role]}（好人）</span>
          )}
        </div>
      ) : last.outcome === "no_exile" ? (
        <div className="vres">
          ⚖{" "}
          {last.groups.length === 0
            ? "全员弃票 · 无人放逐，直接入夜"
            : "加赛仍平票 · 无人放逐，直接入夜"}
        </div>
      ) : null}
    </div>
  );
}
