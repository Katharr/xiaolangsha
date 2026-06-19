import type { Result } from "../shared";
import { gameSnapshotSchema, ok } from "../shared";

import type { GameDatabase } from "./db";
import { clearCurrentGame, loadCurrentGame, type PersistedGame } from "./repository";

/**
 * recoverGame 的结果：
 * - status "empty"：无存档（全新启动）。
 * - status "recovered"：存档有效，可直接恢复对局。
 * - status "reset"：存档损坏/不一致，已清空，按全新启动处理。
 */
export type RecoveryResult =
  | { status: "empty" }
  | { status: "recovered"; game: PersistedGame }
  | { status: "reset"; reason: string };

/**
 * 启动恢复流程：加载当前对局并校验快照。
 *
 * MVP 策略：因 saveGameState 是三表原子写，快照永远不会与事件流分叉，
 * 因此校验通过的快照即权威，无需做完整 foldEvents 重放（完整重放列为已知限制）。
 * 这里只做两道校验：
 *   1. gameSnapshotSchema.safeParse —— 结构完整性。
 *   2. lastEventSeq 与事件流最大 seq 对齐 —— 原子写一致性。
 * 任一失败即视为损坏：clearCurrentGame 清档，返回 reset（调用方按全新开局处理）。
 */
export async function recoverGame(db: GameDatabase): Promise<Result<RecoveryResult>> {
  const loaded = await loadCurrentGame(db);
  if (!loaded.ok) {
    return loaded;
  }
  if (loaded.data === null) {
    return ok({ status: "empty" });
  }

  const game = loaded.data;

  const parsed = gameSnapshotSchema.safeParse(game.snapshot);
  if (!parsed.success) {
    return resetCorrupted(db, `快照结构校验失败: ${parsed.error.message}`);
  }

  if (game.events.length > 0) {
    const maxSeq = game.events.reduce((max, event) => Math.max(max, event.seq), -Infinity);
    if (maxSeq !== game.snapshot.lastEventSeq) {
      return resetCorrupted(
        db,
        `快照与事件流不一致: lastEventSeq=${game.snapshot.lastEventSeq}, 事件最大 seq=${maxSeq}`,
      );
    }
  } else if (game.snapshot.lastEventSeq > 0) {
    return resetCorrupted(
      db,
      `快照声称 lastEventSeq=${game.snapshot.lastEventSeq} 但事件流为空`,
    );
  }

  return ok({ status: "recovered", game });
}

async function resetCorrupted(db: GameDatabase, reason: string): Promise<Result<RecoveryResult>> {
  const cleared = await clearCurrentGame(db);
  if (!cleared.ok) {
    return cleared;
  }
  return ok({ status: "reset", reason });
}
