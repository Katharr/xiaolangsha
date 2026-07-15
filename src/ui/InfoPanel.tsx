import type { ReactNode } from "react";

import type { VisibleInformationSnapshot } from "../shared";

import { PlayerName } from "./PlayerName";
import { buildLookup, witchInfo, wolfKills } from "./seatTokens";
import { VoteArchive } from "./VoteFlow";

/**
 * 左列「过程档案」（v3 信息上桌后的收缩版）：只剩两节——
 * 🌙 夜报（无座位锚点的私密流水兜底，仅有内容的角色渲染）+ 🗳️ 投票记录。
 * 身份卡/查验史/药剂状态/狼队/死亡公告已全部上桌（座位铭牌 token / 角色胶囊 /
 * 死因 chip），遵守「信息不重复：上桌即从面板删除」纪律。
 * 严格只读 vi（ISO-001）；完整真相仍只在复盘出现（ISO-002）。
 */

type NightRow = { key: string; night: number; seat: number | null; content: ReactNode };

/**
 * 夜报条目：只收「没有座位锚点」或「相对公开事实有私密增量」的流水；
 * 纯重复公开事实（或已被座位 token 覆盖）的行不许进夜报。
 */
function nightReport(vi: VisibleInformationSnapshot): NightRow[] {
  switch (vi.ownRole) {
    case "witch": {
      const lookup = buildLookup(vi);
      const { saves, poisons, wakes } = witchInfo(vi);
      const rows: NightRow[] = [];
      for (const w of wakes) {
        if (!w.killedTargetId) {
          // 空刀夜：公开只知「平安夜」，女巫独知不是被救回。
          rows.push({
            key: `wake-${w.night}`,
            night: w.night,
            seat: null,
            content: <span className="nb">平安夜 · 无人倒牌</span>,
          });
          continue;
        }
        const savedHere = saves.some(
          (s) => s.night === w.night && s.targetId === w.killedTargetId,
        );
        if (savedHere) {
          continue; // 座位「救」token 已覆盖，纯重复不进夜报。
        }
        const who = lookup.get(w.killedTargetId);
        const poisonedHere = poisons.some((p) => p.night === w.night);
        rows.push({
          key: `wake-${w.night}`,
          night: w.night,
          seat: who?.seat ?? null,
          content: (
            <>
              倒牌：
              {who ? (
                <PlayerName
                  name={who.name}
                  seat={who.seat}
                  isSelf={w.killedTargetId === vi.viewerId}
                />
              ) : (
                "某玩家"
              )}
              {poisonedHere ? null : (
                <span className="nb n-extra"> · 你未用毒</span>
              )}
            </>
          ),
        });
      }
      return rows;
    }
    case "werewolf": {
      // 只收空刀夜（未得手的刀有座位 token，得手的刀有公开死因牌）。
      return wolfKills(vi)
        .filter((k) => !k.killed && k.targetId === null)
        .map((k) => ({
          key: `kill-${k.night}`,
          night: k.night,
          seat: null,
          content: <span className="nb">空刀 · 无人倒牌</span>,
        }));
    }
    default:
      return [];
  }
}

export function InfoPanel({ vi }: { vi: VisibleInformationSnapshot }) {
  const rows = nightReport(vi);
  return (
    <aside className="info" aria-label="过程档案">
      <div className="info-head">
        📜 <b>过程档案</b>
        {rows.length > 0 ? " · 夜报仅你可见" : ""}
      </div>
      <div className="info-body">
        {rows.length > 0 ? (
          <div className="psec">
            <h4>🌙 夜报 · 仅你可见</h4>
            {rows.map((r) => (
              <div
                className="nrow"
                key={r.key}
                {...(r.seat !== null ? { "data-seat-link": r.seat } : {})}
              >
                <span className="n-when nb">夜{r.night}</span>
                <span>{r.content}</span>
              </div>
            ))}
          </div>
        ) : null}
        <VoteArchive vi={vi} />
      </div>
    </aside>
  );
}
