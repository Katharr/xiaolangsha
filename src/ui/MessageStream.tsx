import { useEffect, useRef } from "react";

import type { NightStepKind } from "../shared";
import type { ChatMessage, ThinkingState } from "../store";

import { Avatar } from "./Avatar";
import { NIGHT_STEP_LABEL, TASK_THINKING_LABEL } from "./labels";
import { PlayerName, bareName } from "./PlayerName";

type MessageStreamProps = {
  messages: ChatMessage[];
  /** 当前正在思考的 AI；非空时在流底显示打字气泡。 */
  thinking?: ThinkingState | null;
  /** 当前夜晚步骤的角色种类（主持人播报「等待 XX…」）；非夜晚为 null。 */
  nightStepKind?: NightStepKind | null;
};

/**
 * 聊天室消息流：唯一可滚动区域。发言渲染成左右分栏气泡（自己靠右），
 * 带玩家色块头像 + 「名字（N号）」标签；主持人/投票/系统消息渲染为居中通知。
 * 所有文本按纯文本渲染（React 默认转义），不做 HTML 注入。
 */
export function MessageStream({
  messages,
  thinking,
  nightStepKind,
}: MessageStreamProps) {
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
        <ThinkingBubble thinking={thinking} nightStepKind={nightStepKind} />
      ) : null}
      <div ref={endRef} />
    </div>
  );
}

function SpeechBubble({ message }: { message: ChatMessage }) {
  const seat = message.speakerSeat ?? 0;
  return (
    <div
      className={`chat-row${message.self ? " chat-row-self" : ""}`}
      data-kind="speech"
    >
      <Avatar seat={seat} className="chat-avatar" />
      <div className="chat-bubble">
        <span className="chat-name">
          <PlayerName
            name={bareName(message.speakerLabel, message.speakerSeat)}
            seat={seat}
            isSelf={message.self}
          />
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

function ThinkingBubble({
  thinking,
  nightStepKind,
}: {
  thinking: ThinkingState;
  nightStepKind?: NightStepKind | null;
}) {
  // 投票匿名：暗投只播报「正在投票」，不暴露是谁、不暴露顺序（多名 AI 并发投票时也只显示这一条）。
  if (thinking.anonymous && thinking.taskType === "vote") {
    return (
      <div className="chat-notice chat-notice-vote" aria-label="投票进行中">
        <span className="chat-notice-tag">投票</span>
        <span className="chat-notice-text">
          正在投票，玩家们陆续暗投中…
          <span className="chat-typing">
            <span className="dot" />
            <span className="dot" />
            <span className="dot" />
          </span>
        </span>
      </div>
    );
  }

  // 夜晚匿名：只播报「当前在等哪个角色」，绝不暴露具体行动者身份（ISO-001）。
  if (thinking.anonymous) {
    const waitingFor = nightStepKind ? NIGHT_STEP_LABEL[nightStepKind] : null;
    return (
      <div className="chat-notice chat-notice-host chat-notice-night" aria-label="夜晚行动中">
        <span className="chat-notice-tag">主持人</span>
        <span className="chat-notice-text">
          {waitingFor
            ? `天黑请闭眼，正在等待${waitingFor}…`
            : "天黑请闭眼，夜晚行动进行中"}
          <span className="chat-typing">
            <span className="dot" />
            <span className="dot" />
            <span className="dot" />
          </span>
        </span>
      </div>
    );
  }

  const task = TASK_THINKING_LABEL[thinking.taskType] ?? "行动";
  const seat = thinking.seat ?? 0;
  return (
    <div className="chat-row chat-row-thinking" aria-label="AI 思考中">
      <Avatar seat={seat} className="chat-avatar" />
      <div className="chat-bubble chat-bubble-thinking">
        <span className="chat-name">
          <PlayerName name={thinking.name ?? "?"} seat={seat} />
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
