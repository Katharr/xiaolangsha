import { Fragment, type RefObject } from "react";

export type QaEntry = { id: number; question: string; answer: string };

/** 情境提问 chips：有「问这一轮」上下文时按夜/天出题，否则给通用三问。 */
export function chipsFor(ctx: string | null): string[] {
  if (!ctx) {
    return [
      "我这局哪一步失误最大？",
      "狼队整体思路是什么？",
      "下一局我该怎么改进？",
    ];
  }
  if (ctx.includes("夜")) {
    return [`${ctx}狼人的刀口是怎么选的？`, `${ctx}的查验与用药决策对吗？`];
  }
  return [`${ctx}的票为什么这么投？`, `${ctx}我该怎么发言更好？`];
}

/**
 * 幕后问答（#qa）：问答记录只存内存不持久化；pending 期间问题先上屏、
 * 答案位显示 typing 三点（aria 层保留「AI 正在思考」），同时驱动导航
 * 问AI节点的呼吸态。输入受控（maxLength=300），支持「问这一轮」预填与 chip 快填。
 */
export function ReviewQa({
  qaLog,
  pending,
  qaCtx,
  draft,
  setDraft,
  busy,
  inputRef,
  onSend,
}: {
  qaLog: QaEntry[];
  pending: string | null;
  qaCtx: string | null;
  draft: string;
  setDraft: (v: string) => void;
  busy: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onSend: () => void;
}) {
  const chips = chipsFor(qaCtx);
  return (
    <section className="qa" id="qa">
      <h3>幕后问答</h3>
      <div className="qa-note">
        基于本局完整真相向 AI 追问 · 问答记录不会保存 · 单条问题上限 300 字
      </div>
      {qaLog.length > 0 || pending ? (
        <div className="qlog">
          {qaLog.map((entry) => (
            <Fragment key={entry.id}>
              <div className="qmsg q">{entry.question}</div>
              <div className="qmsg a">{entry.answer}</div>
            </Fragment>
          ))}
          {pending ? (
            <>
              <div className="qmsg q">{pending}</div>
              <div className="qmsg a" role="status" aria-label="AI 正在思考">
                <span className="typing" aria-hidden="true">
                  <i className="dot" />
                  <i className="dot" />
                  <i className="dot" />
                </span>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
      <div className="chips">
        <span className="c-lbl">{qaCtx ? `围绕${qaCtx}` : "试着问问"}：</span>
        {chips.map((text) => (
          <button
            type="button"
            className="chip"
            key={text}
            onClick={() => {
              setDraft(text);
              inputRef.current?.focus({ preventScroll: true });
            }}
          >
            {text}
          </button>
        ))}
      </div>
      <div className="qa-input">
        <input
          ref={inputRef}
          type="text"
          maxLength={300}
          value={draft}
          placeholder="例如：天1我该弃票吗？"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onSend();
            }
          }}
        />
        <button
          type="button"
          className="btn"
          disabled={busy || pending !== null}
          onClick={onSend}
        >
          发送
        </button>
      </div>
    </section>
  );
}
