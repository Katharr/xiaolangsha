import "fake-indexeddb/auto";

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { App } from "./App";
import { ScriptedAiClient } from "./ai-client";
import { createGameDatabase } from "./storage";
import { createGameStore, type GameStore } from "./store";

const now = () => "2026-06-19T13:00:00.000Z";

let dbCounter = 0;

/**
 * 点击按钮并 flush store 的 fire-and-forget dispatch 链（规则引擎→持久化→AI driver）。
 * dispatch 同步置 busy=true、收尾置 false，因此轮询 busy 即可等待整条链落定；
 * 持久化经 fake-indexeddb 走宏任务，故用 setTimeout 让出。
 */
async function clickAndSettle(store: GameStore, element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element);
    for (let i = 0; i < 200 && store.getState().busy; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  });
}

async function renderApp() {
  dbCounter += 1;
  const db = createGameDatabase(`app-test-${dbCounter}`);
  const store = createGameStore({ ai: new ScriptedAiClient(), db, now });
  render(<App store={store} />);
  // 等 bootstrap 跑完再交互，避免启动恢复与点击 dispatch 竞争同一 store。
  await waitFor(() => expect(store.getState().ready).toBe(true));
  await screen.findByText("开始标准局"); // mode_select 入口。
  return store;
}

/** 自由局选村民并揭示身份，driver 跑完 AI 夜晚后停在天亮播报。 */
async function startFreeVillager(store: GameStore) {
  await clickAndSettle(store, screen.getByText("练习 / 自由局"));
  await clickAndSettle(store, await screen.findByText("村民"));
  await clickAndSettle(store, screen.getByText("确认身份"));
  await clickAndSettle(store, await screen.findByText("确认进入首夜"));
  await screen.findByText("进入发言");
}

describe("App 聊天室 UI", () => {
  it("启动后展示模式选择入口", async () => {
    await renderApp();
    expect(screen.getByText("开始标准局")).toBeInTheDocument();
    expect(screen.getByText("练习 / 自由局")).toBeInTheDocument();
  });

  it("自由村民局可走到天亮播报，状态栏显示真人身份且不泄露 AI 身份", async () => {
    const store = await renderApp();
    await startFreeVillager(store);

    // 顶部状态栏显示真人自己的身份。
    expect(screen.getByText("你是：村民")).toBeInTheDocument();
    // ISO-001：局中不出现任何角色身份文本（AI 身份不可见）。
    expect(screen.queryByText(/狼人|预言家/)).toBeNull();
    // 已有主持人/系统消息入流。
    expect(screen.getByRole("log")).toBeInTheDocument();
  });

  it("轮到真人发言时启用文本输入区", async () => {
    const store = await renderApp();
    await startFreeVillager(store);
    await clickAndSettle(store, screen.getByText("进入发言"));

    // driver 跑完先于真人的 AI 发言后，停在真人发言，输入区启用。
    const field = await screen.findByPlaceholderText("输入你的发言…");
    expect(field).not.toBeDisabled();
  });
});
