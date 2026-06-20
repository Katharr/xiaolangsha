import { useState } from "react";

import type { GameAction, Player, Result, ReviewContext } from "../shared";
import { toUserMessage } from "../store";

import { FACTION_LABEL, ROLE_LABEL, WIN_REASON_LABEL } from "./labels";
import { TextInput } from "./TextInput";

export type ReviewPanelProps = {
  reviewContext: ReviewContext;
  busy: boolean;
  humanPlayerId: string;
  nextKey: (prefix: string) => string;
  act: (action: GameAction) => void;
  askReview: (question: string) => Promise<Result<string>>;
};

type QaEntry = { id: number; question: string; answer: string };

/**
 * 复盘面板：仅 review 阶段渲染 store 组装的完整真相（ISO-002 由 store 在调用点保证）。
 * 展示真实身份、夜晚行动、投票、发言原文、胜负，并提供向 AI 追问的入口。
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

  const labelOf = (id: string): string => {
    const player = reviewContext.players.find((p) => p.playerId === id);
    return player ? `${player.name}（${player.seat}号）` : "某玩家";
  };

  const sortedPlayers = [...reviewContext.players].sort((a, b) => a.seat - b.seat);

  const handleAsk = async (question: string): Promise<boolean> => {
    const result = await askReview(question);
    const answer = result.ok ? result.data : toUserMessage(result.error);
    const id = qaId + 1;
    setQaId(id);
    setQaLog((log) => [...log, { id, question, answer }]);
    return result.ok;
  };

  return (
    <div className="review-panel" aria-label="复盘">
      <section className="review-section">
        <h2>对局结果</h2>
        <p className="review-outcome">
          {FACTION_LABEL[reviewContext.winner]}获胜 —— {WIN_REASON_LABEL[reviewContext.winReason]}
        </p>
      </section>

      <section className="review-section">
        <h2>身份真相</h2>
        <ul className="review-list">
          {sortedPlayers.map((player: Player) => (
            <li key={player.playerId}>
              {player.name}（{player.seat}号）{player.isHuman ? "·你" : ""} ·{" "}
              {ROLE_LABEL[player.role]} · {FACTION_LABEL[player.faction]} ·{" "}
              {player.alive ? "存活" : "出局"}
            </li>
          ))}
        </ul>
      </section>

      <section className="review-section">
        <h2>夜晚行动</h2>
        {reviewContext.nightActions.length === 0 ? (
          <p className="review-empty">无夜晚行动记录。</p>
        ) : (
          <ul className="review-list">
            {reviewContext.nightActions.map((night) => {
              const verb =
                night.actionType === "werewolf_kill"
                  ? "击杀"
                  : night.actionType === "seer_check"
                    ? "查验"
                    : night.actionType === "guard_protect"
                      ? "守护"
                      : night.actionType === "witch_save"
                        ? "用解药救"
                        : night.actionType === "witch_poison"
                          ? "用毒药毒"
                          : "行动";
              const faction =
                night.result?.factionResult === "werewolf_team"
                  ? "（狼人）"
                  : night.result?.factionResult === "good_team"
                    ? "（好人）"
                    : "";
              // 狼刀是团队行动：展示参与的全部狼 + 各自的刀票，而非笼统的「某玩家」。
              const actorText =
                night.actorIds && night.actorIds.length > 0
                  ? `狼队（${night.actorIds.map(labelOf).join("、")}）`
                  : labelOf(night.actorId);
              const wolfVotes =
                night.actionType === "werewolf_kill" &&
                night.result?.wolfVotes &&
                typeof night.result.wolfVotes === "object"
                  ? (night.result.wolfVotes as Record<string, string>)
                  : null;
              const wolfVotesText = wolfVotes
                ? Object.entries(wolfVotes)
                    .map(([wolfId, targetId]) => `${labelOf(wolfId)}→${labelOf(targetId)}`)
                    .join("，")
                : "";
              // 狼刀是否得手（被守卫守护/女巫救则未得手），也是复盘该看到的细节。
              const killMissed =
                night.actionType === "werewolf_kill" && night.result?.killed === false;
              return (
                <li key={night.eventId}>
                  第 {night.night} 夜：{actorText} {verb}{" "}
                  {night.targetId ? labelOf(night.targetId) : "（无目标）"}
                  {killMissed ? "（未得手）" : ""}
                  {faction}
                  {wolfVotesText ? `（刀票：${wolfVotesText}）` : ""}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="review-section">
        <h2>投票记录</h2>
        {reviewContext.votes.length === 0 ? (
          <p className="review-empty">无投票记录。</p>
        ) : (
          <ul className="review-list">
            {reviewContext.votes.map((vote) => (
              <li key={vote.eventId}>
                第 {vote.day} 天
                {vote.voteRound === "tie_break" ? "（二次）" : ""}：
                {labelOf(vote.voterId)} →{" "}
                {vote.choiceType === "abstain"
                  ? "弃票"
                  : vote.targetId
                    ? labelOf(vote.targetId)
                    : "（无）"}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="review-section">
        <h2>发言记录</h2>
        {reviewContext.speeches.length === 0 ? (
          <p className="review-empty">无发言记录。</p>
        ) : (
          <ul className="review-list">
            {reviewContext.speeches.map((speech) => {
              const tag =
                speech.speechKind === "last_words"
                  ? "【遗言】"
                  : speech.speechKind === "tie_speech"
                    ? "【拉票】"
                    : "";
              return (
                <li key={speech.eventId}>
                  第 {speech.day} 天 {labelOf(speech.speakerId)}：{tag}
                  {speech.text}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="review-section">
        <h2>向 AI 追问</h2>
        {qaLog.length > 0 ? (
          <ul className="review-qa">
            {qaLog.map((entry) => (
              <li key={entry.id}>
                <p className="qa-question">问：{entry.question}</p>
                <p className="qa-answer">答：{entry.answer}</p>
              </li>
            ))}
          </ul>
        ) : null}
        <TextInput
          enabled
          busy={busy}
          maxLength={300}
          placeholder="向 AI 玩家追问，例如：你为什么投我？"
          submitLabel="提交追问"
          emptyHint="追问不能为空，且不能超过 300 字。"
          onSubmit={handleAsk}
        />
      </section>

      <button
        type="button"
        className="new-game-button"
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
  );
}
