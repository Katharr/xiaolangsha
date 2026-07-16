import type { ReactNode } from "react";

import type {
  NarrLine,
  NightActionKind,
  NightResultBadge,
  SeatRef,
  SpeechRow,
} from "../../shared";
import { Avatar } from "../Avatar";
import { seatColorVar } from "../PlayerName";

/**
 * 复盘时间线的基础元件：小铭牌 / 彩名 / 行动 token / 结果徽章 /
 * 叙事保底列表 / 发言折叠。全部只消费 deriveRoundArchives 的派生结构。
 */

/** 玩家小铭牌（.mp）：头像 + 座位色名字 + N号 + 可选「你」徽章。 */
export function Mp({
  p,
  you = false,
  size = 20,
}: {
  p: SeatRef;
  you?: boolean;
  size?: 20 | 18;
}) {
  return (
    <span className="mp">
      <Avatar seat={p.seat} className={`pav pav-${size}`} />
      <b style={{ color: seatColorVar(p.seat) }}>{p.name}</b>
      <span className="mp-no">{p.seat}号</span>
      {you ? <span className="mp-you">你</span> : null}
    </span>
  );
}

/** 纯文本彩色「N号名」（.nb 防拆行）。 */
export function Nm({ p }: { p: SeatRef }) {
  return (
    <b className="nb" style={{ color: seatColorVar(p.seat) }}>
      {p.seat}号{p.name}
    </b>
  );
}

const ATK: Record<NightActionKind, { cls: string; ch: string }> = {
  kill: { cls: "atk-kill", ch: "刀" },
  check: { cls: "atk-check", ch: "验" },
  save: { cls: "atk-save", ch: "救" },
  poison: { cls: "atk-poison", ch: "毒" },
  guard: { cls: "atk-guard", ch: "守" },
  skip: { cls: "atk-none", ch: "空" },
};

/** 夜间行动 token（.atk 圆标）。 */
export function AtkToken({ kind }: { kind: NightActionKind }) {
  const t = ATK[kind];
  return <span className={`atk ${t.cls}`}>{t.ch}</span>;
}

/** 行动结果徽章（.rb）；save 行数据层无 badge，固定渲染「解药」。 */
export function ResultBadge({
  kind,
  badge,
}: {
  kind: NightActionKind;
  badge?: NightResultBadge;
}) {
  if (kind === "save") {
    return <span className="rb rb-saved">解药</span>;
  }
  if (!badge) {
    return null;
  }
  switch (badge.kind) {
    case "saved":
      return <span className="rb rb-saved">未死 · 被救</span>;
    case "plain":
      return <span className="rb rb-plain">得手</span>;
    case "poison":
      return <span className="rb rb-poison">毒杀</span>;
    case "check":
      return badge.faction === "werewolf_team" ? (
        <span className="rb rb-bad">查杀</span>
      ) : (
        <span className="rb rb-good">金水</span>
      );
  }
}

/** 叙事保底区（.narr）：narrateEvent 兜底行，segments 里的玩家交给 nameOf 着色。 */
export function NarrList({
  lines,
  nameOf,
}: {
  lines: NarrLine[];
  nameOf: (playerId: string) => ReactNode;
}) {
  if (lines.length === 0) {
    return null;
  }
  return (
    <div className="narr">
      <div className="sec-t">其余事件 · 叙事保底</div>
      {lines.map((line) => (
        <div className="nline" key={line.key}>
          <i className={`dot nd-${line.dot}`} />
          <span>
            {line.segments.map((seg, i) =>
              typeof seg === "string" ? (
                <span key={i}>{seg}</span>
              ) : (
                <span key={i}>{nameOf(seg.playerId)}</span>
              ),
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * 发言一条（.sp）：>42 字用原生 <details> 折叠（摘要 40 字 + 展开全文），
 * ≤42 字渲染不可折叠的 div——展开态由浏览器管理，零 React state。
 */
export function SpeechFold({
  row,
  you = false,
  extraCls,
}: {
  row: SpeechRow;
  you?: boolean;
  extraCls?: string;
}) {
  const cls = `sp${extraCls ? ` ${extraCls}` : ""}`;
  const head = (
    <>
      <Mp p={row.speaker} you={you} />
      {row.tag ? <span className="sp-tag">{row.tag}</span> : null}
    </>
  );
  if (row.text.length <= 42) {
    return (
      <div className={cls}>
        <div className="sp-sum">
          {head}
          <span className="excerpt">{row.text}</span>
        </div>
      </div>
    );
  }
  return (
    <details className={cls}>
      <summary>
        {head}
        <span className="excerpt">{row.text.slice(0, 40)}…</span>
        <span className="exp">展开全文 ▾</span>
      </summary>
      <div className="full">{row.text}</div>
    </details>
  );
}
