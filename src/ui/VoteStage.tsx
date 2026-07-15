import type { CSSProperties } from "react";

import type { VisibleInformationSnapshot } from "../shared";

import { Avatar } from "./Avatar";
import { PlayerName, seatColorVar } from "./PlayerName";
import { buildLookup, type Resolved, type Who } from "./seatTokens";
import { groupVotes } from "./VoteFlow";

/**
 * 中央舞台的开票揭示内容（stagger 全走 CSS 变量 delay：--d 行 / --dc chip / --dv 宣判）。
 * 数据口径：票向取当轮 vi.votes（结算后全显），票数取 vote_resolved payload.tally。
 * 淡入淡出由外层 AnimatePresence 负责，这里只管行内 stagger。
 */

const ROW_DELAY = 0.12;
const CHIP_BASE = 0.15;
const CHIP_STEP = 0.06;
const VERDICT_EXTRA = 0.6;

function delayVar(s: number): CSSProperties {
  return { "--d": `${s.toFixed(2)}s` } as CSSProperties;
}

function ChipAv({
  id,
  lookup,
  style,
}: {
  id: string;
  lookup: Map<string, Who>;
  style?: CSSProperties;
}) {
  const w = lookup.get(id);
  if (!w) {
    return null;
  }
  // .slink 是 display:contents：内层 chip 直接参与 .rv-chips 的 flex 叠瓦，
  // CSS 变量（--dc stagger）照常继承。
  return (
    <span className="slink" data-seat-link={w.seat} style={style}>
      <Avatar seat={w.seat} className="rv-chip" />
    </span>
  );
}

export function voteStageClassName(reveal: Resolved): string {
  return `stage reveal${reveal.outcome === "exile" ? " exile" : ""}`;
}

export function VoteStageContent({
  reveal,
  vi,
}: {
  reveal: Resolved;
  vi: VisibleInformationSnapshot;
}) {
  const lookup = buildLookup(vi);
  const votes = vi.votes.filter(
    (v) => v.day === reveal.day && v.voteRound === reveal.voteRound,
  );
  const { groups, abstains } = groupVotes(votes, lookup);

  let rowIndex = 0;
  const rows = groups.map((g) => {
    const i = rowIndex;
    rowIndex += 1;
    const w = lookup.get(g.targetId);
    return (
      <div className="rv-row" style={delayVar(i * ROW_DELAY)} key={g.targetId}>
        <span className="slink" data-seat-link={w?.seat}>
          <Avatar seat={w?.seat ?? 0} className="rv-av" />
        </span>
        <span
          className="rv-name"
          style={{
            color:
              g.targetId === vi.viewerId
                ? "var(--gold)"
                : seatColorVar(w?.seat ?? 0),
          }}
        >
          {w?.name ?? "某玩家"}
        </span>
        <span className="rv-chips">
          {g.voters.map((v, j) => (
            <ChipAv
              key={v}
              id={v}
              lookup={lookup}
              style={
                {
                  "--dc": `${(i * ROW_DELAY + CHIP_BASE + j * CHIP_STEP).toFixed(2)}s`,
                } as CSSProperties
              }
            />
          ))}
        </span>
        <span className="rv-n">{g.voters.length}</span>
      </div>
    );
  });

  let abstainRow = null;
  if (abstains.length > 0) {
    const i = rowIndex;
    rowIndex += 1;
    abstainRow = (
      <div className="rv-row abs" style={delayVar(i * ROW_DELAY)}>
        <span className="rv-name nb">弃票</span>
        <span className="rv-chips">
          {abstains.map((v, j) => (
            <ChipAv
              key={v}
              id={v}
              lookup={lookup}
              style={
                {
                  "--dc": `${(i * ROW_DELAY + CHIP_BASE + j * CHIP_STEP).toFixed(2)}s`,
                } as CSSProperties
              }
            />
          ))}
        </span>
        <span className="rv-n">{abstains.length}</span>
      </div>
    );
  }

  const vd = rowIndex * ROW_DELAY + VERDICT_EXTRA;
  const vdVar = { "--dv": `${vd.toFixed(2)}s` } as CSSProperties;

  let verdict = null;
  if (reveal.outcome === "exile" && reveal.exiledPlayerId) {
    const w = lookup.get(reveal.exiledPlayerId);
    const n = reveal.tally[reveal.exiledPlayerId];
    verdict = (
      <div className="rv-verdict" style={vdVar}>
        <Avatar seat={w?.seat ?? 0} className="rv-exile-av" />
        <div className="vtext">
          <PlayerName
            name={w?.name ?? "某玩家"}
            seat={w?.seat ?? 0}
            isSelf={reveal.exiledPlayerId === vi.viewerId}
          />{" "}
          <span className="nb">被放逐{n ? `（${n} 票）` : ""}</span>
        </div>
      </div>
    );
  } else if (reveal.outcome === "tie") {
    const max = Math.max(0, ...Object.values(reveal.tally));
    const ties = Object.entries(reveal.tally)
      .filter(([, n]) => n === max)
      .map(([id]) => id);
    verdict = (
      <div className="rv-verdict" style={vdVar}>
        <div className="rv-ties">
          {ties.map((id) => (
            <Avatar
              key={id}
              seat={lookup.get(id)?.seat ?? 0}
              className="rv-tie-av"
            />
          ))}
        </div>
        <div className="vtext">
          <span className="nb">平票 → 发言后加赛</span>
        </div>
      </div>
    );
  } else {
    verdict = (
      <div className="rv-verdict" style={vdVar}>
        <div className="vtext dim">
          <span className="nb">无人被放逐，即将入夜</span>
        </div>
      </div>
    );
  }

  return (
    <>
      <span className="stg-title">
        <span className="nb">
          开票 · {reveal.voteRound === "tie_break" ? "加赛" : "首轮"}
        </span>
      </span>
      <div className="rv-list">
        {rows}
        {abstainRow}
      </div>
      {verdict}
    </>
  );
}
