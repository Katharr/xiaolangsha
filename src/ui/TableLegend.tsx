import type { Role } from "../shared";

/**
 * 桌面标记图例卡（❔ 钮在 TableTools 里，这里只渲染卡片本体）。
 * 按 viewer 角色只列他见得到的私密 token 种类——形状编码的教学入口；
 * 公开标记（死因牌/得票数/平票候选）人人相同。
 */

type LegendRow = { cls: string; ch: string; label: string };

const PRIV_ROWS: Partial<Record<Role, LegendRow[]>> = {
  seer: [
    { cls: "tk tk-wolf", ch: "狼", label: "查验为狼人" },
    { cls: "tk tk-good", ch: "好", label: "查验为好人（金水）" },
  ],
  werewolf: [
    { cls: "tk tk-wolf", ch: "狼", label: "你的狼队友" },
    { cls: "tk tk-knife", ch: "刀", label: "出刀未得手" },
  ],
  witch: [
    { cls: "tk tk-save", ch: "救", label: "解药救回" },
    { cls: "tk tk-poison", ch: "毒", label: "毒药目标" },
  ],
  guard: [{ cls: "tk tk-guard", ch: "守", label: "夜间守护" }],
};

export function TableLegend({ role, open }: { role: Role; open: boolean }) {
  if (!open) {
    return null;
  }
  const priv = PRIV_ROWS[role] ?? [];
  return (
    <div className="lg-card">
      <div className="lg-title">桌面标记图例</div>
      {priv.length > 0 ? (
        priv.map((r) => (
          <div className="lg-row" key={r.ch + r.label}>
            <span className={r.cls}>{r.ch}</span>
            <span>
              {r.label} <i className="lg-priv nb">· 仅你可见</i>
            </span>
          </div>
        ))
      ) : (
        <div className="lg-row lg-dim">
          你没有夜间私密情报，<span className="nb">桌面只有公开标记</span>
        </div>
      )}
      {role === "witch" ? (
        <div className="lg-row">
          <span className="pip pip-save" />
          <span>
            药剂 pip：实心=可用 / 空心=已用{" "}
            <i className="lg-priv nb">· 仅你可见</i>
          </span>
        </div>
      ) : null}
      <div className="lg-row">
        <span className="dchip">
          逐·天1 <i className="xn">×3</i>
        </span>
        <span>死因牌 · 公开</span>
      </div>
      <div className="lg-row">
        <span className="vote-badge">3</span>
        <span>得票数 · 开票后公开</span>
      </div>
      <div className="lg-row">
        <span className="badge tie">平</span>
        <span>平票候选 · 公开</span>
      </div>
      <div className="lg-note nb">圆形 = 仅你可见 · 胶囊/角标 = 全场公开</div>
    </div>
  );
}
