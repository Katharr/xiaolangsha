import { useEffect, useRef } from "react";
import { useStore } from "zustand";

import "./App.css";
import { STANDARD_BOARD_ID } from "./rules";
import type { GameAction } from "./shared";
import { isAbnormalHalt, type DriverHalt, type GameStore } from "./store";
import {
  ActionArea,
  HomeScreen,
  InfoPanel,
  MessageStream,
  PhaseTransition,
  ReviewPanel,
  RoleSelectScreen,
  Roster,
  SeatRing,
  StatusBar,
  TextInput,
} from "./ui";

const HUMAN_PLAYER_ID = "human-1";

/** 把异常的停止原因翻成给玩家看的一句话（正常 idle/completed 返回 null，不打扰）。 */
function abnormalHaltText(halt: DriverHalt | null): string | null {
  if (!isAbnormalHalt(halt) || !halt) {
    return null;
  }
  switch (halt.reason) {
    case "ai_error":
      return `AI 行动失败且兜底也没接住（${halt.error.userMessage ?? halt.error.message}），自动流程已暂停。`;
    case "invalid_payload":
      return "AI 返回了无法执行的动作，自动流程已暂停。";
    case "rule_rejected":
      return `规则引擎拒绝了一个自动动作（${halt.error.userMessage ?? halt.error.message}），自动流程已暂停。`;
    case "max_steps":
      return "自动推进达到步数上限，已停止（可能存在死循环）。";
    default:
      return "自动流程已意外暂停。";
  }
}

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
  const diagnostics = useStore(store, (s) => s.diagnostics);

  const keyCounter = useRef(0);
  const nextKey = (prefix: string) =>
    `ui-${prefix}-${(keyCounter.current += 1)}`;

  useEffect(() => {
    void store.getState().bootstrap();
  }, [store]);

  const act = (action: GameAction) => {
    void store.getState().dispatch(action);
  };

  // 调试：把本局完整日志导出成 JSON 文件，方便把卡住的局发出来排查。
  const exportDebugLog = () => {
    const json = store.getState().exportDebugLog();
    const snapshot = store.getState().snapshot;
    const stamp = (snapshot?.lastEventSeq ?? 0).toString().padStart(3, "0");
    const gameId = snapshot?.gameId ?? "nogame";
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `wolf-debug-${gameId}-seq${stamp}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
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

  const isReview = phase === "review";
  const showBoard = Boolean(vi) && !isReview;
  // 发言流的「当前发言者」舞台取最近一条 speech。
  const latestSpeech = (() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].kind === "speech") {
        return messages[i];
      }
    }
    return undefined;
  })();

  const aliveCount = vi ? vi.alivePlayers.length : 0;
  const totalCount = vi ? aliveCount + vi.deadPlayers.length : 0;
  // 自动流程异常停止时才提示（busy 期间驱动仍在跑，不打扰）。
  const haltText = busy ? null : abnormalHaltText(diagnostics);

  // 启动恢复未完成：先给一个干净的加载屏，避免闪过旧入口/空壳。
  if (!ready) {
    return <div className="app-boot">加载中…</div>;
  }

  // 开场屏：整屏接管的主页，不要状态栏/牌桌/输入区。
  // 入口态相位为 null（初次启动，无存档）或 mode_select（结束后开新局回到选择），vi 均为空。
  if (phase === null || phase === "mode_select") {
    return (
      <HomeScreen
        busy={busy}
        humanPlayerId={HUMAN_PLAYER_ID}
        boardId={STANDARD_BOARD_ID}
        nextKey={nextKey}
        act={act}
      />
    );
  }

  // 选身份页（仅自由局）：整屏接管，与主页同款入场氛围，不渲染空的三列牌桌。
  // role_setup 的 vi 是空壳（无 players），渲染牌桌会得到「空桌 / 存活 0」的破相界面。
  if (phase === "role_setup") {
    return (
      <RoleSelectScreen
        busy={busy}
        humanPlayerId={HUMAN_PLAYER_ID}
        boardId={STANDARD_BOARD_ID}
        nextKey={nextKey}
        act={act}
      />
    );
  }

  return (
    <div className={`app-root${showBoard ? "" : " is-solo"}`}>
      <PhaseTransition phase={phase} round={vi?.round} />
      <StatusBar
        phase={phase}
        participation={participation}
        vi={vi}
        onExportDebug={exportDebugLog}
      />

      {haltText ? (
        <div className="halt-banner" role="alert">
          <span className="halt-banner-icon">⚠️</span>
          <span className="halt-banner-text">
            {haltText} 请点右上角「导出日志」把这局发出来排查。
          </span>
        </div>
      ) : null}

      {showBoard && vi ? <InfoPanel vi={vi} /> : null}

      <section className="chat">
        {!isReview && vi ? (
          <div className="chat-head">
            💬 发言流 · 存活 {aliveCount} / {totalCount}
          </div>
        ) : null}
        <main className="app-main">
          {isReview && reviewContext ? (
            <ReviewPanel
              reviewContext={reviewContext}
              busy={busy}
              humanPlayerId={HUMAN_PLAYER_ID}
              nextKey={nextKey}
              act={act}
              askReview={(question) => store.getState().askReview(question)}
            />
          ) : (
            <MessageStream
              messages={messages}
              thinking={thinking}
              nightStepKind={vi?.nightStatus?.currentStepKind ?? null}
            />
          )}
        </main>
      </section>

      {!isReview && vi ? (
        <aside className="side" aria-label="牌桌">
          <SeatRing
            vi={vi}
            thinking={thinking}
            latestSpeech={latestSpeech}
            phase={phase}
          />
          <Roster vi={vi} />
        </aside>
      ) : null}

      {!isReview ? (
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
    </div>
  );
}
