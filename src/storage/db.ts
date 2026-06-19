import Dexie, { type Table } from "dexie";

import type { CurrentGameRecord, GameSnapshot, TruthEvent } from "../shared";

/**
 * settings 表的行结构（key/value 通用配置存储）。
 */
export type SettingRecord = {
  key: string;
  value: unknown;
};

/**
 * 小狼杀的本地持久化数据库（IndexedDB）。
 *
 * 四张表（与 BUILD-PLAN M3 对齐）：
 * - currentGame: 当前对局指针（CurrentGameRecord，含 session 与 snapshotRef），按 gameId 主键。
 *   MVP 单局单人，正常只有一条；开新局前 clearCurrentGame 会清空。
 * - events: 权威事实事件流（append-only），按 eventId 主键，附 [gameId+seq] 复合索引便于按序加载。
 * - snapshots: 派生快照缓存，按 gameId 主键（每局只保留最新一份，靠 put 覆盖）。
 * - settings: 通用 key/value 配置。
 */
export class GameDatabase extends Dexie {
  currentGame!: Table<CurrentGameRecord, string>;
  events!: Table<TruthEvent, string>;
  snapshots!: Table<GameSnapshot, string>;
  settings!: Table<SettingRecord, string>;

  constructor(name = "xiaolangsha") {
    super(name);
    this.version(1).stores({
      currentGame: "gameId",
      events: "eventId, gameId, [gameId+seq]",
      snapshots: "gameId",
      settings: "key",
    });
  }
}

/**
 * 创建一个数据库实例。测试通过传入唯一 name + fake-indexeddb 实现隔离。
 */
export function createGameDatabase(name?: string): GameDatabase {
  return new GameDatabase(name);
}
