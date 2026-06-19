import type {
  CurrentGameRecord,
  GameSession,
  GameSnapshot,
  Result,
  TruthEvent,
} from "../shared";
import { err, ok } from "../shared";

import type { GameDatabase } from "./db";

/**
 * saveGameState 的输入：一次状态变更后 store 持有的三件套。
 */
export type SaveGameStateInput = {
  session: GameSession;
  snapshot: GameSnapshot;
  /** 本次要追加的事件（按 eventId 幂等；可只传新事件，也可传全量）。 */
  events: TruthEvent[];
};

/**
 * loadCurrentGame 的返回：完整重建一局所需的全部持久化数据。
 */
export type PersistedGame = {
  record: CurrentGameRecord;
  session: GameSession;
  snapshot: GameSnapshot;
  /** 按 seq 升序的全部事件。 */
  events: TruthEvent[];
};

function saveFailed(message: string, cause?: unknown): Result<never> {
  return err({
    code: "STORAGE_SAVE_FAILED",
    message: cause ? `${message}: ${String(cause)}` : message,
    userMessage: "保存进度失败，请重试。",
    retryable: true,
    source: "storage",
  });
}

function loadFailed(message: string, cause?: unknown): Result<never> {
  return err({
    code: "STORAGE_LOAD_FAILED",
    message: cause ? `${message}: ${String(cause)}` : message,
    userMessage: "读取存档失败。",
    retryable: false,
    source: "storage",
  });
}

function toCurrentGameRecord(session: GameSession, snapshot: GameSnapshot): CurrentGameRecord {
  return {
    gameId: session.gameId,
    schemaVersion: session.schemaVersion,
    session,
    snapshotRef: {
      gameId: snapshot.gameId,
      lastEventSeq: snapshot.lastEventSeq,
    },
  };
}

/**
 * 原子写：在单个读写事务里 put 事件 + put 快照 + put currentGame 指针。
 *
 * 三表同事务，要么全成功要么全回滚 —— 保证快照永远不会与事件流分叉，
 * 这也是 recovery 可以信任快照、不必做完整 foldEvents 重放的前提。
 * events 用 bulkPut（按 eventId upsert）→ 重复 eventId 幂等。
 */
export async function saveGameState(
  db: GameDatabase,
  input: SaveGameStateInput,
): Promise<Result<void>> {
  const { session, snapshot, events } = input;
  if (snapshot.gameId !== session.gameId) {
    return saveFailed("snapshot.gameId 与 session.gameId 不一致");
  }

  try {
    await db.transaction("rw", db.events, db.snapshots, db.currentGame, async () => {
      if (events.length > 0) {
        await db.events.bulkPut(events);
      }
      await db.snapshots.put(snapshot);
      await db.currentGame.put(toCurrentGameRecord(session, snapshot));
    });
    return ok(undefined);
  } catch (cause) {
    return saveFailed("saveGameState 事务失败", cause);
  }
}

/**
 * 仅追加事件，按 eventId 去重幂等（bulkPut upsert）。事件不可变，重复键覆盖等价于 no-op。
 */
export async function appendEvents(
  db: GameDatabase,
  events: TruthEvent[],
): Promise<Result<void>> {
  if (events.length === 0) {
    return ok(undefined);
  }
  try {
    await db.events.bulkPut(events);
    return ok(undefined);
  } catch (cause) {
    return saveFailed("appendEvents 失败", cause);
  }
}

/**
 * 加载当前对局的全部持久化数据。无存档时返回 ok(null)。
 */
export async function loadCurrentGame(db: GameDatabase): Promise<Result<PersistedGame | null>> {
  try {
    const record = await db.currentGame.toCollection().first();
    if (!record) {
      return ok(null);
    }

    const snapshot = await db.snapshots.get(record.gameId);
    if (!snapshot) {
      return loadFailed(`currentGame 指向的快照缺失: ${record.gameId}`);
    }

    const events = await db.events
      .where("[gameId+seq]")
      .between([record.gameId, -Infinity], [record.gameId, Infinity])
      .toArray();
    events.sort((a, b) => a.seq - b.seq);

    return ok({ record, session: record.session, snapshot, events });
  } catch (cause) {
    return loadFailed("loadCurrentGame 失败", cause);
  }
}

/**
 * 清空当前对局（currentGame + snapshots + events）。settings 保留。开新局前调用，防串档。
 */
export async function clearCurrentGame(db: GameDatabase): Promise<Result<void>> {
  try {
    await db.transaction("rw", db.events, db.snapshots, db.currentGame, async () => {
      await db.events.clear();
      await db.snapshots.clear();
      await db.currentGame.clear();
    });
    return ok(undefined);
  } catch (cause) {
    return saveFailed("clearCurrentGame 失败", cause);
  }
}

/**
 * 读取一条 setting。不存在返回 ok(null)。
 */
export async function getSetting<T = unknown>(
  db: GameDatabase,
  key: string,
): Promise<Result<T | null>> {
  try {
    const row = await db.settings.get(key);
    return ok(row ? (row.value as T) : null);
  } catch (cause) {
    return loadFailed(`getSetting(${key}) 失败`, cause);
  }
}

/**
 * 写入一条 setting（upsert）。
 */
export async function setSetting(
  db: GameDatabase,
  key: string,
  value: unknown,
): Promise<Result<void>> {
  try {
    await db.settings.put({ key, value });
    return ok(undefined);
  } catch (cause) {
    return saveFailed(`setSetting(${key}) 失败`, cause);
  }
}
