import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";

import { ScriptedAiClient } from "../ai-client";
import { MVP_5P_BOARD_ID } from "../rules";
import { STANDARD_7P_BOARD_ID } from "../rules/boards";
import type { GameAction, GameMode } from "../shared";
import {
  clearCurrentGame,
  createGameDatabase,
  loadCurrentGame,
  type GameDatabase,
} from "../storage";

import { createGameStore, type GameStore } from "./gameStore";

const HUMAN = "human-1";
const NOW = () => "2026-06-19T13:00:00.000Z";

let dbCounter = 0;
let keyCounter = 0;
const nextKey = (prefix: string) => `smoke-${prefix}-${(keyCounter += 1)}`;

beforeEach(() => {
  keyCounter = 0;
});

function freshStore(): { store: GameStore; db: GameDatabase } {
  dbCounter += 1;
  const db = createGameDatabase(`smoke-${dbCounter}`);
  const store = createGameStore({ ai: new ScriptedAiClient(), db, now: NOW });
  return { store, db };
}

/**
 * 替真人决策下一步动作。store.dispatch 会自动驱动 AI 直到再次轮到真人，
 * 所以这里只需在每次"控制权回到真人"时给出真人该相位的合理动作：
 * - 能行动（vi.canAct）→ 按 legalActions 选第一个合法目标 / 文本。
 * - 确认门（揭示 / 天亮）→ 按相位确认。
 * - 真人已死在旁观 → 无需真人动作，driver 自动推进到结局。
 * 返回 null 表示无可推进动作（应停下，避免死循环）。
 */
function nextHumanAction(store: GameStore): GameAction | null {
  const { phase, visibleInformation: vi } = store.getState();

  if (phase === "role_reveal") {
    return {
      type: "confirm_role_reveal",
      idempotencyKey: nextKey("reveal"),
      playerId: HUMAN,
    };
  }
  if (phase === "day_announcement") {
    return {
      type: "confirm_day_announcement",
      idempotencyKey: nextKey("day"),
      playerId: HUMAN,
    };
  }

  // 轮到真人具体行动（夜晚 / 发言 / 投票 / 遗言）。
  if (vi?.canAct) {
    const legal = vi.legalActions[0];
    if (!legal) {
      return null;
    }
    switch (legal.actionType) {
      case "werewolf_kill":
      case "seer_check":
      case "guard_protect":
        return {
          type: "submit_night_action",
          idempotencyKey: nextKey("night"),
          actorId: HUMAN,
          actionType: legal.actionType,
          targetId: legal.legalTargets[0],
        };
      case "witch_action":
        return {
          type: "submit_witch_action",
          idempotencyKey: nextKey("witch"),
          actorId: HUMAN,
          witchChoice: "skip",
        };
      case "hunter_shoot":
        return {
          type: "submit_hunter_shoot",
          idempotencyKey: nextKey("hunter"),
          actorId: HUMAN,
          ...(legal.legalTargets[0] ? { targetId: legal.legalTargets[0] } : {}),
        };
      case "speech":
        return {
          type: "submit_speech",
          idempotencyKey: nextKey("speech"),
          speakerId: HUMAN,
          text: "（真人测试发言）",
        };
      case "tie_speech":
        return {
          type: "submit_tie_speech",
          idempotencyKey: nextKey("tiespeech"),
          speakerId: HUMAN,
          text: "（真人拉票发言）",
        };
      case "last_words":
        return {
          type: "submit_last_words",
          idempotencyKey: nextKey("lastwords"),
          speakerId: HUMAN,
          text: "（真人遗言）",
        };
      case "vote": {
        const voteRound = phase === "tie_vote" ? "tie_break" : "first";
        const target = legal.legalTargets[0];
        if (target) {
          return {
            type: "submit_vote",
            idempotencyKey: nextKey("vote"),
            voterId: HUMAN,
            voteRound,
            choiceType: "target",
            targetId: target,
          };
        }
        if (legal.allowAbstain) {
          return {
            type: "submit_vote",
            idempotencyKey: nextKey("vote"),
            voterId: HUMAN,
            voteRound,
            choiceType: "abstain",
          };
        }
        return null;
      }
      default:
        return null;
    }
  }

  // 真人已出局：无需任何真人动作——driver 会在导致出局的那次 dispatch 内自动把对局
  // 一路推进到 review（旁观）。这里返回 null，由 playToReview 直接读到 review 相位。
  return null;
}

/** 自动替真人把一局从当前态打到 review；返回到达的相位。 */
async function playToReview(store: GameStore): Promise<string | null> {
  for (let guard = 0; guard < 200; guard += 1) {
    if (store.getState().phase === "review") {
      return "review";
    }
    const action = nextHumanAction(store);
    if (!action) {
      return store.getState().phase; // 卡住——返回当前相位供断言定位。
    }
    await store.getState().dispatch(action);
  }
  return store.getState().phase;
}

function expectReachedReview(store: GameStore) {
  const state = store.getState();
  expect(state.phase).toBe("review");
  expect(state.session?.status).toBe("ended");

  const rc = state.reviewContext;
  expect(rc).not.toBeNull();
  expect(["good_team", "werewolf_team"]).toContain(rc?.winner);
  expect([
    "all_werewolves_dead",
    "werewolves_reach_parity",
    "all_gods_dead",
    "all_folk_dead",
  ]).toContain(rc?.winReason);
  // 复盘上下文含完整真相：至少有发言与夜晚行动记录。
  expect(rc?.speeches.length ?? 0).toBeGreaterThan(0);
  expect(rc?.nightActions.length ?? 0).toBeGreaterThan(0);
}

async function createGame(
  store: GameStore,
  mode: GameMode,
  boardId: string = MVP_5P_BOARD_ID,
): Promise<void> {
  await store.getState().bootstrap();
  await store.getState().dispatch({
    type: "create_game",
    idempotencyKey: nextKey("create"),
    mode,
    boardId,
    humanPlayerId: HUMAN,
  });
}

describe("e2e 冒烟：开局 → 复盘", () => {
  it("标准局可从开局一路打到复盘并产出胜负", async () => {
    const { store } = freshStore();
    await createGame(store, "standard");
    const reached = await playToReview(store);
    expect(reached).toBe("review");
    expectReachedReview(store);
  });

  it("自由局（真人选村民）可从开局一路打到复盘并产出胜负", async () => {
    const { store } = freshStore();
    await createGame(store, "free");
    await store.getState().dispatch({
      type: "confirm_role_setup",
      idempotencyKey: nextKey("setup"),
      playerId: HUMAN,
      selectedRole: "villager",
    });
    const reached = await playToReview(store);
    expect(reached).toBe("review");
    expectReachedReview(store);
  });

  it("7人标准局（预女猎屠边）可从开局打到复盘并产出胜负", async () => {
    const { store } = freshStore();
    await createGame(store, "standard", STANDARD_7P_BOARD_ID);
    const reached = await playToReview(store);
    expect(reached).toBe("review");
    expectReachedReview(store);
  });

  it("7人自由局（真人选村民）可从开局打到复盘", async () => {
    const { store } = freshStore();
    await createGame(store, "free", STANDARD_7P_BOARD_ID);
    await store.getState().dispatch({
      type: "confirm_role_setup",
      idempotencyKey: nextKey("setup"),
      playerId: HUMAN,
      selectedRole: "villager",
    });
    const reached = await playToReview(store);
    expect(reached).toBe("review");
    expectReachedReview(store);
  });

  it("复盘后开新局清空存档，不串档", async () => {
    const { store, db } = freshStore();
    await createGame(store, "free");
    await store.getState().dispatch({
      type: "confirm_role_setup",
      idempotencyKey: nextKey("setup"),
      playerId: HUMAN,
      selectedRole: "villager",
    });
    await playToReview(store);
    expect(store.getState().phase).toBe("review");

    // 存档此时应已写入。
    const beforeNewGame = await loadCurrentGame(db);
    expect(beforeNewGame.ok && beforeNewGame.data !== null).toBe(true);

    await store.getState().dispatch({
      type: "confirm_new_game",
      idempotencyKey: nextKey("newgame"),
      playerId: HUMAN,
    });

    expect(store.getState().phase).toBe("mode_select");
    expect(store.getState().events).toEqual([]);
    expect(store.getState().reviewContext).toBeNull();

    // 存档已清，旧局不会串到下一局。
    const afterNewGame = await loadCurrentGame(db);
    expect(afterNewGame.ok && afterNewGame.data === null).toBe(true);
  });

  it("无残留：clearCurrentGame 后 loadCurrentGame 返回空", async () => {
    const { store, db } = freshStore();
    await createGame(store, "standard");
    await clearCurrentGame(db);
    const loaded = await loadCurrentGame(db);
    expect(loaded.ok && loaded.data === null).toBe(true);
  });
});
