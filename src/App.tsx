import { useEffect, useRef } from "react";
import { useStore } from "zustand";

import "./App.css";
import { STANDARD_BOARD_ID } from "./rules";
import type { GameAction } from "./shared";
import type { GameStore } from "./store";
import {
  ActionArea,
  MessageStream,
  ReviewPanel,
  StatusBar,
  TextInput,
} from "./ui";

const HUMAN_PLAYER_ID = "human-1";

export type AppProps = {
  store: GameStore;
};

type TextConfig = {
  build: (text: string) => GameAction;
  placeholder: string;
  submitLabel: string;
  emptyHint: string;
};

/**
 * 聊天室外壳：固定视口，状态栏 / 消息流（唯一滚动）/ 操作区 / 输入区。
 * 只绑定 store 暴露的 visibleInformation / messages / reviewContext 等只读视图（ISO-001）。
 */
export function App({ store }: AppProps) {
  const ready = useStore(store, (s) => s.ready);
  const busy = useStore(store, (s) => s.busy);
  const thinking = useStore(store, (s) => s.thinking);
  const phase = useStore(store, (s) => s.phase);
  const participation = useStore(store, (s) => s.participation);
  const vi = useStore(store, (s) => s.visibleInformation);
  const messages = useStore(store, (s) => s.messages);
  const reviewContext = useStore(store, (s) => s.reviewContext);

  const keyCounter = useRef(0);
  const nextKey = (prefix: string) =>
    `ui-${prefix}-${(keyCounter.current += 1)}`;

  useEffect(() => {
    void store.getState().bootstrap();
  }, [store]);

  const act = (action: GameAction) => {
    void store.getState().dispatch(action);
  };

  // 当前若轮到真人自由输入（发言/拉票/遗言），从 vi.legalActions 推导输入配置。
  const textConfig: TextConfig | null = (() => {
    if (!vi?.canAct) {
      return null;
    }
    const legal = vi.legalActions.find(
      (a) =>
        a.actionType === "speech" ||
        a.actionType === "tie_speech" ||
        a.actionType === "last_words",
    );
    if (!legal) {
      return null;
    }
    switch (legal.actionType) {
      case "speech":
        return {
          build: (text) => ({
            type: "submit_speech",
            idempotencyKey: nextKey("speech"),
            speakerId: HUMAN_PLAYER_ID,
            text,
          }),
          placeholder: "输入你的发言…",
          submitLabel: "发送发言",
          emptyHint: "发言不能为空，且不能超过 500 字。",
        };
      case "tie_speech":
        return {
          build: (text) => ({
            type: "submit_tie_speech",
            idempotencyKey: nextKey("tiespeech"),
            speakerId: HUMAN_PLAYER_ID,
            text,
          }),
          placeholder: "输入你的拉票发言…",
          submitLabel: "发送拉票发言",
          emptyHint: "拉票发言不能为空，且不能超过 500 字。",
        };
      default:
        return {
          build: (text) => ({
            type: "submit_last_words",
            idempotencyKey: nextKey("lastwords"),
            speakerId: HUMAN_PLAYER_ID,
            text,
          }),
          placeholder: "输入你的遗言…",
          submitLabel: "提交遗言",
          emptyHint: "遗言不能为空，且不能超过 500 字。",
        };
    }
  })();

  const submitText = async (text: string): Promise<boolean> => {
    if (!textConfig) {
      return false;
    }
    await store.getState().dispatch(textConfig.build(text));
    // dispatch 成功会把 lastError 清空并推进状态；失败则 lastError 非空、相位不变。
    return store.getState().lastError === null;
  };

  return (
    <div className="app-root">
      <StatusBar phase={phase} participation={participation} vi={vi} />

      <main className="app-main">
        {phase === "review" && reviewContext ? (
          <ReviewPanel
            reviewContext={reviewContext}
            busy={busy}
            humanPlayerId={HUMAN_PLAYER_ID}
            nextKey={nextKey}
            act={act}
            askReview={(question) => store.getState().askReview(question)}
          />
        ) : (
          <MessageStream messages={messages} thinking={thinking} />
        )}
      </main>

      {phase !== "review" ? (
        <footer className="app-controls">
          <ActionArea
            phase={phase}
            participation={participation}
            vi={vi}
            busy={busy}
            humanPlayerId={HUMAN_PLAYER_ID}
            boardId={STANDARD_BOARD_ID}
            nextKey={nextKey}
            act={act}
          />
          <TextInput
            enabled={Boolean(textConfig)}
            busy={busy}
            maxLength={500}
            placeholder={textConfig?.placeholder ?? ""}
            submitLabel={textConfig?.submitLabel ?? "发送"}
            emptyHint={textConfig?.emptyHint ?? ""}
            onSubmit={submitText}
          />
        </footer>
      ) : null}

      {!ready ? <div className="app-loading">加载中…</div> : null}
    </div>
  );
}
