import { useMemo, useState, type CSSProperties } from "react";

import { getBoardConfig } from "../rules";
import type { GameAction, Role } from "../shared";

import { ROLE_LABEL } from "./labels";

import "./home.css";

/**
 * 选身份页（role_setup 相位，仅自由局）。整屏接管，复用主页（HomeScreen）的深色夜晚
 * 背景与卡片视觉语言，与主页连成一套入场流——而不是渲染一桌空的三列牌桌。
 * 纯展示 + 仅派发 confirm_role_setup，不读任何 vi/真相（pre-game，ISO 无关）。
 */

export type RoleSelectScreenProps = {
  busy: boolean;
  humanPlayerId: string;
  boardId: string;
  nextKey: (prefix: string) => string;
  act: (action: GameAction) => void;
};

/** 座位 6 色循环（与主页/游戏内一致），用于背景牌桌剪影光点。 */
const SEAT_COLORS = [
  "#d8b25a",
  "#d59a4e",
  "#5b91c9",
  "#b07cc4",
  "#d4685a",
  "#44b2a6",
  "#6fae8f",
];

/** 角色展示元信息：图标 + 阵营 + 一句能力简介（按意群书写，描述用 text-wrap:pretty 兜底）。 */
const ROLE_META: Record<Role, { icon: string; wolf: boolean; desc: string }> = {
  werewolf: {
    icon: "🐺",
    wolf: true,
    desc: "夜晚与狼队共谋刀人，白天伪装潜伏、带节奏出好人。",
  },
  seer: {
    icon: "🔮",
    wolf: false,
    desc: "每晚查验一名玩家的善恶，是好人阵营的核心信息源。",
  },
  witch: {
    icon: "🧪",
    wolf: false,
    desc: "一瓶解药一瓶毒药，关键时刻掌握一夜的生杀。",
  },
  hunter: {
    icon: "🎯",
    wolf: false,
    desc: "被放逐或被刀出局时，可开枪带走场上任意一人。",
  },
  guard: {
    icon: "🛡️",
    wolf: false,
    desc: "每晚守护一人免遭狼刀，但不能连续两晚守同一人。",
  },
  idiot: {
    icon: "🤡",
    wolf: false,
    desc: "被票出局时翻牌免死，但从此失去投票权。",
  },
  villager: {
    icon: "👤",
    wolf: false,
    desc: "没有夜晚能力，全凭白天的发言、逻辑与投票翻盘。",
  },
};

type Star = { left: number; top: number; dur: number; del: number; scale: number };
type Ember = { left: number; dur: number; del: number; sway: number; size: number };
type RingDot = { left: number; top: number; color: string };

export function RoleSelectScreen({
  busy,
  humanPlayerId,
  boardId,
  nextKey,
  act,
}: RoleSelectScreenProps) {
  const board = getBoardConfig(boardId);
  // 可选身份 = 当前板去重角色（与旧 ActionArea 一致）；无板时退回三选一。
  const setupRoles: Role[] = board
    ? [...new Set(board.roles)]
    : ["werewolf", "seer", "villager"];
  const aiCount = board ? board.playerCount - 1 : 6;

  const [selectedRole, setSelectedRole] = useState<Role>(
    setupRoles.includes("seer") ? "seer" : setupRoles[0],
  );

  // 背景装饰只生成一次，避免重渲染抖动（与 HomeScreen 同款）。
  const stars = useMemo<Star[]>(
    () =>
      Array.from({ length: 60 }, () => ({
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
      Array.from({ length: 14 }, () => ({
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

  const confirm = () =>
    act({
      type: "confirm_role_setup",
      idempotencyKey: nextKey("setup"),
      playerId: humanPlayerId,
      selectedRole,
    });

  return (
    <div className="home-screen role-select">
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
          <p className="hs-subtitle rs-eyebrow">
            F&nbsp;R&nbsp;E&nbsp;E&nbsp;&nbsp;M&nbsp;O&nbsp;D&nbsp;E
          </p>
          <h1 className="hs-title rs-title">选择你的身份</h1>
          <p className="hs-tagline rs-lede">
            <span className="nb">自由局里你说了算。</span>
            <span className="nb">挑一个想练的身份反复打磨——</span>
            <b className="nb">其余 {aiCount} 名 AI 自动补齐这桌。</b>
          </p>

          <div className="rs-roles">
            {setupRoles.map((role) => {
              const meta = ROLE_META[role];
              const selected = selectedRole === role;
              return (
                <button
                  type="button"
                  key={role}
                  className={`rs-role${meta.wolf ? " wolf" : ""}${selected ? " sel" : ""}`}
                  disabled={busy}
                  aria-pressed={selected}
                  onClick={() => setSelectedRole(role)}
                >
                  <span className="rs-check" aria-hidden="true">
                    ✓
                  </span>
                  <span className="rs-medal" aria-hidden="true">
                    {meta.icon}
                  </span>
                  <h3>
                    <span className="rname">{ROLE_LABEL[role]}</span>{" "}
                    <span className={`rs-fac ${meta.wolf ? "wolf" : "good"}`}>
                      {meta.wolf ? "狼人阵营" : "好人阵营"}
                    </span>
                  </h3>
                  <p>{meta.desc}</p>
                </button>
              );
            })}
          </div>

          <div className="rs-confirm">
            <span className="rs-picked">
              已选：<b>{ROLE_LABEL[selectedRole]}</b>
            </span>
            <button
              type="button"
              className="hs-cta rs-cta"
              disabled={busy}
              onClick={confirm}
            >
              确认身份 <span className="arr">→</span>
            </button>
          </div>

          <p className="hs-footnote rs-foot">
            大语言模型驱动的 AI 玩家 · 严格信息隔离 · 单机本地可玩
          </p>
        </div>
      </main>
    </div>
  );
}
