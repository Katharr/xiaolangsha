import { Fragment, useState } from "react";
import type { ReactNode } from "react";

import type {
  DeathCause,
  PublicDeathRef,
  VisibleInformationSnapshot,
  VisibleVote,
} from "../shared";

import { Avatar } from "./Avatar";
import { FACTION_LABEL, ROLE_LABEL } from "./labels";
import { PlayerName } from "./PlayerName";

/**
 * 左信息列（阶段 1.5）：上半「私密信息」（按角色变）+ 下半「公开信息」（人人同）。
 * 严格只读 vi（privateEvents / teammates / deadPlayers / votes / publicEvents），
 * 物理上拿不到 snapshot/events/AI 身份（ISO-001）。完整真相仍只在复盘出现（ISO-002）。
 */

type Who = { name: string; seat: number; alive: boolean };

function buildLookup(vi: VisibleInformationSnapshot): Map<string, Who> {
  const m = new Map<string, Who>();
  for (const p of vi.alivePlayers) {
    m.set(p.playerId, { name: p.name, seat: p.seat, alive: true });
  }
  for (const p of vi.deadPlayers) {
    m.set(p.playerId, { name: p.name, seat: p.seat, alive: false });
  }
  return m;
}

/** 按 id 渲染带座位色的玩家名（找不到则降级「某玩家」）。 */
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

function EmptyNote({ children }: { children: ReactNode }) {
  return <div className="empty-note">{children}</div>;
}

// ============ 私密信息抽取（全部来自 vi.privateEvents） ============

type SeerCheck = { night: number; targetId: string; isWolf: boolean };
function seerChecks(vi: VisibleInformationSnapshot): SeerCheck[] {
  const out: SeerCheck[] = [];
  for (const e of vi.privateEvents) {
    if (e.type !== "night_action_resolved") continue;
    const r = e.payload.result as Record<string, unknown> | undefined;
    if (!r || r.kind !== "seer_check_result") continue;
    out.push({
      night: e.round.night,
      targetId: String(r.targetId),
      isWolf: r.factionResult === "werewolf_team",
    });
  }
  return out.sort((a, b) => a.night - b.night);
}

type Used = { night: number; targetId: string };
type Wake = { night: number; killedTargetId: string | null };
function witchInfo(vi: VisibleInformationSnapshot): {
  saves: Used[];
  poisons: Used[];
  wakes: Wake[];
} {
  const saves: Used[] = [];
  const poisons: Used[] = [];
  const wakes: Wake[] = [];
  for (const e of vi.privateEvents) {
    if (e.type === "night_action_submitted") {
      const at = e.payload.actionType;
      if (at === "witch_save") {
        saves.push({ night: e.round.night, targetId: String(e.payload.targetId) });
      } else if (at === "witch_poison") {
        poisons.push({ night: e.round.night, targetId: String(e.payload.targetId) });
      }
    } else if (e.type === "night_action_resolved") {
      const r = e.payload.result as Record<string, unknown> | undefined;
      if (r && r.kind === "witch_wake") {
        wakes.push({
          night: e.round.night,
          killedTargetId: r.killedTargetId ? String(r.killedTargetId) : null,
        });
      }
    }
  }
  return { saves, poisons, wakes };
}

function guardLogs(vi: VisibleInformationSnapshot): Used[] {
  const out: Used[] = [];
  for (const e of vi.privateEvents) {
    if (e.type === "night_action_submitted" && e.payload.actionType === "guard_protect") {
      out.push({ night: e.round.night, targetId: String(e.payload.targetId) });
    }
  }
  return out.sort((a, b) => a.night - b.night);
}

type Kill = { night: number; targetId: string | null; killed: boolean };
function wolfKills(vi: VisibleInformationSnapshot): Kill[] {
  const out: Kill[] = [];
  for (const e of vi.privateEvents) {
    if (e.type !== "night_action_resolved") continue;
    const r = e.payload.result as Record<string, unknown> | undefined;
    if (!r || r.kind !== "kill_result") continue;
    out.push({
      night: e.round.night,
      targetId: r.targetId ? String(r.targetId) : null,
      killed: Boolean(r.killed),
    });
  }
  return out.sort((a, b) => a.night - b.night);
}

// ============ 私密面板 ============

function IdCard({ vi }: { vi: VisibleInformationSnapshot }) {
  const wolf = vi.ownFaction === "werewolf_team";
  return (
    <div className="idcard">
      <Avatar seat={vi.ownSeat} className="id-av" />
      <div>
        <div className="id-name">
          <PlayerName name={vi.ownName} seat={vi.ownSeat} isSelf />
        </div>
        <div className="id-role">
          {ROLE_LABEL[vi.ownRole]} ·{" "}
          <span className={`fac ${wolf ? "wolf" : "good"}`}>
            {FACTION_LABEL[vi.ownFaction]}
          </span>
        </div>
      </div>
    </div>
  );
}

function PrivatePanel({ vi }: { vi: VisibleInformationSnapshot }) {
  const lookup = buildLookup(vi);
  const ref = (id: string | null | undefined) => (
    <RefName id={id} lookup={lookup} viewerId={vi.viewerId} />
  );

  let body: ReactNode;
  switch (vi.ownRole) {
    case "seer": {
      const checks = seerChecks(vi);
      body = (
        <div className="psec">
          <h4>🔍 查验记录</h4>
          {checks.length === 0 ? (
            <EmptyNote>尚无查验记录。</EmptyNote>
          ) : (
            checks.map((c) => {
              const w = lookup.get(c.targetId);
              return (
                <div className="chk" key={`${c.night}-${c.targetId}`}>
                  <span className="chk-night">第{c.night}夜</span>
                  <Avatar seat={w?.seat ?? c.night} className="chk-av" />
                  <span className="chk-name">{ref(c.targetId)}</span>
                  <span className={c.isWolf ? "badge-wolf" : "badge-good"}>
                    {c.isWolf ? "狼人" : "好人"}
                  </span>
                </div>
              );
            })
          )}
        </div>
      );
      break;
    }
    case "witch": {
      const { saves, poisons, wakes } = witchInfo(vi);
      const save = saves[0];
      const poison = poisons[0];
      body = (
        <>
          <div className="psec">
            <h4>🧪 药剂状态</h4>
            <div className={`potion${save ? " used" : ""}`}>
              <span className="p-ic">💊</span>
              <div className="p-main">
                <b>解药</b>
                <div className="p-sub">
                  {save ? <>第{save.night}夜 救了 {ref(save.targetId)}</> : "尚未使用"}
                </div>
              </div>
              <span className={`p-tag ${save ? "used" : "ok"}`}>
                {save ? "已用" : "可用"}
              </span>
            </div>
            <div className={`potion${poison ? " used" : ""}`}>
              <span className="p-ic">☠️</span>
              <div className="p-main">
                <b>毒药</b>
                <div className="p-sub">
                  {poison ? (
                    <>第{poison.night}夜 毒了 {ref(poison.targetId)}</>
                  ) : (
                    "尚未使用"
                  )}
                </div>
              </div>
              <span className={`p-tag ${poison ? "used" : "ok"}`}>
                {poison ? "已用" : "可用"}
              </span>
            </div>
          </div>
          {wakes.length > 0 ? (
            <div className="psec">
              <h4>🌙 夜间情报</h4>
              {wakes.map((w) => {
                const savedHere =
                  w.killedTargetId !== null &&
                  saves.some(
                    (s) => s.night === w.night && s.targetId === w.killedTargetId,
                  );
                return (
                  <div className="night-info" key={w.night}>
                    第{w.night}夜：
                    {w.killedTargetId ? (
                      <>
                        今晚倒牌的是 {ref(w.killedTargetId)}
                        {savedHere ? "（你已用解药救回）" : ""}
                      </>
                    ) : (
                      "今晚是平安夜"
                    )}
                  </div>
                );
              })}
            </div>
          ) : null}
        </>
      );
      break;
    }
    case "guard": {
      const logs = guardLogs(vi);
      body = (
        <div className="psec">
          <h4>🛡️ 守护记录</h4>
          {logs.length === 0 ? (
            <EmptyNote>尚无守护记录。</EmptyNote>
          ) : (
            logs.map((g) => (
              <div className="logline" key={`${g.night}-${g.targetId}`}>
                <span className="ln-night">第{g.night}夜</span>
                <span className="ln-main">守护 {ref(g.targetId)}</span>
              </div>
            ))
          )}
        </div>
      );
      break;
    }
    case "werewolf": {
      const kills = wolfKills(vi);
      body = (
        <>
          <div className="psec">
            <h4>🐺 狼队（含你共 {vi.teammates.length + 1} 人）</h4>
            {vi.teammates.length === 0 ? (
              <EmptyNote>只有你一匹狼，独狼作战。</EmptyNote>
            ) : (
              vi.teammates.map((t) => (
                <div className={`mate${t.alive ? "" : " dead"}`} key={t.playerId}>
                  <Avatar seat={t.seat} className="m-av" />
                  <span className="m-name">
                    <PlayerName name={t.name} seat={t.seat} muted={!t.alive} />
                  </span>
                  <span className="m-st">{t.alive ? "存活" : "出局"}</span>
                </div>
              ))
            )}
          </div>
          <div className="psec">
            <h4>🔪 击杀记录</h4>
            {kills.length === 0 ? (
              <EmptyNote>尚无击杀记录。</EmptyNote>
            ) : (
              kills.map((k) => (
                <div className="logline" key={k.night}>
                  <span className="ln-night">第{k.night}夜</span>
                  <span className="ln-main">
                    目标 {k.targetId ? ref(k.targetId) : "空刀"}
                  </span>
                  <span className={k.killed ? "badge-wolf" : "badge-good"}>
                    {k.killed ? "得手" : "未得手"}
                  </span>
                </div>
              ))
            )}
          </div>
        </>
      );
      break;
    }
    case "hunter": {
      body = (
        <EmptyNote>
          你是猎人。出局时（被刀或被放逐）可开枪带走场上一人。
          <br />
          白天靠发言与推理揪出隐藏的狼。
        </EmptyNote>
      );
      break;
    }
    default: {
      body = (
        <EmptyNote>
          你没有夜间能力。
          <br />
          靠白天的发言与推理揪出隐藏的狼吧。
        </EmptyNote>
      );
    }
  }

  return (
    <>
      <IdCard vi={vi} />
      {body}
    </>
  );
}

// ============ 公开面板 ============

const CAUSE_LABEL: Record<DeathCause, string> = {
  night_kill: "夜里出局",
  exile: "被放逐",
  poison: "被毒杀",
  hunter_shot: "被带走",
};

function isNightCause(cause: DeathCause): boolean {
  return cause === "night_kill" || cause === "poison";
}

function deathWhen(d: PublicDeathRef): string {
  return isNightCause(d.deathCause)
    ? `第${d.round.night}夜`
    : `第${d.round.day}天`;
}

/** 出局排序键：夜在同号白天之前。 */
function deathOrder(d: PublicDeathRef): number {
  return isNightCause(d.deathCause) ? d.round.night * 10 : d.round.day * 10 + 5;
}

function DeathSection({ vi }: { vi: VisibleInformationSnapshot }) {
  const deaths = [...vi.deadPlayers].sort((a, b) => deathOrder(a) - deathOrder(b));
  return (
    <div className="psec">
      <h4>💀 死亡公告</h4>
      {deaths.length === 0 ? (
        <EmptyNote>目前无人出局。</EmptyNote>
      ) : (
        deaths.map((d) => (
          <div className="death-row" key={d.playerId}>
            <span className="d-when">{deathWhen(d)}</span>
            <Avatar seat={d.seat} className="d-av" />
            <span className="d-name">
              <PlayerName
                name={d.name}
                seat={d.seat}
                isSelf={d.playerId === vi.viewerId}
              />
            </span>
            <span className="d-cause">{CAUSE_LABEL[d.deathCause]}</span>
          </div>
        ))
      )}
    </div>
  );
}

type Resolved = {
  outcome: "exile" | "tie" | "no_exile";
  exiledPlayerId: string | null;
  tally: Record<string, number>;
};

function normRound(round: string): "first" | "tie_break" {
  return round === "tie_break" ? "tie_break" : "first";
}

function collectResolved(vi: VisibleInformationSnapshot): Map<string, Resolved> {
  const m = new Map<string, Resolved>();
  for (const e of vi.publicEvents) {
    if (e.type !== "vote_resolved") continue;
    const key = `${e.round.day}:${normRound(e.round.voteRound)}`;
    m.set(key, {
      outcome: (e.payload.outcome as Resolved["outcome"]) ?? "no_exile",
      exiledPlayerId:
        typeof e.payload.exiledPlayerId === "string"
          ? e.payload.exiledPlayerId
          : null,
      tally: (e.payload.tally as Record<string, number>) ?? {},
    });
  }
  return m;
}

function VoteResult({
  res,
  lookup,
  viewerId,
}: {
  res: Resolved | undefined;
  lookup: Map<string, Who>;
  viewerId: string;
}) {
  if (!res) {
    return null;
  }
  const ref = (id: string) => (
    <RefName id={id} lookup={lookup} viewerId={viewerId} />
  );
  if (res.outcome === "exile" && res.exiledPlayerId) {
    const count = res.tally[res.exiledPlayerId];
    return (
      <div className="vr-result">
        {ref(res.exiledPlayerId)} 被放逐{count ? `（${count} 票）` : ""}
      </div>
    );
  }
  if (res.outcome === "tie") {
    const parts = Object.entries(res.tally);
    return (
      <div className="vr-result">
        平票（
        {parts.map(([id, c], i) => (
          <Fragment key={id}>
            {i > 0 ? " / " : ""}
            {ref(id)} {c}
          </Fragment>
        ))}
        ）→ 进入加赛
      </div>
    );
  }
  return <div className="vr-result">无人被放逐</div>;
}

function VoteDayCard({
  day,
  rounds,
  resolved,
  lookup,
  viewerId,
  defaultOpen,
}: {
  day: number;
  rounds: Map<"first" | "tie_break", VisibleVote[]>;
  resolved: Map<string, Resolved>;
  lookup: Map<string, Who>;
  viewerId: string;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const ref = (id: string | null | undefined) => (
    <RefName id={id} lookup={lookup} viewerId={viewerId} />
  );
  const finalRound: "first" | "tie_break" = rounds.has("tie_break")
    ? "tie_break"
    : "first";
  const finalRes = resolved.get(`${day}:${finalRound}`);
  const summary = finalRes
    ? finalRes.outcome === "exile" && finalRes.exiledPlayerId
      ? ref(finalRes.exiledPlayerId)
      : "无人放逐"
    : "进行中";
  const order: Array<"first" | "tie_break"> = ["first", "tie_break"];

  return (
    <div className={`vote-day${open ? " open" : ""}`}>
      <button
        type="button"
        className="vd-head"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="vd-arrow">▸</span>
        <span>第 {day} 天</span>
        <span className="vd-sum">
          {finalRes && finalRes.outcome === "exile" ? <>放逐 {summary}</> : summary}
        </span>
      </button>
      <div className="vd-body">
        {order
          .filter((r) => rounds.has(r))
          .map((r) => (
            <div className="vr" key={r}>
              <div className="vr-sub">{r === "first" ? "首轮" : "加赛"}</div>
              {(rounds.get(r) ?? []).map((v) => (
                <div className="vline" key={v.eventId}>
                  {ref(v.voterId)}
                  {v.choiceType === "abstain" ? (
                    <span className="vabs">弃票</span>
                  ) : (
                    <>
                      <span className="varr">→</span>
                      {ref(v.targetId)}
                    </>
                  )}
                </div>
              ))}
              <VoteResult
                res={resolved.get(`${day}:${r}`)}
                lookup={lookup}
                viewerId={viewerId}
              />
            </div>
          ))}
      </div>
    </div>
  );
}

function VoteSection({ vi }: { vi: VisibleInformationSnapshot }) {
  const lookup = buildLookup(vi);
  const resolved = collectResolved(vi);

  // 按「天」→「轮次」分组。
  const days = new Map<number, Map<"first" | "tie_break", VisibleVote[]>>();
  for (const v of vi.votes) {
    if (!days.has(v.day)) {
      days.set(v.day, new Map());
    }
    const rounds = days.get(v.day)!;
    const rk = v.voteRound === "tie_break" ? "tie_break" : "first";
    if (!rounds.has(rk)) {
      rounds.set(rk, []);
    }
    rounds.get(rk)!.push(v);
  }

  const dayKeys = [...days.keys()].sort((a, b) => b - a); // 最近一天在上
  const maxDay = dayKeys.length > 0 ? Math.max(...dayKeys) : 0;

  return (
    <div className="psec">
      <h4>🗳️ 投票记录</h4>
      {dayKeys.length === 0 ? (
        <EmptyNote>尚无投票记录。</EmptyNote>
      ) : (
        dayKeys.map((day) => (
          <VoteDayCard
            key={day}
            day={day}
            rounds={days.get(day)!}
            resolved={resolved}
            lookup={lookup}
            viewerId={vi.viewerId}
            defaultOpen={day === maxDay}
          />
        ))
      )}
    </div>
  );
}

// ============ 外壳 ============

export function InfoPanel({ vi }: { vi: VisibleInformationSnapshot }) {
  return (
    <aside className="info" aria-label="信息面板">
      <div className="info-head">
        🔒 <b>你的私密信息</b> · 仅你可见
      </div>
      <div className="info-body">
        <PrivatePanel vi={vi} />
        <div className="pub-divider">
          <span>公 开 信 息</span>
        </div>
        <DeathSection vi={vi} />
        <VoteSection vi={vi} />
      </div>
    </aside>
  );
}
