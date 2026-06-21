/**
 * 统一玩家名字着色组件（阶段 1.5）。凡渲染玩家名字处一律复用它，确保
 * 「你」=金色、其余按座位 6 色循环、座位号小字暗灰且不加粗——全局一致。
 * 纯展示，不读任何敏感数据（ISO 安全）。
 */

/** 座位专属色 CSS 变量：按座位号取 theme.css 的 --seat-1..6（整局稳定，7 号与 1 号同色）。
 * 对非法/缺失座位号（<1）兜底到 1 号色，避免生成无效的 --seat-0。 */
export function seatColorVar(seat: number): string {
  const n = seat >= 1 ? seat : 1;
  return `var(--seat-${((n - 1) % 6) + 1})`;
}

type PlayerNameProps = {
  name: string;
  seat: number;
  /** 是否是 viewer 自己：自己用金色 --gold，其余按座位色。 */
  isSelf?: boolean;
  /** 弱化态（出局/名单灰显）：不上座位色，交由祖先 .dead 样式置灰删除线。 */
  muted?: boolean;
};

export function PlayerName({
  name,
  seat,
  isSelf = false,
  muted = false,
}: PlayerNameProps) {
  const color = isSelf ? "var(--gold)" : seatColorVar(seat);
  return (
    <span className="pname">
      <span className="pname-n" style={muted ? undefined : { color }}>
        {name}
      </span>
      <span className="pname-no">（{seat}号）</span>
    </span>
  );
}

/** 取名字首字（色块头像占位用，阶段 2 换 DiceBear）。 */
export function firstChar(label: string | undefined): string {
  return label?.trim().charAt(0) || "?";
}

/** 从「名字（N号）」标签剥出裸名（store 的 speakerLabel 已含座位后缀，UI 侧复原）。 */
export function bareName(
  label: string | undefined,
  seat: number | undefined,
): string {
  if (!label) {
    return "?";
  }
  return seat ? label.replace(`（${seat}号）`, "") : label;
}
