import { describe, expect, it } from "vitest";

import type {
  ActiveVoteRound,
  GameAction,
  GameSession,
  GameSnapshot,
  Player,
  ReviewContext,
  TruthEvent,
  VoteChoiceType,
} from "../shared";
import {
  deriveRoundArchives,
  type DayArchive,
  type NightArchive,
  type ReviewArchives,
  type SeatRef,
} from "../shared/reviewRounds";
import { STANDARD_7P_BOARD_ID } from "./boards";
import { applyAction, type RuleEngineSuccess } from "./index";
import { buildReviewContext } from "./review";

const boardId = STANDARD_7P_BOARD_ID;
const humanPlayerId = "human-1";

type EngineState = {
  session: GameSession;
  snapshot: GameSnapshot;
  events: TruthEvent[];
};

function expectOk(result: ReturnType<typeof applyAction>): RuleEngineSuccess {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.data;
}

let keyCounter = 0;
const key = (prefix: string) => `${prefix}-${(keyCounter += 1)}`;

/** 开一局 7 人自由局，真人选村民，推进到首夜的夜晚行动相位。 */
function reachFirstNight(): EngineState {
  const created = expectOk(
    applyAction(
      {
        type: "create_game",
        idempotencyKey: key("create"),
        mode: "free",
        boardId,
        humanPlayerId,
      },
      { now: "2026-07-16T00:00:00.000Z" },
    ),
  );
  const assigned = expectOk(
    applyAction(
      {
        type: "confirm_role_setup",
        idempotencyKey: key("setup"),
        playerId: humanPlayerId,
        selectedRole: "villager",
      },
      { ...created, now: "2026-07-16T00:00:01.000Z" },
    ),
  );
  const assignedEvents = [...created.events, ...assigned.events];
  const started = expectOk(
    applyAction(
      {
        type: "confirm_role_reveal",
        idempotencyKey: key("reveal"),
        playerId: humanPlayerId,
      },
      {
        events: assignedEvents,
        snapshot: assigned.snapshot,
        session: assigned.session,
        now: "2026-07-16T00:00:02.000Z",
      },
    ),
  );
  return {
    session: started.session,
    snapshot: started.snapshot,
    events: [...assignedEvents, ...started.events],
  };
}

function apply(state: EngineState, action: GameAction) {
  return applyAction(action, {
    events: state.events,
    snapshot: state.snapshot,
    session: state.session,
    now: "2026-07-16T00:01:00.000Z",
  });
}

function step(state: EngineState, action: GameAction): EngineState {
  const data = expectOk(apply(state, action));
  return {
    session: data.session,
    snapshot: data.snapshot,
    events: [...state.events, ...data.events],
  };
}

function idsByRole(snapshot: GameSnapshot, role: Player["role"]): string[] {
  return snapshot.players
    .filter((player) => player.role === role)
    .map((player) => player.playerId);
}

function aliveVillagerNotHuman(snapshot: GameSnapshot): string {
  const villager = snapshot.players.find(
    (player) => player.role === "villager" && !player.isHuman && player.alive,
  );
  if (!villager) {
    throw new Error("No AI villager found.");
  }
  return villager.playerId;
}

function seatOf(state: EngineState, playerId: string): number {
  const seat = state.snapshot.players.find((p) => p.playerId === playerId)?.seat;
  if (seat === undefined) {
    throw new Error(`No seat for ${playerId}.`);
  }
  return seat;
}

function vote(
  state: EngineState,
  voterId: string,
  voteRound: ActiveVoteRound,
  choiceType: VoteChoiceType,
  targetId?: string,
): EngineState {
  return step(state, {
    type: "submit_vote",
    idempotencyKey: key(`vote-${voteRound}-${voterId}`),
    voterId,
    voteRound,
    choiceType,
    ...(targetId ? { targetId } : {}),
  });
}

/** 天亮确认 + 全员按发言顺位说完（进入投票相位）。 */
function throughSpeeches(state: EngineState): EngineState {
  let next = step(state, {
    type: "confirm_day_announcement",
    idempotencyKey: key("confirm-day"),
    playerId: humanPlayerId,
  });
  const speakerOrder = next.snapshot.speechState?.speakerOrder ?? [];
  for (const speakerId of speakerOrder) {
    next = step(next, {
      type: "submit_speech",
      idempotencyKey: key(`speech-${speakerId}`),
      speakerId,
      text: `我是 ${speakerId} 的发言。`,
    });
  }
  return next;
}

function toReview(state: EngineState): ReviewContext {
  expect(state.snapshot.gamePhase).toBe("review");
  return buildReviewContext(state.session, state.snapshot.players, state.events);
}

function nightCard(a: ReviewArchives, n: number): NightArchive {
  const card = a.rounds.find((r) => r.kind === "night" && r.n === n);
  if (!card || card.kind !== "night") {
    throw new Error(`Missing night-${n} card.`);
  }
  return card;
}

function dayCard(a: ReviewArchives, n: number): DayArchive {
  const card = a.rounds.find((r) => r.kind === "day" && r.n === n);
  if (!card || card.kind !== "day") {
    throw new Error(`Missing day-${n} card.`);
  }
  return card;
}

/** 通用不变量：锚点、座位真实性、票数来源、轮次自洽（四场景共享）。 */
function assertInvariants(a: ReviewArchives, ctx: ReviewContext) {
  const anchorPattern = /^d-seat\d+$/;

  // 锚点所有权：夜死 .dbn / 放逐 .vres / 枪杀 .shot 本体持有，全局唯一。
  const owned: string[] = [];
  for (const round of a.rounds) {
    if (round.kind === "night") {
      owned.push(...round.deaths.map((d) => d.anchorId));
    } else {
      for (const section of round.votes) {
        if (section.exiled) {
          owned.push(section.exiled.anchorId);
        }
      }
      if (round.hunterShot?.anchorId) {
        owned.push(round.hunterShot.anchorId);
      }
    }
  }
  for (const anchor of owned) {
    expect(anchor).toMatch(anchorPattern);
  }
  expect(new Set(owned).size).toBe(owned.length);

  // 身份墙与死亡缩略带只引用已存在的锚点。
  const ownedSet = new Set(owned);
  for (const card of a.prologue.players) {
    if (card.death) {
      expect(card.death.anchorId).toMatch(anchorPattern);
      expect(ownedSet.has(card.death.anchorId)).toBe(true);
    }
  }
  for (const chip of a.prologue.deathOrder) {
    expect(chip.anchorId).toMatch(anchorPattern);
    expect(ownedSet.has(chip.anchorId)).toBe(true);
  }

  // 死亡缩略带长度 = outcomes 里的出局人数。
  expect(a.prologue.deathOrder).toHaveLength(
    ctx.outcomes.filter((o) => !o.alive).length,
  );

  // 座位真实性（反 playerId 后缀解析）：所有 SeatRef 的 seat 必须与 Player.seat 一致。
  const seatByPlayer = new Map(ctx.players.map((p) => [p.playerId, p.seat]));
  const allRefs: SeatRef[] = [];
  const push = (ref?: SeatRef) => {
    if (ref) {
      allRefs.push(ref);
    }
  };
  for (const round of a.rounds) {
    if (round.kind === "night") {
      for (const row of round.actions) {
        push(row.actor);
        push(row.target);
        row.actorPack?.forEach(push);
        row.wolfSplit?.forEach((s) => {
          push(s.wolf);
          push(s.target);
        });
      }
      round.deaths.forEach((d) => push(d.victim));
    } else {
      push(round.hunterShot?.hunter);
      push(round.hunterShot?.target);
      [...round.speeches, ...round.tieSpeeches, ...round.lastWords].forEach((s) =>
        push(s.speaker),
      );
      for (const section of round.votes) {
        section.abstains.forEach(push);
        push(section.exiled);
        for (const group of section.groups) {
          push(group.target);
          group.voters.forEach(push);
        }
      }
    }
  }
  a.finale.alive.forEach(push);
  for (const ref of allRefs) {
    expect(ref.seat).toBe(seatByPlayer.get(ref.playerId));
  }

  // 票数只来自 vote_resolved.payload.tally（从 ctx.events 按 section.key 反查同一事件）。
  for (const round of a.rounds) {
    if (round.kind !== "day") {
      continue;
    }
    for (const section of round.votes) {
      const event = ctx.events.find((e) => e.eventId === section.key);
      expect(event?.type).toBe("vote_resolved");
      const tally = (event?.payload.tally ?? {}) as Record<string, number>;
      for (const group of section.groups) {
        expect(group.count).toBe(tally[group.target.playerId]);
      }
      expect(section.groups).toHaveLength(Object.keys(tally).length);
    }
  }

  // rounds 的 id/label/n 自洽，夜天交错有序（n 不减、同 n 内夜先于天）。
  let prevN = 0;
  let prevKind: "night" | "day" = "day";
  for (const round of a.rounds) {
    expect(round.id).toBe(`round-${round.kind}-${round.n}`);
    expect(round.label).toBe(`第${round.n}${round.kind === "night" ? "夜" : "天"}`);
    expect(round.n).toBeGreaterThanOrEqual(prevN);
    if (round.n === prevN) {
      expect(prevKind).toBe("night");
      expect(round.kind).toBe("day");
    }
    prevN = round.n;
    prevKind = round.kind;
  }
}

describe("deriveRoundArchives 复盘轮次档案（阶段5数据层）", () => {
  it("场景A 毒杀局：救回平安夜、刀口分歧、毒杀掩蔽标记与交叉核对", () => {
    let state = reachFirstNight();
    const [wolf1, wolf2] = idsByRole(state.snapshot, "werewolf");
    const seer = idsByRole(state.snapshot, "seer")[0];
    const witch = idsByRole(state.snapshot, "witch")[0];
    const hunter = idsByRole(state.snapshot, "hunter")[0];
    const villagerA = aliveVillagerNotHuman(state.snapshot);

    // 夜1：两狼分刀（分歧 → 平票 → 座位小者为刀口），预言家验狼1，女巫救下刀口 → 平安夜。
    state = step(state, {
      type: "submit_night_action",
      idempotencyKey: key("a-w1"),
      actorId: wolf1,
      actionType: "werewolf_kill",
      targetId: villagerA,
    });
    state = step(state, {
      type: "submit_night_action",
      idempotencyKey: key("a-w2"),
      actorId: wolf2,
      actionType: "werewolf_kill",
      targetId: hunter,
    });
    const killedNight1 =
      seatOf(state, villagerA) < seatOf(state, hunter) ? villagerA : hunter;
    state = step(state, {
      type: "submit_night_action",
      idempotencyKey: key("a-seer"),
      actorId: seer,
      actionType: "seer_check",
      targetId: wolf1,
    });
    state = step(state, {
      type: "submit_witch_action",
      idempotencyKey: key("a-save"),
      actorId: witch,
      witchChoice: "save",
    });
    expect(state.snapshot.nightState?.deathPlayerIds).toEqual([]);

    // 天1：发言后放逐真人村民（4票，无平票），真人遗言后入夜2。
    state = throughSpeeches(state);
    state = vote(state, wolf1, "first", "target", humanPlayerId);
    state = vote(state, wolf2, "first", "target", humanPlayerId);
    state = vote(state, villagerA, "first", "target", humanPlayerId);
    state = vote(state, seer, "first", "target", humanPlayerId);
    state = vote(state, humanPlayerId, "first", "target", wolf1);
    state = vote(state, witch, "first", "target", wolf1);
    state = vote(state, hunter, "first", "abstain");
    expect(state.snapshot.gamePhase).toBe("exile_last_words");
    state = step(state, {
      type: "submit_last_words",
      idempotencyKey: key("a-lw"),
      speakerId: humanPlayerId,
      text: "我是好人，别信狼。",
    });

    // 夜2：狼刀民A、预言家验狼2、女巫毒猎人 → 屠民边终局（夜内终局，无天2卡）。
    state = step(state, {
      type: "submit_night_action",
      idempotencyKey: key("a2-w1"),
      actorId: wolf1,
      actionType: "werewolf_kill",
      targetId: villagerA,
    });
    state = step(state, {
      type: "submit_night_action",
      idempotencyKey: key("a2-w2"),
      actorId: wolf2,
      actionType: "werewolf_kill",
      targetId: villagerA,
    });
    state = step(state, {
      type: "submit_night_action",
      idempotencyKey: key("a2-seer"),
      actorId: seer,
      actionType: "seer_check",
      targetId: wolf2,
    });
    state = step(state, {
      type: "submit_witch_action",
      idempotencyKey: key("a-poison"),
      actorId: witch,
      witchChoice: "poison",
      targetId: hunter,
    });

    const ctx = toReview(state);
    const a = deriveRoundArchives(ctx);
    assertInvariants(a, ctx);

    // 轮次形态：夜1、天1、夜2（夜内终局无天2卡）。
    expect(a.rounds.map((r) => r.id)).toEqual([
      "round-night-1",
      "round-day-1",
      "round-night-2",
    ]);

    // 夜1：救回（badge saved）+ 刀口分歧 + 查杀 + 解药行，平安夜。
    const night1 = nightCard(a, 1);
    const killRow1 = night1.actions.find((row) => row.kind === "kill");
    expect(killRow1?.badge).toEqual({ kind: "saved" });
    expect(killRow1?.target?.playerId).toBe(killedNight1);
    expect(killRow1?.actorPack?.map((p) => p.playerId).sort()).toEqual(
      [wolf1, wolf2].sort(),
    );
    expect(killRow1?.wolfSplit).toHaveLength(2);
    const checkRow1 = night1.actions.find((row) => row.kind === "check");
    expect(checkRow1?.badge).toEqual({ kind: "check", faction: "werewolf_team" });
    expect(checkRow1?.target?.playerId).toBe(wolf1);
    const saveRow = night1.actions.find((row) => row.kind === "save");
    expect(saveRow?.target?.playerId).toBe(killedNight1);
    expect(night1.deaths).toEqual([]);
    expect(night1.dots).toEqual([]);
    // 行序：狼刀 → 查验 → 女巫（观感顺序，按夜内提交顺位）。
    expect(night1.actions.map((row) => row.kind)).toEqual(["kill", "check", "save"]);

    // 夜2：毒杀行 + 两条死亡（夜刀不掩蔽、毒杀掩蔽 + 猎人无法开枪注记）。
    const night2 = nightCard(a, 2);
    const poisonRow = night2.actions.find((row) => row.kind === "poison");
    expect(poisonRow?.badge).toEqual({ kind: "poison" });
    expect(poisonRow?.target?.playerId).toBe(hunter);
    expect(night2.deaths).toHaveLength(2);
    const villagerDeath = night2.deaths.find(
      (d) => d.victim.playerId === villagerA,
    );
    expect(villagerDeath).toMatchObject({ cause: "night_kill", masked: false });
    expect(villagerDeath?.truthText).toContain("狼人夜刀");
    expect(villagerDeath?.extra).toBeUndefined();
    const hunterDeath = night2.deaths.find((d) => d.victim.playerId === hunter);
    expect(hunterDeath).toMatchObject({
      cause: "poison",
      masked: true,
      extra: "猎人被毒杀 · 无法开枪",
    });
    expect(hunterDeath?.truthText).toContain("女巫毒杀");

    // 交叉核对：outcomes 与 poison 行同指同一个猎人、凶手是女巫。
    const hunterOutcome = ctx.outcomes.find((o) => o.playerId === hunter);
    expect(hunterOutcome?.deathCause).toBe("poison");
    expect(hunterOutcome?.killerIds).toEqual([witch]);
    expect(poisonRow?.target?.playerId).toBe(hunter);

    // 被毒猎人不开枪：全程没有任何天卡带 hunterShot。
    for (const round of a.rounds) {
      if (round.kind === "day") {
        expect(round.hunterShot).toBeUndefined();
      }
    }

    // 序幕：猎人卡真相文案含「毒」；死亡时序 = 真人(放逐×4) → 民A(夜刀) → 猎人(毒杀)。
    const hunterCard = a.prologue.players.find((c) => c.playerId === hunter);
    expect(hunterCard?.death?.causeLabel).toContain("毒");
    expect(hunterCard?.death?.roundLabel).toBe("第2夜");
    expect(
      a.prologue.deathOrder.map((chip) => [chip.seat, chip.causeShort]),
    ).toEqual([
      [seatOf(state, humanPlayerId), "放逐"],
      [seatOf(state, villagerA), "夜刀"],
      [seatOf(state, hunter), "毒杀"],
    ]);
    expect(a.prologue.deathOrder[0]?.exileVotes).toBe(4);
    expect(a.prologue.winner).toBe("werewolf_team");
    expect(a.prologue.boardNote).toBe("7人局 · 2狼 · 预言家/女巫/猎人 · 2村民");
  });

  it("场景B 平票加赛局：两段投票、拉票发言、加赛全员合法（含被平票者）", () => {
    let state = reachFirstNight();
    const [wolf1, wolf2] = idsByRole(state.snapshot, "werewolf");
    const seer = idsByRole(state.snapshot, "seer")[0];
    const witch = idsByRole(state.snapshot, "witch")[0];
    const hunter = idsByRole(state.snapshot, "hunter")[0];
    const villagerA = aliveVillagerNotHuman(state.snapshot);

    // 夜1：狼刀民A，女巫救 → 平安夜（7 人全活进天1）。
    state = step(state, {
      type: "submit_night_action",
      idempotencyKey: key("b-w1"),
      actorId: wolf1,
      actionType: "werewolf_kill",
      targetId: villagerA,
    });
    state = step(state, {
      type: "submit_night_action",
      idempotencyKey: key("b-w2"),
      actorId: wolf2,
      actionType: "werewolf_kill",
      targetId: villagerA,
    });
    state = step(state, {
      type: "submit_night_action",
      idempotencyKey: key("b-seer"),
      actorId: seer,
      actionType: "seer_check",
      targetId: wolf1,
    });
    state = step(state, {
      type: "submit_witch_action",
      idempotencyKey: key("b-save"),
      actorId: witch,
      witchChoice: "save",
    });

    // 天1 首轮：3 票狼1 vs 3 票民A + 猎人弃票 → 平票。
    state = throughSpeeches(state);
    state = vote(state, villagerA, "first", "target", wolf1);
    state = vote(state, seer, "first", "target", wolf1);
    state = vote(state, witch, "first", "target", wolf1);
    state = vote(state, wolf1, "first", "target", villagerA);
    state = vote(state, wolf2, "first", "target", villagerA);
    state = vote(state, humanPlayerId, "first", "target", villagerA);
    state = vote(state, hunter, "first", "abstain");
    expect(state.snapshot.gamePhase).toBe("tie_speech");

    // 拉票发言（两名被平票者按座位顺序）。
    const tieSpeakers = [...(state.snapshot.speechState?.speakerOrder ?? [])];
    expect(tieSpeakers.sort()).toEqual([wolf1, villagerA].sort());
    for (const speakerId of state.snapshot.speechState?.speakerOrder ?? []) {
      state = step(state, {
        type: "submit_tie_speech",
        idempotencyKey: key(`b-tie-${speakerId}`),
        speakerId,
        text: `${speakerId} 的拉票发言。`,
      });
    }
    expect(state.snapshot.gamePhase).toBe("tie_vote");

    // 加赛：全体存活者（含两名被平票者，仅禁自投）→ 放逐狼1（5票）。
    state = vote(state, villagerA, "tie_break", "target", wolf1);
    state = vote(state, seer, "tie_break", "target", wolf1);
    state = vote(state, witch, "tie_break", "target", wolf1);
    state = vote(state, humanPlayerId, "tie_break", "target", wolf1);
    state = vote(state, hunter, "tie_break", "target", wolf1);
    state = vote(state, wolf1, "tie_break", "target", villagerA);
    state = vote(state, wolf2, "tie_break", "target", villagerA);
    expect(state.snapshot.gamePhase).toBe("exile_last_words");
    state = step(state, {
      type: "submit_last_words",
      idempotencyKey: key("b-lw"),
      speakerId: wolf1,
      text: "我是好人，你们冤枉我了。",
    });

    // 夜2：末狼刀民A、女巫毒末狼 → 屠尽狼人终局。
    state = step(state, {
      type: "submit_night_action",
      idempotencyKey: key("b2-w2"),
      actorId: wolf2,
      actionType: "werewolf_kill",
      targetId: villagerA,
    });
    state = step(state, {
      type: "submit_night_action",
      idempotencyKey: key("b2-seer"),
      actorId: seer,
      actionType: "seer_check",
      targetId: wolf2,
    });
    state = step(state, {
      type: "submit_witch_action",
      idempotencyKey: key("b-poison"),
      actorId: witch,
      witchChoice: "poison",
      targetId: wolf2,
    });

    const ctx = toReview(state);
    const a = deriveRoundArchives(ctx);
    assertInvariants(a, ctx);

    const day1 = dayCard(a, 1);
    expect(day1.votes).toHaveLength(2);

    // 首轮：tie，无 exiled；两组各 3 票 + 1 弃票。
    expect(day1.votes[0]).toMatchObject({ voteRound: "first", outcome: "tie" });
    expect(day1.votes[0]?.subLabel).toBe("首轮投票");
    expect(day1.votes[0]?.exiled).toBeUndefined();
    expect(day1.votes[0]?.groups.map((g) => g.count)).toEqual([3, 3]);
    expect(day1.votes[0]?.abstains.map((v) => v.playerId)).toEqual([hunter]);

    // 加赛：exile，票数只来自 payload.tally。
    const tieSection = day1.votes[1];
    expect(tieSection).toMatchObject({
      voteRound: "tie_break",
      outcome: "exile",
      subLabel: "平票加赛投票",
    });
    const tieResolved = ctx.events.find((e) => e.eventId === tieSection?.key);
    const tieTally = tieResolved?.payload.tally as Record<string, number>;
    expect(tieSection?.exiled?.count).toBe(tieTally[wolf1]);
    expect(tieSection?.exiled?.count).toBe(5);
    expect(tieSection?.exiled?.role).toBe("werewolf");
    expect(tieSection?.exiled?.anchorId).toBe(`d-seat${seatOf(state, wolf1)}`);

    // 拉票发言两条，tag 一律「拉票」。
    expect(day1.tieSpeeches).toHaveLength(2);
    expect(day1.tieSpeeches.every((s) => s.tag === "拉票")).toBe(true);

    // 加赛覆盖全员：各组 voters + abstains = 当时存活 7 人，且两名被平票者都投了票。
    const tieVoterIds = [
      ...(tieSection?.groups.flatMap((g) => g.voters.map((v) => v.playerId)) ?? []),
      ...(tieSection?.abstains.map((v) => v.playerId) ?? []),
    ];
    expect(tieVoterIds).toHaveLength(7);
    expect(tieVoterIds).toContain(wolf1);
    expect(tieVoterIds).toContain(villagerA);

    // 白天死亡缩影：dots 含被放逐者座位。
    expect(day1.dots).toEqual([seatOf(state, wolf1)]);
    // 遗言归天1卡。
    expect(day1.lastWords).toHaveLength(1);
    expect(day1.lastWords[0]?.tag).toBe("遗言");
    expect(day1.endNote).toBeUndefined(); // 天1未终局（夜2才终局）。
  });

  it("场景C 猎人枪局：夜死可开枪、开枪归天卡、流局与女巫空过、预言家出局合成行", () => {
    let state = reachFirstNight();
    const [wolf1, wolf2] = idsByRole(state.snapshot, "werewolf");
    const seer = idsByRole(state.snapshot, "seer")[0];
    const witch = idsByRole(state.snapshot, "witch")[0];
    const hunter = idsByRole(state.snapshot, "hunter")[0];
    const villagerA = aliveVillagerNotHuman(state.snapshot);

    // 夜1：狼刀预言家（女巫空过）→ 预言家出局。
    state = step(state, {
      type: "submit_night_action",
      idempotencyKey: key("c-w1"),
      actorId: wolf1,
      actionType: "werewolf_kill",
      targetId: seer,
    });
    state = step(state, {
      type: "submit_night_action",
      idempotencyKey: key("c-w2"),
      actorId: wolf2,
      actionType: "werewolf_kill",
      targetId: seer,
    });
    state = step(state, {
      type: "submit_night_action",
      idempotencyKey: key("c-seer"),
      actorId: seer,
      actionType: "seer_check",
      targetId: wolf1,
    });
    state = step(state, {
      type: "submit_witch_action",
      idempotencyKey: key("c-skip1"),
      actorId: witch,
      witchChoice: "skip",
    });

    // 天1：全员弃票 → 流局（no_exile）→ 夜2。
    state = throughSpeeches(state);
    for (const voter of [wolf1, wolf2, witch, hunter, humanPlayerId, villagerA]) {
      state = vote(state, voter, "first", "abstain");
    }
    expect(state.snapshot.gamePhase).toBe("night_action");

    // 夜2：狼刀猎人（女巫再空过）→ 猎人夜死（非毒，可开枪）。
    state = step(state, {
      type: "submit_night_action",
      idempotencyKey: key("c2-w1"),
      actorId: wolf1,
      actionType: "werewolf_kill",
      targetId: hunter,
    });
    state = step(state, {
      type: "submit_night_action",
      idempotencyKey: key("c2-w2"),
      actorId: wolf2,
      actionType: "werewolf_kill",
      targetId: hunter,
    });
    state = step(state, {
      type: "submit_witch_action",
      idempotencyKey: key("c-skip2"),
      actorId: witch,
      witchChoice: "skip",
    });
    expect(state.snapshot.gamePhase).toBe("day_announcement");
    expect(state.snapshot.pendingHunterId).toBe(hunter);

    // 天2：天亮确认 → 猎人开枪带走狼1 → 白天发言 → 放逐狼2 → 屠尽狼人终局（铁律③）。
    state = step(state, {
      type: "confirm_day_announcement",
      idempotencyKey: key("c-confirm-day2"),
      playerId: humanPlayerId,
    });
    expect(state.snapshot.gamePhase).toBe("hunter_shoot");
    state = step(state, {
      type: "submit_hunter_shoot",
      idempotencyKey: key("c-shot"),
      actorId: hunter,
      targetId: wolf1,
    });
    expect(state.snapshot.gamePhase).toBe("day_speech");
    for (const speakerId of state.snapshot.speechState?.speakerOrder ?? []) {
      state = step(state, {
        type: "submit_speech",
        idempotencyKey: key(`c-speech2-${speakerId}`),
        speakerId,
        text: `${speakerId} 的第二天发言。`,
      });
    }
    state = vote(state, witch, "first", "target", wolf2);
    state = vote(state, humanPlayerId, "first", "target", wolf2);
    state = vote(state, villagerA, "first", "target", wolf2);
    state = vote(state, wolf2, "first", "target", humanPlayerId);

    const ctx = toReview(state);
    const a = deriveRoundArchives(ctx);
    assertInvariants(a, ctx);

    // 开枪行归天2卡头（夜卡结构上不存在 hunterShot；天1卡也不得有）。
    const day2 = dayCard(a, 2);
    expect(dayCard(a, 1).hunterShot).toBeUndefined();
    expect(day2.hunterShot?.hunter.seat).toBe(seatOf(state, hunter));
    expect(day2.hunterShot?.target?.seat).toBe(seatOf(state, wolf1));
    expect(day2.hunterShot?.anchorId).toBe(`d-seat${seatOf(state, wolf1)}`);

    // 夜2：猎人被刀（非毒）→ masked:false、无「无法开枪」注记。
    const night2 = nightCard(a, 2);
    const hunterDeath = night2.deaths.find((d) => d.victim.playerId === hunter);
    expect(hunterDeath).toMatchObject({ cause: "night_kill", masked: false });
    expect(hunterDeath?.extra).toBeUndefined();
    expect(hunterDeath?.truthText).toContain("狼人夜刀");

    // 女巫两夜空过：夜1/夜2 各有一条 skip 行（无目标、无徽章）。
    for (const n of [1, 2] as const) {
      const skipRow = nightCard(a, n).actions.find((row) => row.kind === "skip");
      expect(skipRow?.actor.playerId).toBe(witch);
      expect(skipRow?.target).toBeUndefined();
      expect(skipRow?.badge).toBeUndefined();
    }

    // 天1 流局：outcome 原样 no_exile，无 exiled、无死亡。
    const day1 = dayCard(a, 1);
    expect(day1.votes[0]?.outcome).toBe("no_exile");
    expect(day1.votes[0]?.exiled).toBeUndefined();
    expect(day1.votes[0]?.abstains).toHaveLength(6);
    expect(day1.dots).toEqual([]);

    // 天2 dots = 枪杀狼1 + 放逐狼2；放逐达成胜负 → endNote（铁律③），无遗言。
    expect([...day2.dots].sort()).toEqual(
      [seatOf(state, wolf1), seatOf(state, wolf2)].sort(),
    );
    expect(day2.endNote).toContain("跳过遗言与猎人开枪");
    expect(day2.lastWords).toEqual([]);

    // outcomes 交叉核对：狼1 死于猎人枪、凶手是猎人；缩略带 causeShort=枪杀。
    const wolf1Outcome = ctx.outcomes.find((o) => o.playerId === wolf1);
    expect(wolf1Outcome?.deathCause).toBe("hunter_shot");
    expect(wolf1Outcome?.killerIds).toEqual([hunter]);
    const wolf1Chip = a.prologue.deathOrder.find(
      (chip) => chip.seat === seatOf(state, wolf1),
    );
    expect(wolf1Chip?.causeShort).toBe("枪杀");

    // 预言家夜1出局 → 夜2叙事保底给出「本夜无查验」合成行。
    expect(
      night2.narr.some(
        (line) =>
          line.key === "synth-night-2-no-seer" &&
          line.dot === "check" &&
          line.segments.includes("预言家已出局——本夜无查验"),
      ),
    ).toBe(true);
    expect(nightCard(a, 1).narr).toEqual([]);
  });

  it("场景E 枪杀终局：拂晓开枪带走末狼直接终局，endNote 不得宣称「跳过猎人开枪」", () => {
    let state = reachFirstNight();
    const [wolf1, wolf2] = idsByRole(state.snapshot, "werewolf");
    const seer = idsByRole(state.snapshot, "seer")[0];
    const witch = idsByRole(state.snapshot, "witch")[0];
    const hunter = idsByRole(state.snapshot, "hunter")[0];
    const villagerA = aliveVillagerNotHuman(state.snapshot);

    // 夜1：狼刀民A（女巫不救）→ 民A出局。
    state = step(state, {
      type: "submit_night_action",
      idempotencyKey: key("e-w1"),
      actorId: wolf1,
      actionType: "werewolf_kill",
      targetId: villagerA,
    });
    state = step(state, {
      type: "submit_night_action",
      idempotencyKey: key("e-w2"),
      actorId: wolf2,
      actionType: "werewolf_kill",
      targetId: villagerA,
    });
    state = step(state, {
      type: "submit_night_action",
      idempotencyKey: key("e-seer"),
      actorId: seer,
      actionType: "seer_check",
      targetId: wolf1,
    });
    state = step(state, {
      type: "submit_witch_action",
      idempotencyKey: key("e-skip1"),
      actorId: witch,
      witchChoice: "skip",
    });

    // 天1：放逐狼1（未终局，狼2尚存）→ 遗言 → 夜2。
    state = throughSpeeches(state);
    state = vote(state, seer, "first", "target", wolf1);
    state = vote(state, witch, "first", "target", wolf1);
    state = vote(state, hunter, "first", "target", wolf1);
    state = vote(state, humanPlayerId, "first", "target", wolf1);
    state = vote(state, wolf1, "first", "target", humanPlayerId);
    state = vote(state, wolf2, "first", "target", humanPlayerId);
    expect(state.snapshot.gamePhase).toBe("exile_last_words");
    state = step(state, {
      type: "submit_last_words",
      idempotencyKey: key("e-lw"),
      speakerId: wolf1,
      text: "狼1的遗言。",
    });

    // 夜2：末狼刀猎人（非毒，可开枪）。
    state = step(state, {
      type: "submit_night_action",
      idempotencyKey: key("e2-w2"),
      actorId: wolf2,
      actionType: "werewolf_kill",
      targetId: hunter,
    });
    state = step(state, {
      type: "submit_night_action",
      idempotencyKey: key("e2-seer"),
      actorId: seer,
      actionType: "seer_check",
      targetId: wolf2,
    });
    state = step(state, {
      type: "submit_witch_action",
      idempotencyKey: key("e-skip2"),
      actorId: witch,
      witchChoice: "skip",
    });
    expect(state.snapshot.gamePhase).toBe("day_announcement");
    expect(state.snapshot.pendingHunterId).toBe(hunter);

    // 天2：拂晓猎人开枪带走末狼 → 屠尽狼人，枪杀直接终局（无发言/投票）。
    state = step(state, {
      type: "confirm_day_announcement",
      idempotencyKey: key("e-confirm-day2"),
      playerId: humanPlayerId,
    });
    expect(state.snapshot.gamePhase).toBe("hunter_shoot");
    state = step(state, {
      type: "submit_hunter_shoot",
      idempotencyKey: key("e-shot"),
      actorId: hunter,
      targetId: wolf2,
    });

    const ctx = toReview(state);
    const a = deriveRoundArchives(ctx);
    assertInvariants(a, ctx);

    // 全局最后一死 = 狼2，死因 hunter_shot（枪杀终局路径）。
    const wolf2Outcome = ctx.outcomes.find((o) => o.playerId === wolf2);
    expect(wolf2Outcome?.deathCause).toBe("hunter_shot");
    expect(wolf2Outcome?.killerIds).toEqual([hunter]);

    // 天2卡：开枪行在列 + endNote 按枪杀路径给文案，绝不宣称「跳过遗言与猎人开枪」。
    const day2 = dayCard(a, 2);
    expect(day2.hunterShot?.hunter.seat).toBe(seatOf(state, hunter));
    expect(day2.hunterShot?.target?.seat).toBe(seatOf(state, wolf2));
    expect(day2.endNote).toContain("猎人开枪直接终局");
    expect(day2.endNote).not.toContain("跳过");

    // 天1未终局：无 endNote，遗言正常归档。
    const day1 = dayCard(a, 1);
    expect(day1.endNote).toBeUndefined();
    expect(day1.lastWords).toHaveLength(1);
    expect(a.prologue.winner).toBe("good_team");
  });

  it("场景D 天1速胜局（5人板）：导航稀疏两节点、无女巫猎人注记、铁律③跳遗言", () => {
    // 复用 fast-forward 的 reachReview 剧本：夜1狼刀民 → 天1放逐唯一狼 → 好人速胜。
    const ffBoardId = "mvp_5p_wolf_seer_3villagers";
    const now = "2026-07-16T11:00:00.000Z";
    const created = expectOk(
      applyAction(
        {
          type: "create_game",
          idempotencyKey: key("d-create"),
          mode: "free",
          boardId: ffBoardId,
          humanPlayerId,
        },
        { now },
      ),
    );
    let state: EngineState = {
      session: created.session,
      snapshot: created.snapshot,
      events: created.events,
    };
    state = step(state, {
      type: "confirm_role_setup",
      idempotencyKey: key("d-setup"),
      playerId: humanPlayerId,
      selectedRole: "villager",
    });
    state = step(state, {
      type: "confirm_role_reveal",
      idempotencyKey: key("d-reveal"),
      playerId: humanPlayerId,
    });

    const wolfId = idsByRole(state.snapshot, "werewolf")[0];
    const seerId = idsByRole(state.snapshot, "seer")[0];
    const killedVillagerId = aliveVillagerNotHuman(state.snapshot);
    state = step(state, {
      type: "submit_night_action",
      idempotencyKey: key("d-kill"),
      actorId: wolfId,
      actionType: "werewolf_kill",
      targetId: killedVillagerId,
    });
    state = step(state, {
      type: "submit_night_action",
      idempotencyKey: key("d-check"),
      actorId: seerId,
      actionType: "seer_check",
      targetId: wolfId,
    });
    state = throughSpeeches(state);
    const otherVoters = state.snapshot.players
      .filter((p) => p.alive && p.playerId !== wolfId)
      .map((p) => p.playerId);
    for (const voterId of otherVoters) {
      state = vote(state, voterId, "first", "target", wolfId);
    }
    state = vote(state, wolfId, "first", "target", humanPlayerId);

    const ctx = toReview(state);
    const a = deriveRoundArchives(ctx);
    assertInvariants(a, ctx);

    // 导航稀疏形态：只有夜1、天1两个节点。
    expect(a.rounds).toHaveLength(2);
    expect(a.rounds.map((r) => r.kind)).toEqual(["night", "day"]);

    // 夜1：本板无女巫与猎人；一条夜刀死亡；无 save/poison/skip 行。
    const night1 = nightCard(a, 1);
    expect(night1.emptyNote).toBe("本板无女巫与猎人");
    expect(night1.deaths).toHaveLength(1);
    expect(night1.deaths[0]).toMatchObject({ cause: "night_kill", masked: false });
    expect(
      night1.actions.some((row) => ["save", "poison", "skip"].includes(row.kind)),
    ).toBe(false);
    expect(night1.actions.map((row) => row.kind)).toEqual(["kill", "check"]);

    // 天1：放逐唯一狼 → exile；铁律③跳遗言 → lastWords 空 + endNote 非空。
    const day1 = dayCard(a, 1);
    expect(day1.votes[0]?.outcome).toBe("exile");
    expect(day1.votes[0]?.exiled?.faction).toBe("werewolf_team");
    expect(day1.votes[0]?.exiled?.count).toBe(3);
    expect(day1.lastWords).toEqual([]);
    expect(day1.endNote).toBeTruthy();
    expect(day1.announce?.deadSeats).toEqual([seatOf(state, killedVillagerId)]);

    // 序幕与终局。
    expect(a.prologue.winner).toBe("good_team");
    expect(a.prologue.winReasonText).toBe("屠尽所有狼人");
    expect(a.prologue.boardNote).toBe("5人局 · 1狼 · 预言家 · 3村民");
    expect(a.prologue.deathOrder).toHaveLength(2);
    const aliveCount = ctx.outcomes.filter((o) => o.alive).length;
    expect(a.finale.alive).toHaveLength(aliveCount);
    expect(
      a.finale.alive.some(
        (ref) =>
          ctx.players.find((p) => p.playerId === ref.playerId)?.role === "werewolf",
      ),
    ).toBe(false);
    expect(a.finale.line).toBe("好人阵营胜利 — 屠尽所有狼人");
    expect(a.finale.narrText).toBe("全程 1 夜 1 天，3 人存活。");
  });
});
