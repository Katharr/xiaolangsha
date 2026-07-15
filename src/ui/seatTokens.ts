import type {
  DeathCause,
  PublicDeathRef,
  Role,
  VisibleInformationSnapshot,
} from "../shared";

import { ROLE_DUTY } from "./labels";

/**
 * 座位铭牌 token 派生（ISO-001 核心）：全部由 viewer 作用域的纯函数从
 * vi.privateEvents / vi.teammates / vi.deadPlayers / vi.publicEvents 派生，
 * 座位组件只吃派生结果、绝不接触跨 viewer 数据。
 *
 * 纪律（基准 preview/vote-mockup-v3.html 注释）：
 * - 私密 token 全部产生于夜晚结算（天亮公告帧），投票进行中绝不新增/变化。
 * - 「得手的刀」不挂 token——公开死因牌已表达；只有未得手的刀挂 .tk-knife。
 * - 毒杀 token 必须与公开死因牌同帧：仅当目标已在 deadPlayers 且
 *   deathCause === "poison" 才挂，不得早于 death 事件。
 * - 死因 chip 的 ×N（放逐票数持久层）只取 vote_resolved payload.tally。
 * - 私密 tooltip 一律以「· 仅你可见」结尾。
 */

// ============ 通用查找 ============

export type Who = { name: string; seat: number; alive: boolean };

export function buildLookup(vi: VisibleInformationSnapshot): Map<string, Who> {
  const m = new Map<string, Who>();
  for (const p of vi.alivePlayers) {
    m.set(p.playerId, { name: p.name, seat: p.seat, alive: true });
  }
  for (const p of vi.deadPlayers) {
    m.set(p.playerId, { name: p.name, seat: p.seat, alive: false });
  }
  return m;
}

// ============ 私密事件抽取（原 InfoPanel 内部函数迁出共享） ============

export type SeerCheck = { night: number; targetId: string; isWolf: boolean };

export function seerChecks(vi: VisibleInformationSnapshot): SeerCheck[] {
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

export type Used = { night: number; targetId: string };
export type Wake = { night: number; killedTargetId: string | null };

export function witchInfo(vi: VisibleInformationSnapshot): {
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
        poisons.push({
          night: e.round.night,
          targetId: String(e.payload.targetId),
        });
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

export function guardLogs(vi: VisibleInformationSnapshot): Used[] {
  const out: Used[] = [];
  for (const e of vi.privateEvents) {
    if (
      e.type === "night_action_submitted" &&
      e.payload.actionType === "guard_protect"
    ) {
      out.push({ night: e.round.night, targetId: String(e.payload.targetId) });
    }
  }
  return out.sort((a, b) => a.night - b.night);
}

export type Kill = { night: number; targetId: string | null; killed: boolean };

export function wolfKills(vi: VisibleInformationSnapshot): Kill[] {
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

// ============ 投票结算抽取（票数/票向唯一公开点 = vote_resolved payload） ============

export type Resolved = {
  outcome: "exile" | "tie" | "no_exile";
  exiledPlayerId: string | null;
  tally: Record<string, number>;
  eventId: string;
  seq: number;
  day: number;
  voteRound: "first" | "tie_break";
};

export function normRound(round: string): "first" | "tie_break" {
  return round === "tie_break" ? "tie_break" : "first";
}

/** 按 `${day}:${round}` 收集全部 vote_resolved（tally 只能从这里拿）。 */
export function collectResolved(
  vi: VisibleInformationSnapshot,
): Map<string, Resolved> {
  const m = new Map<string, Resolved>();
  for (const e of vi.publicEvents) {
    if (e.type !== "vote_resolved") continue;
    const voteRound = normRound(e.round.voteRound);
    m.set(`${e.round.day}:${voteRound}`, {
      outcome: (e.payload.outcome as Resolved["outcome"]) ?? "no_exile",
      exiledPlayerId:
        typeof e.payload.exiledPlayerId === "string"
          ? e.payload.exiledPlayerId
          : null,
      tally: (e.payload.tally as Record<string, number>) ?? {},
      eventId: e.eventId,
      seq: e.seq,
      day: e.round.day,
      voteRound,
    });
  }
  return m;
}

// ============ 座位私密圆 token ============

export type SeatTokenKind =
  | "wolf"
  | "good"
  | "save"
  | "poison"
  | "guard"
  | "knife";

export type SeatToken = { kind: SeatTokenKind; ch: string; tip: string };

/**
 * 每个座位（playerId）的私密圆 token 列表，按 viewer 角色派生。
 * 只对信息的主人产出：预言家的查验、狼的队友/未得手刀、女巫的救/毒、守卫的守护。
 */
export function privateSeatTokens(
  vi: VisibleInformationSnapshot,
): Map<string, SeatToken[]> {
  const m = new Map<string, SeatToken[]>();
  const push = (id: string | null, t: SeatToken) => {
    if (!id) return;
    const list = m.get(id) ?? [];
    list.push(t);
    m.set(id, list);
  };

  switch (vi.ownRole) {
    case "seer": {
      for (const c of seerChecks(vi)) {
        push(
          c.targetId,
          c.isWolf
            ? {
                kind: "wolf",
                ch: "狼",
                tip: `第${c.night}夜查验 · 狼人 · 仅你可见`,
              }
            : {
                kind: "good",
                ch: "好",
                tip: `第${c.night}夜查验 · 好人 · 仅你可见`,
              },
        );
      }
      break;
    }
    case "werewolf": {
      for (const t of vi.teammates) {
        push(t.playerId, {
          kind: "wolf",
          ch: "狼",
          tip: "你的狼队友 · 仅你可见",
        });
      }
      // 得手的刀不挂（公开死因牌已覆盖）；只有未得手的刀留痕。
      for (const k of wolfKills(vi)) {
        if (!k.killed && k.targetId) {
          push(k.targetId, {
            kind: "knife",
            ch: "刀",
            tip: `第${k.night}夜 出刀未得手 · 仅你可见`,
          });
        }
      }
      break;
    }
    case "witch": {
      const { saves, poisons } = witchInfo(vi);
      for (const s of saves) {
        push(s.targetId, {
          kind: "save",
          ch: "救",
          tip: `第${s.night}夜 你用解药救回 · 仅你可见`,
        });
      }
      // 毒杀 token 与公开死亡同帧：目标必须已在 deadPlayers（不得早于 death 事件）。
      // 注意公开死因已被 visibility 层掩蔽（夜死不公布死法），这里只看「已死」，
      // 「死于你的毒」这件事本身来自女巫自己的 witch_poison 私密事件。
      const deadIds = new Set(vi.deadPlayers.map((d) => d.playerId));
      for (const p of poisons) {
        if (deadIds.has(p.targetId)) {
          push(p.targetId, {
            kind: "poison",
            ch: "毒",
            tip: `第${p.night}夜 你下毒 · 仅你可见`,
          });
        }
      }
      break;
    }
    case "guard": {
      for (const g of guardLogs(vi)) {
        push(g.targetId, {
          kind: "guard",
          ch: "守",
          tip: `第${g.night}夜守护 · 仅你可见`,
        });
      }
      break;
    }
    default:
      break;
  }
  return m;
}

// ============ own 座位角色胶囊 + 女巫药剂 pip ============

export type PotionPip = {
  kind: "save" | "poison";
  used: boolean;
  tip: string;
};

export type OwnRoleBadge = {
  role: Role;
  wolfy: boolean;
  duty: string;
  pips: PotionPip[];
};

export function ownRoleBadge(vi: VisibleInformationSnapshot): OwnRoleBadge {
  const pips: PotionPip[] = [];
  if (vi.ownRole === "witch") {
    const lookup = buildLookup(vi);
    const { saves, poisons } = witchInfo(vi);
    const save = saves[0];
    const poison = poisons[0];
    pips.push({
      kind: "save",
      used: Boolean(save),
      tip: save
        ? `解药 · 已用（第${save.night}夜救了${lookup.get(save.targetId)?.name ?? "某玩家"}）`
        : "解药 · 可用",
    });
    pips.push({
      kind: "poison",
      used: Boolean(poison),
      tip: poison
        ? `毒药 · 已用（第${poison.night}夜毒了${lookup.get(poison.targetId)?.name ?? "某玩家"}）`
        : "毒药 · 可用",
    });
  }
  return {
    role: vi.ownRole,
    wolfy: vi.ownFaction === "werewolf_team",
    duty: ROLE_DUTY[vi.ownRole],
    pips,
  };
}

// ============ 公开死因胶囊 chip ============

export type DeathChip = {
  text: string;
  tip: string;
  /** 放逐票数缀（×N，vote_resolved payload.tally 同帧） */
  xn: number | null;
};

function isNightCause(cause: DeathCause): boolean {
  return cause === "night_kill" || cause === "poison";
}

export function deathWhen(d: PublicDeathRef): string {
  return isNightCause(d.deathCause)
    ? `第${d.round.night}夜`
    : `第${d.round.day}天`;
}

/** 每个死者（playerId）的公开死因 chip（全员同款，vi.deadPlayers 派生）。 */
export function deathChips(
  vi: VisibleInformationSnapshot,
): Map<string, DeathChip> {
  const resolved = collectResolved(vi);
  const m = new Map<string, DeathChip>();
  for (const d of vi.deadPlayers) {
    switch (d.deathCause) {
      // 夜死不公布死法（规则铁律，visibility 层已掩蔽毒杀）：统一「倒牌」文案。
      // poison 分支只是防御——正常对局可见层不会出现。
      case "night_kill":
      case "poison":
        m.set(d.playerId, {
          text: `倒·夜${d.round.night}`,
          tip: `第${d.round.night}夜 夜里出局 · 死法不公开`,
          xn: null,
        });
        break;
      case "hunter_shot":
        m.set(d.playerId, {
          text: `枪·天${d.round.day}`,
          tip: `第${d.round.day}天 被猎人带走`,
          xn: null,
        });
        break;
      case "exile": {
        // ×N 只取 vote_resolved payload.tally（加赛优先——真正放逐他的那轮）。
        const tie = resolved.get(`${d.round.day}:tie_break`);
        const first = resolved.get(`${d.round.day}:first`);
        const res =
          tie?.exiledPlayerId === d.playerId
            ? tie
            : first?.exiledPlayerId === d.playerId
              ? first
              : null;
        const n = res ? (res.tally[d.playerId] ?? null) : null;
        m.set(d.playerId, {
          text: `逐·天${d.round.day}`,
          tip: `第${d.round.day}天 被放逐${n ? `（${n}票）` : ""} · 详见投票记录`,
          xn: n,
        });
        break;
      }
      default:
        break;
    }
  }
  return m;
}
