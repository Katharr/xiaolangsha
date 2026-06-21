import { createStore, type StoreApi } from "zustand/vanilla";

import type { AiClient } from "../ai-client";
import {
  applyAction,
  buildReviewContext,
  buildVisibleInformation,
} from "../rules";
import {
  clearCurrentGame,
  recoverGame,
  saveGameState,
  type GameDatabase,
} from "../storage";
import type {
  AppError,
  GameAction,
  GamePhase,
  GameSession,
  GameSnapshot,
  HumanParticipationState,
  ReviewContext,
  Result,
  TruthEvent,
  VisibleInformationSnapshot,
} from "../shared";

import type { DriverHalt, DriverState, InGameTaskType } from "./driver";
import { runAiDriver } from "./driver";
import { deriveMessages, type ChatMessage } from "./messages";

/**
 * 当前正在「思考」的 AI 行动者（供 UI 显示打字指示）。无人思考时为 null。
 * 夜晚行动对非行动者匿名（anonymous:true，不带 name/seat），避免泄露谁是狼/神（ISO-001）。
 */
export type ThinkingState = {
  name?: string;
  seat?: number;
  taskType: InGameTaskType;
  anonymous?: boolean;
};

export type GameStoreDeps = {
  ai: AiClient;
  db: GameDatabase;
  /** 时钟注入点；测试传入确定性 now，运行时默认用真实时间。 */
  now?: () => string;
};

export type GameStoreState = {
  /** bootstrap 完成前为 false。 */
  ready: boolean;
  /** 正在处理动作 / AI 思考中——UI 据此禁用输入。 */
  busy: boolean;
  /** 当前正在思考的 AI 行动者；UI 据此显示「XX 正在思考…」打字气泡。 */
  thinking: ThinkingState | null;
  session: GameSession | null;
  snapshot: GameSnapshot | null;
  events: TruthEvent[];
  /** 真人视角的可见信息（ISO-001：UI 只读它）。无对局/真人未入场时为 null。 */
  visibleInformation: VisibleInformationSnapshot | null;
  messages: ChatMessage[];
  lastError: AppError | null;
  /**
   * 当前相位（非机密控制字段）。role_setup/mode_select 等阶段 visibleInformation 为 null，
   * UI 仍需据此渲染入口/设置屏；相位枚举本身不泄露任何隐藏身份。
   */
  phase: GamePhase | null;
  /** 真人参与态（非机密）。UI 据此叠加只读/快进规则。 */
  participation: HumanParticipationState | null;
  /** 完整真相只在 review 阶段组装（ISO-002）；其余阶段恒为 null。 */
  reviewContext: ReviewContext | null;
  /**
   * 上一次自动轮转停下的原因（诊断用）。正常等真人时为 idle/completed；
   * AI 出错 / 规则拒绝 / 步数耗尽时为异常原因——「天黑没动静」时据此提示并导出日志。
   */
  diagnostics: DriverHalt | null;

  /** 启动恢复：读存档→校验→（必要时）续跑 AI。 */
  bootstrap: () => Promise<void>;
  /** 唯一的状态变更漏斗：规则引擎→持久化→派生→自动轮转 AI。 */
  dispatch: (action: GameAction) => Promise<void>;
  /**
   * 复盘追问：仅 review 阶段合法，基于 reviewContext 调 AI（不是 GameAction、不改局面）。
   * 返回 AI 回答文本或错误，由 UI 自行维护问答记录。
   */
  askReview: (question: string) => Promise<Result<string>>;
  /**
   * 导出当前对局的完整调试日志（JSON 字符串）：含 session / 完整快照 / 全部 TruthEvent /
   * 诊断信息。这是**完整真相**（含 AI 身份、夜晚密谋），仅供离线 debug，不在 UI 内展示。
   */
  exportDebugLog: () => string;
};

export type GameStore = StoreApi<GameStoreState>;

/**
 * 创建一个游戏 Store（zustand vanilla，框架无关；M6 用 useStore 绑到 React）。
 *
 * Store 永不手写 TruthEvent——所有事实都经 `applyAction` 产出。dispatch 是单一漏斗：
 * applyAction → saveGameState → 重算真人 VI + messages → runAiDriver 替 AI 出手。
 */
export function createGameStore(deps: GameStoreDeps): GameStore {
  const { ai, db } = deps;
  const nowProvider = deps.now ?? (() => new Date().toISOString());

  return createStore<GameStoreState>()((set, get) => {
    const humanVisibleInformation = (
      state: DriverState,
    ): VisibleInformationSnapshot | null => {
      const humanId = state.session.humanPlayerId;
      const humanInGame = state.snapshot.players.some(
        (player) => player.playerId === humanId,
      );
      if (!humanInGame) {
        return null;
      }
      return buildVisibleInformation(humanId, state.snapshot, state.events);
    };

    const persist = async (state: DriverState): Promise<void> => {
      // mode_select 是空快照（gameId 可能与 session 不一致），无需持久化。
      if (state.snapshot.gamePhase === "mode_select") {
        return;
      }
      const result = await saveGameState(db, {
        session: state.session,
        snapshot: state.snapshot,
        events: state.events,
      });
      if (!result.ok) {
        set({ lastError: result.error });
      }
    };

    /** 提交一份新状态到 store 并持久化（不改 busy / lastError 由调用方控制）。 */
    const commit = async (state: DriverState): Promise<void> => {
      const visibleInformation = humanVisibleInformation(state);
      const { snapshot } = state;
      // ISO-002：完整真相只在 review 阶段经 buildReviewContext 组装。
      const reviewContext =
        snapshot.gamePhase === "review"
          ? buildReviewContext(state.session, snapshot.players, state.events)
          : null;
      set({
        session: state.session,
        snapshot,
        events: state.events,
        visibleInformation,
        messages: deriveMessages(visibleInformation, null),
        phase: snapshot.gamePhase,
        participation: snapshot.humanParticipationState,
        reviewContext,
      });
      await persist(state);
    };

    const drive = async (state: DriverState): Promise<DriverState> => {
      return runAiDriver(state, {
        ai,
        humanPlayerId: state.session.humanPlayerId,
        now: nowProvider,
        onStep: commit,
        onHalt: (halt) => set({ diagnostics: halt }),
        onActorThinking: ({ actorId, taskType }) => {
          const snapshot = get().snapshot;
          const player = snapshot?.players.find(
            (candidate) => candidate.playerId === actorId,
          );
          // 夜晚行动对非真人匿名：只暴露「夜里有人在行动」，绝不暴露是谁（防泄狼/神身份）。
          const isNight = snapshot?.gamePhase === "night_action";
          const isHuman = player?.isHuman ?? false;
          if (isNight && !isHuman) {
            set({ thinking: { taskType, anonymous: true } });
            return;
          }
          set({
            thinking: player
              ? { name: player.name, seat: player.seat, taskType }
              : null,
          });
        },
      });
    };

    return {
      ready: false,
      busy: false,
      thinking: null,
      session: null,
      snapshot: null,
      events: [],
      visibleInformation: null,
      messages: [],
      lastError: null,
      phase: null,
      participation: null,
      reviewContext: null,
      diagnostics: null,

      bootstrap: async () => {
        set({ busy: true, lastError: null });
        const recovered = await recoverGame(db);
        if (!recovered.ok) {
          set({ busy: false, thinking: null, ready: true, lastError: recovered.error });
          return;
        }

        if (recovered.data.status === "recovered") {
          const game = recovered.data.game;
          let state: DriverState = {
            session: game.session,
            snapshot: game.snapshot,
            events: game.events,
          };
          await commit(state);
          // 可能在轮到 AI 时崩溃过——续跑到真人回合/终局。
          state = await drive(state);
          await commit(state);
        }

        set({ busy: false, thinking: null, ready: true });
      },

      dispatch: async (action: GameAction) => {
        set({ busy: true, lastError: null });
        const { session, snapshot, events } = get();
        const now = nowProvider();
        const context = session
          ? { session, snapshot: snapshot ?? undefined, events, now }
          : { now };

        const result = applyAction(action, context);
        if (!result.ok) {
          set({
            busy: false,
            thinking: null,
            lastError: result.error,
            messages: deriveMessages(get().visibleInformation, result.error),
          });
          return;
        }

        const success = result.data;

        // 开新局：清存档、重置事件流，回到空白选择态。
        if (action.type === "confirm_new_game") {
          await clearCurrentGame(db);
          set({
            session: success.session,
            snapshot: success.snapshot,
            events: [],
            visibleInformation: null,
            messages: [],
            busy: false,
            thinking: null,
            lastError: null,
            phase: success.snapshot.gamePhase,
            participation: success.snapshot.humanParticipationState,
            reviewContext: null,
          });
          return;
        }

        const isFreshGame = action.type === "create_game";
        let state: DriverState = {
          session: success.session,
          snapshot: success.snapshot,
          events: isFreshGame
            ? success.events
            : [...events, ...success.events],
        };

        await commit(state);
        state = await drive(state);
        await commit(state);
        set({ busy: false, thinking: null });
      },

      askReview: async (question: string): Promise<Result<string>> => {
        const { snapshot, reviewContext } = get();
        // ISO-002：仅 review 阶段允许构造/发送 reviewContext。
        if (snapshot?.gamePhase !== "review" || !reviewContext) {
          return {
            ok: false,
            error: {
              code: "ACTION_NOT_ALLOWED",
              message: "复盘追问仅在复盘阶段可用。",
              userMessage: "复盘追问仅在复盘阶段可用。",
              retryable: false,
              source: "app",
            },
          };
        }
        const response = await ai.respond({
          gameId: snapshot.gameId,
          taskType: "review_question",
          questionText: question,
          reviewContext,
        });
        if (!response.ok) {
          return { ok: false, error: response.error };
        }
        const text = (response.data.text ?? "").trim();
        return { ok: true, data: text.length > 0 ? text : "（AI 未给出回答）" };
      },

      exportDebugLog: (): string => {
        const s = get();
        const snapshot = s.snapshot;
        // 顶部摘要：最常用来定位「卡在哪一步」的字段，放最前面便于一眼看清。
        const summary = {
          phase: s.phase,
          participation: s.participation,
          round: snapshot?.round ?? null,
          diagnostics: s.diagnostics,
          lastError: s.lastError,
          busy: s.busy,
          eventCount: s.events.length,
          night: snapshot?.nightState
            ? {
                night: snapshot.nightState.night,
                resolved: snapshot.nightState.resolved,
                currentStepIndex: snapshot.nightState.currentStepIndex,
                steps: snapshot.nightState.steps.map((step) => ({
                  kind: step.kind,
                  actorIds: step.actorIds,
                  submittedActorIds: step.submittedActorIds,
                })),
              }
            : null,
        };
        const payload = {
          exportedAt: nowProvider(),
          summary,
          // 完整真相（含 AI 身份、夜晚密谋）——仅供离线排查。
          session: s.session,
          snapshot,
          events: s.events,
        };
        return JSON.stringify(payload, null, 2);
      },
    };
  });
}
