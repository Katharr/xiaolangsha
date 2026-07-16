import type {
  ActiveVoteRound,
  DeathCause,
  Faction,
  GamePhase,
  Role,
  WinReason,
} from "./enums";
import { roles } from "./enums";
import { narrateEvent, type NarrationSegment } from "./eventNarration";
import {
  FACTION_LABEL,
  REVIEW_DEATH_SHORT_LABEL,
  REVIEW_DEATH_TRUTH_LABEL,
  ROLE_LABEL,
  WIN_REASON_LABEL,
} from "./labels";
import type {
  Player,
  PlayerOutcome,
  ReviewContext,
  TruthEvent,
} from "./models";

/**
 * 复盘时间线数据层：把 ReviewContext（唯一合法的完整真相源，ISO-002）折叠成
 * 「序幕 → 夜1 → 天1 → 夜2 → … → 终局」的轮次档案，供复盘 UI 纯渲染。
 *
 * 落地纪律（七条，违者返工）：
 * 1. 只吃 ReviewContext——绝不消费 VisibleInformationSnapshot / PublicDeathRef
 *    （那层的毒杀死因被掩蔽成 night_kill、round 可能是占位）。真死因以
 *    player_died 的 TruthEvent payload 与 ctx.outcomes 为准。
 * 2. 座位号一律取数据结构自带的 seat 字段（Player.seat），绝不解析 playerId
 *    后缀——座位开局被打乱，后缀与座位无关。
 * 3. 票数只取 vote_resolved payload 的 tally/outcome/exiledPlayerId，
 *    任何路径不得自行 count(votes)；payload.votes 只作明细展示。
 * 4. 女巫救/毒与守卫守护从不发 night_action_resolved——必须扫 events 里的
 *    night_action_submitted（witchChoice / guard_protect）补齐；狼刀与查验
 *    直接用 ctx.nightActions（resolved 已折叠好、带 factionResult/wolfVotes）。
 * 5. 猎人开枪是独立 hunter_shot 事件：夜死猎人与放逐猎人的 round.day 均已是
 *    当天 N，一律归当天的天卡（渲染位置由 UI 固定在卡头）。
 * 6. 平票加赛 tie_break 的合法投票人 = 全体存活者（含被平票者，仅禁自投），
 *    派生层不做特殊过滤，明细照 payload 原样呈现。
 * 7. 死亡锚点 d-seat{seat} 全局每座位唯一，所有权归 .dbn/.vres/.shot 本体；
 *    身份墙与死亡缩略带只引用、不再造。
 *
 * 本文件属 shared 层：只 import shared 内部（enums/models/labels/eventNarration），
 * 零外部依赖；纯函数、无副作用。
 */

/** 死亡呈现锚点：`d-seat${seat}`，挂在 .dbn / .vres / .shot 上；死亡缩略带据此点跳。全局每座位唯一。 */
export type DeathAnchorId = `d-seat${number}`;

/** 玩家座位引用：一切「N号」只认 seat 字段，绝不解析 playerId 后缀（座位开局被打乱）。 */
export type SeatRef = {
  playerId: string;
  seat: number;
  name: string;
};

/** 身份揭示墙一张卡（.wcard）。 */
export type ArchivePlayerCard = {
  playerId: string;
  seat: number;
  name: string;
  role: Role;
  roleLabel: string;
  faction: Faction;
  isHuman: boolean;
  alive: boolean;
  death?: {
    causeLabel: string;
    roundLabel: string;
    exileVotes?: number;
    anchorId: DeathAnchorId;
  };
};

/** 死亡时序带一枚胶囊（.schip）。 */
export type DeathStripChip = {
  seat: number;
  name: string;
  causeShort: string;
  exileVotes?: number;
  anchorId: DeathAnchorId;
};

/** 序幕（hero 区）。 */
export type ReviewPrologue = {
  winner: Faction;
  winTitle: string;
  winReason: WinReason;
  winReasonText: string;
  boardNote: string;
  players: ArchivePlayerCard[];
  deathOrder: DeathStripChip[];
};

/** 夜间行动种类 → .atk-kill / .atk-check / .atk-save / .atk-poison / .atk-none（skip 与 guard 复用灰/守色）。 */
export type NightActionKind = "kill" | "check" | "save" | "poison" | "guard" | "skip";

/** 行动结果徽章 → .rb-plain「得手」/.rb-saved「未死·被救」/.rb-bad「查杀」/.rb-good「金水」/.rb-poison。 */
export type NightResultBadge =
  | { kind: "plain" }
  | { kind: "saved" }
  | { kind: "check"; faction: Faction }
  | { kind: "poison" };

/** 夜卡「行动真相」一行（.arow）。 */
export type NightActionRow = {
  key: string;
  kind: NightActionKind;
  actor: SeatRef;
  actorPack?: SeatRef[];
  target?: SeatRef;
  badge?: NightResultBadge;
  /** 狼队刀口分歧（.split 全宽行）：仅 wolfVotes 出现 ≥2 个不同 target 时给出。 */
  wolfSplit?: Array<{ wolf: SeatRef; target: SeatRef }>;
};

/** 夜卡「死亡结算」一条（.dbn）。 */
export type NightDeathRow = {
  victim: SeatRef;
  cause: Extract<DeathCause, "night_kill" | "poison">;
  truthText: string;
  masked: boolean;
  extra?: string;
  anchorId: DeathAnchorId;
};

/** 叙事保底一行（.nline）。segments 交给 UI 用 PlayerName 解析着色。 */
export type NarrDot = "phase" | "death" | "vote" | "words" | "check";
export type NarrLine = {
  key: string;
  dot: NarrDot;
  segments: NarrationSegment[];
};

export type NightArchive = {
  kind: "night";
  n: number;
  id: `round-night-${number}`;
  label: string;
  dots: number[];
  actions: NightActionRow[];
  emptyNote?: string;
  deaths: NightDeathRow[];
  narr: NarrLine[];
};

/** 发言/遗言/拉票一条（.sp；>42 字 UI 折叠）。 */
export type SpeechRow = {
  key: string;
  speaker: SeatRef;
  text: string;
  tag?: "遗言" | "拉票";
};

/** 投票分组一行（.vg）。count 只来自 vote_resolved.payload.tally，voters 只是明细展示。 */
export type VoteGroupRow = {
  target: SeatRef;
  count: number;
  voters: SeatRef[];
  exiled: boolean;
};

/** 一段投票（首轮或加赛，.vblock 内一节）。 */
export type VoteSectionArchive = {
  key: string;
  voteRound: ActiveVoteRound;
  subLabel: string;
  groups: VoteGroupRow[];
  abstains: SeatRef[];
  outcome: "exile" | "tie" | "no_exile";
  exiled?: SeatRef & {
    count: number;
    role: Role;
    faction: Faction;
    anchorId: DeathAnchorId;
  };
};

/** 猎人开枪行（.shot）。收枪不开时引擎不发 hunter_shot 事件，故 target 必有。 */
export type HunterShotRow = {
  key: string;
  hunter: SeatRef;
  target: SeatRef;
  anchorId: DeathAnchorId;
};

export type DayArchive = {
  kind: "day";
  n: number;
  id: `round-day-${number}`;
  label: string;
  dots: number[];
  announce?: {
    key: string;
    deadSeats: number[];
    text: string;
  };
  hunterShot?: HunterShotRow;
  speeches: SpeechRow[];
  votes: VoteSectionArchive[];
  tieSpeeches: SpeechRow[];
  lastWords: SpeechRow[];
  endNote?: string;
  narr: NarrLine[];
};

export type RoundArchive = NightArchive | DayArchive;

export type FinaleArchive = {
  line: string;
  narrText: string;
  alive: SeatRef[];
};

export type ReviewArchives = {
  prologue: ReviewPrologue;
  rounds: RoundArchive[];
  finale: FinaleArchive;
};

/** 白天段相位（分轮归拢的天桶 key 判据）。 */
const DAY_PHASES: readonly GamePhase[] = [
  "day_announcement",
  "hunter_shoot",
  "day_speech",
  "vote",
  "tie_speech",
  "tie_vote",
  "exile_last_words",
];

/** 已被结构化区覆盖（或属噪声/终局卡覆盖）的事件类型——叙事保底跳过。 */
const STRUCTURAL_COVERED = new Set<string>([
  "night_action_submitted",
  "night_action_resolved",
  "player_died",
  "day_announced",
  "hunter_shot",
  "vote_submitted",
  "vote_resolved",
  "speech_submitted",
  "tie_speech_submitted",
  "last_words_submitted",
  "exile_resolved",
  "phase_changed",
  "win_checked",
  "game_ended",
  "game_created",
  "game_started",
  "players_assigned",
  "human_role_revealed",
  "werewolf_team_revealed",
]);

const GOD_ROLES: readonly Role[] = ["seer", "witch", "hunter", "guard", "idiot"];

function anchorOf(seat: number): DeathAnchorId {
  return `d-seat${seat}`;
}

function narrDotOf(_event: TruthEvent): NarrDot {
  // 目前漏网的主要是 fast_forward_* 三件套，一律映射 "phase"；
  // 其余 NarrDot 枚举留给合成行与未来事件。
  return "phase";
}

export function deriveRoundArchives(ctx: ReviewContext): ReviewArchives {
  const events = [...ctx.events].sort((a, b) => a.seq - b.seq);
  const byId = new Map<string, Player>(ctx.players.map((p) => [p.playerId, p]));
  const eventById = new Map<string, TruthEvent>(events.map((e) => [e.eventId, e]));
  const outcomeById = new Map<string, PlayerOutcome>(
    ctx.outcomes.map((o) => [o.playerId, o]),
  );

  /** 非法 id 兜底为「未知玩家」；seat 一律取 Player.seat（纪律 2）。 */
  function ref(id: unknown): SeatRef {
    const player = typeof id === "string" ? byId.get(id) : undefined;
    if (!player) {
      return { playerId: String(id), seat: 0, name: "未知玩家" };
    }
    return { playerId: player.playerId, seat: player.seat, name: player.name };
  }

  // ── 分轮归拢：walk 一遍 events（seq 有序），夜桶按 round.night、天桶按 round.day。
  const nightBuckets = new Map<number, TruthEvent[]>();
  const dayBuckets = new Map<number, TruthEvent[]>();
  for (const event of events) {
    if (event.phase === "night_action") {
      const bucket = nightBuckets.get(event.round.night) ?? [];
      bucket.push(event);
      nightBuckets.set(event.round.night, bucket);
    } else if (DAY_PHASES.includes(event.phase)) {
      const bucket = dayBuckets.get(event.round.day) ?? [];
      bucket.push(event);
      dayBuckets.set(event.round.day, bucket);
    }
    // 其余相位（mode_select/role_setup/role_reveal/review）不入轮次桶。
  }

  // 每人第一条 player_died 事件（出局只发生一次），供死亡时序带与合成行使用。
  const deathEventByPlayer = new Map<string, TruthEvent>();
  for (const event of events) {
    if (event.type !== "player_died") {
      continue;
    }
    const pid = event.payload.playerId;
    if (typeof pid === "string" && !deathEventByPlayer.has(pid)) {
      deathEventByPlayer.set(pid, event);
    }
  }

  const winTitle = `${FACTION_LABEL[ctx.winner]}胜利`;

  // 终局判据：全局最后一条 player_died 为白天死因 → 终局由白天死亡直接达成，
  // 对应天卡给 endNote；夜内终局由 finale 卡兜底。文案按实际终局路径分叉：
  // 放逐终局 = 铁律③（跳过遗言与猎人开枪）；枪杀终局 = 猎人开枪直接达成
  // （同卡可能刚渲染过开枪行/遗言，绝不能宣称「跳过」）。
  const lastDeath = [...deathEventByPlayer.values()].reduce<TruthEvent | null>(
    (latest, event) => (!latest || event.seq > latest.seq ? event : latest),
    null,
  );
  let endNoteDay: number | null = null;
  let endNoteText = "";
  if (lastDeath && lastDeath.payload.deathCause === "exile") {
    endNoteDay = lastDeath.round.day;
    endNoteText = `${winTitle}达成 — 跳过遗言与猎人开枪，直接终局（规则铁律③）`;
  } else if (lastDeath && lastDeath.payload.deathCause === "hunter_shot") {
    endNoteDay = lastDeath.round.day;
    endNoteText = `${winTitle}达成 — 猎人开枪直接终局`;
  }

  // ── 叙事保底：结构化区覆盖外的事件走 narrateEvent。
  function buildNarr(bucket: TruthEvent[]): NarrLine[] {
    const lines: NarrLine[] = [];
    for (const event of bucket) {
      if (STRUCTURAL_COVERED.has(event.type)) {
        continue;
      }
      const segments = narrateEvent(event);
      if (segments) {
        lines.push({ key: event.eventId, dot: narrDotOf(event), segments });
      }
    }
    return lines;
  }

  // ── 夜卡组装 ─────────────────────────────────────────────
  const hasWitch = ctx.players.some((p) => p.role === "witch");
  const hasHunter = ctx.players.some((p) => p.role === "hunter");
  const seers = ctx.players.filter((p) => p.role === "seer");

  function buildNightCard(n: number, bucket: TruthEvent[]): NightArchive {
    // 行排序 key：优先取同夜同类行动的首条 night_action_submitted 的 seq
    // （狼→预→女的提交顺序即观感顺序；狼刀/查验的 resolved 事件迟至夜结算才发，
    //  直接用 resolved seq 会把狼刀排到最后），找不到再退回 resolved seq。
    function submittedSeq(actionType: string): number | null {
      const hit = bucket.find(
        (e) =>
          e.type === "night_action_submitted" &&
          e.payload.actionType === actionType,
      );
      return hit ? hit.seq : null;
    }

    const rows: Array<{ seq: number; row: NightActionRow }> = [];

    // 狼刀 / 查验：直接取 ctx.nightActions（resolved 已折叠好，纪律 4）。
    for (const action of ctx.nightActions) {
      if (action.night !== n) {
        continue;
      }
      const resolvedSeq = eventById.get(action.eventId)?.seq ?? 0;
      if (action.actionType === "werewolf_kill") {
        const result = action.result;
        const wolfVotes =
          result.wolfVotes && typeof result.wolfVotes === "object"
            ? (result.wolfVotes as Record<string, string>)
            : undefined;
        const distinctTargets = wolfVotes
          ? new Set(Object.values(wolfVotes)).size
          : 0;
        rows.push({
          seq: submittedSeq("werewolf_kill") ?? resolvedSeq,
          row: {
            key: action.eventId,
            kind: "kill",
            actor: ref(action.actorId),
            ...(action.actorIds && action.actorIds.length > 0
              ? { actorPack: action.actorIds.map(ref) }
              : {}),
            ...(action.targetId ? { target: ref(action.targetId) } : {}),
            badge:
              result.killed === false ? { kind: "saved" } : { kind: "plain" },
            ...(wolfVotes && distinctTargets >= 2
              ? {
                  wolfSplit: Object.entries(wolfVotes).map(([wolf, target]) => ({
                    wolf: ref(wolf),
                    target: ref(target),
                  })),
                }
              : {}),
          },
        });
      } else if (action.actionType === "seer_check") {
        const faction: Faction =
          action.result.factionResult === "werewolf_team"
            ? "werewolf_team"
            : "good_team";
        rows.push({
          seq: submittedSeq("seer_check") ?? resolvedSeq,
          row: {
            key: action.eventId,
            kind: "check",
            actor: ref(action.actorId),
            ...(action.targetId ? { target: ref(action.targetId) } : {}),
            badge: { kind: "check", faction },
          },
        });
      }
    }

    // 女巫救/毒/空过 与 守卫守护：从不发 resolved，扫 submitted 补齐（纪律 4）。
    for (const event of bucket) {
      if (event.type !== "night_action_submitted") {
        continue;
      }
      const p = event.payload;
      if ("witchChoice" in p) {
        if (p.actionType === "witch_save") {
          rows.push({
            seq: event.seq,
            row: {
              key: event.eventId,
              kind: "save",
              actor: ref(p.actorId),
              ...(typeof p.targetId === "string" ? { target: ref(p.targetId) } : {}),
            },
          });
        } else if (p.actionType === "witch_poison") {
          rows.push({
            seq: event.seq,
            row: {
              key: event.eventId,
              kind: "poison",
              actor: ref(p.actorId),
              ...(typeof p.targetId === "string" ? { target: ref(p.targetId) } : {}),
              badge: { kind: "poison" },
            },
          });
        } else {
          // witchChoice === "skip"（actionType === "none"）→ 空过行。
          rows.push({
            seq: event.seq,
            row: { key: event.eventId, kind: "skip", actor: ref(p.actorId) },
          });
        }
      } else if (p.actionType === "guard_protect") {
        rows.push({
          seq: event.seq,
          row: {
            key: event.eventId,
            kind: "guard",
            actor: ref(p.actorId),
            ...(typeof p.targetId === "string" ? { target: ref(p.targetId) } : {}),
          },
        });
      }
    }

    rows.sort((a, b) => a.seq - b.seq);

    // 死亡结算：真死因直取 player_died 的 TruthEvent payload（未掩蔽，纪律 1）。
    const deaths: NightDeathRow[] = [];
    for (const event of bucket) {
      if (event.type !== "player_died") {
        continue;
      }
      const cause = event.payload.deathCause;
      if (cause !== "night_kill" && cause !== "poison") {
        continue;
      }
      const victim = ref(event.payload.playerId);
      const victimRole = byId.get(victim.playerId)?.role;
      deaths.push({
        victim,
        cause,
        truthText: `真相：${REVIEW_DEATH_TRUTH_LABEL[cause]}`,
        masked: cause === "poison",
        ...(victimRole === "hunter" && cause === "poison"
          ? { extra: "猎人被毒杀 · 无法开枪" }
          : {}),
        anchorId: anchorOf(victim.seat),
      });
    }

    const narr = buildNarr(bucket);
    // 合成行：预言家在本夜开始前已全部出局 → 提示「本夜无查验」。
    const firstSeq = bucket[0]?.seq ?? 0;
    if (
      n >= 2 &&
      seers.length > 0 &&
      seers.every((seer) => {
        const death = deathEventByPlayer.get(seer.playerId);
        return death !== undefined && death.seq < firstSeq;
      })
    ) {
      narr.push({
        key: `synth-night-${n}-no-seer`,
        dot: "check",
        segments: ["预言家已出局——本夜无查验"],
      });
    }

    return {
      kind: "night",
      n,
      id: `round-night-${n}`,
      label: `第${n}夜`,
      dots: deaths.map((d) => d.victim.seat),
      actions: rows.map((r) => r.row),
      ...(!hasWitch && !hasHunter ? { emptyNote: "本板无女巫与猎人" } : {}),
      deaths,
      narr,
    };
  }

  // ── 天卡组装 ─────────────────────────────────────────────
  function toSpeechRow(
    speech: ReviewContext["speeches"][number],
    tag?: "遗言" | "拉票",
  ): SpeechRow {
    return {
      key: speech.eventId,
      speaker: ref(speech.speakerId),
      text: speech.text,
      ...(tag ? { tag } : {}),
    };
  }

  function buildVoteSection(event: TruthEvent): VoteSectionArchive {
    const p = event.payload;
    const tally =
      p.tally && typeof p.tally === "object"
        ? (p.tally as Record<string, number>)
        : {};
    const votes = Array.isArray(p.votes)
      ? (p.votes as Array<{ voterId?: unknown; choiceType?: unknown; targetId?: unknown }>)
      : [];
    const outcome: VoteSectionArchive["outcome"] =
      p.outcome === "exile" ? "exile" : p.outcome === "tie" ? "tie" : "no_exile";
    const exiledPlayerId =
      typeof p.exiledPlayerId === "string" ? p.exiledPlayerId : null;
    const voteRound: ActiveVoteRound =
      p.voteRound === "tie_break" ? "tie_break" : "first";

    // groups 严格由 payload.tally 生成（count 唯一来源，纪律 3）；voters 只是明细。
    const groups: VoteGroupRow[] = Object.entries(tally).map(
      ([targetId, count]) => ({
        target: ref(targetId),
        count: Number(count),
        voters: votes
          .filter((v) => v.choiceType === "target" && v.targetId === targetId)
          .map((v) => ref(v.voterId)),
        exiled: outcome === "exile" && exiledPlayerId === targetId,
      }),
    );
    groups.sort((a, b) =>
      b.count !== a.count ? b.count - a.count : a.target.seat - b.target.seat,
    );

    const abstains = votes
      .filter((v) => v.choiceType === "abstain")
      .map((v) => ref(v.voterId));

    let exiled: VoteSectionArchive["exiled"];
    if (outcome === "exile" && exiledPlayerId) {
      const seatRef = ref(exiledPlayerId);
      const player = byId.get(exiledPlayerId);
      exiled = {
        ...seatRef,
        count: Number(tally[exiledPlayerId] ?? 0),
        role: player?.role ?? "villager",
        faction: player?.faction ?? "good_team",
        anchorId: anchorOf(seatRef.seat),
      };
    }

    return {
      key: event.eventId,
      voteRound,
      subLabel: voteRound === "tie_break" ? "平票加赛投票" : "首轮投票",
      groups,
      abstains,
      outcome,
      ...(exiled ? { exiled } : {}),
    };
  }

  function buildDayCard(n: number, bucket: TruthEvent[]): DayArchive {
    const announcedEvent = bucket.find((e) => e.type === "day_announced");
    const announce = announcedEvent
      ? {
          key: announcedEvent.eventId,
          deadSeats: (Array.isArray(announcedEvent.payload.deadPlayerIds)
            ? announcedEvent.payload.deadPlayerIds
            : []
          ).map((id) => ref(id).seat),
          text: String(announcedEvent.payload.announcementText ?? ""),
        }
      : undefined;

    // 猎人开枪：夜死猎人与放逐猎人的 hunter_shot 事件 round.day 都是当天 N（纪律 5）。
    const shotEvent = bucket.find((e) => e.type === "hunter_shot");
    let hunterShot: HunterShotRow | undefined;
    if (shotEvent && typeof shotEvent.payload.targetId === "string") {
      const target = ref(shotEvent.payload.targetId);
      hunterShot = {
        key: shotEvent.eventId,
        hunter: ref(shotEvent.payload.hunterId),
        target,
        anchorId: anchorOf(target.seat),
      };
    }

    const daySpeeches = ctx.speeches.filter((s) => s.day === n);
    const speeches = daySpeeches
      .filter((s) => s.speechKind === "day_speech")
      .map((s) => toSpeechRow(s));
    const tieSpeeches = daySpeeches
      .filter((s) => s.speechKind === "tie_speech")
      .map((s) => toSpeechRow(s, "拉票"));
    const lastWords = daySpeeches
      .filter((s) => s.speechKind === "last_words")
      .map((s) => toSpeechRow(s, "遗言"));

    const votes = bucket
      .filter((e) => e.type === "vote_resolved")
      .map(buildVoteSection);

    const dots = bucket
      .filter((e) => e.type === "player_died")
      .map((e) => ref(e.payload.playerId).seat);

    return {
      kind: "day",
      n,
      id: `round-day-${n}`,
      label: `第${n}天`,
      dots,
      ...(announce ? { announce } : {}),
      ...(hunterShot ? { hunterShot } : {}),
      speeches,
      votes,
      tieSpeeches,
      lastWords,
      ...(endNoteDay === n ? { endNote: endNoteText } : {}),
      narr: buildNarr(bucket),
    };
  }

  // ── 轮次数组：夜1、天1、夜2、天2…交错，只含实际发生的轮次。 ──
  const maxN = Math.max(0, ...nightBuckets.keys(), ...dayBuckets.keys());
  const rounds: RoundArchive[] = [];
  for (let n = 1; n <= maxN; n += 1) {
    const nightBucket = nightBuckets.get(n);
    if (nightBucket && nightBucket.length > 0) {
      rounds.push(buildNightCard(n, nightBucket));
    }
    const dayBucket = dayBuckets.get(n);
    if (dayBucket && dayBucket.length > 0) {
      rounds.push(buildDayCard(n, dayBucket));
    }
  }

  // ── 序幕 ─────────────────────────────────────────────────
  const cards: ArchivePlayerCard[] = [...ctx.players]
    .sort((a, b) => a.seat - b.seat)
    .map((player) => {
      const outcome = outcomeById.get(player.playerId);
      let death: ArchivePlayerCard["death"];
      if (outcome && !outcome.alive && outcome.deathCause) {
        const truth = REVIEW_DEATH_TRUTH_LABEL[outcome.deathCause];
        death = {
          causeLabel: outcome.deathCause === "exile" ? truth : `被${truth}`,
          roundLabel:
            outcome.deathRound !== undefined
              ? `第${outcome.deathRound}${outcome.deathPhaseKind === "night" ? "夜" : "天"}`
              : "",
          ...(outcome.exileVotes !== undefined
            ? { exileVotes: outcome.exileVotes }
            : {}),
          anchorId: anchorOf(player.seat),
        };
      }
      return {
        playerId: player.playerId,
        seat: player.seat,
        name: player.name,
        role: player.role,
        roleLabel: ROLE_LABEL[player.role],
        faction: player.faction,
        isHuman: player.isHuman,
        alive: player.alive,
        ...(death ? { death } : {}),
      };
    });

  const deathOrder: DeathStripChip[] = ctx.outcomes
    .filter((o) => !o.alive)
    .map((o) => ({
      outcome: o,
      seq: deathEventByPlayer.get(o.playerId)?.seq ?? Number.MAX_SAFE_INTEGER,
    }))
    .sort((a, b) => a.seq - b.seq)
    .map(({ outcome }) => {
      const seatRef = ref(outcome.playerId);
      return {
        seat: seatRef.seat,
        name: seatRef.name,
        causeShort: outcome.deathCause
          ? REVIEW_DEATH_SHORT_LABEL[outcome.deathCause]
          : "出局",
        ...(outcome.exileVotes !== undefined
          ? { exileVotes: outcome.exileVotes }
          : {}),
        anchorId: anchorOf(seatRef.seat),
      };
    });

  const wolves = ctx.players.filter((p) => p.role === "werewolf").length;
  const villagers = ctx.players.filter((p) => p.role === "villager").length;
  const godLabels = roles
    .filter(
      (role) =>
        GOD_ROLES.includes(role) && ctx.players.some((p) => p.role === role),
    )
    .map((role) => ROLE_LABEL[role]);
  const boardNote = [
    `${ctx.players.length}人局`,
    `${wolves}狼`,
    ...(godLabels.length > 0 ? [godLabels.join("/")] : []),
    ...(villagers > 0 ? [`${villagers}村民`] : []),
  ].join(" · ");

  const prologue: ReviewPrologue = {
    winner: ctx.winner,
    winTitle,
    winReason: ctx.winReason,
    winReasonText: WIN_REASON_LABEL[ctx.winReason],
    boardNote,
    players: cards,
    deathOrder,
  };

  // ── 终局 ─────────────────────────────────────────────────
  const aliveRefs = ctx.outcomes
    .filter((o) => o.alive)
    .map((o) => ref(o.playerId))
    .sort((a, b) => a.seat - b.seat);
  const nightCount = rounds.filter((r) => r.kind === "night").length;
  const dayCount = rounds.filter((r) => r.kind === "day").length;

  const finale: FinaleArchive = {
    line: `${winTitle} — ${WIN_REASON_LABEL[ctx.winReason]}`,
    narrText: `全程 ${nightCount} 夜 ${dayCount} 天，${aliveRefs.length} 人存活。`,
    alive: aliveRefs,
  };

  return { prologue, rounds, finale };
}
