import { createAvatar } from "@dicebear/core";
import * as adventurer from "@dicebear/adventurer";

import { seatColorVar } from "./PlayerName";

/**
 * DiceBear adventurer 头像（阶段 2）。
 *
 * seed 用**座位号**：每个座位整局对应同一名玩家，且 SeatRing / 气泡 / 思考态 /
 * 名单 / 信息面板各处都拿得到 seat（思考态没有 playerId），用 seat 作种能保证
 * 同一玩家在所有界面是同一张脸——这是优先于「跨局唯一」的一致性诉求。
 *
 * 本地生成 SVG data URI（@dicebear/core + collection，离线可用），按座位缓存。
 * 头像背景透明，座位色透出作底，沿用既有色块审美。纯展示，aria-hidden。
 */

const cache = new Map<number, string>();

function avatarUri(seat: number): string {
  const key = seat >= 1 ? seat : 0;
  let uri = cache.get(key);
  if (!uri) {
    uri = createAvatar(adventurer, {
      seed: `seat-${key}`,
      backgroundColor: [],
    }).toDataUri();
    cache.set(key, uri);
  }
  return uri;
}

/**
 * @param seat 座位号（<1 兜底为统一的「未知」头像）。
 * @param className 沿用原色块的容器类名（尺寸/边框/圆形/灰显由既有 CSS 提供）。
 */
export function Avatar({
  seat,
  className,
}: {
  seat: number;
  className: string;
}) {
  return (
    <span
      className={className}
      style={{ background: seatColorVar(seat) }}
      aria-hidden="true"
    >
      <img className="av-img" src={avatarUri(seat)} alt="" />
    </span>
  );
}
