import { createStore, type StoreApi } from "zustand/vanilla";

import type { AiClient } from "../ai-client";
import { applyAction, buildVisibleInformation } from "../rules";
import {
  clearCurrentGame,
  recoverGame,
  saveGameState,
  type GameDatabase,
} from "../storage";
import type {
  AppError,
  GameAction,
  GameSession,
  GameSnapshot,
  TruthEvent,
  VisibleInformationSnapshot,
} from "../shared";

import type { DriverState } from "./driver";
import { runAiDriver } from "./driver";
import { deriveMessages, type ChatMessage } from "./messages";

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
  session: GameSession | null;
  snapshot: GameSnapshot | null;
  events: TruthEvent[];
  /** 真人视角的可见信息（ISO-001：UI 只读它）。无对局/真人未入场时为 null。 */
  visibleInformation: VisibleInformationSnapshot | null;
  messages: ChatMessage[];
  lastError: AppError | null;

  /** 启动恢复：读存档→校验→（必要时）续跑 AI。 */
  bootstrap: () => Promise<void>;
  /** 唯一的状态变更漏斗：规则引擎→持久化→派生→自动轮转 AI。 */
  dispatch: (action: GameAction) => Promise<void>;
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
      set({
        session: state.session,
        snapshot: state.snapshot,
        events: state.events,
        visibleInformation,
        messages: deriveMessages(visibleInformation, null),
      });
      await persist(state);
    };

    const drive = async (state: DriverState): Promise<DriverState> => {
      return runAiDriver(state, {
        ai,
        humanPlayerId: state.session.humanPlayerId,
        now: nowProvider,
        onStep: commit,
      });
    };

    return {
      ready: false,
      busy: false,
      session: null,
      snapshot: null,
      events: [],
      visibleInformation: null,
      messages: [],
      lastError: null,

      bootstrap: async () => {
        set({ busy: true, lastError: null });
        const recovered = await recoverGame(db);
        if (!recovered.ok) {
          set({ busy: false, ready: true, lastError: recovered.error });
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

        set({ busy: false, ready: true });
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
            lastError: null,
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
        set({ busy: false });
      },
    };
  });
}
