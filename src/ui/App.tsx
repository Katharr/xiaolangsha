import {
  BookOpenText,
  Brain,
  ClipboardList,
  MessageSquareText,
  Play,
  ShieldQuestion,
  UsersRound
} from "lucide-react";

const seats = ["1号", "2号", "3号", "4号", "5号", "6号"];

const panels = [
  {
    title: "行动面板",
    description: "后续阶段承载夜晚行动、白天发言和投票入口。",
    icon: ClipboardList
  },
  {
    title: "时间轴",
    description: "后续阶段记录公开流程、关键行为和赛后解密材料。",
    icon: BookOpenText
  },
  {
    title: "局内教练",
    description: "后续阶段只基于玩家当前视角提供训练建议。",
    icon: Brain
  },
  {
    title: "复盘",
    description: "后续阶段展示脚本评分和可验证的对局回顾。",
    icon: MessageSquareText
  }
];

export function App() {
  return (
    <main className="app-shell">
      <section className="workspace" aria-labelledby="app-title">
        <header className="topbar">
          <div>
            <p className="eyebrow">单人 AI 狼人杀训练工具</p>
            <h1 id="app-title">小狼杀</h1>
          </div>
          <button className="start-button" type="button" disabled>
            <Play size={18} aria-hidden="true" />
            开始训练
          </button>
        </header>

        <section className="brief" aria-label="MVP 目标">
          <div>
            <h2>quick-6-v1 训练闭环</h2>
            <p>
              MVP 目标是在 10 分钟内完成一局本地可运行训练：开始对局、完成关键行动、查看结算、评分和复盘。
            </p>
          </div>
          <div className="status-strip" aria-label="当前阶段状态">
            <span>阶段 00</span>
            <span>项目基础搭建</span>
            <span>无 API key 可运行</span>
          </div>
        </section>

        <section className="table-zone" aria-label="训练桌占位">
          <div className="table-panel">
            <div className="table-header">
              <div>
                <h2>游戏桌</h2>
                <p>6 人快速局席位占位，玩法逻辑将在后续阶段接入。</p>
              </div>
              <UsersRound size={22} aria-hidden="true" />
            </div>
            <div className="seat-grid">
              {seats.map((seat) => (
                <div className="seat" key={seat}>
                  <span className="seat-number">{seat}</span>
                  <span className="seat-state">待接入</span>
                </div>
              ))}
            </div>
          </div>

          <aside className="role-panel" aria-label="玩家视角占位">
            <ShieldQuestion size={28} aria-hidden="true" />
            <h2>玩家视角</h2>
            <p>这里将显示玩家自己的身份、当前阶段和可执行动作，不展示规则外隐藏信息。</p>
          </aside>
        </section>

        <section className="panel-grid" aria-label="功能区域占位">
          {panels.map((panel) => {
            const Icon = panel.icon;

            return (
              <article className="placeholder-panel" key={panel.title}>
                <div className="panel-title">
                  <Icon size={20} aria-hidden="true" />
                  <h2>{panel.title}</h2>
                </div>
                <p>{panel.description}</p>
              </article>
            );
          })}
        </section>
      </section>
    </main>
  );
}
