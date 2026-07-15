import { Fragment, useState } from "react";
import type { ReactNode } from "react";

import type { VisibleInformationSnapshot, VisibleVote } from "../shared";

import { Avatar } from "./Avatar";
import { PlayerName, seatColorVar } from "./PlayerName";
import {
  buildLookup,
  collectResolved,
  type Resolved,
  type Who,
} from "./seatTokens";

/**
 * 投票记录（左列过程档案的主体）：按「天」折叠卡 + 票流图。
 * 数据口径（防坑，基准 preview/vote-mockup-v3.html 注释）：
 * - VisibleVote.tally 恒 undefined，票数只能取 vote_resolved payload.tally；
 * - 弃票人数只能数当轮 votes 里 choiceType === "abstain"；
 * - 【保密口径】进行中一轮只渲染「🕐 暗投进行中 · 开票时公示」——零票向，
 *   连 viewer 自己的票也不在此出现（唯一出口 = 操作区确认条）。
 */

type RoundKey = "first" | "tie_break";

type VoteGroup = { targetId: string; voters: string[] };

/** 按目标聚合票型：票数降序，再按目标座位升序；弃票单列。 */
export function groupVotes(
  votes: VisibleVote[],
  lookup: Map<string, Who>,
): { groups: VoteGroup[]; abstains: string[] } {
  const by = new Map<string, string[]>();
  const abstains: string[] = [];
  for (const v of votes) {
    if (!v.voterId) continue;
    if (v.choiceType === "abstain" || !v.targetId) {
      abstains.push(v.voterId);
    } else {
      const list = by.get(v.targetId) ?? [];
      list.push(v.voterId);
      by.set(v.targetId, list);
    }
  }
  const seatOf = (id: string) => lookup.get(id)?.seat ?? 99;
  const groups = [...by.entries()]
    .map(([targetId, voters]) => ({
      targetId,
      voters: voters.sort((a, b) => seatOf(a) - seatOf(b)),
    }))
    .sort(
      (a, b) =>
        b.voters.length - a.voters.length ||
        seatOf(a.targetId) - seatOf(b.targetId),
    );
  return { groups, abstains: abstains.sort((a, b) => seatOf(a) - seatOf(b)) };
}

/** 小头像（带座位联动锚点；display:contents 包装不打破叠瓦布局）。 */
function ChipAv({ id, lookup, cls }: { id: string; lookup: Map<string, Who>; cls: string }) {
  const w = lookup.get(id);
  if (!w) {
    return null;
  }
  return (
    <span className="slink" data-seat-link={w.seat}>
      <Avatar seat={w.seat} className={cls} />
    </span>
  );
}

function RefName({
  id,
  lookup,
  viewerId,
}: {
  id: string | null | undefined;
  lookup: Map<string, Who>;
  viewerId: string;
}) {
  if (!id) {
    return <span className="pname-fallback">空</span>;
  }
  const w = lookup.get(id);
  if (!w) {
    return <span className="pname-fallback">某玩家</span>;
  }
  return <PlayerName name={w.name} seat={w.seat} isSelf={id === viewerId} />;
}

function RoundFlow({
  sub,
  votes,
  res,
  lookup,
  viewerId,
  waitYou,
}: {
  sub: string;
  votes: VisibleVote[];
  res: Resolved | undefined;
  lookup: Map<string, Who>;
  viewerId: string;
  waitYou: boolean;
}) {
  // 进行中：零票向（保密红线）。
  if (!res) {
    return (
      <div className="vr">
        <div className="vr-sub">{sub}</div>
        <div className="vf-pending nb">🕐 暗投进行中 · 开票时公示</div>
        {waitYou ? <div className="vf-mine nb">等待你投票…</div> : null}
      </div>
    );
  }

  const { groups, abstains } = groupVotes(votes, lookup);
  const max = groups.length > 0 ? groups[0].voters.length : 1;
  const exiledId = res.outcome === "exile" ? res.exiledPlayerId : null;

  let banner: ReactNode;
  if (res.outcome === "exile" && res.exiledPlayerId) {
    const n = res.tally[res.exiledPlayerId];
    banner = (
      <div className="vf-banner exile">
        <RefName id={res.exiledPlayerId} lookup={lookup} viewerId={viewerId} />{" "}
        <span className="nb">被放逐{n ? `（${n} 票）` : ""}</span>
      </div>
    );
  } else if (res.outcome === "tie") {
    const parts = Object.entries(res.tally);
    banner = (
      <div className="vf-banner tie">
        平票（
        {parts.map(([id, c], i) => (
          <Fragment key={id}>
            {i > 0 ? " / " : ""}
            <span className="nb">
              {lookup.get(id)?.name ?? "某玩家"} {c}
            </span>
          </Fragment>
        ))}
        ）<span className="nb">→ 进入加赛</span>
      </div>
    );
  } else {
    banner = (
      <div className="vf-banner tie">
        <span className="nb">无人被放逐，</span>
        <span className="nb">直接入夜</span>
      </div>
    );
  }

  return (
    <div className="vr">
      <div className="vr-sub">{sub}</div>
      {groups.map((g) => {
        const w = lookup.get(g.targetId);
        return (
          <div
            className={`vf-row${g.targetId === exiledId ? " exiled" : ""}`}
            key={g.targetId}
          >
            <span className="vf-chips">
              {g.voters.map((v) => (
                <ChipAv key={v} id={v} lookup={lookup} cls="vfc" />
              ))}
            </span>
            <span className="vf-arr">→</span>
            {/* 目标只放 头像+短名（不带「（N号）」——窄列下号码会把票数挤出行外；
                座位号由 hover 联动与 banner 全称兜底） */}
            <span className="vf-tgt slink" data-seat-link={w?.seat}>
              <Avatar seat={w?.seat ?? 0} className="vft" />
              <b
                className="nb"
                style={{
                  color:
                    g.targetId === viewerId
                      ? "var(--gold)"
                      : seatColorVar(w?.seat ?? 0),
                }}
              >
                {w?.name ?? "某玩家"}
              </b>
            </span>
            <span className="vf-bar">
              <i
                style={{
                  width: `${Math.round((g.voters.length / max) * 100)}%`,
                }}
              />
            </span>
            <span className="vf-n">{g.voters.length}</span>
          </div>
        );
      })}
      {abstains.length > 0 ? (
        <div className="vf-row abs">
          <span className="vf-chips">
            {abstains.map((v) => (
              <ChipAv key={v} id={v} lookup={lookup} cls="vfc" />
            ))}
          </span>
          <span className="vf-arr" />
          <span className="vf-tgt nb">弃票</span>
          <span className="vf-bar" style={{ visibility: "hidden" }} />
          <span className="vf-n">{abstains.length}</span>
        </div>
      ) : null}
      {banner}
    </div>
  );
}

function VoteDayCard({
  day,
  rounds,
  resolved,
  lookup,
  vi,
  defaultOpen,
}: {
  day: number;
  rounds: Map<RoundKey, VisibleVote[]>;
  resolved: Map<string, Resolved>;
  lookup: Map<string, Who>;
  vi: VisibleInformationSnapshot;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const first = resolved.get(`${day}:first`);
  const tie = resolved.get(`${day}:tie_break`);
  const final = tie ?? first;
  const pending =
    rounds.has("tie_break") && !tie ? true : !first && rounds.has("first");

  let summary: ReactNode;
  if (pending || !final) {
    summary = "进行中";
  } else if (final.outcome === "exile" && final.exiledPlayerId) {
    summary = (
      <>
        放逐{" "}
        <RefName id={final.exiledPlayerId} lookup={lookup} viewerId={vi.viewerId} />
      </>
    );
  } else if (final.outcome === "tie") {
    summary = "平票 · 待加赛";
  } else {
    summary = "无人放逐";
  }

  const waitYou =
    vi.canAct && vi.legalActions.some((a) => a.actionType === "vote");
  const order: RoundKey[] = ["first", "tie_break"];

  return (
    <div className={`vote-day${open ? " open" : ""}`}>
      <button
        type="button"
        className="vd-head"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="vd-arrow">▸</span>
        <span className="nb">第 {day} 天</span>
        <span className="vd-sum">{summary}</span>
      </button>
      <div className="vd-body">
        {order
          .filter((r) => rounds.has(r))
          .map((r) => (
            <RoundFlow
              key={r}
              sub={r === "first" ? "首轮" : "加赛"}
              votes={rounds.get(r) ?? []}
              res={resolved.get(`${day}:${r}`)}
              lookup={lookup}
              viewerId={vi.viewerId}
              waitYou={waitYou && day === vi.round.day}
            />
          ))}
      </div>
    </div>
  );
}

/** 投票记录整节（含 h4 标题；无记录时给空态说明）。 */
export function VoteArchive({ vi }: { vi: VisibleInformationSnapshot }) {
  const lookup = buildLookup(vi);
  const resolved = collectResolved(vi);

  // 按「天」→「轮次」分组。
  const days = new Map<number, Map<RoundKey, VisibleVote[]>>();
  const ensure = (day: number, rk: RoundKey) => {
    if (!days.has(day)) {
      days.set(day, new Map());
    }
    const rounds = days.get(day)!;
    if (!rounds.has(rk)) {
      rounds.set(rk, []);
    }
    return rounds.get(rk)!;
  };
  for (const v of vi.votes) {
    ensure(v.day, v.voteRound === "tie_break" ? "tie_break" : "first").push(v);
  }
  // 结算过的轮次即使 votes 为空也要有条目（理论上不会，防御）。
  for (const r of resolved.values()) {
    ensure(r.day, r.voteRound);
  }
  // 投票进行中：当前轮即使还没有任何可见票（自己未投），卡片也要出现。
  const voting = vi.gamePhase === "vote" || vi.gamePhase === "tie_vote";
  if (voting) {
    ensure(vi.round.day, vi.gamePhase === "tie_vote" ? "tie_break" : "first");
  }

  const dayKeys = [...days.keys()].sort((a, b) => b - a); // 最近一天在上
  const maxDay = dayKeys.length > 0 ? Math.max(...dayKeys) : 0;

  return (
    <div className="psec vote-sec">
      <h4>🗳️ 投票记录</h4>
      {dayKeys.length === 0 ? (
        <div className="empty-note">尚无投票记录。</div>
      ) : (
        dayKeys.map((day) => (
          <VoteDayCard
            key={day}
            day={day}
            rounds={days.get(day)!}
            resolved={resolved}
            lookup={lookup}
            vi={vi}
            defaultOpen={day === maxDay}
          />
        ))
      )}
    </div>
  );
}
