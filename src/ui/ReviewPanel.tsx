import { useState } from "react";

import type { GameAction, Player, Result, ReviewContext } from "../shared";

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

  const seatOf = (id: string): number | string =>
    reviewContext.players.find((p) => p.playerId === id)?.seat ?? "?";

  const sortedPlayers = [...reviewContext.players].sort((a, b) => a.seat - b.seat);

  const handleAsk = async (question: string): Promise<boolean> => {
    const result = await askReview(question);
    const answer = result.ok
      ? result.data
      : (result.error.userMessage ?? "追问失败。");
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
              {player.seat}号 {player.controller === "human" ? "你" : "AI"} ·{" "}
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
              const verb = night.actionType === "werewolf_kill" ? "击杀" : "查验";
              const faction =
                night.result?.factionResult === "werewolf_team"
                  ? "（狼人）"
                  : night.result?.factionResult === "good_team"
                    ? "（好人）"
                    : "";
              return (
                <li key={night.eventId}>
                  第 {night.night} 夜：{seatOf(night.actorId)}号 {verb}{" "}
                  {night.targetId ? `${seatOf(night.targetId)}号` : "（无目标）"}
                  {faction}
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
                {seatOf(vote.voterId)}号 →{" "}
                {vote.choiceType === "abstain"
                  ? "弃票"
                  : `${vote.targetId ? seatOf(vote.targetId) : "?"}号`}
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
                  第 {speech.day} 天 {seatOf(speech.speakerId)}号：{tag}
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
