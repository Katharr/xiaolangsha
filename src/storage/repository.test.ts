import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { GameSession, GameSnapshot, TruthEvent } from "../shared";
import { applyAction } from "../rules/index";

import { createGameDatabase, type GameDatabase } from "./db";
import {
  appendEvents,
  clearCurrentGame,
  getSetting,
  loadCurrentGame,
  saveGameState,
  setSetting,
} from "./repository";
import { recoverGame } from "./recovery";

const boardId = "mvp_5p_wolf_seer_3villagers";
const humanPlayerId = "human-1";

type GameState = {
  session: GameSession;
  snapshot: GameSnapshot;
  events: TruthEvent[];
};

/**
 * 用真实规则引擎跑 create_game(standard) → confirm_role_reveal，
 * 得到带多事件、进入首夜的真实状态（而非手捏的假数据）。
 */
function buildRealGame(): GameState {
  const created = applyAction(
    {
      type: "create_game",
      idempotencyKey: "storage-create-1",
      mode: "standard",
      boardId,
      humanPlayerId,
    },
    { now: "2026-06-18T12:00:00.000Z" },
  );
  if (!created.ok) {
    throw new Error(created.error.message);
  }

  const revealed = applyAction(
    {
      type: "confirm_role_reveal",
      idempotencyKey: "storage-reveal-1",
      playerId: humanPlayerId,
    },
    {
      session: created.data.session,
      snapshot: created.data.snapshot,
      events: created.data.events,
      now: "2026-06-18T12:00:02.000Z",
    },
  );
  if (!revealed.ok) {
    throw new Error(revealed.error.message);
  }

  return {
    session: revealed.data.session,
    snapshot: revealed.data.snapshot,
    events: [...created.data.events, ...revealed.data.events],
  };
}

let dbCounter = 0;
let db: GameDatabase;

beforeEach(() => {
  dbCounter += 1;
  db = createGameDatabase(`xiaolangsha-test-${dbCounter}`);
});

afterEach(async () => {
  db.close();
});

describe("M3 storage repository", () => {
  it("STORAGE-001 saves and loads a game round-trip with identical data", async () => {
    const game = buildRealGame();

    const saved = await saveGameState(db, game);
    expect(saved.ok).toBe(true);

    const loaded = await loadCurrentGame(db);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok || loaded.data === null) {
      throw new Error("expected loaded game");
    }

    expect(loaded.data.session).toEqual(game.session);
    expect(loaded.data.snapshot).toEqual(game.snapshot);
    expect(loaded.data.events).toEqual(game.events);
    expect(loaded.data.record.gameId).toBe(game.session.gameId);
    expect(loaded.data.record.snapshotRef?.lastEventSeq).toBe(game.snapshot.lastEventSeq);
  });

  it("STORAGE-002 loads events ordered by seq regardless of insertion order", async () => {
    const game = buildRealGame();
    // 乱序写入，验证 loadCurrentGame 按 seq 升序还原。
    const shuffled = [...game.events].reverse();
    const saved = await saveGameState(db, { ...game, events: shuffled });
    expect(saved.ok).toBe(true);

    const loaded = await loadCurrentGame(db);
    if (!loaded.ok || loaded.data === null) {
      throw new Error("expected loaded game");
    }
    const seqs = loaded.data.events.map((event) => event.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(loaded.data.events).toEqual(game.events);
  });

  it("STORAGE-003 returns null when no game is stored", async () => {
    const loaded = await loadCurrentGame(db);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      throw new Error(loaded.error.message);
    }
    expect(loaded.data).toBeNull();
  });

  it("STORAGE-004 appendEvents is idempotent on duplicate eventId", async () => {
    const game = buildRealGame();
    await saveGameState(db, game);

    const before = await db.events.count();
    // 重复 append 同一批事件 → 计数不变（按 eventId upsert）。
    const again = await appendEvents(db, game.events);
    expect(again.ok).toBe(true);
    const after = await db.events.count();
    expect(after).toBe(before);
    expect(after).toBe(game.events.length);
  });

  it("STORAGE-005 clearCurrentGame wipes game tables but keeps settings", async () => {
    const game = buildRealGame();
    await saveGameState(db, game);
    await setSetting(db, "theme", "dark");

    const cleared = await clearCurrentGame(db);
    expect(cleared.ok).toBe(true);

    expect(await db.currentGame.count()).toBe(0);
    expect(await db.events.count()).toBe(0);
    expect(await db.snapshots.count()).toBe(0);

    const theme = await getSetting<string>(db, "theme");
    expect(theme.ok && theme.data).toBe("dark");
  });

  it("STORAGE-006 settings get/set round-trip and missing key returns null", async () => {
    const missing = await getSetting(db, "nope");
    expect(missing.ok && missing.data).toBeNull();

    await setSetting(db, "wireApi", "chat");
    const value = await getSetting<string>(db, "wireApi");
    expect(value.ok && value.data).toBe("chat");
  });

  it("STORAGE-007 saveGameState rejects mismatched snapshot/session gameId", async () => {
    const game = buildRealGame();
    const result = await saveGameState(db, {
      ...game,
      snapshot: { ...game.snapshot, gameId: "other-game" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected save failure");
    }
    expect(result.error.code).toBe("STORAGE_SAVE_FAILED");
  });
});

describe("M3 storage recovery", () => {
  it("RECOVERY-001 reports empty when no game is stored", async () => {
    const result = await recoverGame(db);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    expect(result.data.status).toBe("empty");
  });

  it("RECOVERY-002 recovers a valid stored game", async () => {
    const game = buildRealGame();
    await saveGameState(db, game);

    const result = await recoverGame(db);
    expect(result.ok).toBe(true);
    if (!result.ok || result.data.status !== "recovered") {
      throw new Error(`expected recovered, got ${result.ok ? result.data.status : "err"}`);
    }
    expect(result.data.game.snapshot).toEqual(game.snapshot);
    expect(result.data.game.events).toEqual(game.events);
  });

  it("RECOVERY-003 resets and clears on a corrupted snapshot", async () => {
    const game = buildRealGame();
    await saveGameState(db, game);

    // 直接破坏快照（绕过 saveGameState 的一致性校验），模拟损坏存档。
    await db.snapshots.put({
      ...game.snapshot,
      gamePhase: "not_a_real_phase" as GameSnapshot["gamePhase"],
    });

    const result = await recoverGame(db);
    expect(result.ok).toBe(true);
    if (!result.ok || result.data.status !== "reset") {
      throw new Error(`expected reset, got ${result.ok ? result.data.status : "err"}`);
    }
    // 清档后再恢复 → empty。
    const again = await recoverGame(db);
    expect(again.ok && again.data.status).toBe("empty");
    expect(await db.events.count()).toBe(0);
  });

  it("RECOVERY-004 resets when snapshot lastEventSeq is out of sync with events", async () => {
    const game = buildRealGame();
    await saveGameState(db, game);

    // 把快照 lastEventSeq 改成与事件流不对齐的值。
    await db.snapshots.put({ ...game.snapshot, lastEventSeq: game.snapshot.lastEventSeq + 99 });

    const result = await recoverGame(db);
    expect(result.ok).toBe(true);
    if (!result.ok || result.data.status !== "reset") {
      throw new Error(`expected reset, got ${result.ok ? result.data.status : "err"}`);
    }
  });
});
