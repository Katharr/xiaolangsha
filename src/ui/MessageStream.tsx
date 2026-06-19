import { useEffect, useRef } from "react";

import type { ChatMessage } from "../store";

type MessageStreamProps = {
  messages: ChatMessage[];
};

const KIND_LABEL: Record<ChatMessage["kind"], string> = {
  host: "主持人",
  private_info: "私密",
  speech: "发言",
  vote_result: "投票",
  system: "系统",
};

/**
 * 消息流：唯一可滚动区域，按 seq 顺序渲染 store 派生的 ChatMessage。
 * 所有文本按纯文本渲染（React 默认转义），不做 HTML 注入。
 */
export function MessageStream({ messages }: MessageStreamProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // jsdom（测试环境）不实现 scrollIntoView，守卫一下。
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [messages.length]);

  return (
    <div className="message-stream" aria-label="消息流" role="log">
      {messages.length === 0 ? (
        <p className="message-empty">尚无消息。</p>
      ) : (
        messages.map((message) => (
          <div
            key={message.id}
            className={`message message-${message.kind}${
              message.self ? " message-self" : ""
            }`}
            data-kind={message.kind}
          >
            <span className="message-tag">[{KIND_LABEL[message.kind]}]</span>
            <span className="message-text">{message.text}</span>
          </div>
        ))
      )}
      <div ref={endRef} />
    </div>
  );
}
