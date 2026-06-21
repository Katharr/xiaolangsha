import { useEffect, useMemo, type CSSProperties } from "react";

import type { GameAction } from "../shared";

import "./home.css";

/**
 * 主页 / 开场屏（mode_select 相位）。深色复古夜晚氛围：漂移极光 + 星空 + 上浮余烬
 * + 缓慢自转的环形牌桌剪影 + 呼吸月亮 + 流光标题，两张模式卡片（标准局 / 自由局）。
 * 纯展示 + 仅派发 create_game，不读任何 vi/真相（pre-game，ISO 无关）。
 */

export type HomeScreenProps = {
  busy: boolean;
  humanPlayerId: string;
  boardId: string;
  nextKey: (prefix: string) => string;
  act: (action: GameAction) => void;
};

/** 座位 6 色循环（1 号金=「你」），与游戏内一致。 */
const SEAT_COLORS = [
  "#d8b25a",
  "#d59a4e",
  "#5b91c9",
  "#b07cc4",
  "#d4685a",
  "#44b2a6",
  "#6fae8f",
];

type Star = { left: number; top: number; dur: number; del: number; scale: number };
type Ember = { left: number; dur: number; del: number; sway: number; size: number };
type RingDot = { left: number; top: number; color: string };

export function HomeScreen({
  busy,
  humanPlayerId,
  boardId,
  nextKey,
  act,
}: HomeScreenProps) {
  // 主页固定走深色夜晚态（去掉白天主题类），契合开场氛围。
  useEffect(() => {
    document.body.classList.remove("is-day");
  }, []);

  // 背景装饰只生成一次，避免每次渲染抖动。
  const stars = useMemo<Star[]>(
    () =>
      Array.from({ length: 64 }, () => ({
        left: Math.random() * 100,
        top: Math.random() * 100,
        dur: 2.5 + Math.random() * 4,
        del: Math.random() * 5,
        scale: 0.6 + Math.random() * 1.4,
      })),
    [],
  );
  const embers = useMemo<Ember[]>(
    () =>
      Array.from({ length: 16 }, () => ({
        left: Math.random() * 100,
        dur: 11 + Math.random() * 10,
        del: Math.random() * 12,
        sway: Math.random() * 60 - 30,
        size: 0.7 + Math.random() * 1.2,
      })),
    [],
  );
  const ringDots = useMemo<RingDot[]>(() => {
    const n = 7;
    return Array.from({ length: n }, (_, i) => {
      const a = ((-90 + (i * 360) / n) * Math.PI) / 180;
      return {
        left: 50 + 47 * Math.cos(a),
        top: 50 + 47 * Math.sin(a),
        color: SEAT_COLORS[i % SEAT_COLORS.length],
      };
    });
  }, []);

  const start = (mode: "standard" | "free") =>
    act({
      type: "create_game",
      idempotencyKey: nextKey("create"),
      mode,
      boardId,
      humanPlayerId,
    });

  return (
    <div className="home-screen">
      <div className="hs-aurora" aria-hidden="true">
        <b className="b1" />
        <b className="b2" />
        <b className="b3" />
      </div>
      <div className="hs-veil" aria-hidden="true" />
      <div className="hs-stars" aria-hidden="true">
        {stars.map((s, i) => (
          <i
            key={i}
            style={
              {
                left: `${s.left}%`,
                top: `${s.top}%`,
                transform: `scale(${s.scale})`,
                "--dur": `${s.dur}s`,
                "--del": `${s.del}s`,
              } as CSSProperties
            }
          />
        ))}
      </div>
      <div className="hs-embers" aria-hidden="true">
        {embers.map((e, i) => (
          <i
            key={i}
            style={
              {
                left: `${e.left}%`,
                width: `${4 * e.size}px`,
                height: `${4 * e.size}px`,
                "--dur": `${e.dur}s`,
                "--del": `${e.del}s`,
                "--sway": `${e.sway}px`,
              } as CSSProperties
            }
          />
        ))}
      </div>

      <main className="hs-home">
        <div className="hs-ring" aria-hidden="true">
          <div className="r" />
          {ringDots.map((d, i) => (
            <i
              key={i}
              style={{
                left: `${d.left}%`,
                top: `${d.top}%`,
                color: d.color,
                background: d.color,
              }}
            />
          ))}
        </div>

        <div className="hs-hero">
          <div className="hs-moon" aria-hidden="true" />
          <h1 className="hs-title">小狼杀</h1>
          <p className="hs-subtitle">W&nbsp;E&nbsp;R&nbsp;E&nbsp;W&nbsp;O&nbsp;L&nbsp;F</p>
          <p className="hs-tagline">
            一个人，一桌 AI。<b>白天唇枪舌战，夜晚刀光暗涌</b>——
            <br />
            读心、伪装、投票放逐，看你能否活到最后。
          </p>

          <div className="hs-modes">
            <article className="hs-mode primary">
              <span className="hs-ribbon">推荐</span>
              <span className="hs-watermark">🌙</span>
              <div className="hs-medallion">🌙</div>
              <div className="hs-mtitle">
                <h3>标准局</h3>
                <span className="hs-pill">7 人 · 屠边</span>
              </div>
              <p className="hs-desc">
                经典 7 人配置，随机发牌。1 名真人 + 6 名 AI，玩到一方屠边获胜。
              </p>
              <div className="hs-roles">
                <span className="hs-chip">🐺 <b>狼人</b>×2</span>
                <span className="hs-chip">👤 <b>村民</b>×2</span>
                <span className="hs-chip">🔮 预言家</span>
                <span className="hs-chip">🧪 女巫</span>
                <span className="hs-chip">🎯 猎人</span>
              </div>
              <button
                type="button"
                className="hs-cta"
                disabled={busy}
                onClick={() => start("standard")}
              >
                开始标准局 <span className="arr">→</span>
              </button>
            </article>

            <article className="hs-mode free">
              <span className="hs-watermark">🎴</span>
              <div className="hs-medallion">🎴</div>
              <div className="hs-mtitle">
                <h3>练习 / 自由局</h3>
                <span className="hs-pill">自选身份</span>
              </div>
              <p className="hs-desc">
                挑一个你想练的身份反复打磨：体会预言家的查验、女巫的抉择、狼人的伪装。
              </p>
              <div className="hs-roles">
                <span className="hs-chip">自选 <b>狼人</b></span>
                <span className="hs-chip">自选 <b>预言家</b></span>
                <span className="hs-chip">自选 <b>村民</b></span>
              </div>
              <button
                type="button"
                className="hs-cta"
                disabled={busy}
                onClick={() => start("free")}
              >
                进入自由局 <span className="arr">→</span>
              </button>
            </article>
          </div>

          <p className="hs-footnote">
            <span>大语言模型</span>驱动的 AI 玩家 · 严格信息隔离 · 单机本地可玩
          </p>
        </div>
      </main>
    </div>
  );
}
