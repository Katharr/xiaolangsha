import { useMemo, useState, type ReactNode } from "react";

import type {
  GameAction,
  NarrationSegment,
  Player,
  PlayerOutcome,
  Result,
  ReviewContext,
  ReviewSpeechRef,
  TruthEvent,
} from "../shared";
import { narrateEvent } from "../shared";
import { toUserMessage } from "../store";

import { Avatar } from "./Avatar";
import { FACTION_LABEL, ROLE_LABEL, WIN_REASON_LABEL } from "./labels";
import { PlayerName } from "./PlayerName";
import { TextInput } from "./TextInput";
import "./review.css";

export type ReviewPanelProps = {
  reviewContext: ReviewContext;
  busy: boolean;
  humanPlayerId: string;
  nextKey: (prefix: string) => string;
  act: (action: GameAction) => void;
  askReview: (question: string) => Promise<Result<string>>;
};

type QaEntry = { id: number; question: string; answer: string };

/** 时间线里不单独成行的事件：发言并入折叠区；胜负/开局由横幅与速览覆盖。 */
const TIMELINE_SKIP = new Set([
  "speech_submitted",
  "tie_speech_submitted",
  "win_checked",
  "game_ended",
  "game_created",
]);

/**
 * 复盘面板：仅 review 阶段渲染 store 组装的完整真相（ISO-002 由 store 在调用点保证）。
 * 自上而下＝结果横幅 → 结局速览（谁怎么死的、谁干的）→ 回合叙事时间线 → 向 AI 追问。
 */
export function ReviewPanel({
  reviewContext,
  busy,
  humanPlayerId,
  nextKey,
  act,
  askReview,
}: ReviewPanelProps) {
  const [qaLog, setQaLog] = useState<QaEntry[]>([]);
  const [qaId, setQaId] = useState(0);
  // 追问进行中显示的问题：await 期间先把问题上屏 + 显示「思考中」，让用户看到「已点到、在等待」。
  const [pending, setPending] = useState<string | null>(null);

  const byId = useMemo(() => {
    const map = new Map<string, Player>();
    for (const p of reviewContext.players) {
      map.set(p.playerId, p);
    }
    return map;
  }, [reviewContext.players]);

  // 真人是狼时，标出其余狼为「你的狼队友」（复盘可见完整真相）。
  const teammateIds = useMemo(() => {
    const human = byId.get(humanPlayerId);
    if (human?.role !== "werewolf") {
      return new Set<string>();
    }
    return new Set(
      reviewContext.players
        .filter((p) => p.role === "werewolf" && p.playerId !== humanPlayerId)
        .map((p) => p.playerId),
    );
  }, [byId, humanPlayerId, reviewContext.players]);

  const sortedPlayers = useMemo(
    () => [...reviewContext.players].sort((a, b) => a.seat - b.seat),
    [reviewContext.players],
  );
  const outcomeById = useMemo(() => {
    const map = new Map<string, PlayerOutcome>();
    for (const o of reviewContext.outcomes) {
      map.set(o.playerId, o);
    }
    return map;
  }, [reviewContext.outcomes]);

  const rounds = useMemo(
    () => groupTimeline(reviewContext.events),
    [reviewContext.events],
  );

  const renderName = (playerId: string) => {
    const p = byId.get(playerId);
    return p ? (
      <PlayerName name={p.name} seat={p.seat} isSelf={p.isHuman} />
    ) : (
      <span className="pname">某玩家</span>
    );
  };

  const renderSegments = (segs: NarrationSegment[]) =>
    segs.map((s, i) =>
      typeof s === "string" ? (
        <span key={i}>{s}</span>
      ) : (
        <span key={i}>{renderName(s.playerId)}</span>
      ),
    );

  const handleAsk = async (question: string): Promise<boolean> => {
    setPending(question);
    try {
      const result = await askReview(question);
      const answer = result.ok ? result.data : toUserMessage(result.error);
      const id = qaId + 1;
      setQaId(id);
      setQaLog((log) => [...log, { id, question, answer }]);
      return result.ok;
    } finally {
      setPending(null);
    }
  };

  const winWolf = reviewContext.winner === "werewolf_team";

  return (
    <div className="rv" aria-label="复盘">
      {/* 1. 结果横幅 */}
      <div className={`rv-banner${winWolf ? " win-wolf" : ""}`}>
        <div className="rv-crown">{winWolf ? "🐺" : "🏆"}</div>
        <h1>{FACTION_LABEL[reviewContext.winner]} 获胜</h1>
        <div className="rv-reason">{WIN_REASON_LABEL[reviewContext.winReason]}</div>
      </div>

      {/* 2. 结局速览 */}
      <section className="rv-card">
        <h2 className="rv-title">结局速览</h2>
        <div className="rv-grid">
          {sortedPlayers.map((player) => (
            <OutcomeCard
              key={player.playerId}
              player={player}
              outcome={outcomeById.get(player.playerId)}
              isTeammate={teammateIds.has(player.playerId)}
              renderName={renderName}
            />
          ))}
        </div>
      </section>

      {/* 3. 回合叙事时间线 */}
      <section className="rv-card">
        <h2 className="rv-title">对局时间线</h2>
        <div className="rv-timeline">
          {rounds.map((round) => (
            <RoundBlock
              key={`${round.kind}-${round.n}`}
              round={round}
              speeches={reviewContext.speeches}
              renderSegments={renderSegments}
              renderName={renderName}
            />
          ))}
          <div className="rv-ev win">
            <span className="rv-dot" />
            <span>
              终局：
              <b className={winWolf ? "v-wolf" : "v-good"}>
                {FACTION_LABEL[reviewContext.winner]}获胜
              </b>
              （{WIN_REASON_LABEL[reviewContext.winReason]}）
            </span>
          </div>
        </div>
      </section>

      {/* 4. 向 AI 追问 */}
      <section className="rv-card">
        <h2 className="rv-title">向 AI 追问</h2>
        {qaLog.length > 0 || pending ? (
          <ul className="rv-qa">
            {qaLog.map((entry) => (
              <li key={entry.id}>
                <p className="qa-q">问：{entry.question}</p>
                <p className="qa-a">答：{entry.answer}</p>
              </li>
            ))}
            {pending ? (
              <li className="qa-pending">
                <p className="qa-q">问：{pending}</p>
                <p className="qa-a thinking">
                  AI 正在思考<span className="qa-dots" aria-hidden="true" />
                </p>
              </li>
            ) : null}
          </ul>
        ) : null}
        <TextInput
          enabled
          busy={busy}
          maxLength={300}
          placeholder="向 AI 玩家追问，例如：你为什么投我？女巫为什么毒我队友？"
          submitLabel="提交追问"
          emptyHint="追问不能为空，且不能超过 300 字。"
          onSubmit={handleAsk}
        />
      </section>

      {/* 5. 开始新局 */}
      <div className="rv-newgame">
        <button
          type="button"
          className="rv-btn primary"
          disabled={busy}
          onClick={() =>
            act({
              type: "confirm_new_game",
              idempotencyKey: nextKey("newgame"),
              playerId: humanPlayerId,
            })
          }
        >
          开始新局
        </button>
      </div>
    </div>
  );
}

function OutcomeCard({
  player,
  outcome,
  isTeammate,
  renderName,
}: {
  player: Player;
  outcome?: PlayerOutcome;
  isTeammate: boolean;
  renderName: (id: string) => ReactNode;
}) {
  const dead = !player.alive;
  const tag = outcomeTag(outcome);
  return (
    <div className={`rv-ocard${dead ? " dead" : ""}${player.isHuman ? " self" : ""}`}>
      {isTeammate ? <span className="rv-mate">🐺 你的狼队友</span> : null}
      <Avatar seat={player.seat} className="rv-av" />
      <div className="rv-obody">
        <div className="rv-oline1">
          <PlayerName name={player.name} seat={player.seat} isSelf={player.isHuman} />
          {player.isHuman ? <span className="rv-you">· 你</span> : null}
        </div>
        <div className="rv-ometa">
          {ROLE_LABEL[player.role]} ·{" "}
          <span className={player.faction === "werewolf_team" ? "f-wolf" : "f-good"}>
            {FACTION_LABEL[player.faction]}
          </span>
        </div>
        <span className={`rv-otag ${tag.cls}`}>
          {tag.icon} {tag.text}
          {tag.killerIds && tag.killerIds.length > 0 ? (
            <span className="rv-by">
              · {tag.byPrefix}
              {tag.killerIds.map((id, i) => (
                <span key={id}>
                  {i > 0 ? "、" : ""}
                  {renderName(id)}
                </span>
              ))}
            </span>
          ) : null}
          {tag.suffix ? <span className="rv-by">· {tag.suffix}</span> : null}
        </span>
      </div>
    </div>
  );
}

type Tag = {
  cls: string;
  icon: string;
  text: string;
  byPrefix?: string;
  killerIds?: string[];
  suffix?: string;
};

/** 把 PlayerOutcome 折成结局色标（图标 / 文案 / 责任方）。 */
function outcomeTag(outcome?: PlayerOutcome): Tag {
  if (!outcome || outcome.alive) {
    return { cls: "alive", icon: "✅", text: "存活到终局" };
  }
  const when =
    outcome.deathRound !== undefined
      ? outcome.deathPhaseKind === "night"
        ? `第${outcome.deathRound}夜 `
        : `第${outcome.deathRound}天 `
      : "";
  switch (outcome.deathCause) {
    case "night_kill":
      return {
        cls: "knife",
        icon: "🔪",
        text: `${when}被狼刀`,
        byPrefix: "狼队 ",
        killerIds: outcome.killerIds,
      };
    case "poison":
      return {
        cls: "poison",
        icon: "☠️",
        text: `${when}被毒杀`,
        byPrefix: "女巫 ",
        killerIds: outcome.killerIds,
      };
    case "exile":
      return {
        cls: "exile",
        icon: "⚖️",
        text: `${when}被放逐`,
        suffix:
          outcome.exileVotes !== undefined ? `${outcome.exileVotes} 票出局` : undefined,
      };
    case "hunter_shot":
      return {
        cls: "hunter",
        icon: "🎯",
        text: `${when}被猎人带走`,
        byPrefix: "猎人 ",
        killerIds: outcome.killerIds,
      };
    default:
      return { cls: "exile", icon: "💀", text: `${when}出局` };
  }
}

type RoundGroup = {
  kind: "night" | "day";
  n: number;
  day: number;
  events: { event: TruthEvent; segs: NarrationSegment[] }[];
};

/** 把事件流按「第N夜 / 第N天」分组，过滤发言与胜负噪声（由横幅/折叠区覆盖）。 */
function groupTimeline(events: TruthEvent[]): RoundGroup[] {
  const groups: RoundGroup[] = [];
  let current: RoundGroup | null = null;
  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    if (TIMELINE_SKIP.has(event.type)) {
      continue;
    }
    const segs = narrateEvent(event);
    if (!segs) {
      continue;
    }
    const kind: "night" | "day" =
      event.phase === "night_action" ? "night" : "day";
    const n = kind === "night" ? event.round.night : event.round.day;
    if (!current || current.kind !== kind || current.n !== n) {
      current = { kind, n, day: event.round.day, events: [] };
      groups.push(current);
    }
    current.events.push({ event, segs });
  }
  return groups;
}

function RoundBlock({
  round,
  speeches,
  renderSegments,
  renderName,
}: {
  round: RoundGroup;
  speeches: ReviewSpeechRef[];
  renderSegments: (segs: NarrationSegment[]) => ReactNode;
  renderName: (id: string) => ReactNode;
}) {
  // 白天发言折叠：announcement 之后、其余事件（投票/遗言）之前插入。
  const daySpeeches =
    round.kind === "day"
      ? speeches.filter(
          (s) => s.day === round.day && s.speechKind !== "last_words",
        )
      : [];
  const announce = round.events.filter((e) => e.event.type === "day_announced");
  const rest = round.events.filter((e) => e.event.type !== "day_announced");

  const evClass = (event: TruthEvent): string => {
    switch (event.type) {
      case "night_action_resolved":
        return event.payload.actionType === "werewolf_kill"
          ? "kill"
          : event.payload.actionType === "seer_check"
            ? "check"
            : "";
      case "player_died":
        return "death";
      case "vote_resolved":
        return "vote";
      case "last_words_submitted":
        return "words";
      default:
        return "";
    }
  };

  const line = (item: { event: TruthEvent; segs: NarrationSegment[] }) => (
    <div className={`rv-ev ${evClass(item.event)}`} key={item.event.eventId}>
      <span className="rv-dot" />
      <span className="rv-evtext">{renderSegments(item.segs)}</span>
    </div>
  );

  return (
    <div className={`rv-round ${round.kind}`}>
      <div className="rv-round-head">
        {round.kind === "night" ? `🌙 第 ${round.n} 夜` : `☀️ 第 ${round.n} 天`}
      </div>
      <div className="rv-events">
        {announce.map(line)}
        {daySpeeches.length > 0 ? (
          <details className="rv-speeches">
            <summary>展开 {daySpeeches.length} 条白天发言</summary>
            {daySpeeches.map((s) => (
              <div className="rv-speech" key={s.eventId}>
                {renderName(s.speakerId)}
                {s.speechKind === "tie_speech" ? (
                  <span className="rv-tag">【拉票】</span>
                ) : null}
                ：{s.text}
              </div>
            ))}
          </details>
        ) : null}
        {rest.map(line)}
      </div>
    </div>
  );
}
