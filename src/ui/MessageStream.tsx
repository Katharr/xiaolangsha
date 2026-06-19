import { useEffect, useRef } from "react";

import type { ChatMessage, ThinkingState } from "../store";

import { TASK_THINKING_LABEL } from "./labels";

type MessageStreamProps = {
  messages: ChatMessage[];
  /** 当前正在思考的 AI；非空时在流底显示打字气泡。 */
  thinking?: ThinkingState | null;
};

/** 玩家头像/名字标签的固定配色（按座位号取，整局稳定）。 */
const SEAT_COLORS = [
  "#5a7a5f",
  "#b5651d",
  "#3d6ea5",
  "#8a5a9e",
  "#c0392b",
  "#2a9d8f",
];

function seatColor(seat: number | undefined): string {
  if (!seat || seat < 1) {
    return SEAT_COLORS[0];
  }
  return SEAT_COLORS[(seat - 1) % SEAT_COLORS.length];
}

function avatarChar(label: string | undefined): string {
  // 取名字首字（label 形如「小林（3号）」）。
  return label?.trim().charAt(0) || "?";
}

/**
 * 聊天室消息流：唯一可滚动区域。发言渲染成左右分栏气泡（自己靠右），
 * 带玩家色块头像 + 「名字（N号）」标签；主持人/投票/系统消息渲染为居中通知。
 * 所有文本按纯文本渲染（React 默认转义），不做 HTML 注入。
 */
export function MessageStream({ messages, thinking }: MessageStreamProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // jsdom（测试环境）不实现 scrollIntoView，守卫一下。
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [messages.length, thinking?.seat, thinking?.taskType]);

  return (
    <div className="message-stream" aria-label="消息流" role="log">
      {messages.length === 0 && !thinking ? (
        <p className="message-empty">尚无消息。</p>
      ) : (
        messages.map((message) =>
          message.kind === "speech" ? (
            <SpeechBubble key={message.id} message={message} />
          ) : (
            <NoticeRow key={message.id} message={message} />
          ),
        )
      )}
      {thinking ? (
        <ThinkingBubble thinking={thinking} />
      ) : null}
      <div ref={endRef} />
    </div>
  );
}

function SpeechBubble({ message }: { message: ChatMessage }) {
  const color = seatColor(message.speakerSeat);
  return (
    <div
      className={`chat-row${message.self ? " chat-row-self" : ""}`}
      data-kind="speech"
    >
      <span
        className="chat-avatar"
        style={{ background: color }}
        aria-hidden="true"
      >
        {avatarChar(message.speakerLabel)}
      </span>
      <div className="chat-bubble">
        <span className="chat-name" style={{ color }}>
          {message.speakerLabel}
          {message.self ? "（你）" : ""}
        </span>
        <span className="chat-text">{message.text}</span>
      </div>
    </div>
  );
}

const NOTICE_LABEL: Record<string, string> = {
  host: "主持人",
  private_info: "仅你可见",
  vote_result: "投票",
  system: "系统",
};

function NoticeRow({ message }: { message: ChatMessage }) {
  return (
    <div
      className={`chat-notice chat-notice-${message.kind}`}
      data-kind={message.kind}
    >
      <span className="chat-notice-tag">{NOTICE_LABEL[message.kind]}</span>
      <span className="chat-notice-text">{message.text}</span>
    </div>
  );
}

function ThinkingBubble({ thinking }: { thinking: ThinkingState }) {
  // 夜晚匿名：只显示「天黑请闭眼」通用提示，不暴露行动者身份。
  if (thinking.anonymous) {
    return (
      <div className="chat-notice chat-notice-host chat-notice-night" aria-label="夜晚行动中">
        <span className="chat-notice-tag">夜晚</span>
        <span className="chat-notice-text">
          天黑请闭眼，夜晚行动进行中
          <span className="chat-typing">
            <span className="dot" />
            <span className="dot" />
            <span className="dot" />
          </span>
        </span>
      </div>
    );
  }

  const color = seatColor(thinking.seat);
  const task = TASK_THINKING_LABEL[thinking.taskType] ?? "行动";
  return (
    <div className="chat-row chat-row-thinking" aria-label="AI 思考中">
      <span
        className="chat-avatar"
        style={{ background: color }}
        aria-hidden="true"
      >
        {avatarChar(thinking.name)}
      </span>
      <div className="chat-bubble chat-bubble-thinking">
        <span className="chat-name" style={{ color }}>
          {thinking.name}（{thinking.seat}号）
        </span>
        <span className="chat-typing">
          正在{task}
          <span className="dot" />
          <span className="dot" />
          <span className="dot" />
        </span>
      </div>
    </div>
  );
}
